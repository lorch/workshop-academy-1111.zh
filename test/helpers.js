// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

export function tempDir(t, prefix = 'academy-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 在临时数据目录、随机端口上启动真实服务，测试结束后停止。 */
export async function startApp(t, options = {}) {
  const app = createApp({ dataDir: options.dataDir ?? tempDir(t), port: 0, ...options });
  await app.start();
  t.after(() => app.stop());
  return app;
}

/** 带 cookie 的 HTTP 客户端，像浏览器一样保存会话。 */
export function client(baseUrl) {
  const jar = new Map();
  async function request(path, { method = 'GET', json, headers = {}, body, ...rest } = {}) {
    const finalHeaders = { ...headers };
    if (jar.size) finalHeaders.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let finalBody = body;
    if (json !== undefined) {
      finalHeaders['content-type'] ??= 'application/json';
      finalBody = JSON.stringify(json);
    }
    const response = await fetch(new URL(path, baseUrl), { method, headers: finalHeaders, body: finalBody, redirect: 'manual', ...rest });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attrs] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value || attrs.some((a) => /max-age=0/i.test(a.trim()))) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  }
  return {
    jar,
    request,
    get: (path, options) => request(path, options),
    post: (path, json = {}, options = {}) => request(path, { method: 'POST', json, ...options }),
    patch: (path, json = {}, options = {}) => request(path, { method: 'PATCH', json, ...options }),
    // /api/ 下的非 GET 请求必须有 JSON 头，DELETE 没有请求体也要带。
    del: (path, options = {}) => request(path, { method: 'DELETE', headers: { 'content-type': 'application/json' }, ...options }),
  };
}

export async function login(c, username = 'student', password = '123456') {
  const response = await c.post('/api/login', { username, password });
  if (response.status !== 200) throw new Error(`登录失败：${response.status} ${await response.text()}`);
  return (await response.json()).user;
}

/** 为当前会话报名一门课程，返回报名记录。 */
export async function enroll(c, courseId = 1) {
  const response = await c.post('/api/enrollments', { courseId });
  if (![200, 201].includes(response.status)) {
    throw new Error(`报名失败：${response.status} ${await response.text()}`);
  }
  return (await response.json()).enrollment;
}
