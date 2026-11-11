// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHmac } from 'node:crypto';
import { closeSync, createReadStream, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSetting } from './db.js';
import { getCourse, getPublishedCourse, parseCourseId } from './courses.js';
import { hasActiveEnrollment } from './enrollments.js';
import { HttpError, constantTimeEqual, parseId, sendJson } from './http.js';

export const VIDEO_FILENAME = /^[a-z0-9][a-z0-9-]{0,80}\.mp4$/;

/**
 * 观看资格：判断某个用户此刻能否取得新的播放地址。
 * 课程页的“开始观看”按钮状态和 POST /api/courses/:id/play 都只经过这里，
 * 依次检查登录状态、课程发布状态与本人有效报名。
 *
 * 返回 { ok: true, course } 或 { ok: false, status, reason, message, course? }。
 */
export function checkWatchEligibility(db, user, courseId) {
  if (!user) {
    return { ok: false, status: 401, reason: 'login_required', message: '请先登录后再观看' };
  }
  const course = getPublishedCourse(db, courseId);
  if (!course) {
    return { ok: false, status: 404, reason: 'course_unavailable', message: '课程不存在或尚未发布' };
  }
  // 页面播放面板与直调接口共用本判定：登录、发布状态、本人有效报名依次检查。
  if (!hasActiveEnrollment(db, user.id, course.id)) {
    return { ok: false, status: 403, reason: 'enrollment_required', message: '请先报名后再观看' };
  }
  return { ok: true, course };
}

/** 课程页播放面板的初始状态（见 views/course.js）。 */
export function watchStateForPage(ctx, course) {
  const result = checkWatchEligibility(ctx.db, ctx.user, course.id);
  if (result.ok) return { state: 'ready' };
  if (result.reason === 'login_required') return { state: 'login' };
  return { state: 'blocked', message: result.message };
}

function playbackSignature(db, courseId, expiresAt) {
  const secret = getSetting(db, 'playback_secret');
  if (!secret) throw new Error('缺少播放签名密钥');
  return createHmac('sha256', secret).update(`${courseId}:${expiresAt}`).digest('hex');
}

/** 签发有效期为 ttlMs 的播放地址。 */
export function createPlaybackGrant(db, courseId, ttlMs, now = Date.now()) {
  const expiresAt = now + ttlMs;
  const signature = playbackSignature(db, courseId, expiresAt);
  return { url: `/media/${courseId}?expires=${expiresAt}&signature=${signature}`, expiresAt };
}

/** 校验播放地址：签名不符 403，已过期 410。 */
export function verifyPlaybackUrl(db, courseId, searchParams, now = Date.now()) {
  const expires = searchParams.get('expires') || '';
  const signature = searchParams.get('signature') || '';
  if (!/^\d{1,15}$/.test(expires) || !/^[0-9a-f]{64}$/.test(signature)
    || !constantTimeEqual(signature, playbackSignature(db, courseId, Number(expires)))) {
    throw new HttpError(403, '播放地址无效');
  }
  if (Number(expires) <= now) throw new HttpError(410, '播放地址已过期，请重新获取');
}

/** 读取 MP4 的 moov/mvhd，返回四舍五入的秒数；解析失败返回 null。 */
export function readMp4Duration(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = statSync(file).size;
    const header = Buffer.alloc(16);
    const findBox = (start, end, type) => {
      let offset = start;
      while (offset + 8 <= end) {
        readSync(fd, header, 0, 16, offset);
        let boxSize = header.readUInt32BE(0);
        let headerSize = 8;
        if (boxSize === 1) {
          boxSize = Number(header.readBigUInt64BE(8));
          headerSize = 16;
        } else if (boxSize === 0) {
          boxSize = end - offset;
        }
        if (boxSize < headerSize) return null;
        if (header.toString('latin1', 4, 8) === type) return { start: offset + headerSize, end: offset + boxSize };
        offset += boxSize;
      }
      return null;
    };
    const moov = findBox(0, size, 'moov');
    const mvhd = moov && findBox(moov.start, moov.end, 'mvhd');
    if (!mvhd) return null;
    const body = Buffer.alloc(32);
    readSync(fd, body, 0, 32, mvhd.start);
    const version = body.readUInt8(0);
    const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
    const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
    return timescale ? Math.round(duration / timescale) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** media/ 中可供课程使用的视频。 */
export function listVideos(mediaDir) {
  let names = [];
  try {
    names = readdirSync(mediaDir).filter((name) => VIDEO_FILENAME.test(name)).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return names.map((file) => {
    const path = resolve(mediaDir, file);
    return { file, sizeBytes: statSync(path).size, durationSeconds: readMp4Duration(path) };
  });
}

/** 解析单段 Range；无法识别或多段时返回 null（按整个文件响应）。 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (match[2] && Number(match[2]) < start) return null;
  }
  if (!Number.isSafeInteger(start) || start >= size) return 'unsatisfiable';
  return { start, end };
}

function streamVideo(req, res, file) {
  const size = statSync(file).size;
  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  if (range === 'unsatisfiable') {
    throw new HttpError(416, '请求的视频范围无效', { headers: { 'Content-Range': `bytes */${size}` } });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export function registerPlaybackRoutes(app) {
  const { router, config } = app;

  router.post('/api/courses/:id/play', (ctx) => {
    const result = checkWatchEligibility(ctx.db, ctx.user, parseCourseId(ctx.params.id));
    if (!result.ok) throw new HttpError(result.status, result.message);
    sendJson(ctx.res, 200, createPlaybackGrant(ctx.db, result.course.id, config.playbackTtlMs));
  });

  // 已签发的地址在有效期内都可读取；media/ 中的文件不会以其他方式提供。
  router.get('/media/:id', (ctx) => {
    const courseId = parseId(ctx.params.id);
    verifyPlaybackUrl(ctx.db, courseId, ctx.url.searchParams);
    const course = getCourse(ctx.db, courseId);
    if (!course || !VIDEO_FILENAME.test(course.video_file)) throw new HttpError(404, '视频不存在');
    const file = resolve(config.mediaDir, course.video_file);
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
    } catch {
      throw new HttpError(404, '视频不存在');
    }
    streamVideo(ctx.req, ctx.res, file);
  });
}
