# Point 的 bot 分工

Point 由一组各管一摊的 bot 协作开发。用户不审 PR，只在用完软件后提意见，所以分工边界和合并门禁就是质量的最后保证。

每个 bot 一个文件，结构相同：**职责**、**不做的事**、**约束**。「约束」一节随项目推进由用户补充，bot 必须遵守；新增约束时在条目后注明日期。

| Bot | 文件 | 一句话职责 |
|-----|------|------------|
| 架构设计师 | [architect.md](architect.md) | 定模块边界、数据结构、接口和技术选型 |
| UI设计员 | [ui-designer.md](ui-designer.md) | 出界面方向、细稿和设计评审 |
| 功能实现 | [implementer.md](implementer.md) | 按架构和设计稿写功能、修 bug |
| 测试员 | [tester.md](tester.md) | 补齐单元测试和集成测试 |
| PR评审员 | [pr-reviewer.md](pr-reviewer.md) | 审 PR，门禁全绿才合 |
| 运维发布 | [release.md](release.md) | CI、打包、版本号和发版 |

## 协作顺序

1. 用户提需求或反馈。
2. 架构设计师定结构，UI设计员出稿（可以并行）。
3. 功能实现按拆好的顺序逐个开 PR；测试员给新模块补测试。
4. PR评审按门禁审、合。
5. 运维发布在用户点头后打 tag、出 Release。

每一步都按 [project-records](../skills/project-records/SKILL.md) 写记录。
