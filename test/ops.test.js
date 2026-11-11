// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// 运维流程的系统测试：以子进程运行真实的 npm 脚本入口（src/main.js 与 scripts/*.js）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { defaultMigrationsDir, projectRoot, readMigrationFiles } from '../src/db.js';
import { client, enroll, login, tempDir } from './helpers.js';

const execFileAsync = promisify(execFile);
const NODE_ARGS = ['--disable-warning=ExperimentalWarning'];

/** 复制一份项目（不含数据），在副本里演练迁移，不影响仓库本身。 */
function projectCopy(t) {
  const root = tempDir(t, 'academy-project-');
  for (const dir of ['src', 'scripts', 'migrations', 'public']) cpSync(resolve(projectRoot, dir), join(root, dir), { recursive: true });
  cpSync(resolve(projectRoot, 'package.json'), join(root, 'package.json'));
  return root;
}

function environment(t, overrides = {}) {
  return {
    ...process.env,
    DATA_DIR: tempDir(t, 'academy-data-'),
    BACKUP_DIR: tempDir(t, 'academy-backups-'),
    PORT: '0',
    INIT_CWD: '',
    ...overrides,
  };
}

/** 启动 src/main.js，等到打印出访问地址。 */
async function startServer(t, env, root = projectRoot) {
  const child = spawn(process.execPath, [...NODE_ARGS, join(root, 'src/main.js')], { cwd: root, env });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = once(child, 'exit').then(([code]) => code);
  t.after(() => { if (child.exitCode === null) child.kill('SIGINT'); return exited; });
  const url = await new Promise((resolveUrl, reject) => {
    const check = () => {
      const match = /已启动：http:\/\/localhost:(\d+)/.exec(output);
      if (match) resolveUrl(`http://127.0.0.1:${match[1]}`);
    };
    child.stdout.on('data', check);
    exited.then((code) => reject(new Error(`服务提前退出（${code}）：${output}`)));
  });
  return { child, url, exited, output: () => output };
}

async function runNode(script, env, root = projectRoot, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [...NODE_ARGS, join(root, script), ...args], { cwd: root, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function courseTitles(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT title FROM courses ORDER BY id').all().map((row) => row.title);
  } finally {
    db.close();
  }
}

test('备份会先请运行中的服务正常停止，再复制数据库', async (t) => {
  const env = environment(t);
  const server = await startServer(t, env);
  assert.match(server.output(), /示例账号/);
  const admin = client(server.url);
  await login(admin, 'admin');
  await admin.post('/api/admin/courses', {
    title: '备份前创建的课程', summary: '用来核对备份内容', instructor: '测试', level: 'beginner', videoFile: 'python-basics.mp4',
  });

  const result = await runNode('scripts/backup.js', env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /正在请求它正常停止/);
  assert.match(result.stdout, /已备份：/);
  const { port } = new URL(server.url);
  assert.ok(result.stdout.includes(`DATA_DIR=${env.DATA_DIR} PORT=${port} npm start`), '重启提示带上原来的数据目录和端口');
  assert.equal(await server.exited, 0);
  assert.match(server.output(), /已停止，数据库已正常关闭/);
  assert.equal(existsSync(join(env.DATA_DIR, 'run.json')), false);

  const files = readdirSync(env.BACKUP_DIR);
  assert.equal(files.length, 1);
  assert.equal(files[0].match(/^academy-(.+)-\d{8}-\d{6}\.sqlite$/)?.[1], basename(env.DATA_DIR), '备份文件名带数据目录名');
  assert.ok(courseTitles(join(env.BACKUP_DIR, files[0])).includes('备份前创建的课程'));

  const again = await runNode('scripts/backup.js', env);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /未在运行/);
  assert.equal(readdirSync(env.BACKUP_DIR).length, 2);
});

