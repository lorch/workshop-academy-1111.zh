<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# HTTP 接口

页面上的操作都调用下面这些接口，也可以直接用 curl 等工具调用。示例假设服务地址为 `http://localhost:3000`；以 `HOST=0.0.0.0` 开放局域网访问时，把示例中的地址换成启动日志打印的本机 IP 即可。

## 通用约定

- 请求和响应都是 JSON，字段名为英文，消息为中文。
- 除 `GET`、`HEAD` 外，`/api/` 下的请求必须带 `Content-Type: application/json`，否则返回 415；请求体不超过 64 KB。
- 带 `Origin` 请求头时必须与访问地址同源，否则返回 403。
- `Host` 请求头必须在允许列表内：默认仅 `localhost`、`127.0.0.1`、`[::1]`；以 `HOST=0.0.0.0` 启动时额外放行本机网卡地址，以及 `ALLOWED_HOSTS` 中显式列出的主机名，否则返回 400。
- 登录后服务端设置 cookie `academy_session`（HttpOnly，SameSite=Lax，12 小时）；命令行工具需要保存并带回它。
- 出错时返回 `{"error": "中文说明"}`；表单校验错误另带 `fields`，逐字段说明问题。
- 编号不合法或资源不存在时返回 404；未发布的课程对外与不存在相同。

| 状态码 | 含义 |
| --- | --- |
| 200 / 201 | 成功 / 已创建 |
| 400 | 请求内容不合法 |
| 401 | 需要登录 |
| 403 | 没有权限，或播放地址签名无效 |
| 404 | 不存在或未发布 |
| 409 | 报名已取消，本轮不支持再次报名 |
| 410 | 播放地址已过期 |
| 413 / 415 | 请求体过大 / 不是 JSON |

## 账号与会话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/login` | 请求体 `{"username","password"}`，返回 `{"user"}` 并设置会话 cookie，同时结束请求带来的旧会话；用户名或密码错误返回 401 |
| `POST` | `/api/logout` | 结束当前会话 |
| `GET` | `/api/session` | 返回 `{"user": {...}}`，未登录时 `user` 为 `null` |

`user` 的字段：`id`、`username`、`displayName`、`role`（`admin` 或 `student`）。

```sh
curl -s -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"student","password":"123456"}' \
  http://localhost:3000/api/login

curl -s -b cookies.txt http://localhost:3000/api/session

curl -s -b cookies.txt -c cookies.txt -X POST -H 'Content-Type: application/json' \
  http://localhost:3000/api/logout
```

`cookies.txt` 保存登录会话，已在 `.gitignore` 中忽略，不会被误提交。

## 课程（公开）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/courses` | 已发布课程列表 `{"courses": [...]}` |
| `GET` | `/api/courses/:id` | 已发布课程详情 `{"course": {...}}`，草稿返回 404 |

课程字段：`id`、`title`、`summary`、`description`、`instructor`、`level`（`beginner`/`intermediate`/`advanced`）、`levelLabel`（入门/进阶/高级）、`durationSeconds`、`published`、`url`、`coverUrl`、`updatedAt`（毫秒时间戳）。

```sh
curl -s http://localhost:3000/api/courses
curl -s http://localhost:3000/api/courses/1
```

## 报名（登录后）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/enrollments` | 请求体 `{"courseId":1}`，为当前登录账号报名已发布课程，返回 201 和 `{"enrollment"}` |
| `GET` | `/api/enrollments` | 返回 `{"enrollments": [...]}`，只含本人的有效与已取消报名 |
| `DELETE` | `/api/enrollments/:id` | 取消本人的一条报名，返回 200 和 `{"enrollment"}` |

报名记录字段：`id`、`courseId`、`courseTitle`、`status`（`active` 有效、`cancelled` 已取消）、`createdAt`（毫秒时间戳）。

| 情形 | 结果 |
| --- | --- |
| 未登录 | 401 |
| 课程不存在、未发布或编号不合法 | 404 |
| 当前账号已有有效报名 | 200 返回既有记录，不新增 |
| 报名已取消后再次报名 | 409，本轮不支持再次报名 |
| 查看或取消他人报名、编号不合法 | 404 |

- 报名人数不设上限；取消只把记录标记为已取消，不物理删除，服务重启后仍可查。
- 报名信息仅本人可见；管理员本轮没有报名列表，也不能代报名或导出报名。
- 请求体中自报的账号名、学员编号或角色一律忽略，只认当前会话身份。
- 本轮不提供报名页面入口，报名通过上述接口完成；课程目录与课程详情保持公开可浏览。

