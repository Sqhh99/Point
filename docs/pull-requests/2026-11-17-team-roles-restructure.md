# PR：将团队职责文档同步为开发负责人与端到端交付

- **日期：** 2026-11-17 / **分支：** `docs/team-roles-restructure` → `main` / **基线 commit：** `bd3be891edac86a158b4c7071bdc44764fd03148` / **相关记录：** [工作日志](../work-logs/2026-11-17-team-roles-restructure.md)

## 关联
同步已生效的软件开发团队职责，消除仓库文档中「架构 → UI → 实现 → 测试 → PR 评审 → 运维」的强制串行交接说明。

## 改了什么
- 更新 `agents/bots/README.md` 和 6 个原岗位文件：现为 1 名开发负责人、4 名职责相同的端到端开发（A–D）和 1 名工程效能。一个功能由同一负责人负责设计、界面、实现、测试及该功能引起的 CI 修复，直到交付。
- 保留全部旧文件名，并在 README 中给出原名称映射，避免既有链接失效。
- 同步 `AGENTS.md` 的分工说明，以及 `project-records` 中由「PR评审员」包办每单审查记录的表述。
- 保留原有质量门禁：适用的 Windows/macOS CI、有效测试、版本和 tag 规则、用户不审 PR、没跑过不得报通过、不强推、不绕过分支保护或 required reviews。
- 本次是文档更新，不升软件版本，不改业务代码或 CI，不触发发版。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建

## 版本号
不升版本。本次只更新团队职责和协作文档，按仓库约定，文档 PR 不升 `va.b.c`。

## 如何测试
- [ ] `pnpm lint` 和 `pnpm typecheck` 通过
- [ ] `pnpm test` 通过（core + main）
- [ ] `pnpm e2e` 通过
- [ ] Windows 和 macOS 上的 CI 全绿（写明 commit）
- [ ] 在应用里实际走过受影响的流程（写明是哪个）

未运行上述检查：本次 diff 仅限 Markdown 文档，不改业务代码、构建脚本或权限配置，也没有可在应用内走的产品流程。合并前请以 GitHub 上该 commit 的文档审阅和（若 CI 仍会跑）双平台结果为准。本地已做 `git diff --check`、文件清单核对，以及文档相对链接抽查。

## 检查项
- [x] UI 改动附了改前改后截图，放在 `docs/pull-requests/assets/<文件名>/` — 无 UI 改动，不适用。
- [x] 数据库表结构变化附了迁移脚本和迁移测试 — 无表结构变化，不适用。
- [x] 打包布局、依赖、安全相关（CSP、IPC、外部内容渲染）变化在上面单独说明 — 无此类变化。
- [x] AI 声明：文档正文、工作日志和本 PR 记录由 Grok Bot 根据已生效的角色职责和仓库原有约束起草；已对照 `agents/bots/` 旧文、`AGENTS.md`、`project-records` 和已生效 profile 核对。未做运行时测试。

## 验证与未做事项
- 已确认目标仓库为 [Sqhh99/Point](https://github.com/Sqhh99/Point)，不是 ViewPoint。
- 未改业务代码，未改 CI，未 force push，未跳过 hook，未自动合并。
- 未运行 `pnpm` 测试或真实设备验收。
