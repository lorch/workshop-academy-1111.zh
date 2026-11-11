// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createApp } from './app.js';
import { MigrationError } from './db.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`学堂在线需要 Node.js 24 或更新版本，当前是 ${process.version}。`);
  process.exit(1);
}

function parsePort(value) {
  if (value === undefined || value === '') return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT 应为 0 到 65535 之间的整数，当前是 ${JSON.stringify(value)}。`);
    process.exit(1);
  }
  return port;
}

// 提示命令时带上当前的 DATA_DIR / PORT，照抄即可操作同一份数据。
function command(script, { withPort = false } = {}) {
  const env = [];
  if (process.env.DATA_DIR) env.push(`DATA_DIR=${process.env.DATA_DIR}`);
  if (process.env.HOST) env.push(`HOST=${process.env.HOST}`);
  if (process.env.ALLOWED_HOSTS) env.push(`ALLOWED_HOSTS='${process.env.ALLOWED_HOSTS}'`);
  if (withPort && process.env.PORT) env.push(`PORT=${process.env.PORT}`);
  return [...env, script].join(' ');
}

function describeFailure(error) {
  if (error.code === 'pending_migrations') {
    return [
      `数据库有 ${error.pending.length} 个待执行的迁移：`,
      ...error.pending.map((name) => `  - ${name}`),
      '为保护现有数据，服务不会自动迁移。请依次执行：',
      `  1. 备份当前数据库：${command('npm run backup')}`,
      `  2. 执行迁移：${command('npm run migrate')}`,
      `  3. 重新启动：${command('npm start', { withPort: true })}`,
    ].join('\n');
  }
  if (error instanceof MigrationError) {
    return `${error.message}\n已执行的迁移文件不能修改或删除；新的结构变更请追加编号更大的迁移文件。`;
  }
  return error.message;
}

const allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const app = createApp({
  host: process.env.HOST || '127.0.0.1',
  allowedHosts,
  port: parsePort(process.env.PORT),
  logRequests: true,
});

try {
  const url = await app.start();
  for (const notice of app.notices) console.log(notice);
  console.log(`学堂在线已启动：${url.replace('127.0.0.1', 'localhost')}`);
  console.log(`数据目录：${app.config.dataDir}`);
  console.log('示例账号：admin（管理员）、student、student2（学员），密码均为 123456');
  console.log('按 Ctrl+C 停止服务。');
} catch (error) {
  console.error(`启动失败：${describeFailure(error)}`);
  process.exitCode = 1;
}

if (!process.exitCode) {
  const shutdown = () => {
    console.log('\n正在停止服务…');
    app.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await app.closed;
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
  console.log('学堂在线已停止，数据库已正常关闭。');
}
