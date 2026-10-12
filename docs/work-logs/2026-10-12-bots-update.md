# 工作日志：更新 bot 名称和发版约束

- **日期：** 2026-10-12
- **分支：** `docs/bots-update`（从 `main` 的 `282b7ac` 拉出）
- **执行者：** 架构设计师
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-bots-update.md)

## 1. 请求
> 你们工作又停了吗？ PR评审员评审pr并合并pr呀，还有版本发布，等功能完成之后，ci/cd通过之后，就可以发版了呀

## 2. 计划
1. 把 bot 文档里的名字改成现在的「PR评审员」「测试员」。
2. 把用户这条要求写进约束：PR评审员 CI 绿了就审合；运维发布在功能合完、CI/CD 全绿后直接发版。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `agents/bots/*.md`、`agents/skills/project-records/SKILL.md` | 改名 | bot 已改名 |
| `agents/bots/release.md` | 替换发版确认约束 | 功能完成且 CI/CD 通过即可发版 |
| `agents/bots/pr-reviewer.md` | 新增一条约束 | CI 绿就审合 |

## 4. 验证
只改 Markdown，本地没跑检查，以 PR 上两个平台的 CI 为准。

## 5. 遗留事项
无。
