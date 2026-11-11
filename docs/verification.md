<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-001 验证记录

本记录对应「规划 IR，按规约生成代码」第 3、4 步，用于人工验收。
执行时间：2026-11-11。所有演练都在临时副本数据目录中进行，未触碰仓库 `data/` 与正在运行的服务。

## 环境与身份

| 项目 | 值 |
| --- | --- |
| Node.js | 24.22.2，`~/.local/lib/node-v24.22.2/bin/node` |
| 运行命令 | `env PATH="$HOME/.local/lib/node-v24.22.2/bin:$PATH" npm test` |
| Git 身份 | `wangjinye <wangjinye@guminggc.com>`（[[git-1]](../specs/packages/git.md#git-1) 要求先确认） |
| 规约校验 | `spex lint`：no problems found |
| 规约基线 | [DR-001](../specs/decisions/001-enrollment-mvp.md) 已接受，三个业务规约包已确认 |

会话默认 `PATH` 中的 Node.js 是 v22.22.2，会让 4 项运维系统测试因版本检查提前退出；验证一律前置 Node.js 24.22.2。

## 命令与实际结果

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 规约结构 | `spex lint` | no problems found |
| 全量测试 | `npm test`（Node 24） | 51 项通过、0 失败（改动前为 39 项、38 通过） |
| 迁移数据层 | Node 内联脚本 | 执行 `001-init.sql`、`002-enrollments.sql`；账号 3、课程 4；重复报名同一条；取消后状态 `cancelled` 且仍可查 |
| 运维交接 | `npm run backup` → `npm run migrate` → `npm start` | 见下节逐步证据 |
| 重启核对 | 同一数据目录再次 `npm start` | 报名 1 条仍为 `active`，账号 3、课程 4 不变，播放签发 200 |
| 恢复演练 | 副本 `DATA_DIR` 执行 `npm run restore -- <迁移前快照>` | 提示 `002-enrollments.sql` 待执行；补跑 `npm run migrate` 后启动，账号 3、课程 4、报名表为空 |

### 备份 → 迁移 → 启动 → 重启 → 恢复演练输出摘要

```text
STEP1 旧库：账号 3，课程 4，已执行迁移 001-init.sql
STEP2 npm run backup：已备份，账号 3 个，课程 4 门，已执行迁移 1 个
STEP3 npm run migrate：已执行 1 个迁移：002-enrollments.sql
STEP3 迁移后：{"users":3,"courses":4,"enrollments":0}
STEP4 启动：applied ["001-init.sql","002-enrollments.sql"]，pending []
STEP4 登录：HTTP 200
STEP4 报名：HTTP 201 记录 1 状态 active；播放签发 HTTP 200
STEP5 npm run backup（含报名记录）：已备份，已执行迁移 2 个
STEP6 重启后：报名 1 条（状态 active），账号课程 {"users":3,"courses":4,"enrollments":1}，播放签发 HTTP 200
STEP7 恢复（副本）：账号 3 个，课程 4 门，已执行迁移 1 个；提示 002-enrollments.sql 待执行
STEP7 恢复后迁移：已执行 1 个迁移：002-enrollments.sql
STEP7 副本启动：applied ["001-init.sql","002-enrollments.sql"]，账号课程报名 {"users":3,"courses":4,"enrollments":0}
STEP8 全部子进程已正常停止，仓库 data/ 未被触碰
```

## 规约条目与验证证据的对应

| 条目 | 证据 |
| --- | --- |
| course-enrollment-9 至 14 | `test/enrollment.test.js`（6 项） |
| course-access-9 至 14 | `test/access.test.js`（5 项）与 `test/watch.test.js`（5 项） |
| course-catalog-6 至 9 | `test/catalog.test.js`（5 项，含新增的报名前后一致性） |
| course-access-7 | `src/playback.js` 的 `checkWatchEligibility` 单点判定，页面与接口共用；`test/watch.test.js` 断言取消报名后页面与接口同步变化 |
| course-access-8 | `test/access.test.js` 的签名篡改矩阵与 `test/watch.test.js` 的媒体读取用例 |
| course-enrollment-8 | `migrations/002-enrollments.sql` 的部分唯一索引；`test/enrollment.test.js` 断言迁移清单且已执行迁移未被修改 |
| licensing-3、licensing-4 | `test/repo.test.js`：每个源文件都带 SPDX 头 |
| git-2 至 git-5 | 5 次提交的主题、正文、`IR-001` 引用与 `Co-authored-by` 尾注 |

### 覆盖方式的如实说明

- `course-access-14` 要求浏览器在地址到期后自动续播并限制连续失败。本轮没有浏览器自动化环境，采用白盒断言 `public/js/app.js` 的 `error` 续播、`resumeAt` 恢复进度与 `failures >= 2` 提示，并用短有效期真实服务验证过期 410 后可重新签发。
- `course-catalog-8` 的「页面内容一致」按课程信息比对：顶栏与播放面板会按登录、报名状态变化（[[course-access-2]](../specs/packages/course-access.md#course-access-2) 要求），课程标题、讲师、封面与课程链接在报名前、报名后、取消后保持一致。
- 基线噪声：已跟踪的 `.idea/.gitignore` 缺 SPDX 头，使改动前 `npm test` 有 1 项失败。本轮只补两行注释，不改其行为；`.idea/` 目录清理不属于本轮范围。

## 关键取舍与理由

1. **Q4 取消后再次报名**：[DR-001](../specs/decisions/001-enrollment-mvp.md) 的 Q4 待定，规约只规定「已有有效报名」的结果。本轮不修订规约，`POST /api/enrollments` 在只有已取消记录时返回 409 与「该课程报名已取消，本轮暂不支持再次报名」，不产生第二条记录；已写入 `test/enrollment.test.js` 与接口文档。
2. **不新增报名页面入口**：规约只规定报名接口与课程页播放面板，新增按钮或报名列表会改变对外承诺。本轮报名通过接口完成，页面仅按资格显示「请先报名后再观看」。
3. **管理员可为本人报名**：[[course-enrollment-7]](../specs/packages/course-enrollment.md#course-enrollment-7) 只约束作用域与他人视图，未禁止管理员为自己报名；`GET /api/enrollments` 仍只返回本人记录，管理员无报名列表。
4. **状态值用 `active` / `cancelled`**：项目约定 JSON 字段用英文，中文「有效 / 已取消」体现在文档与页面提示。
5. **非法课程编号统一 404 消息**：为落实 [[course-catalog-2]](../specs/packages/course-catalog.md#course-catalog-2) 与 [[course-access-1]](../specs/packages/course-access.md#course-access-1) 的「一视同仁」，新增 `parseCourseId`，让草稿、不存在、前导零与非数字编号都返回「课程不存在或尚未发布」。
6. **既有承诺未改写**：播放地址 60 秒、地址即授权、不校验 cookie、已签发地址到期前可读、页面续播、`/media/:id` 校验均保持原样。
7. **版权头漂移（未处理）**：自编规约文件沿用上游 `SubLang International` 的头，而 [[licensing-9]](../specs/packages/licensing.md#licensing-9) 规定项目持有人为 `wangjinye`。这属于既有规约与文件的不一致，改动会触碰已确认规约包，本轮只记录、不擅改。
8. **共享文档**：本会话没有小组共享飞书文档的访问入口，任务与验证安排的关键取舍、理由与实际结果记录在本文件，需由组长同步到飞书。

## 未执行与未完成项

- 无未通过的本轮交付项；IR-001 的全部交付项已执行并勾选，状态为「已完成（待人工验收）」。
- Q4、Q5、[DR-002](../specs/decisions/002-personal-center-learning-status.md)、[DR-003](../specs/decisions/003-course-creation-access.md) 仍属范围之外，功能未实现。
- `course-access-14` 的浏览器真机续播未执行，采用上述白盒 + 服务端替代验证。
- 版权头漂移与 `.idea/` 目录清理留待人工决定，未纳入本轮。

## 提交与交接

| 项目 | 内容 |
| --- | --- |
| 提交序列 | 本轮按 IR 划分的 5 次提交：`feat(db)` 5a72c3a、`feat(enroll)` 3346f4a、`feat(access)` 55471c9、`docs(api)` 54088f4、`docs(verify)`（本记录）；IR 初版由并发会话以 `d1fa04e "IR"` 提交，本记录在最后一次提交中据实更新 |
| 提交约定 | 每次提交引用 `IR-001`，正文说明改了什么与为什么，末尾含 `Co-authored-by: Claude Opus 6 (coder) <cligent@sublang.ai>` |
| 运行入口 | `npm start`（Node.js 24.22.2），打开 `http://localhost:3000` |
| 示例账号 | `admin` / `student` / `student2`，密码见 `README.md` |
| 数据准备 | 新数据目录首次启动自动执行全部迁移并写入示例账号课程；已有数据目录按 `npm run backup` → `npm run migrate` → `npm start` 升级，重启后报名记录保留；恢复演练使用副本 `DATA_DIR` |
| 本轮入口 | 报名 `POST /api/enrollments`、`GET /api/enrollments`、`DELETE /api/enrollments/:id`；观看 `POST /api/courses/:id/play`，详见 `docs/api.md` |
