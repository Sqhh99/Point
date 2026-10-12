# PR：加入 project-records skill 和 bot 分工文档

- **日期：** 2026-10-12 / **分支：** `docs/project-records` → `main` / **基线 commit：** `a6fd673` / **相关记录：** [工作日志](../work-logs/2026-10-12-project-records-and-bots.md)

## 关联
用户要求把 FLiNG-Downloader 的 project-records skill 移植过来，并新增 bot 职责和约束文档。

## 改了什么
- 新增 `agents/skills/project-records/SKILL.md`：规定工作日志、代码审查、PR 记录三类文档的触发时机、目录、模板。
- 新增 `agents/bots/`：6 个 bot 各一份职责、不做的事和约束，用户以后直接往「约束」一节里加。
- 新增 `AGENTS.md` 入口，以及 `docs/work-logs/`、`docs/pull-requests/`、`docs/code-reviews/` 三个目录。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建

## 版本号
不升版本（仅文档）。

## 如何测试
- [ ] `pnpm lint` 和 `pnpm typecheck` 通过：本地没跑，只改了 Markdown，以 CI 为准
- [ ] `pnpm test` 通过：同上
- [ ] `pnpm e2e` 通过：同上
- [ ] Windows 和 macOS 上的 CI 全绿：等 CI 跑完
- [ ] 在应用里实际走过受影响的流程：不涉及应用

## 检查项
- [ ] UI 改动附了截图：不涉及
- [ ] 数据库表结构变化附了迁移：不涉及
- [ ] 打包、依赖、安全变化已说明：不涉及
- [x] AI 声明：全部内容由架构设计师生成；skill 结构对照原文核对过，bot 约束取自群聊中已确认的规则