```sh
curl -s -b cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"courseId":1}' http://localhost:3000/api/enrollments
# {"enrollment":{"id":1,"courseId":1,"courseTitle":"…","status":"active","createdAt":…}}

curl -s -b cookies.txt http://localhost:3000/api/enrollments

curl -s -b cookies.txt -X DELETE -H 'Content-Type: application/json' \
  http://localhost:3000/api/enrollments/1
```

## 观看

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/courses/:id/play` | 取得播放地址 `{"url", "expiresAt"}`；未登录 401，课程不存在或未发布 404，无有效报名 403 |
| `GET` / `HEAD` | `/media/:id?expires=…&signature=…` | 读取视频，支持 `Range`；签名无效 403，已过期 410，视频缺失 404 |

观看资格只在签发播放地址时检查：需要当前账号已登录、课程已发布且本人持该课程的有效报名。页面的“开始观看”按钮和直接调用接口经过同一个检查（`src/playback.js` 中的 `checkWatchEligibility`）；无有效报名时页面显示“请先报名后再观看”，接口返回 403。
播放地址默认 60 秒内有效，地址本身就是授权，不需要 cookie；已签发的地址在到期前都可读取，即使随后取消报名或课程被取消发布。
页面播放时如果地址过期，会自动重新申请并从当前进度继续。

```sh
curl -s -b cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"courseId":1}' http://localhost:3000/api/enrollments

curl -s -b cookies.txt -X POST -H 'Content-Type: application/json' \
  http://localhost:3000/api/courses/1/play
# {"url":"/media/1?expires=1794190000000&signature=…","expiresAt":1794190000000}

curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -H 'Range: bytes=0-1023' \
  'http://localhost:3000/media/1?expires=…&signature=…'
# 206 1024
```

## 课程管理（管理员）

以下接口未登录返回 401，非管理员返回 403。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/courses` | 全部课程（含草稿），另含 `videoFile`、`createdAt` |
| `POST` | `/api/admin/courses` | 新建课程，返回 201 和 `{"course"}` |
| `GET` | `/api/admin/courses/:id` | 单门课程 |
| `PATCH` | `/api/admin/courses/:id` | 修改部分字段，返回 `{"course"}` |
| `GET` | `/api/admin/videos` | `media/` 中可选的视频：`file`、`sizeBytes`、`durationSeconds` |

可写字段：

| 字段 | 新建时 | 规则 |
| --- | --- | --- |
| `title` | 必填 | 不超过 80 字 |
| `summary` | 必填 | 不超过 200 字 |
| `description` | 选填 | 不超过 5000 字，空行分段 |
| `instructor` | 必填 | 不超过 40 字 |
| `level` | 必填 | `beginner`、`intermediate` 或 `advanced` |
| `videoFile` | 必填 | `/api/admin/videos` 中的文件名；课程时长按视频自动计算 |
| `published` | 选填 | `true` 或 `false`，新建默认 `false`（草稿） |

```sh
curl -s -c admin.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}' http://localhost:3000/api/login

curl -s -b admin.txt -H 'Content-Type: application/json' \
  -d '{"title":"新课程","summary":"一句话简介","instructor":"讲师","level":"beginner","videoFile":"python-basics.mp4"}' \
  http://localhost:3000/api/admin/courses

curl -s -b admin.txt -X PATCH -H 'Content-Type: application/json' \
  -d '{"published":true}' http://localhost:3000/api/admin/courses/5
```

校验失败的响应示例：

```json
{"error":"请检查标出的字段","fields":{"title":"请填写课程标题","videoFile":"请选择课程视频"}}
```

## 运维

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | `{"ok": true, "migrations": {"applied": [...], "pending": [...]}}` |
| `POST` | `/internal/stop` | 请求正常停服，需要请求头 `x-maintenance-token`（见 `run.json`）；由 `npm run backup` 使用 |

## 页面

| 路径 | 说明 |
| --- | --- |
| `/` | 课程目录 |
| `/courses/:id` | 课程详情与播放 |
| `/login?next=/…` | 登录，成功后回到站内地址 `next` |
| `/login?switch=1&next=/…` | 已登录时也显示登录表单（403 页的“换个账号登录”），新会话替换旧会话 |
| `/admin` | 课程管理（管理员） |
| `/admin/courses/new`、`/admin/courses/:id/edit` | 新建、编辑课程 |

页面出错时返回带站点外壳的 HTML 错误页；未登录访问管理页会跳转到登录页。
