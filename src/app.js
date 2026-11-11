// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import {
  applyMigrations, databaseFile, defaultMigrationsDir, migrationStatus, openDatabase, projectRoot,
  resolveDataDir, MigrationError,
} from './db.js';
import { DEMO_PASSWORD, demoAccounts, seedIfNeeded } from './seed.js';
import { registerAuthRoutes } from './auth.js';
import {
  HttpError, applySecurityHeaders, constantTimeEqual, isJsonRequest, redirect, sendHtml, sendJson, serveStatic,
} from './http.js';
import { Router } from './router.js';
import { errorPage } from './views/error.js';
import { registerCourseRoutes } from './courses.js';
import { registerPlaybackRoutes, watchStateForPage } from './playback.js';

export const RUN_FILENAME = 'run.json';
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

/** 去掉 Host 头的端口并统一大小写；IPv6 的方括号保持不变。 */
export function normalizeHost(value) {
  return String(value ?? '').trim().replace(/:\d+$/, '').toLowerCase();
}

/** 是否监听所有网卡：此时局域网内的其他设备也能连进来。 */
export function isWildcardHost(host) {
  return WILDCARD_HOSTS.has(normalizeHost(host));
}

// 虚拟网卡（VPN、AirDrop、网桥等）上的地址不是可分享的局域网地址。
const VIRTUAL_PREFIXES = ['utun', 'tun', 'tap', 'ppp', 'awdl', 'llw', 'bridge', 'vmenet', 'lo'];

/** 本机物理网卡上的地址，用于生成可分享的局域网访问地址。 */
export function localAddresses() {
  const addresses = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const entry of entries ?? []) {
      if (entry.internal || entry.address.includes('%')) continue;
      if (entry.family === 'IPv4') addresses.push(entry.address);
      else if (entry.family === 'IPv6' && !entry.address.startsWith('fe80')) addresses.push(`[${entry.address}]`);
    }
  }
  return [...new Set(addresses)];
}

export class StartupError extends Error {
  constructor(message, { code, pending } = {}) {
    super(message);
    this.name = 'StartupError';
    this.code = code;
    this.pending = pending;
  }
}

