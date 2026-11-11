// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_COOKIE, createSession } from '../src/auth.js';
import { migrationStatus } from '../src/db.js';
import {
  cancelEnrollment, hasActiveEnrollment, insertEnrollment,
} from '../src/enrollments.js';
import { client, enroll, login, startApp, tempDir } from './helpers.js';

const json = async (response) => response.json();

test('报名只认当前会话身份，草稿与不存在课程返回 404，重复报名不新增', async (t) => {
  const app = await startApp(t);
  const guest = client(app.url);
  const anonymous = await guest.post('/api/enrollments', { courseId: 1 });
  assert.equal(anonymous.status, 401);
  assert.ok((await json(anonymous)).error, '错误用中文说明');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enrollments').get().n, 0);

  const student = client(app.url);
  const me = await login(student);
  for (const courseId of [4, 999, 'abc', '01', 0]) {
    const refused = await student.post('/api/enrollments', { courseId });
    assert.equal(refused.status, 404, String(courseId));
    assert.ok((await json(refused)).error);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enrollments').get().n, 0);

  // 请求体自报身份一律忽略，只按当前会话写入。
  const forged = await student.post('/api/enrollments', {
    courseId: 1, userId: me.id + 100, username: 'student2', role: 'admin',
  });
  assert.equal(forged.status, 201);
  const record = (await json(forged)).enrollment;
  assert.equal(record.status, 'active');
  assert.equal(record.courseId, 1);
  assert.equal(typeof record.courseTitle, 'string');
  assert.equal(typeof record.createdAt, 'number');
  assert.equal(app.db.prepare('SELECT user_id FROM enrollments WHERE id = ?').get(record.id).user_id, me.id);

  const again = await student.post('/api/enrollments', { courseId: 1 });
  assert.equal(again.status, 200);
  assert.equal((await json(again)).enrollment.id, record.id, '返回既有有效报名');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enrollments').get().n, 1);

  // 管理员也只能为自己报名；不存在代报名、按学员查询或管理员报名列表入口。
  const admin = client(app.url);
  await login(admin, 'admin');
  assert.equal((await admin.post('/api/enrollments', { courseId: 2 })).status, 201);
  // 不存在的入口返回 404；与 DELETE 路径形状相同但方法不符时返回 405，同样不可用。
  for (const path of ['/api/admin/enrollments', '/api/enrollments/all', '/api/users/2/enrollments']) {
    const response = await admin.get(path);
    assert.ok([404, 405].includes(response.status), `${path} 不应提供报名视图`);
  }
  const scoped = await json(await admin.get('/api/enrollments?userId=2'));
  assert.equal(scoped.enrollments.length, 1, 'userId 参数被忽略');
  assert.equal(scoped.enrollments[0].courseId, 2);
});

test('取消以状态保留记录，重启后仍可查，旧账号课程不变，迁移只追加新文件', async (t) => {
  const dir = tempDir(t);
  const app = await startApp(t, { dataDir: dir });
  const usersBefore = app.db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const coursesBefore = app.db.prepare('SELECT COUNT(*) n FROM courses').get().n;
  const c = client(app.url);
  await login(c);
  const record = await enroll(c, 1);
  const cancelled = await c.del(`/api/enrollments/${record.id}`);
  assert.equal(cancelled.status, 200);
  assert.equal((await json(cancelled)).enrollment.status, 'cancelled');
  await app.stop();

  const restarted = await startApp(t, { dataDir: dir });
  const after = client(restarted.url);
  await login(after);
  const list = await json(await after.get('/api/enrollments'));
  assert.equal(list.enrollments.length, 1);
  assert.equal(list.enrollments[0].id, record.id);
  assert.equal(list.enrollments[0].status, 'cancelled', '取消不物理删除');
  assert.equal(restarted.db.prepare('SELECT COUNT(*) n FROM users').get().n, usersBefore);
  assert.equal(restarted.db.prepare('SELECT COUNT(*) n FROM courses').get().n, coursesBefore);
  assert.equal(restarted.db.prepare('SELECT COUNT(*) n FROM enrollments').get().n, 1);
  const status = migrationStatus(restarted.db);
  assert.deepEqual(status.applied, ['001-init.sql', '002-enrollments.sql']);
  assert.deepEqual(status.problems, [], '已执行迁移未被修改或删除');
  assert.equal(status.pending.length, 0);
});

test('有效报名判定覆盖无报名、已取消、有效、他人报名与他人课程', async (t) => {
  const app = await startApp(t);
  const db = app.db;
  const student = db.prepare("SELECT id FROM users WHERE username = 'student'").get().id;
  const other = db.prepare("SELECT id FROM users WHERE username = 'student2'").get().id;

  assert.equal(hasActiveEnrollment(db, student, 1), false, '无报名记录');
  const cancelledRow = insertEnrollment(db, student, 1);
  cancelEnrollment(db, cancelledRow.id, student);
  assert.equal(hasActiveEnrollment(db, student, 1), false, '仅有已取消记录');

  insertEnrollment(db, student, 1);
  assert.equal(hasActiveEnrollment(db, student, 1), true, '存在一条有效记录');
  assert.equal(hasActiveEnrollment(db, other, 1), false, '记录属于其他学员');
  assert.equal(hasActiveEnrollment(db, student, 2), false, '记录属于其他课程');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM enrollments WHERE status = 'active'").get().n, 1);
});

test('报名人数不设上限，多名学员的报名结果互不影响', async (t) => {
  const app = await startApp(t);
  const db = app.db;
  const ids = [];
  for (let i = 0; i < 12; i += 1) {
    const username = `bulk-${i}`;
    db.prepare(`INSERT INTO users (username, display_name, role, password_hash, password_salt, created_at)
      VALUES (?, ?, 'student', 'x', 'y', ?)`).run(username, `批量学员${i}`, Date.now());
    ids.push(db.prepare('SELECT id FROM users WHERE username = ?').get(username).id);
  }
  const records = [];
  for (const id of ids) {
    const c = client(app.url);
    c.jar.set(SESSION_COOKIE, createSession(db, id));
    const response = await c.post('/api/enrollments', { courseId: 1 });
    assert.equal(response.status, 201);
    records.push((await json(response)).enrollment);
  }
  assert.equal(records.length, 12);
  assert.equal(new Set(records.map((r) => r.id)).size, 12, '每人一条有效报名');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM enrollments WHERE status = 'active'").get().n, 12);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM enrollments WHERE status = 'cancelled'").get().n, 0, '无候补或审批状态');

  const one = client(app.url);
  one.jar.set(SESSION_COOKIE, createSession(db, ids[0]));
  const mine = await json(await one.get('/api/enrollments'));
  assert.equal(mine.enrollments.length, 1, '每人只看到自己的报名');
  const courses = await json(await fetch(`${app.url}/api/courses`));
  assert.deepEqual(courses.courses.map((c) => c.id), [1, 2, 3], '目录不受报名影响');
});

