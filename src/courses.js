// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { HttpError, parseId, readJson, sendHtml, sendJson } from './http.js';
import { requireAdmin, requireAdminPage } from './auth.js';
import { LEVEL_LABELS } from './views/format.js';
import { coverSvg } from './views/cover.js';
import { catalogPage } from './views/catalog.js';
import { coursePage } from './views/course.js';
import { adminListPage, courseFormPage } from './views/admin.js';
import { listVideos } from './playback.js';

export const LEVELS = Object.keys(LEVEL_LABELS);

export function listPublishedCourses(db) {
  return db.prepare('SELECT * FROM courses WHERE published = 1 ORDER BY id').all();
}

/** 只返回已发布的课程；草稿与不存在的课程对外一视同仁。 */
export function getPublishedCourse(db, id) {
  return db.prepare('SELECT * FROM courses WHERE id = ? AND published = 1').get(id) ?? null;
}

/** 课程编号不合法、不存在或未发布时对外使用同一条 404 中文提示。 */
export function parseCourseId(value) {
  if (!/^[1-9]\d{0,15}$/.test(String(value))) throw new HttpError(404, '课程不存在或尚未发布');
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(404, '课程不存在或尚未发布');
  return id;
}

export function getCourse(db, id) {
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(id) ?? null;
}

/** 对外的课程字段；admin 为真时附带发布状态、视频文件与创建时间。 */
export function publicCourse(row, { admin = false } = {}) {
  const course = {
    id: row.id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    instructor: row.instructor,
    level: row.level,
    levelLabel: LEVEL_LABELS[row.level] ?? row.level,
    durationSeconds: row.duration_seconds,
    published: row.published === 1,
    url: `/courses/${row.id}`,
    coverUrl: `/covers/${row.id}.svg`,
    updatedAt: row.updated_at,
  };
  if (admin) {
    course.videoFile = row.video_file;
    course.createdAt = row.created_at;
  }
  return course;
}

export function listAllCourses(db) {
  return db.prepare('SELECT * FROM courses ORDER BY id').all();
}

const TEXT_FIELDS = {
  title: { label: '课程标题', max: 80, required: true },
  summary: { label: '一句话简介', max: 200, required: true },
  description: { label: '课程介绍', max: 5000, required: false },
  instructor: { label: '讲师', max: 40, required: true },
};
const EDITABLE_FIELDS = new Set([...Object.keys(TEXT_FIELDS), 'level', 'videoFile', 'published']);

/**
 * 校验管理员提交的课程字段。partial 为真时（修改）只校验出现的字段。
 * 返回整理后的值；有错误时抛出 400，fields 中是逐字段的中文提示。
 */
export function validateCourseInput(input, { partial, videos }) {
  const errors = {};
  const values = {};
  const unknown = Object.keys(input).filter((key) => !EDITABLE_FIELDS.has(key));
  if (unknown.length) throw new HttpError(400, `不支持的字段：${unknown.join('、')}`);

  for (const [name, rule] of Object.entries(TEXT_FIELDS)) {
    if (!(name in input)) {
      if (!partial && rule.required) errors[name] = `请填写${rule.label}`;
      continue;
    }
    const value = input[name];
    if (typeof value !== 'string') {
      errors[name] = `${rule.label}应为文字`;
      continue;
    }
    const text = value.replace(/\r\n?/g, '\n').trim();
    if (rule.required && !text) errors[name] = `请填写${rule.label}`;
    else if ([...text].length > rule.max) errors[name] = `${rule.label}不能超过 ${rule.max} 个字`;
    else values[name] = text;
  }

  if ('level' in input) {
    if (LEVELS.includes(input.level)) values.level = input.level;
    else errors.level = '请选择课程难度';
  } else if (!partial) {
    errors.level = '请选择课程难度';
  }

  if ('videoFile' in input) {
    const video = videos.find((v) => v.file === input.videoFile);
    if (video) {
      values.videoFile = video.file;
      values.durationSeconds = video.durationSeconds ?? 0;
    } else {
      errors.videoFile = typeof input.videoFile === 'string' && input.videoFile ? 'media/ 中没有这个视频文件' : '请选择课程视频';
    }
  } else if (!partial) {
    errors.videoFile = '请选择课程视频';
  }

  if ('published' in input) {
    if (typeof input.published === 'boolean') values.published = input.published;
    else errors.published = '发布状态应为 true 或 false';
  }

  if (Object.keys(errors).length) throw new HttpError(400, '请检查标出的字段', { fields: errors });
  if (partial && !Object.keys(values).length) throw new HttpError(400, '没有需要修改的字段');
  return values;
}

