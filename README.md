<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 学堂在线

学堂在线是一个在本机运行的视频课程网站，用作《给人类开发者的 AI 原生软件工程课》的实战项目。
它提供账号登录、课程目录、课程管理、课程报名与限时播放：登录学员先为已发布课程报名，才能取得播放地址；课程目录与详情仍然公开可浏览。

## 运行

需要 [Node.js 24](https://nodejs.org/zh-cn/download)（版本见 `.nvmrc`）。无需 `npm install`，也不需要联网。

```sh
npm start
```

打开 <http://localhost:3000>，按 `Ctrl+C` 停止。首次启动会自动建库并写入示例账号和课程，以后启动保留已有数据；数据库结构按 `migrations/` 中的编号迁移演进，新增的 `002-enrollments.sql` 建立报名数据表。

默认只有本机能访问。要让同一局域网的其他设备打开，改用 `HOST=0.0.0.0 npm start`，启动日志会打印可分享的局域网地址；示例账号密码是公开的，只在可信网络临时开放。详见[运维说明](docs/operations.md#局域网访问)。

## 示例账号

| 账号 | 密码 | 身份 |
| --- | --- | --- |
| `admin` | `123456` | 管理员 |
| `student` | `123456` | 学员 |
| `student2` | `123456` | 学员 |

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 启动服务（默认仅本机访问） |
| `HOST=0.0.0.0 npm start` | 启动服务并允许局域网访问 |
| `npm test` | 运行测试（启动真实服务，用临时数据目录） |
| `npm run backup` | 正常停服并备份数据库 |
| `npm run migrate` | 服务停止时执行新的迁移 |
| `npm run restore -- <备份文件>` | 服务停止时用备份替换数据库 |

## 报名后观看

学员登录后为课程报名，再在课程详情页点击“开始观看”。本轮报名通过接口完成，页面不提供报名按钮；报名人数不设上限，取消报名后记录仍可查，服务重启后保持。

```sh
# 先按 HTTP 接口文档登录并保存 cookies.txt，再报名课程 1
curl -s -b cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"courseId":1}' http://localhost:3000/api/enrollments
```

取消后再次报名本轮暂不支持（Q4 待定）；观看资格、播放地址与完整 curl 示例见 [HTTP 接口](docs/api.md)。数据目录、端口和备份恢复见[运维说明](docs/operations.md)。

## 代码结构

| 位置 | 内容 |
| --- | --- |
| `src/app.js` | 应用生命周期、运行记录与请求处理 |
| `src/auth.js` | 密码校验、会话、登录接口 |
| `src/courses.js` | 课程目录、详情与管理 |
| `src/enrollments.js` | 报名记录、有效报名判定与报名接口 |
| `src/playback.js` | 观看资格、播放地址签发与视频读取 |
| `src/views/` | 服务端渲染的页面 |
| `public/` | 样式与页面脚本 |
| `migrations/` | 编号 SQL 迁移 |
| `scripts/` | 迁移、备份、恢复与示例视频生成 |
| `test/` | 集成测试与系统测试 |

## 课程起点

| 标签 | 内容 |
| --- | --- |
| `start` | 可运行的学堂，没有 `specs/`，第一天从初始化规约开始 |
| `specs-ready` | 与 `start` 代码相同，另含观看功能的基座规约 |
