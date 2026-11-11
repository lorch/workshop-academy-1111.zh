-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

-- 报名记录：有效与已取消用状态字段区分，取消不物理删除。
-- 部分唯一索引保证同一学员对同一课程至多一条有效报名。

CREATE TABLE enrollments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  course_id INTEGER NOT NULL REFERENCES courses (id),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX enrollments_user_course ON enrollments (user_id, course_id, id);

CREATE UNIQUE INDEX enrollments_one_active ON enrollments (user_id, course_id)
  WHERE status = 'active';