export function createCourse(db, values, now = Date.now()) {
  const result = db.prepare(`INSERT INTO courses
    (title, summary, description, instructor, level, duration_seconds, video_file, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    values.title, values.summary, values.description ?? '', values.instructor, values.level,
    values.durationSeconds, values.videoFile, values.published ? 1 : 0, now, now,
  );
  return getCourse(db, Number(result.lastInsertRowid));
}

const COLUMNS = {
  title: 'title',
  summary: 'summary',
  description: 'description',
  instructor: 'instructor',
  level: 'level',
  videoFile: 'video_file',
  durationSeconds: 'duration_seconds',
  published: 'published',
};

export function updateCourse(db, id, values, now = Date.now()) {
  const entries = Object.entries(values);
  const assignments = entries.map(([key]) => `${COLUMNS[key]} = ?`);
  const params = entries.map(([key, value]) => (key === 'published' ? (value ? 1 : 0) : value));
  db.prepare(`UPDATE courses SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, now, id);
  return getCourse(db, id);
}

function requireCourse(db, rawId) {
  const course = getCourse(db, parseId(rawId));
  if (!course) throw new HttpError(404, '课程不存在');
  return course;
}

function requirePublishedCourse(db, rawId) {
  const course = getPublishedCourse(db, parseCourseId(rawId));
  if (!course) throw new HttpError(404, '课程不存在或尚未发布');
  return course;
}

export function registerCourseRoutes(app, { watchState }) {
  const { router } = app;

  router.get('/', (ctx) => {
    const courses = listPublishedCourses(ctx.db).map((row) => publicCourse(row));
    sendHtml(ctx.res, 200, catalogPage({ user: ctx.user, path: ctx.path, courses }));
  });

  router.get('/courses/:id', (ctx) => {
    const course = requirePublishedCourse(ctx.db, ctx.params.id);
    sendHtml(ctx.res, 200, coursePage({
      user: ctx.user,
      path: ctx.path,
      course: publicCourse(course),
      watch: watchState(ctx, course),
    }));
  });

  router.get('/api/courses', (ctx) => {
    sendJson(ctx.res, 200, { courses: listPublishedCourses(ctx.db).map((row) => publicCourse(row)) });
  });

  router.get('/api/courses/:id', (ctx) => {
    sendJson(ctx.res, 200, { course: publicCourse(requirePublishedCourse(ctx.db, ctx.params.id)) });
  });

  // ---------- 管理员 ----------
  router.get('/admin', (ctx) => {
    if (!requireAdminPage(ctx)) return;
    const notice = ctx.url.searchParams.get('notice');
    const noticeId = Number(ctx.url.searchParams.get('id'));
    const noticeCourse = Number.isSafeInteger(noticeId) && noticeId > 0 ? getCourse(ctx.db, noticeId) : null;
    sendHtml(ctx.res, 200, adminListPage({
      user: ctx.user,
      path: ctx.path,
      courses: listAllCourses(ctx.db).map((row) => publicCourse(row, { admin: true })),
      notice: noticeCourse && ['created', 'updated'].includes(notice) ? { kind: notice, course: publicCourse(noticeCourse) } : null,
    }));
  });

  router.get('/admin/courses/new', (ctx) => {
    if (!requireAdminPage(ctx)) return;
    sendHtml(ctx.res, 200, courseFormPage({ user: ctx.user, path: ctx.path, course: null }));
  });

  router.get('/admin/courses/:id/edit', (ctx) => {
    if (!requireAdminPage(ctx)) return;
    const course = requireCourse(ctx.db, ctx.params.id);
    sendHtml(ctx.res, 200, courseFormPage({ user: ctx.user, path: ctx.path, course: publicCourse(course, { admin: true }) }));
  });

  router.get('/api/admin/courses', (ctx) => {
    requireAdmin(ctx);
    sendJson(ctx.res, 200, { courses: listAllCourses(ctx.db).map((row) => publicCourse(row, { admin: true })) });
  });

  router.post('/api/admin/courses', async (ctx) => {
    requireAdmin(ctx);
    const values = validateCourseInput(await readJson(ctx.req), { partial: false, videos: listVideos(app.config.mediaDir) });
    sendJson(ctx.res, 201, { course: publicCourse(createCourse(ctx.db, values), { admin: true }) });
  });

  router.get('/api/admin/courses/:id', (ctx) => {
    requireAdmin(ctx);
    sendJson(ctx.res, 200, { course: publicCourse(requireCourse(ctx.db, ctx.params.id), { admin: true }) });
  });

  router.patch('/api/admin/courses/:id', async (ctx) => {
    requireAdmin(ctx);
    const course = requireCourse(ctx.db, ctx.params.id);
    const values = validateCourseInput(await readJson(ctx.req), { partial: true, videos: listVideos(app.config.mediaDir) });
    sendJson(ctx.res, 200, { course: publicCourse(updateCourse(ctx.db, course.id, values), { admin: true }) });
  });

  router.get('/api/admin/videos', (ctx) => {
    requireAdmin(ctx);
    sendJson(ctx.res, 200, { videos: listVideos(app.config.mediaDir) });
  });

  // 封面只由编号决定，不涉及课程内容，草稿也可以显示。
  router.get('/covers/:id.svg', (ctx) => {
    const svg = coverSvg(parseId(ctx.params.id));
    ctx.res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Content-Length': Buffer.byteLength(svg),
      'Cache-Control': 'public, max-age=3600',
    });
    ctx.res.end(svg);
  });
}
