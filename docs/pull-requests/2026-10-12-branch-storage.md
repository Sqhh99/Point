# PR：feat(conversations): 分支对话的数据存储（⑤）

- **日期：** 2026-10-12 / **分支：** `feat/branch-storage` → `main` / **基线 commit：** `282b7ac` / **相关记录：** [工作日志](../work-logs/2026-10-12-branch-storage.md)

## 关联
用户反馈第 4 条（分支对话）。本 PR 是这一轮拆分里的 ⑤，表结构按 架构设计师 定的 `002`。

## 改了什么
- 迁移 `002`：`messages` 新增 `parent_id` 和 `parts_json` 两列，并新建 `branch_origin` 表。v0.1.0 的旧对话在每段对话内按 `created_at` 加 `id` 串成一条没有分支的主线。
- `core/conversations/tree.ts`（纯 TS）：`pathTo`、`mainLeaf`、`breadcrumb`、`branchTree`、`branchCounts`、`spanMatches`、`locateOrigin`。遇到孤立节点或者成环的坏数据也不会出错。
- main 进程新增 `createBranch(sourceId, {start, end, quote}, content)`：只能从 AI 回答派生，`start` 和 `end` 是存储的 md 原文里的 UTF-16 下标，左闭右开，和 `quote` 对不上就拒绝。消息和来源记录在同一个事务里写入。
- `historyFor` 和 `dropTrailingAssistant` 可以传 `leafId`，只走根到当前节点的路径，兄弟分支不会混进上下文。不传就走主线，现有的对话流程不变。
- 往一段对话里加消息时，父消息必须属于这段对话，否则报错。

## 改动类型
- [ ] Bug 修复
- [x] 新功能
- [ ] 性能或重构（不改变行为）
- [ ] 仅文档、CI 或构建

## 版本号
不升。这一轮的版本号已经在 #16 里升到 `0.1.1`。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过
- [x] `pnpm test` 通过（core 91、main 50）
- [ ] 两个平台的 CI：等这个 PR 跑完

## 检查项
- [x] 存储带单元测试和集成测试：上下文只走当前分支、子分支、位置读回一致、中文和 emoji 的下标、孤立节点和环、非法 span 被拒绝、旧库迁移成一条链
- [ ] UI 改动附截图（不适用，没有界面）

## 已知限制
重新生成一条回答会级联删除从它派生的分支，⑥ 做界面时处理。
