// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, isWildcardHost, localAddresses, normalizeHost, readRunInfo, runFilePath } from '../src/app.js';
import { defaultMigrationsDir, readMigrationFiles } from '../src/db.js';
import { client, startApp, tempDir } from './helpers.js';

/** 用指定的 Host 头请求首页，返回状态码。 */
function statusWithHost(port, host) {
  return new Promise((resolveStatus, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
      res.resume();
      resolveStatus(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

test('页面返回带站点外壳的中文 HTML 和安全响应头', async (t) => {
  const app = await startApp(t);
  const response = await fetch(`${app.url}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  const body = await response.text();
  assert.match(body, /<html lang="zh-CN">/);
  assert.match(body, /<script src="\/assets\/js\/app\.js" defer><\/script>/);
  assert.doesNotMatch(body, /<script>(?!<\/script>)/, '页面不应包含内联脚本');
});

test('静态资源可协商缓存，不提供目录外或隐藏文件', async (t) => {
  const app = await startApp(t);
  const css = await fetch(`${app.url}/assets/css/app.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.match(css.headers.get('cache-control'), /public/);
  const etag = css.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(`${app.url}/assets/css/app.css`, { headers: { 'if-none-match': etag } })).status, 304);
  assert.match(await (await fetch(`${app.url}/assets/js/app.js`)).text(), /use strict/);
  assert.equal((await fetch(`${app.url}/assets/favicon.svg`)).headers.get('content-type'), 'image/svg+xml');
  for (const path of ['/assets/%2e%2e/src/app.js', '/assets/..%2fpackage.json', '/assets/.hidden', '/assets/css', '/media/python-basics.mp4', '/migrations/001-init.sql']) {
    assert.equal((await fetch(`${app.url}${path}`)).status, 404, path);
  }
});

test('页面路由出错返回 HTML 错误页，接口出错返回中文 JSON', async (t) => {
  const app = await startApp(t);
  const page = await fetch(`${app.url}/no-such-page`);
  assert.equal(page.status, 404);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const html = await page.text();
  assert.match(html, /页面不存在/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /<p class="lead">链接可能写错了，或者这门课程还没有发布。<\/p>/);
  const wrongMethod = await fetch(`${app.url}/`, { method: 'DELETE' });
  assert.equal(wrongMethod.status, 405);
  assert.match(await wrongMethod.text(), /<p class="lead">[^<]*。<\/p>/, '没有现成说明时显示原因，并补上句号');

  const api = await fetch(`${app.url}/api/no-such-api`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await api.json(), { error: '接口不存在' });

  const c = client(app.url);
  const unsupported = await c.request('/api/health', { method: 'PUT', json: {} });
  assert.equal(unsupported.status, 405);
  assert.match(unsupported.headers.get('allow'), /GET/);
});

test('非 GET 接口要求 JSON 与同源请求，并拒绝陌生 Host', async (t) => {
  const app = await startApp(t);
  const noJson = await fetch(`${app.url}/api/health`, { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(noJson.status, 415);
  assert.match((await noJson.json()).error, /Content-Type: application\/json/);
  const crossSite = await fetch(`${app.url}/api/health`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://evil.example' } });
  assert.equal(crossSite.status, 403);

  const { port } = new URL(app.url);
  const status = await new Promise((resolveStatus, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/', headers: { host: 'evil.example' } }, (res) => {
      res.resume();
      resolveStatus(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 400);
});

test('只有通配监听地址才开启局域网模式', () => {
  assert.equal(isWildcardHost('0.0.0.0'), true);
  assert.equal(isWildcardHost('::'), true);
  assert.equal(isWildcardHost('127.0.0.1'), false);
  assert.equal(normalizeHost('Example.LOCAL:3000'), 'example.local');
});

test('默认模式不接受局域网 Host', async (t) => {
  const app = await startApp(t);
  const { port } = new URL(app.url);
  assert.equal(await statusWithHost(port, '10.10.31.106'), 400);
  assert.equal(app.notices.some((notice) => /局域网访问/.test(notice)), false);
});

test('局域网模式放行本机网卡地址与自定义主机名，仍拒绝陌生 Host', async (t) => {
  const app = await startApp(t, { lanAccess: true, allowedHosts: ['my-mac.local'] });
  const { port } = new URL(app.url);
  assert.equal(await statusWithHost(port, 'localhost'), 200);
  for (const address of localAddresses()) {
    assert.equal(await statusWithHost(port, address), 200, `本机网卡地址 ${address} 应可访问`);
  }
  assert.equal(await statusWithHost(port, 'my-mac.local'), 200, 'ALLOWED_HOSTS 中的主机名应可访问');
  assert.equal(await statusWithHost(port, 'evil.example'), 400, '陌生 Host 仍应拒绝');
  assert.ok(app.notices.some((notice) => /局域网访问/.test(notice)));
});

test('健康检查报告迁移状态', async (t) => {
  const app = await startApp(t);
  const response = await fetch(`${app.url}/api/health`);
  const applied = readMigrationFiles(defaultMigrationsDir).map((m) => m.filename);
  assert.deepEqual(await response.json(), { ok: true, migrations: { applied, pending: [] } });
});

test('运行记录只允许一个实例使用同一数据目录，失效记录自动清理', async (t) => {
  const dataDir = tempDir(t);
  const app = await startApp(t, { dataDir });
  const info = readRunInfo(dataDir);
  assert.equal(info.pid, process.pid);
  assert.equal(info.url, app.url);
  assert.match(info.token, /^[0-9a-f]{64}$/);
  assert.equal(statSync(runFilePath(dataDir)).mode & 0o777, 0o600);

  const second = createApp({ dataDir, port: 0 });
  await assert.rejects(second.start(), (error) => error.code === 'already_running' && /已有学堂在运行/.test(error.message));
  assert.ok(existsSync(runFilePath(dataDir)), '失败的第二个实例不能删掉第一个实例的运行记录');

  await app.stop();
  assert.equal(existsSync(runFilePath(dataDir)), false);

  writeFileSync(runFilePath(dataDir), JSON.stringify({ pid: 2 ** 31 - 2, url: 'http://127.0.0.1:1', token: 'x' }));
  const third = await startApp(t, { dataDir });
  assert.ok(third.notices.some((n) => /已清理/.test(n)));
  assert.equal(readRunInfo(dataDir).pid, process.pid);
});

test('数据库有待执行的迁移时拒绝启动并保持数据不变', async (t) => {
  const dataDir = tempDir(t);
  const migrationsDir = join(tempDir(t), 'migrations');
  cpSync(defaultMigrationsDir, migrationsDir, { recursive: true });
  const first = await startApp(t, { dataDir, migrationsDir });
  await first.stop();

  writeFileSync(join(migrationsDir, '900-extra.sql'), 'CREATE TABLE extra (id INTEGER PRIMARY KEY);\n');
  const app = createApp({ dataDir, port: 0, migrationsDir });
  await assert.rejects(app.start(), (error) => {
    assert.equal(error.code, 'pending_migrations');
    assert.deepEqual(error.pending, ['900-extra.sql']);
    return true;
  });
  assert.equal(existsSync(runFilePath(dataDir)), false);
});

test('维护令牌可以请求正常停服，错误令牌被拒绝', async (t) => {
  const dataDir = tempDir(t);
  const app = await startApp(t, { dataDir });
  const { token } = JSON.parse(readFileSync(runFilePath(dataDir), 'utf8'));
  assert.equal((await fetch(`${app.url}/internal/stop`, { method: 'POST', headers: { 'x-maintenance-token': 'wrong' } })).status, 403);
  const response = await fetch(`${app.url}/internal/stop`, { method: 'POST', headers: { 'x-maintenance-token': token } });
  assert.equal(response.status, 202);
  await app.closed;
  assert.equal(existsSync(runFilePath(dataDir)), false);
  assert.equal(app.db, null);
});
