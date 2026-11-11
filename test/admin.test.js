// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import test from 'node:test';
import assert from 'node:assert/strict';
import { client, enroll, login, startApp } from './helpers.js';

const newCourse = {
  title: '课堂实战：从需求到验收',
  summary: '把一条需求写清楚，再一起验证它。',
  description: '第一段。\n\n第二段。',
  instructor: '赵一',
  level: 'advanced',
  videoFile: 'sqlite-modeling.mp4',
};

test('管理页面：未登录跳转登录，学员看到 403 页面', async (t) => {
  const app = await startApp(t);
  const guest = client(app.url);
  for (const path of ['/admin', '/admin/courses/new', '/admin/courses/1/edit']) {
    const response = await guest.get(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), `/login?next=${encodeURIComponent(path)}`);
  }
  const student = client(app.url);
  await login(student);
  const forbidden = await student.get('/admin');
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.headers.get('content-type'), /^text\/html/);
  const forbiddenHtml = await forbidden.text();
  assert.match(forbiddenHtml, /没有访问权限/);
  // 403 页的“换个账号登录”要真的打开登录表单，而不是被送回 403。
  const switchHref = forbiddenHtml.match(/href="([^"]+)">换个账号登录/)[1].replaceAll('&amp;', '&');
  const switchPage = await student.get(switchHref);
  assert.equal(switchPage.status, 200);
  assert.match(await switchPage.text(), /id="login-form" data-next="\/admin"/);
  await login(student, 'admin');
  assert.equal((await student.get('/admin')).status, 200, '换成管理员后可以打开管理页');

  const admin = client(app.url);
  await login(admin, 'admin');
  const list = await admin.get('/admin');
  assert.equal(list.status, 200);
  const html = await list.text();
  assert.match(html, /SQLite 数据建模实践/);
  assert.match(html, /data-course-id="4" data-published="0"/);
  assert.equal((await admin.get('/admin/courses/new')).status, 200);
  assert.match(await (await admin.get('/admin/courses/1/edit')).text(), /value="Python 入门：写出第一个程序"/);
  const missing = await admin.get('/admin/courses/99/edit');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /^text\/html/);
});

test('管理接口只对管理员开放', async (t) => {
  const app = await startApp(t);
  const guest = client(app.url);
  const student = client(app.url);
  await login(student);
  const calls = [
    ['GET', '/api/admin/courses'],
    ['POST', '/api/admin/courses', newCourse],
    ['GET', '/api/admin/courses/1'],
    ['PATCH', '/api/admin/courses/1', { published: false }],
    ['GET', '/api/admin/videos'],
  ];
  for (const [method, path, json] of calls) {
    assert.equal((await guest.request(path, { method, json })).status, 401, `${method} ${path}`);
    const denied = await student.request(path, { method, json });
    assert.equal(denied.status, 403, `${method} ${path}`);
    assert.deepEqual(await denied.json(), { error: '只有管理员可以执行这个操作' });
  }
  assert.equal((await (await guest.get('/api/courses/1')).json()).course.published, true, '越权请求没有改动数据');
});

test('管理员创建草稿、修改并发布课程，目录随之变化', async (t) => {
  const app = await startApp(t);
  const admin = client(app.url);
  await login(admin, 'admin');

  const { videos } = await (await admin.get('/api/admin/videos')).json();
  assert.deepEqual(videos.map((v) => v.file), ['git-essentials.mp4', 'python-basics.mp4', 'sqlite-modeling.mp4', 'web-api-testing.mp4']);
  assert.ok(videos.every((v) => v.durationSeconds > 0 && v.sizeBytes > 0));

  const all = await (await admin.get('/api/admin/courses')).json();
  assert.equal(all.courses.length, 4);
  assert.equal(all.courses[3].published, false);
  assert.equal(all.courses[0].videoFile, 'python-basics.mp4');

  const created = await admin.post('/api/admin/courses', { ...newCourse, title: `  ${newCourse.title}  ` });
  assert.equal(created.status, 201);
  const { course } = await created.json();
  assert.equal(course.title, newCourse.title);
  assert.equal(course.published, false);
  assert.equal(course.durationSeconds, 16);
  assert.equal(course.levelLabel, '高级');
  assert.equal((await admin.get(`/api/courses/${course.id}`)).status, 404, '草稿不公开');
  assert.equal((await admin.get(`/courses/${course.id}`)).status, 404);

  const edited = await admin.patch(`/api/admin/courses/${course.id}`, { summary: '新的简介', videoFile: 'web-api-testing.mp4' });
  assert.equal(edited.status, 200);
  const after = (await edited.json()).course;
  assert.equal(after.summary, '新的简介');
  assert.equal(after.title, newCourse.title);
  assert.equal(after.durationSeconds, 22);
  assert.ok(after.updatedAt >= course.updatedAt);

  assert.equal((await admin.patch(`/api/admin/courses/${course.id}`, { published: true })).status, 200);
  const catalog = await (await fetch(`${app.url}/api/courses`)).json();
  assert.ok(catalog.courses.some((c) => c.id === course.id));
  assert.match(await (await fetch(`${app.url}/`)).text(), /课堂实战：从需求到验收/);

  const student = client(app.url);
  await login(student);
  await enroll(student, course.id);
  assert.equal((await student.post(`/api/courses/${course.id}/play`)).status, 200);

  assert.equal((await admin.patch(`/api/admin/courses/${course.id}`, { published: false })).status, 200);
  assert.equal((await student.post(`/api/courses/${course.id}/play`)).status, 404);
  assert.equal((await student.get(`/courses/${course.id}`)).status, 404);

  const notice = await (await admin.get(`/admin?notice=created&id=${course.id}`)).text();
  assert.match(notice, /已创建/);
});

test('课程字段校验返回逐字段的中文提示', async (t) => {
  const app = await startApp(t);
  const admin = client(app.url);
  await login(admin, 'admin');

  const empty = await admin.post('/api/admin/courses', {});
  assert.equal(empty.status, 400);
  const body = await empty.json();
  assert.equal(body.error, '请检查标出的字段');
  assert.deepEqual(Object.keys(body.fields).sort(), ['instructor', 'level', 'summary', 'title', 'videoFile']);

  const invalid = await admin.post('/api/admin/courses', {
    ...newCourse, title: 'x'.repeat(81), level: 'expert', videoFile: '../package.json', published: 'yes',
  });
  const { fields } = await invalid.json();
  assert.equal(fields.title, '课程标题不能超过 80 个字');
  assert.equal(fields.level, '请选择课程难度');
  assert.equal(fields.videoFile, 'media/ 中没有这个视频文件');
  assert.equal(fields.published, '发布状态应为 true 或 false');

  const unknown = await admin.patch('/api/admin/courses/1', { id: 9 });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /不支持的字段：id/);
  const nothing = await admin.patch('/api/admin/courses/1', {});
  assert.equal(nothing.status, 400);
  const blank = await admin.patch('/api/admin/courses/1', { title: '   ' });
  assert.deepEqual((await blank.json()).fields, { title: '请填写课程标题' });
  assert.equal((await admin.patch('/api/admin/courses/99', { published: true })).status, 404);
  assert.equal((await admin.get('/api/admin/courses/99')).status, 404);
});
