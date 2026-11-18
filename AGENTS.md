# Point 仓库约定（面向 bot）

Point 是一个 Electron 桌面应用（Windows / macOS），用于导入文档、选中内容交给 AI 解读、整理笔记。pnpm 单仓库：`packages/core` 是不依赖 Electron 的纯 TS 核心，`apps/desktop` 是 main / preload / renderer。

## 分工
团队为 1 名开发负责人、4 名职责相同的端到端开发（A–D）和 1 名工程效能。一个功能由同一负责人做到交付，不再默认按架构 → UI → 实现 → 测试 → 评审 → 运维串行交接。职责、不做的事和约束见 [`agents/bots/`](agents/bots/README.md)。

## 必备记录
按 [`agents/skills/project-records`](agents/skills/project-records/SKILL.md) 写：
- 改动仓库文件 → `docs/work-logs/` 工作日志
- 审查 PR → `docs/code-reviews/` 审查归档
- 开 PR 前 → `docs/pull-requests/` PR 记录（同时作为 PR 正文）

## 常用命令
- `pnpm dev`：本地运行
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm e2e`

## 版本号
`va.b.c`：a 大升级或架构调整，b 较大的功能调整或优化，c bug 修复或小优化。功能和修复 PR 升版本，文档和设计稿 PR 不升。
