// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import test from 'node:test';
import assert from 'node:assert/strict';
import { client, enroll, login, startApp } from './helpers.js';

test('目录与详情只公开已发布课程', async (t) => {
  const app = await startApp(t);
  const { courses } = await (await fetch(`${app.url}/api/courses`)).json();
  assert.deepEqual(courses.map((c) => c.id), [1, 2, 3]);
  const first = courses[0];
  assert.deepEqual(Object.keys(first).sort(), [
    'coverUrl', 'description', 'durationSeconds', 'id', 'instructor', 'level', 'levelLabel', 'published', 'summary', 'title', 'updatedAt', 'url',
  ]);
  assert.equal(first.level, 'beginner');
  assert.equal(first.levelLabel, '入门');
  assert.equal(first.published, true);
  assert.equal(first.videoFile, undefined, '公开接口不暴露视频文件名');

  const detail = await fetch(`${app.url}/api/courses/1`);
  assert.equal((await detail.json()).course.title, first.title);
  for (const id of ['4', '999', 'abc', '0', '01']) {
    const response = await fetch(`${app.url}/api/courses/${id}`);
    assert.equal(response.status, 404, id);
    assert.deepEqual(await response.json(), { error: '课程不存在或尚未发布' }, '草稿、不存在与非法编号一视同仁');
  }
});

test('目录页与详情页渲染课程信息，草稿返回 HTML 404 页面', async (t) => {
  const app = await startApp(t);
  const catalog = await (await fetch(`${app.url}/`)).text();
  assert.match(catalog, /Python 入门：写出第一个程序/);
  assert.match(catalog, /href="\/courses\/3"/);
  assert.doesNotMatch(catalog, /SQLite 数据建模实践/);
  assert.match(catalog, /src="\/covers\/1\.svg"/);
  assert.match(catalog, /登录后即可观看/);

  const page = await fetch(`${app.url}/courses/1`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<h1>Python 入门：写出第一个程序<\/h1>/);
  assert.match(html, /林知远/);
  assert.match(html, /登录后观看视频/);
  assert.match(html, /href="\/login\?next=%2Fcourses%2F1">去登录/);

  const draft = await fetch(`${app.url}/courses/4`);
  assert.equal(draft.status, 404);
  assert.match(draft.headers.get('content-type'), /^text\/html/);
  assert.match(await draft.text(), /页面不存在/);
});

test('页面内容经过转义', async (t) => {
  const app = await startApp(t);
  app.db.prepare('UPDATE courses SET title = ?, summary = ? WHERE id = 1').run('<script>alert(1)</script>', '"><img src=x onerror=alert(1)>');
  const c = client(app.url);
  await login(c);
  assert.doesNotMatch(await (await c.get('/')).text(), /登录后即可观看/, '已登录时不再提示登录');
  for (const path of ['/', '/courses/1']) {
    const html = await (await c.get(path)).text();
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  }
});

test('封面按课程编号确定生成像素 SVG', async (t) => {
  const app = await startApp(t);
  const one = await fetch(`${app.url}/covers/1.svg`);
  assert.equal(one.status, 200);
  assert.equal(one.headers.get('content-type'), 'image/svg+xml');
  assert.match(one.headers.get('cache-control'), /public/);
  const svg = await one.text();
  assert.match(svg, /^<svg [^>]*viewBox="0 0 160 90"/);
  assert.equal(svg, await (await fetch(`${app.url}/covers/1.svg`)).text());
  assert.notEqual(svg, await (await fetch(`${app.url}/covers/2.svg`)).text());
  assert.equal((await fetch(`${app.url}/covers/x.svg`)).status, 404);
});

test('报名前后课程集合、详情与页面课程信息保持一致', async (t) => {
  const app = await startApp(t);
  const c = client(app.url);
  const catalogOf = async () => (await (await c.get('/api/courses')).json()).courses;
  const detailOf = async () => (await (await c.get('/api/courses/1')).json()).course;
  // 顶栏与播放面板随登录、报名状态变化，这里只比较课程信息本身。
  const infoOf = (html) => ({
    title: /<h1>Python 入门：写出第一个程序<\/h1>/.test(html),
    instructor: /林知远/.test(html),
    cover: /\/covers\/1\.svg/.test(html),
    links: [...html.matchAll(/href="\/courses\/(\d+)"/g)].map((m) => m[1]).join(','),
  });

  const before = await catalogOf();
  const detailBefore = await detailOf();
  const pageBefore = infoOf(await (await c.get('/courses/1')).text());
  assert.deepEqual(before.map((course) => course.id), [1, 2, 3]);

  await login(c);
  assert.deepEqual(await catalogOf(), before, '登录不改变可见性');

  const record = await enroll(c, 1);
  assert.deepEqual(await catalogOf(), before, '报名不改变可见性或排序');
  assert.deepEqual(await detailOf(), detailBefore);
  assert.deepEqual(infoOf(await (await c.get('/courses/1')).text()), pageBefore);

  await c.del(`/api/enrollments/${record.id}`);
  assert.deepEqual(await catalogOf(), before, '取消报名不改变可见性');
  assert.deepEqual(await detailOf(), detailBefore);
  assert.deepEqual(infoOf(await (await c.get('/courses/1')).text()), pageBefore);
});