export function runFilePath(dataDir) {
  return resolve(dataDir, RUN_FILENAME);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** 读取数据目录的运行记录；没有记录时返回 null。 */
export function readRunInfo(dataDir) {
  const file = runFilePath(dataDir);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let info = {};
  try { info = JSON.parse(text) || {}; } catch { /* 损坏的记录按已失效处理 */ }
  return {
    pid: info.pid,
    url: info.url ?? null,
    token: info.token ?? null,
    task: info.task ?? null,
    startedAt: info.startedAt,
    file,
    alive: isProcessAlive(info.pid),
  };
}

// 先写临时文件再链接或改名，读者不会看到写了一半的运行记录。
function writeFileAtomic(file, content, { exclusive }) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  try {
    if (exclusive) linkSync(temp, file);
    else renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function busyMessage(info) {
  if (info.task) return `这个数据目录正在${info.task}（进程 ${info.pid}），请等它完成后再试。`;
  return `这个数据目录已有学堂在运行（进程 ${info.pid}${info.url ? `，${info.url}` : ''}）。\n`
    + '请先在它的终端按 Ctrl+C 停止，或为新实例设置另一个 DATA_DIR。';
}

/**
 * 独占数据目录：写入运行记录（服务写 url 与维护令牌，维护脚本写 task）。
 * 记录属于已退出的进程时视为失效并清理；属于存活进程时抛出 StartupError。
 */
export function claimRunFile(dataDir, record) {
  const file = runFilePath(dataDir);
  let staleRemoved = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileAtomic(file, JSON.stringify(record), { exclusive: true });
      return { staleRemoved, release: () => rmSync(file, { force: true }) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = readRunInfo(dataDir);
      if (info?.alive) throw new StartupError(busyMessage(info), { code: 'already_running' });
      rmSync(file, { force: true });
      staleRemoved = true;
    }
  }
  throw new StartupError('无法创建运行记录，请稍后重试。');
}

function expectsJson(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/internal/') || pathname.startsWith('/media/');
}

/**
 * 创建学堂应用：start() 取得数据目录的运行锁、准备数据库并监听端口，
 * stop() 正常关闭连接与数据库并删除运行记录。
 */
export function createApp(options = {}) {
  const config = {
    dataDir: resolve(options.dataDir ?? resolveDataDir()),
    host: options.host ?? '127.0.0.1',
    lanAccess: options.lanAccess ?? isWildcardHost(options.host ?? '127.0.0.1'),
    allowedHosts: options.allowedHosts ?? [],
    port: options.port ?? 3000,
    migrationsDir: options.migrationsDir ?? defaultMigrationsDir,
    publicDir: options.publicDir ?? resolve(projectRoot, 'public'),
    mediaDir: options.mediaDir ?? resolve(projectRoot, 'media'),
    playbackTtlMs: options.playbackTtlMs ?? 60_000,
    logRequests: options.logRequests ?? false,
  };
  // 始终校验 Host，防止 DNS rebinding：局域网模式只额外放行本机网卡地址与显式配置的主机名。
  const allowedHostnames = new Set(LOOPBACK_HOSTNAMES);
  if (config.lanAccess) {
    for (const address of localAddresses()) allowedHostnames.add(address);
  } else if (!isWildcardHost(config.host)) {
    allowedHostnames.add(normalizeHost(config.host));
  }
  for (const extra of config.allowedHosts) allowedHostnames.add(normalizeHost(extra));

  const maintenanceToken = randomBytes(32).toString('hex');
  const runFile = runFilePath(config.dataDir);
  const router = new Router();
  const notices = [];
  let db = null;
  let server = null;
  let url = null;
  let ownsLock = false;
  let started = false;
  let stopping = null;
  let markClosed;
  const closed = new Promise((resolveClosed) => { markClosed = resolveClosed; });

  const app = {
    config,
    router,
    notices,
    closed,
    get db() { return db; },
    get url() { return url; },
    start,
    stop,
    // 当前登录用户，由 registerAuthRoutes 接入会话读取。
    currentUser: () => null,
  };

  registerCoreRoutes(app, { maintenanceToken });
  registerAuthRoutes(app, { demoAccounts, demoPassword: DEMO_PASSWORD });
  registerCourseRoutes(app, { watchState: watchStateForPage });
  registerPlaybackRoutes(app);

  function acquireLock() {
    const claim = claimRunFile(config.dataDir, { pid: process.pid, url: null, token: maintenanceToken, startedAt: Date.now() });
    ownsLock = true;
    if (claim.staleRemoved) notices.push('已清理上次异常退出留下的运行记录。');
  }

  function prepareDatabase() {
    const handle = openDatabase(databaseFile(config.dataDir));
    try {
      const fresh = !handle.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
      if (fresh) {
        applyMigrations(handle, config.migrationsDir);
      } else {
        const status = migrationStatus(handle, config.migrationsDir);
        if (status.problems.length) {
          throw new MigrationError(`迁移记录与迁移文件不一致：\n${status.problems.map((p) => `  - ${p}`).join('\n')}`, { problems: status.problems });
        }
        if (status.pending.length) {
          throw new StartupError('数据库有待执行的迁移', { code: 'pending_migrations', pending: status.pending.map((m) => m.filename) });
        }
      }
      if (seedIfNeeded(handle)) notices.push('首次启动：已创建数据库，并写入示例账号和课程。');
      return handle;
    } catch (error) {
      handle.close();
      throw error;
    }
  }

  async function start() {
    if (started) throw new Error('同一个应用实例只能启动一次');
    started = true;
    mkdirSync(config.dataDir, { recursive: true });
    acquireLock();
    try {
      db = prepareDatabase();
      server = createServer((req, res) => { handle(req, res); });
      server.headersTimeout = 10_000;
      server.requestTimeout = 30_000;
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(config.port, config.host, () => {
          server.off('error', rejectListen);
          resolveListen();
        });
      });
      const port = server.address().port;
      // 通配地址本身不能用来访问，运行记录里始终写可连接的地址。
      const urlHost = isWildcardHost(config.host) ? '127.0.0.1'
        : config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
      url = `http://${urlHost}:${port}`;
      if (config.lanAccess) {
        for (const address of localAddresses()) notices.push(`局域网访问：http://${address}:${port}`);
      }
      writeFileAtomic(runFile, JSON.stringify({ pid: process.pid, url, token: maintenanceToken, startedAt: Date.now() }), { exclusive: false });
      return url;
    } catch (error) {
      await stop();
      if (error.code === 'EADDRINUSE') {
        throw new StartupError(`端口 ${config.port} 已被占用。请先停止占用它的程序，或换一个端口，例如 PORT=3001 npm start。`, { code: 'port_in_use' });
      }
      throw error;
    }
  }

  function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (server?.listening) {
        await new Promise((resolveClose) => {
          // 给进行中的请求和视频流一点时间，超时后强制断开。
          const timer = setTimeout(() => server.closeAllConnections(), 2000);
          server.close(() => {
            clearTimeout(timer);
            resolveClose();
          });
          server.closeIdleConnections();
        });
      }
      try { db?.close(); } catch { /* 已关闭 */ }
      db = null;
      if (ownsLock) {
        rmSync(runFile, { force: true });
        ownsLock = false;
      }
      markClosed();
    })();
    return stopping;
  }

  async function handle(req, res) {
    const startedAt = process.hrtime.bigint();
    applySecurityHeaders(res);
    let pathname = '/';
    let user;
    const ctx = {
      app,
      req,
      res,
      params: {},
      url: null,
      get db() { return db; },
      get path() { return pathname; },
      get user() {
        if (user === undefined) user = app.currentUser(ctx) ?? null;
        return user;
      },
    };
    if (config.logRequests) {
      res.on('finish', () => {
        if (/^\/(assets|covers|media)\//.test(pathname)) return;
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(`${req.method} ${pathname} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
    }
    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      pathname = requestUrl.pathname;
      ctx.url = requestUrl;
      const hostname = normalizeHost(req.headers.host);
      if (!allowedHostnames.has(hostname)) {
        const hint = config.lanAccess ? 'localhost、127.0.0.1 或本机局域网地址' : 'localhost 或 127.0.0.1';
        throw new HttpError(400, `请求的 Host 无效，请通过 ${hint} 访问`);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://${req.headers.host}`) throw new HttpError(403, '请求来源不受信任');
        if (pathname.startsWith('/api/') && !isJsonRequest(req)) {
          throw new HttpError(415, '请用 JSON 提交，并设置请求头 Content-Type: application/json');
        }
      }
      const found = router.match(req.method, pathname);
      if (!found) throw new HttpError(404, expectsJson(pathname) ? '接口不存在' : '页面不存在');
      ctx.params = found.params;
      await found.handler(ctx);
    } catch (error) {
      sendError(ctx, error);
    }
  }

  function sendError(ctx, error) {
    const { res } = ctx;
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = status >= 500 ? '服务暂时不可用，请稍后重试' : error.message;
    const headers = error.headers || {};
    if (expectsJson(ctx.path)) {
      sendJson(res, status, error.fields ? { error: message, fields: error.fields } : { error: message }, headers);
      return;
    }
    let user = null;
    try { user = ctx.user; } catch { /* 出错页不依赖登录状态 */ }
    sendHtml(res, status, errorPage({ status, message, user, path: ctx.path }), headers);
  }

  return app;
}

function registerCoreRoutes(app, { maintenanceToken }) {
  const { router, config } = app;

  router.get('/assets/*', (ctx) => serveStatic(ctx.req, ctx.res, config.publicDir, ctx.params.rest));
  router.get('/favicon.ico', (ctx) => redirect(ctx.res, '/assets/favicon.svg', 301));

  router.get('/api/health', (ctx) => {
    const status = migrationStatus(ctx.db, config.migrationsDir);
    sendJson(ctx.res, 200, {
      ok: true,
      migrations: { applied: status.applied, pending: status.pending.map((m) => m.filename) },
    });
  });

  // 备份脚本用运行记录里的令牌请求正常停服：先应答，再关闭连接和数据库。
  router.post('/internal/stop', (ctx) => {
    if (!constantTimeEqual(ctx.req.headers['x-maintenance-token'] || '', maintenanceToken)) {
      throw new HttpError(403, '维护令牌无效');
    }
    ctx.res.on('finish', () => { app.stop().catch((error) => console.error(error)); });
    sendJson(ctx.res, 202, { message: '正在停止服务' });
  });
}
