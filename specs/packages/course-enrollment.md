<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# course-enrollment: 课程报名

## 意图

本规约包使已登录学员能够为自己报名已发布课程、查看本人的报名并取消本人的报名，并向观看资格提供有效报名判定。
它规定报名记录的状态、作用域、持久化与接口结果，不规定账号体系、支付、管理员报名视图与课程可见性。
它依据 [DR-001](../decisions/001-enrollment-mvp.md) 写入本轮新功能要求；Q4 与 Q5 仍待定，本轮不规定取消后再次报名，也不规定课程或账号删除时的报名处置。

## 外部行为

### course-enrollment-1

当已登录学员请求 `POST /api/enrollments` 并指定课程编号，报名接口应依据课程详情接口仅返回已发布课程 [[course-catalog-2](course-catalog.md#course-catalog-2)] 的判定，为当前会话身份创建一条有效报名并返回该记录：

| 情形 | 结果 |
| --- | --- |
| 未登录 | 401 与中文提示，不写入报名记录 |
| 课程不存在、未发布或编号不合法 | 404 与中文提示，不写入报名记录 |
| 请求体声明其他学员身份 | 忽略该字段，仍只为当前会话身份创建报名 |
| 当前学员对该课程已有有效报名 | 不新增有效报名，返回既有有效报名 |

- 返回的报名记录包含课程编号、课程标题、报名状态与创建时间。
- 错误响应以 JSON 的 `error` 字段给出中文说明。

### course-enrollment-2

当报名记录被创建或取消，报名服务应以状态字段区分「有效」与「已取消」并把记录持久化到数据库：

| 状态 | 含义 |
| --- | --- |
| 有效 | 记录参与有效报名判定 |
| 已取消 | 记录仅供本人查看，不参与有效报名判定 |

- 记录不因取消而物理删除。
- 记录在服务重启、退出后重新登录及换回原账号后仍可查。
- 已有课程与账号数据不因新增报名能力而迁移或重置。
- 同一学员对同一课程至多存在一条有效报名。

### course-enrollment-3

给定某学员与某课程，当查询该学员对该课程是否持有效报名，报名服务应仅在存在属于该学员与该课程、且状态为「有效」 [[course-enrollment-2](#course-enrollment-2)] 的报名记录时判定为有效报名：

| 情形 | 判定 |
| --- | --- |
| 无报名记录 | 非有效报名 |
| 仅有已取消记录 | 非有效报名 |
| 存在一条有效记录 | 有效报名 |
| 记录属于其他学员或其他课程 | 非有效报名 |

### course-enrollment-4

当多名学员对同一门已发布课程依次报名 [[course-enrollment-1](#course-enrollment-1)]，报名接口应不设置名额上限、候补队列或报名审批，且每名学员的报名结果互不影响。

### course-enrollment-5

当已登录学员请求 `GET /api/enrollments`，报名接口应仅返回当前会话身份的报名记录，且同时包含有效与已取消状态 [[course-enrollment-2](#course-enrollment-2)] 的记录：

- 每条记录包含课程编号、课程标题、报名状态与创建时间。
- 未登录时返回 401。
- 管理员本轮不提供报名视图，管理员身份不返回其他学员的记录。

### course-enrollment-6

当已登录学员请求 `DELETE /api/enrollments/:id`，报名接口应仅把属于当前会话身份且状态为「有效」 [[course-enrollment-2](#course-enrollment-2)] 的记录标记为「已取消」并返回该记录：

| 情形 | 结果 |
| --- | --- |
| 未登录 | 401 |
| 记录不存在、属于他人或编号不合法 | 404 |
| 记录已取消 | 保持已取消，不新增记录 |

- 取消后本人仍可查到该记录 [[course-enrollment-5](#course-enrollment-5)]。
- 取消后该学员对该课程不再判定为有效报名 [[course-enrollment-3](#course-enrollment-3)]。

### course-enrollment-7

当请求任一报名接口，报名服务应仅以当前会话身份界定数据作用域，且不提供按学员编号查询、代报名、批量导入、报名导出或管理员报名列表的入口：

| 入口 | 数据作用域 |
| --- | --- |
| `POST /api/enrollments` | 仅当前会话身份 |
| `GET /api/enrollments` | 仅当前会话身份的记录 |
| `DELETE /api/enrollments/:id` | 仅当前会话身份的记录 |

## 内部行为

### course-enrollment-8

当实现报名持久化 [[course-enrollment-2](#course-enrollment-2)]，数据库应通过追加编号大于 `001-init.sql` 的迁移文件建立报名数据表，以对有效状态的唯一约束保证同一学员对同一课程至多一条有效报名，且不修改已执行的迁移文件。

## 验证

### course-enrollment-9

给定真实服务与临时数据库已启动，当访客、学员与管理员依次请求 `POST /api/enrollments` 指定已发布课程、草稿课程与不存在课程，集成验证应断言未登录返回 401、草稿与不存在课程返回 404、成功时仅写入当前会话身份的一条有效报名、伪造的学员编号不生效、重复报名不新增有效报名 [[course-enrollment-1](#course-enrollment-1)]，并断言不存在按学员编号查询、代报名或管理员报名列表的可用入口 [[course-enrollment-7](#course-enrollment-7)]。

### course-enrollment-10

给定真实服务与临时数据库已启动，当学员报名后取消并分别在服务重启前后查询本人报名，系统验证应断言记录以状态字段保留、未物理删除、重启后仍可查、已有课程与账号不变、同一学员同一课程至多一条有效报名 [[course-enrollment-2](#course-enrollment-2)]，并断言报名数据表由编号大于 `001-init.sql` 的新迁移建立且已执行迁移未被修改 [[course-enrollment-8](#course-enrollment-8)]。

### course-enrollment-11

给定真实服务与临时数据库已启动，当依次构造无报名、已取消、有效、他人报名与他人课程五种状态并查询有效报名，集成验证应断言判定结果与情形矩阵逐一对应 [[course-enrollment-3](#course-enrollment-3)]。

### course-enrollment-12

给定真实服务与临时数据库已启动，当超过任意阈值的多名学员对同一门已发布课程依次报名，系统验证应断言每名学员都取得有效报名、无候补或审批状态产生，且彼此的报名与查看结果互不影响 [[course-enrollment-4](#course-enrollment-4)]。

### course-enrollment-13

给定真实服务与临时数据库已启动，当学员 A 与学员 B 各持报名记录、其中 A 含已取消记录，并以各自会话、访客会话与管理员会话请求 `GET /api/enrollments`，系统验证应断言每人只看到自己的有效与已取消记录、访客返回 401、管理员不获得他人报名视图 [[course-enrollment-5](#course-enrollment-5)]，且不存在读取他人记录的入口 [[course-enrollment-7](#course-enrollment-7)]。

### course-enrollment-14

给定真实服务与临时数据库已启动，当学员依次执行报名、查看、取消、再次查看与重复取消，系统验证应断言取消仅把本人有效记录标记为已取消、记录仍可查、重复取消不新增记录、他人记录与不存在编号均返回 404 [[course-enrollment-6](#course-enrollment-6)]，并断言取消后的查看结果 [[course-enrollment-5](#course-enrollment-5)] 与有效报名判定 [[course-enrollment-3](#course-enrollment-3)] 同步变化。
