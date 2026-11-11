<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->
<!-- spex-i18n-source: map.md sha256-5dbf6d5bf1f09c74f8bf71209986eca460723957c6861f0a73654b88d9e522d9 -->

# 规约地图

用于快速定位决策和规约包的索引。
规约条目是事实来源。
开发过程中，代码可能与规约暂时不一致。

## 编写和审阅规约

在编写、修改或审阅 DR、IR 或条目前，先了解 [`meta.md`](meta.md) 中的规则。

## 目录结构

```text
decisions/    决策记录（DRs）
intents/      意图记录（IRs）
packages/     规约包（每包一个文件）
map.md        本索引
meta.md       规约的规约
```

## 决策

| ID | 文件 | 摘要 |
| --- | --- | --- |
| [DR-000](decisions/000-spec-structure-format.md) | 000-spec-structure-format.md | 规约结构、格式和命名约定 |
| [DR-001](decisions/001-enrollment-mvp.md) | 001-enrollment-mvp.md | 学堂报名最小可验证版本：范围、业务边界、已确认决定与排除项 |
| [DR-002](decisions/002-personal-center-learning-status.md) | 002-personal-center-learning-status.md | 个人中心与课程学习状态：新增需求草案 |
| [DR-003](decisions/003-course-creation-access.md) | 003-course-creation-access.md | 新建课程入口的账号权限：新增需求草案 |

## 规约包

| 文件 | 摘要 |
| --- | --- |
| [course-catalog.md](packages/course-catalog.md) | 课程目录与详情的公开可见性、公开字段、页面呈现与封面 |
| [course-enrollment.md](packages/course-enrollment.md) | 报名状态、本人报名管理、有效报名判定与持久化 |
| [course-access.md](packages/course-access.md) | 观看资格、页面与接口统一、播放地址签发与地址即授权 |
| [git.md](packages/git.md) | 提交信息格式和 AI 共同作者 trailers |
| [licensing.md](packages/licensing.md) | SPDX 头要求与验证检查 |