test('恢复要求服务已停止，校验快照并保留恢复前的数据库', async (t) => {
  const env = environment(t);
  const dbFile = join(env.DATA_DIR, 'academy.sqlite');
  const first = await startServer(t, env);
  await runNode('scripts/backup.js', env);
  await first.exited;
  const snapshot = join(env.BACKUP_DIR, readdirSync(env.BACKUP_DIR)[0]);

  const server = await startServer(t, env);
  const admin = client(server.url);
  await login(admin, 'admin');
  await admin.post('/api/admin/courses', {
    title: '快照之后的课程', summary: '恢复后应当消失', instructor: '测试', level: 'beginner', videoFile: 'python-basics.mp4',
  });
  const refused = await runNode('scripts/restore.js', env, projectRoot, [snapshot]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /学堂仍在运行/);
  server.child.kill('SIGINT');
  assert.equal(await server.exited, 0);

  const junk = join(env.BACKUP_DIR, 'not-a-database.sqlite');
  writeFileSync(junk, 'hello');
  const bad = await runNode('scripts/restore.js', env, projectRoot, [junk]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /恢复失败/);
  assert.ok(courseTitles(dbFile).includes('快照之后的课程'), '无效快照不改动当前数据库');

  assert.match((await runNode('scripts/restore.js', env)).stderr, /请指定要恢复的备份文件/);

  const restored = await runNode('scripts/restore.js', env, projectRoot, [snapshot]);
  assert.equal(restored.code, 0, restored.stderr);
  assert.match(restored.stdout, /快照之后产生的数据不在恢复后的数据库中/);
  assert.ok(!courseTitles(dbFile).includes('快照之后的课程'));
  const saved = readdirSync(env.BACKUP_DIR).find((name) => name.startsWith('before-restore-'));
  assert.ok(saved);
  assert.ok(courseTitles(join(env.BACKUP_DIR, saved)).includes('快照之后的课程'));

  const after = await startServer(t, env);
  const response = await fetch(`${after.url}/api/courses`);
  assert.equal((await response.json()).courses.length, 3);
});

test('新增迁移后：启动被拒绝，备份并迁移后保留原数据启动', async (t) => {
  const root = projectCopy(t);
  const env = environment(t);
  const first = await startServer(t, env, root);
  first.child.kill('SIGINT');
  await first.exited;

  // 编号从 900 起，不与课上新增的迁移冲突。
  writeFileSync(join(root, 'migrations/900-course-tags.sql'), [
    '-- SPDX-License-Identifier: Apache-2.0',
    'ALTER TABLE courses ADD COLUMN tags TEXT NOT NULL DEFAULT \'\';',
    '',
  ].join('\n'));

  const blocked = spawn(process.execPath, [...NODE_ARGS, join(root, 'src/main.js')], { cwd: root, env });
  let blockedOutput = '';
  blocked.stdout.on('data', (chunk) => { blockedOutput += chunk; });
  blocked.stderr.on('data', (chunk) => { blockedOutput += chunk; });
  const [blockedCode] = await once(blocked, 'exit');
  assert.equal(blockedCode, 1);
  assert.match(blockedOutput, /1 个待执行的迁移/);
  assert.match(blockedOutput, /900-course-tags\.sql/);
  assert.match(blockedOutput, /npm run backup/);
  assert.match(blockedOutput, /npm run migrate/);
  assert.equal(existsSync(join(env.DATA_DIR, 'run.json')), false);

  const backup = await runNode('scripts/backup.js', env, root);
  assert.equal(backup.code, 0, backup.stderr);

  const migrated = await runNode('scripts/migrate.js', env, root);
  assert.equal(migrated.code, 0, migrated.stderr);
  assert.match(migrated.stdout, /已执行 1 个迁移/);
  assert.match(migrated.stdout, /900-course-tags\.sql/);
  const nothing = await runNode('scripts/migrate.js', env, root);
  assert.match(nothing.stdout, /没有待执行的迁移/);

  const server = await startServer(t, env, root);
  const health = await (await fetch(`${server.url}/api/health`)).json();
  const baseline = readMigrationFiles(defaultMigrationsDir).map((m) => m.filename);
  assert.deepEqual(health.migrations, { applied: [...baseline, '900-course-tags.sql'], pending: [] });
  assert.equal((await (await fetch(`${server.url}/api/courses`)).json()).courses.length, 3);
  const student = client(server.url);
  await login(student);
  await enroll(student, 1);
  assert.equal((await student.post('/api/courses/1/play')).status, 200);

  const whileRunning = await runNode('scripts/migrate.js', env, root);
  assert.equal(whileRunning.code, 1);
  assert.match(whileRunning.stderr, /学堂仍在运行/);
  server.child.kill('SIGINT');
  await server.exited;

  appendFileSync(join(root, 'migrations/001-init.sql'), '-- 改动已执行的迁移\n');
  const changed = await runNode('scripts/migrate.js', env, root);
  assert.equal(changed.code, 1);
  assert.match(changed.stderr, /被修改过：001-init\.sql/);
});

test('同一数据目录不能启动第二个服务', async (t) => {
  const env = environment(t);
  await startServer(t, env);
  const second = await runNode('src/main.js', env);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /已有学堂在运行/);
});
