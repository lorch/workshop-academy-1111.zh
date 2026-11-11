// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { projectRoot } from '../src/db.js';
import { client, enroll, login, startApp } from './helpers.js';

const mediaDir = resolve(projectRoot, 'media');

test('签发播放地址的各情形状态码与中文错误逐一对应', async (t) => {
  const app = await startApp(t);
  const guest = client(app.url);
  const anonymous = await guest.post('/api/courses/1/play');
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: '请先登录后再观看' });

  const unenrolled = client(app.url);
  await login(unenrolled);
  const denied = await unenrolled.post('/api/courses/1/play');
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: '请先报名后再观看' });

  const cancelled = client(app.url);
  await login(cancelled, 'student2');
  const record = await enroll(cancelled, 1);
  await cancelled.del(`/api/enrollments/${record.id}`);
  const afterCancel = await cancelled.post('/api/courses/1/play');
  assert.equal(afterCancel.status, 403, '报名已取消');
  assert.deepEqual(await afterCancel.json(), { error: '请先报名后再观看' });

  // 他人报名不使当前账号获得资格。
  const other = client(app.url);
  await login(other, 'admin');
  assert.equal((await other.post('/api/courses/1/play')).status, 403);

  for (const id of [4, 999, 'abc', '01']) {
    const unavailable = await unenrolled.post(`/api/courses/${id}/play`);
    assert.equal(unavailable.status, 404, String(id));
    assert.deepEqual(await unavailable.json(), { error: '课程不存在或尚未发布' });
  }

  const enrolled = client(app.url);
  await login(enrolled, 'student');
  await enroll(enrolled, 1);
  const granted = await enrolled.post('/api/courses/1/play');
  assert.equal(granted.status, 200);
  assert.ok((await granted.json()).url, '具备资格时签发地址');
});

test('播放地址含 url 与 expiresAt，有效期 60 秒，篡改参数被 403 拒绝', async (t) => {
  const app = await startApp(t);
  const c = client(app.url);
  await login(c);
  await enroll(c, 1);
  const before = Date.now();
  const response = await c.post('/api/courses/1/play');
  assert.equal(response.status, 200);
  const grant = await response.json();
  assert.deepEqual(Object.keys(grant).sort(), ['expiresAt', 'url']);
  assert.match(grant.url, /^\/media\/1\?expires=\d+&signature=[0-9a-f]{64}$/);
  assert.ok(grant.expiresAt >= before + 59_000 && grant.expiresAt <= Date.now() + 60_000);
  assert.equal(Number(new URL(grant.url, app.url).searchParams.get('expires')), grant.expiresAt);

  const signed = new URL(grant.url, app.url);
  const signature = signed.searchParams.get('signature');
  const expires = signed.searchParams.get('expires');
  for (const path of [
    `/media/1?expires=${expires}&signature=${signature.replace(/^./, signature[0] === 'a' ? 'b' : 'a')}`,
    `/media/1?expires=${Number(expires) + 1000}&signature=${signature}`,
    `/media/2?expires=${expires}&signature=${signature}`,
    '/media/1',
    `/media/1?expires=abc&signature=${signature}`,
  ]) {
    const forged = await fetch(`${app.url}${path}`);
    assert.equal(forged.status, 403, path);
    assert.deepEqual(await forged.json(), { error: '播放地址无效' });
  }
});

test('地址即授权：不带会话也能读取，过期与越界返回约定结果', async (t) => {
  const app = await startApp(t, { playbackTtlMs: 300 });
  const c = client(app.url);
  await login(c);
  await enroll(c, 1);
  const { url } = await (await c.post('/api/courses/1/play')).json();
  const size = statSync(resolve(mediaDir, 'python-basics.mp4')).size;

  const whole = await fetch(`${app.url}${url}`);
  assert.equal(whole.status, 200, '不带 cookie 也能读取');
  assert.equal((await whole.arrayBuffer()).byteLength, size);
  const head = await fetch(`${app.url}${url}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(size));
  const part = await fetch(`${app.url}${url}`, { headers: { range: 'bytes=0-31' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-31/${size}`);
  const beyond = await fetch(`${app.url}${url}`, { headers: { range: `bytes=${size}-` } });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), `bytes */${size}`);

  await sleep(400);
  const expired = await fetch(`${app.url}${url}`);
  assert.equal(expired.status, 410);
  assert.deepEqual(await expired.json(), { error: '播放地址已过期，请重新获取' });
});

test('资格变化只影响新地址，已签发地址在到期前仍可读取', async (t) => {
  const app = await startApp(t, { playbackTtlMs: 1200 });
  const c = client(app.url);
  await login(c);
  const record = await enroll(c, 1);
  const grant = await (await c.post('/api/courses/1/play')).json();
  assert.equal((await fetch(`${app.url}${grant.url}`)).status, 200);

  await c.del(`/api/enrollments/${record.id}`);
  assert.equal((await fetch(`${app.url}${grant.url}`)).status, 200, '取消报名后旧地址仍可读');
  assert.equal((await c.post('/api/courses/1/play')).status, 403, '新的签发请求被拒绝');
  await sleep(1300);
  assert.equal((await fetch(`${app.url}${grant.url}`)).status, 410, '旧地址到期');
  assert.equal((await c.post('/api/courses/1/play')).status, 403, '过期后重新申请仍被拒绝');

  const c2 = client(app.url);
  await login(c2, 'student2');
  await enroll(c2, 2);
  const grant2 = await (await c2.post('/api/courses/2/play')).json();
  app.db.prepare('UPDATE courses SET published = 0 WHERE id = 2').run();
  assert.equal((await fetch(`${app.url}${grant2.url}`)).status, 200, '取消发布后旧地址仍可读');
  assert.equal((await c2.post('/api/courses/2/play')).status, 404, '课程不可用不再签发');
});

test('地址到期后页面自动续播，连续失败超过两次提示重试', async (t) => {
  // 页面脚本是浏览器行为，按白盒方式断言续播与失败上限，并用真实服务验证重新申请。
  const script = readFileSync(resolve(projectRoot, 'public/js/app.js'), 'utf8');
  assert.match(script, /video\.addEventListener\('error'/);
  assert.match(script, /grant = await requestGrant\(\)/);
  assert.match(script, /video\.currentTime = resumeAt/, '从原进度继续');
  assert.match(script, /failures >= 2/);
  assert.match(script, /视频加载失败，请刷新页面后重试/);

  const app = await startApp(t, { playbackTtlMs: 300 });
  const c = client(app.url);
  await login(c);
  await enroll(c, 3);
  const first = await (await c.post('/api/courses/3/play')).json();
  await sleep(400);
  assert.equal((await fetch(`${app.url}${first.url}`)).status, 410);
  const renewed = await c.post('/api/courses/3/play');
  assert.equal(renewed.status, 200, '资格仍有效时能取得新地址');
  const second = await renewed.json();
  assert.notEqual(second.url, first.url);
  assert.equal((await fetch(`${app.url}${second.url}`, { headers: { range: 'bytes=0-1' } })).status, 206);
});
