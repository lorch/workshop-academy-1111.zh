<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# course-access: 观看资格与播放授权

## 意图

本规约包使已登录且持有效报名的学员能够取得并读取已发布课程的限时播放地址。
它规定观看资格判定、课程页与直调接口的一致结果、播放地址签发与「地址即授权」的视频读取。
它依据 [DR-001](../decisions/001-enrollment-mvp.md) 的 D4 与 D7 加入有效报名条件，保留本轮不改变的播放授权行为，且不改造 `/media/:id` 读取校验。

## 外部行为

### course-access-1

当请求 `POST /api/courses/:id/play`，播放地址签发接口应仅在请求者已登录、课程为已发布课程 [[course-catalog-2](course-catalog.md#course-catalog-2)] 且请求者对该课程持有效报名 [[course-enrollment-3](course-enrollment.md#course-enrollment-3)] 时签发播放地址，否则拒绝签发且不返回播放地址：

| 情形 | 结果 |
| --- | --- |
| 未登录 | 401 与「请先登录后再观看」 |
| 课程不存在、未发布或编号不合法 | 404 与「课程不存在或尚未发布」 |
| 无报名、报名已取消或报名属于他人 | 403 与「请先报名后再观看」 |

### course-access-2

当渲染已发布课程详情页或请求 `POST /api/courses/:id/play`，站点应对同一观看资格判定 [[course-access-1](#course-access-1)] 给出一致的页面与接口结果：

| 判定结果 | 页面播放面板 | 播放地址签发接口 |
| --- | --- | --- |
| 未登录 | 显示「去登录」入口，不提供开始观看按钮 | 401 |
| 课程不可用或无有效报名 | 显示不可观看原因，不提供开始观看按钮 | 404 或 403 |
| 具备观看资格 | 显示「开始观看」按钮 | 200 与播放地址 |

- 课程详情页的 HTML 不包含播放地址。
- 页面上的「开始观看」按钮通过 `POST /api/courses/:id/play` 取得播放地址。

### course-access-3

给定观看资格判定通过 [[course-access-1](#course-access-1)]，当签发播放地址，站点应返回 `url` 与 `expiresAt` 两个字段：

- `url` 为 `/media/<课程编号>?expires=<到期毫秒时间戳>&signature=<64 位十六进制签名>`。
- `expiresAt` 等于 `url` 中 `expires` 的数值。
- 有效期为签发时刻起 60 秒。

### course-access-4

当请求 `GET` 或 `HEAD /media/:id?expires=…&signature=…`，视频读取接口应仅凭签名与到期时间返回课程视频，而不校验请求者的登录状态或报名状态：

| 情形 | 结果 |
| --- | --- |
| 签名缺失、格式错误、被篡改或课程编号不匹配 | 403 与「播放地址无效」 |
| 到期时间已过 | 410 与「播放地址已过期，请重新获取」 |
| 课程视频文件缺失 | 404 与「视频不存在」 |
| 地址有效 | 200，或按 `Range` 返回 206 并带 `Content-Range` |

- 有效请求无需携带会话 cookie。
- 拒绝越界的 `Range` 时返回 416 与 `Content-Range: bytes */<文件大小>`。
- `HEAD` 请求返回与 `GET` 一致的 `Content-Length`，且不返回视频内容。

### course-access-5

如果播放地址已签发 [[course-access-3](#course-access-3)]，当请求者随后取消报名 [[course-enrollment-6](course-enrollment.md#course-enrollment-6)] 或课程被取消发布，站点应在该地址到期前继续按 [[course-access-4](#course-access-4)] 提供视频，并对新的播放地址签发请求按 [[course-access-1](#course-access-1)] 拒绝，地址到期后重新申请同样被拒绝。

### course-access-6

给定课程页已开始播放 [[course-access-3](#course-access-3)]，当视频因播放地址到期而加载失败，页面脚本应重新申请播放地址并从原播放进度继续，且连续失败超过两次时提示刷新页面后重试。

## 内部行为

### course-access-7

当判定观看资格 [[course-access-1](#course-access-1)]，服务端应在同一个判定函数内依次检查登录状态、课程发布状态与有效报名状态，且课程页播放面板 [[course-access-2](#course-access-2)] 与播放地址签发接口都调用该函数。

### course-access-8

当签发或校验播放地址 [[course-access-3](#course-access-3)] [[course-access-4](#course-access-4)]，服务端应使用数据库中保存的播放签名密钥，以课程编号与到期时间计算 HMAC-SHA256 十六进制签名，并以恒定时间比较校验请求签名。

## 验证

### course-access-9

给定真实服务与临时数据库已启动，当以访客、无报名学员、已取消报名学员、持有效报名学员分别请求 `POST /api/courses/:id/play`，并以已发布课程、草稿课程与不存在课程分别请求，集成验证应断言各情形的状态码与中文错误逐一对应、被拒绝时不返回 `url` 或 `expiresAt` [[course-access-1](#course-access-1)]。

### course-access-10

给定真实服务与临时数据库已启动，当以访客、无报名学员与持有效报名学员分别打开已发布课程详情页并点击「开始观看」，系统验证应断言页面播放面板的状态、按钮与中文提示和直调接口结果一致、页面 HTML 不含播放地址、无报名学员仍能以 200 打开课程详情页 [[course-access-2](#course-access-2)]，并断言取消报名后重新加载页面与直调接口的结果同步变化 [[course-access-7](#course-access-7)]。

### course-access-11

给定真实服务与临时数据库已启动，当持有效报名学员请求播放地址，集成验证应断言响应字段集合、`url` 形态、`expiresAt` 与 `expires` 一致且有效期约 60 秒 [[course-access-3](#course-access-3)]，并断言篡改签名、到期时间或课程编号的请求被 403 拒绝 [[course-access-8](#course-access-8)]。

### course-access-12

给定真实服务与临时数据库已启动，当持有效报名学员取得播放地址后以不带 cookie 的请求读取视频，系统验证应断言 `GET`、`HEAD` 与 `Range` 请求返回预期的 200、206 与响应头、签名无效返回 403、过期返回 410、视频缺失返回 404、越界范围返回 416 [[course-access-4](#course-access-4)]，且请求不带会话仍可读取 [[course-access-8](#course-access-8)]。

### course-access-13

给定真实服务与临时数据库已启动且播放地址有效期被缩短，当学员在取得地址后取消报名并再次申请、管理员取消课程发布并再次申请、以及旧地址到期后重新申请，系统验证应断言旧地址在到期前仍可读取、新的签发请求被拒绝、过期地址返回 410、过期后重新申请仍被拒绝 [[course-access-5](#course-access-5)] [[course-access-1](#course-access-1)] [[course-access-4](#course-access-4)]。

### course-access-14

给定真实服务与临时数据库已启动且播放地址有效期被缩短，当视频播放中地址到期触发加载失败，系统验证应断言页面自动取得新地址并从原进度继续播放，且连续失败超过两次时显示刷新提示 [[course-access-6](#course-access-6)]。
