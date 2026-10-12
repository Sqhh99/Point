# 工作日志：加入 project-records skill 和 bot 分工文档

- **日期：** 2026-10-12
- **分支：** `docs/project-records`（从 `main` 的 `a6fd673` 拉出）
- **执行者：** 架构设计师
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-project-records-and-bots.md)

## 1. 请求
> 参考这个项目，这个项目的agents/skill/project-records这个skill添加过来，对于pr，review，log需要做成文档，这件事由系统架构师去完成，同时在添加agents/bots，用于去介绍每个bot的职责划分，以及对每个bot的约束（约束随着项目的推进，我会慢慢补进来）

## 2. 计划
1. 读 FLiNG-Downloader 的 `agents/skills/project-records/SKILL.md`。
2. 改写成 Point 的版本：中文、pnpm 命令、两平台 CI、`va.b.c` 版本规则、bot 分工。
3. 新建 `agents/bots/`，每个 bot 一个文件，写职责、不做的事、约束（取自群聊里已经定下的规则）。
4. 新建 `AGENTS.md` 作为入口，建好 `docs/` 下三个记录目录。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `agents/skills/project-records/SKILL.md` | 新增 | 移植 project-records skill |
| `agents/bots/*.md` | 新增 7 个文件 | bot 职责和约束 |
| `AGENTS.md` | 新增 | 让 bot 不读 skill 也知道必备记录 |
| `docs/work-logs/`、`docs/pull-requests/`、`docs/code-reviews/` | 新增目录及本次记录 | 三类记录的存放位置 |

## 4. 验证
只改了 Markdown，没有改代码和配置。没有在本地跑 `pnpm lint` 和 `pnpm test`；以 PR 上两个平台的 CI 为准。

## 5. 遗留事项
- 没有改 README 和打包图标配置，分别由文档整理和运维发布负责。
- 没有加 `.github/pull_request_template.md`；如需要，以 skill 里的 PR 记录模板为准再加。
- `docs/code-reviews/` 目前只有 `.gitkeep`，由 PR评审 从下一个 PR 开始写。