test('报名列表只返回本人记录，访客 401，管理员没有他人报名视图', async (t) => {
  const app = await startApp(t);
  const a = client(app.url);
  await login(a);
  const first = await enroll(a, 1);
  await enroll(a, 2);
  await a.del(`/api/enrollments/${first.id}`);

  const b = client(app.url);
  await login(b, 'student2');
  await enroll(b, 3);

  const mine = await json(await a.get('/api/enrollments'));
  assert.equal(mine.enrollments.length, 2);
  assert.deepEqual(mine.enrollments.map((e) => e.status), ['cancelled', 'active']);
  assert.deepEqual(mine.enrollments.map((e) => e.courseId), [1, 2]);

  const theirs = await json(await b.get('/api/enrollments'));
  assert.equal(theirs.enrollments.length, 1);
  assert.equal(theirs.enrollments[0].courseId, 3);

  assert.equal((await client(app.url).get('/api/enrollments')).status, 401);
  const admin = client(app.url);
  await login(admin, 'admin');
  assert.deepEqual((await json(await admin.get('/api/enrollments'))).enrollments, []);
});

test('取消只改本人有效记录，重复取消不新增，判定同步变化', async (t) => {
  const app = await startApp(t);
  const a = client(app.url);
  const me = await login(a);
  const record = await enroll(a, 1);
  assert.equal(hasActiveEnrollment(app.db, me.id, 1), true);

  const b = client(app.url);
  await login(b, 'student2');
  assert.equal((await b.del(`/api/enrollments/${record.id}`)).status, 404, '他人记录不可取消');
  for (const id of [99999, 'abc']) {
    assert.equal((await a.del(`/api/enrollments/${id}`)).status, 404, String(id));
  }

  const cancelled = await a.del(`/api/enrollments/${record.id}`);
  assert.equal(cancelled.status, 200);
  assert.equal((await json(cancelled)).enrollment.status, 'cancelled');
  assert.equal(hasActiveEnrollment(app.db, me.id, 1), false, '取消后不再是有效报名');

  const repeated = await a.del(`/api/enrollments/${record.id}`);
  assert.equal(repeated.status, 200);
  assert.equal((await json(repeated)).enrollment.status, 'cancelled', '保持已取消');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enrollments').get().n, 1, '不新增记录');

  const list = await json(await a.get('/api/enrollments'));
  assert.equal(list.enrollments.length, 1, '取消后本人仍可查');
  assert.equal(list.enrollments[0].status, 'cancelled');

  // Q4 仍待定：本轮不实现取消后再次报名，接口明确拒绝且不写入新记录。
  const again = await a.post('/api/enrollments', { courseId: 1 });
  assert.equal(again.status, 409);
  assert.match((await json(again)).error, /暂不支持再次报名/);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enrollments').get().n, 1);
});
