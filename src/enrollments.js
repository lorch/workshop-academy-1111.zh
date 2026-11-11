// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { requireUser } from './auth.js';
import { getPublishedCourse } from './courses.js';
import { HttpError, parseId, readJson, sendJson } from './http.js';

export const ENROLLMENT_ACTIVE = 'active';
export const ENROLLMENT_CANCELLED = 'cancelled';

const SELECT = `SELECT enrollments.*, courses.title AS course_title
  FROM enrollments JOIN courses ON courses.id = enrollments.course_id`;

/** 对外的报名记录：课程编号、课程标题、状态与创建时间。 */
export function publicEnrollment(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.course_title,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** 仅按会话身份查询，不提供按学员编号查询的入口。 */
export function listEnrollments(db, userId) {
  return db.prepare(`${SELECT} WHERE enrollments.user_id = ? ORDER BY enrollments.id`).all(userId);
}

export function findEnrollment(db, id, userId) {
  return db.prepare(`${SELECT} WHERE enrollments.id = ? AND enrollments.user_id = ?`).get(id, userId) ?? null;
}

export function findActiveEnrollment(db, userId, courseId) {
  return db.prepare(`${SELECT} WHERE enrollments.user_id = ? AND enrollments.course_id = ? AND enrollments.status = ?`)
    .get(userId, courseId, ENROLLMENT_ACTIVE) ?? null;
}

/** 同一学员对同一课程最近的一条记录，含已取消记录。 */
export function findLatestEnrollment(db, userId, courseId) {
  return db.prepare(`${SELECT} WHERE enrollments.user_id = ? AND enrollments.course_id = ? ORDER BY enrollments.id DESC LIMIT 1`)
    .get(userId, courseId) ?? null;
}

/** 观看资格只认属于本人、本课程且状态为有效的报名记录。 */
export function hasActiveEnrollment(db, userId, courseId) {
  return Boolean(db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ? AND status = ?')
    .get(userId, courseId, ENROLLMENT_ACTIVE));
}

/** 并发重复报名由部分唯一索引挡住，返回最终那条有效报名。 */
export function insertEnrollment(db, userId, courseId, now = Date.now()) {
  db.prepare(`INSERT OR IGNORE INTO enrollments
    (user_id, course_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, courseId, ENROLLMENT_ACTIVE, now, now);
  return findActiveEnrollment(db, userId, courseId);
}

/** 只把本人的有效记录标记为已取消；已取消记录保持原样且可查。 */
export function cancelEnrollment(db, id, userId, now = Date.now()) {
  const row = findEnrollment(db, id, userId);
  if (!row) return null;
  if (row.status === ENROLLMENT_ACTIVE) {
    db.prepare('UPDATE enrollments SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
      .run(ENROLLMENT_CANCELLED, now, id, ENROLLMENT_ACTIVE);
  }
  return findEnrollment(db, id, userId);
}

/** 三个入口都以当前会话身份界定数据作用域，不读取请求体中的自报身份。 */
export function registerEnrollmentRoutes(app) {
  const { router } = app;

  router.post('/api/enrollments', async (ctx) => {
    const user = requireUser(ctx);
    const input = await readJson(ctx.req);
    const course = getPublishedCourse(ctx.db, parseId(input.courseId));
    if (!course) throw new HttpError(404, '课程不存在或尚未发布');

    const active = findActiveEnrollment(ctx.db, user.id, course.id);
    if (active) {
      sendJson(ctx.res, 200, { enrollment: publicEnrollment(active) });
      return;
    }
    // Q4 仍待定：本轮不规定取消后再次报名，明确拒绝而不产生第二条记录。
    if (findLatestEnrollment(ctx.db, user.id, course.id)) {
      throw new HttpError(409, '该课程报名已取消，本轮暂不支持再次报名');
    }
    const created = insertEnrollment(ctx.db, user.id, course.id);
    sendJson(ctx.res, 201, { enrollment: publicEnrollment(created) });
  });

  router.get('/api/enrollments', (ctx) => {
    const user = requireUser(ctx);
    sendJson(ctx.res, 200, { enrollments: listEnrollments(ctx.db, user.id).map(publicEnrollment) });
  });

  router.add('DELETE', '/api/enrollments/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = cancelEnrollment(ctx.db, parseId(ctx.params.id), user.id);
    if (!row) throw new HttpError(404, '报名记录不存在');
    sendJson(ctx.res, 200, { enrollment: publicEnrollment(row) });
  });
}
