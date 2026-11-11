<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 项目约定

- 文件名、目录名、标识符、数据库表和字段、JSON 字段、URL 路径用英文；页面文字、提示、错误消息、脚本输出和文档用简体中文。
- 只依赖 Node.js 24：不加 npm 依赖、不加构建步骤、运行时不联网，`npm start` 克隆后即可用。
- 每个源文件开头保留 SPDX 许可与版权声明。
- 如果已有 `specs/`，先读 `specs/map.md` 和 `specs/meta.md`，按相关规约实现；改变对外承诺前先修订规约。
- 视频只能通过播放授权读取：页面和直调接口都经过 `src/playback.js` 中同一个观看资格检查。
- 数据库结构变更只追加新的编号迁移文件（如 `migrations/002-xxx.sql`），不修改已执行的迁移。
- `data/`、`backups/` 和数据库文件不提交。
- 变更后运行 `npm test`。
- 提交主题用 `<type>(<scope>): <中文主题>`，不超过 50 字符；正文说明做了什么、为什么。
- 智能体参与的提交最后一行加 `Co-authored-by: <实际模型> (<coder|reviewer|maintainer>) <cligent@sublang.ai>`，沿用本机 Git 身份和签名配置。

## Specs (Source of Truth)

- Canonical specs live in @specs/.
  Start with @specs/map.md for a quick-reference index and @specs/meta.md for the spec format; spec packages live in @specs/packages.
- Before making changes or suggestions in an area that has a spec, read the relevant spec file(s) first and follow them.
- Whenever your changes involve any spec, or you make a decision worth recording, keep the specs in sync — don't let them drift.
- Resolve conflicts spec-first, then iterate freely: an intended change that conflicts with existing spec items is resolved in the specs — or dropped — before coding against it; implementing first to explore an approach is fine, and implementation lessons update this intent's specs, but no intent completes until its specs and code agree.
- Keep specs lawful per @specs/meta.md — the law itself, not this summary: complete and exact (meta-34), minimal (meta-23), one requirement per item (meta-29), cohesive packages for a shared intent (meta-13), sections per meta-30, relationships and test evidence only as inline citations (meta-14, meta-16, meta-20), integration/system tests only (meta-21, meta-32).
- Run `npx @sublang/spex lint` (or `spex lint` where the CLI is installed) to check structure, item IDs, and citations after editing specs; never add trace lines to satisfy an older checker.
