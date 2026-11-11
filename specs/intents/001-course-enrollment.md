<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-001: 报名与观看资格实现

## 状态

待审阅（2026-11-11）。
本记录由开发依据 [DR-001](../decisions/001-enrollment-mvp.md) 与已确认规约包编写，供产品与测试对照审阅。
人工修订并确认后才执行本记录的各项任务。

## 意图

实现 [DR-001](../decisions/001-enrollment-mvp.md) 的最小可验证版本，使报名与观看资格的规约条目在代码中成立。
本轮引用以下已确认条目，不新增、不改写任何行为条目：

- 报名行为：[[course-enrollment-1](../packages/course-enrollment.md#course-enrollment-1)]、[[course-enrollment-2](../packages/course-enrollment.md#course-enrollment-2)]、[[course-enrollment-3](../packages/course-enrollment.md#course-enrollment-3)]、[[course-enrollment-4](../packages/course-enrollment.md#course-enrollment-4)]、[[course-enrollment-5](../packages/course-enrollment.md#course-enrollment-5)]、[[course-enrollment-6](../packages/course-enrollment.md#course-enrollment-6)]、[[course-enrollment-7](../packages/course-enrollment.md#course-enrollment-7)]、[[course-enrollment-8](../packages/course-enrollment.md#course-enrollment-8)]。
- 观看行为：[[course-access-1](../packages/course-access.md#course-access-1)]、[[course-access-2](../packages/course-access.md#course-access-2)]、[[course-access-3](../packages/course-access.md#course-access-3)]、[[course-access-4](../packages/course-access.md#course-access-4)]、[[course-access-5](../packages/course-access.md#course-access-5)]、[[course-access-6](../packages/course-access.md#course-access-6)]、[[course-access-7](../packages/course-access.md#course-access-7)]、[[course-access-8](../packages/course-access.md#course-access-8)]。
- 保持不变的承诺：[[course-catalog-4](../packages/course-catalog.md#course-catalog-4)] 的公开浏览与 [[course-access-4](../packages/course-access.md#course-access-4)] 的地址即授权。
- 提交与文件约定：[[git-2](../packages/git.md#git-2)]、[[git-4](../packages/git.md#git-4)]、[[git-5](../packages/git.md#git-5)]、[[licensing-9](../packages/licensing.md#licensing-9)]。

本轮范围之外：

- [DR-002](../decisions/002-personal-center-learning-status.md) 与 [DR-003](../decisions/003-course-creation-access.md) 均为草案，不实现其个人中心、学习状态与新建课程入口权限。
- [DR-001](../decisions/001-enrollment-mvp.md) 的 Q4 与 Q5 仍待定，规约未规定取消后再次报名及课程或账号删除的处置，本轮既不实现也不修订规约。
- 规约只规定报名接口与课程页播放面板，未规定报名页面入口，本轮不新增报名按钮或报名列表页面，避免改变对外承诺。
- 不改动账号体系、课程管理界面、视频存储与 `/media/:id` 读取校验。

## 交付项

- [ ] `migrations/002-enrollments.sql` 以编号大于 `001-init.sql` 的新迁移建立报名表，并以有效状态唯一约束保证同一学员对同一课程至多一条有效报名 [[course-enrollment-8](../packages/course-enrollment.md#course-enrollment-8)]。
- [ ] 报名记录的创建、查看、取消与有效报名判定持久化到数据库，记录不物理删除且重启后可查 [[course-enrollment-2](../packages/course-enrollment.md#course-enrollment-2)] [[course-enrollment-3](../packages/course-enrollment.md#course-enrollment-3)]。
- [ ] `POST /api/enrollments`、`GET /api/enrollments`、`DELETE /api/enrollments/:id` 按会话身份实现报名、查看与取消，且不提供他人报名视图 [[course-enrollment-1](../packages/course-enrollment.md#course-enrollment-1)] [[course-enrollment-5](../packages/course-enrollment.md#course-enrollment-5)] [[course-enrollment-6](../packages/course-enrollment.md#course-enrollment-6)] [[course-enrollment-7](../packages/course-enrollment.md#course-enrollment-7)]。
- [ ] `checkWatchEligibility` 在同一判定函数内加入有效报名条件，课程页播放面板与播放地址签发接口共用该判定 [[course-access-1](../packages/course-access.md#course-access-1)] [[course-access-2](../packages/course-access.md#course-access-2)] [[course-access-7](../packages/course-access.md#course-access-7)]。
- [ ] 播放地址签发、签名校验与视频读取保持现有承诺，已签发地址在有效期内仍可读取 [[course-access-3](../packages/course-access.md#course-access-3)] [[course-access-4](../packages/course-access.md#course-access-4)] [[course-access-5](../packages/course-access.md#course-access-5)] [[course-access-6](../packages/course-access.md#course-access-6)]。
- [ ] 课程目录与详情在报名前后保持公开且内容一致 [[course-catalog-4](../packages/course-catalog.md#course-catalog-4)]。
- [ ] 集成与系统测试覆盖 [[course-enrollment-9](../packages/course-enrollment.md#course-enrollment-9)] 至 [[course-enrollment-14](../packages/course-enrollment.md#course-enrollment-14)]、[[course-access-9](../packages/course-access.md#course-access-9)] 至 [[course-access-14](../packages/course-access.md#course-access-14)]，并回归 [[course-catalog-6](../packages/course-catalog.md#course-catalog-6)] 至 [[course-catalog-9](../packages/course-catalog.md#course-catalog-9)]。
- [ ] `docs/api.md` 与 `README.md` 同步报名接口、观看资格与运维说明，不改写已有的播放地址承诺。
- [ ] 验证记录写明命令、结果、失败项与实际取舍，未执行或未通过的交付项保持未勾选。
- [ ] 每项任务形成一次符合 [[git-2](../packages/git.md#git-2)]、[[git-4](../packages/git.md#git-4)]、[[git-5](../packages/git.md#git-5)] 的提交，并交付提交号、运行入口、账号与数据准备方式。

## 任务

1. 数据层：追加 `migrations/002-enrollments.sql` 与报名数据访问函数，不修改 `migrations/001-init.sql`。
   交付前验证：`spex lint` 通过、迁移编号大于 `001`、已有账号与课程数量不变、有效报名的五种情形判定符合 [[course-enrollment-11](../packages/course-enrollment.md#course-enrollment-11)]。
   提交主题：`feat(db): 追加报名数据表迁移`。
   依赖：无。

2. 报名接口：注册三个报名接口并接入应用，作用域只取当前会话身份，按 [[course-enrollment-9](../packages/course-enrollment.md#course-enrollment-9)]、[[course-enrollment-12](../packages/course-enrollment.md#course-enrollment-12)]、[[course-enrollment-13](../packages/course-enrollment.md#course-enrollment-13)]、[[course-enrollment-14](../packages/course-enrollment.md#course-enrollment-14)] 编写集成与系统测试。
   交付前验证：新增报名测试与 `npm test` 全部通过。
   提交主题：`feat(enroll): 实现本人报名接口`。
   依赖：任务 1。

3. 观看资格：在 `checkWatchEligibility` 中加入有效报名判定，同步课程页播放面板的按钮与中文原因，重写 `test/watch.test.js` 中与 [[course-access-1](../packages/course-access.md#course-access-1)] 冲突的旧断言，补齐 [[course-access-9](../packages/course-access.md#course-access-9)] 至 [[course-access-14](../packages/course-access.md#course-access-14)] 与 [[course-catalog-8](../packages/course-catalog.md#course-catalog-8)] 的验证。
   交付前验证：`npm test` 全部通过，页面与直调接口对同一身份给出一致结果。
   提交主题：`feat(access): 观看资格纳入有效报名`。
   依赖：任务 1、2。

4. 文档同步：更新 `docs/api.md` 与 `README.md` 的接口清单、观看资格说明和报名后的操作示例。
   交付前验证：文档中接口路径、状态码与代码一致，`spex lint` 通过。
   提交主题：`docs(api): 同步报名与观看接口`。
   依赖：任务 2、3。

5. 验证与交接记录：整理验证证据与关键取舍，据实更新本记录的交付项与状态。
   交付前验证：证据覆盖全部已勾选交付项，未通过项保持未勾选并注明原因。
   提交主题：`docs(verify): 记录本轮验证证据`。
   依赖：任务 1 至 4。

## 验证

- 每项任务交付前运行 `spex lint` 与 `npm test`，测试必须使用项目声明的 Node.js 24.22.2，并以真实服务和临时数据库执行集成与系统测试 [[meta-21](../meta.md#meta-21)] [[meta-32](../meta.md#meta-32)]。
- 项目声明的 Node.js 24.22.2 已安装于 `~/.local/lib/node-v24.22.2/bin/node`；会话默认 `PATH` 为 v22.22.2，验证时须把该绝对路径前置，否则 `test/ops.test.js` 的系统验证会因版本检查提前退出。
- 因本轮新增数据库迁移，按 `npm run backup`、`npm run migrate`、`npm start` 顺序执行，再核对原账号、课程数据与重启后的报名记录；恢复演练只用副本数据目录，不动正在使用的数据。
- 验证证据记录命令、退出码与实际输出；修复后必须复测，未执行或未通过的交付项保持未完成。
- 审阅基线：Node.js 24.22.2 下 `npm test` 39 项中 38 通过、1 失败，唯一失败是已跟踪的 `.idea/.gitignore` 缺少 SPDX 头；Node.js 22 下为 34 通过、5 失败；`spex lint` 无问题。
- 待人工确认的取舍：Q4 取消后再次报名的接口结果在规约中未定义；报名页面入口未写入规约；自编规约文件现有的版权头与 [[licensing-9](../packages/licensing.md#licensing-9)] 规定的项目持有人不一致；已被 Git 跟踪的 `.idea/` 目录是否在本轮清理以恢复全绿；小组共享文档应记录本轮任务与验证安排的关键取舍、理由与实际结果。
