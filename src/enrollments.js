// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

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
