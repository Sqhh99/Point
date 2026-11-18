# PR：CI 始终尝试上传完整 e2e 结果包

- **日期：** 2026-11-17 / **分支：** `ci/e2e-results-always-upload` → `main` / **基线 commit：** `460d2bd674b9805c0898754ea75d150994fbfd37` / **相关记录：** [工作日志](../work-logs/2026-11-17-ci-e2e-results-always-upload.md)

## 关联
Related to #79。补上完整 `e2e-results` 产物在任务重试变绿时被跳过上传的证据缺口。本 PR 不修复 Windows 偶发拖选失败的根因，不能单独作为关闭 #79 的条件。

## 改了什么
- e2e job 上传 `apps/desktop/test-results` 的步骤由 `if: failure()` 改为 `if: always()`，步骤名去掉 “on failure”，使作业成功或失败都会尝试上传本轮已生成的完整结果目录。
- 产物名 `e2e-results-${{ matrix.os }}`、路径、14 天保留期、`if-no-files-found: ignore` 不变。
- 不改截图上传步骤（仍为 `if: always()`，路径仍是 `apps/desktop/test-results/screenshots`）、不改 runner / 超时 / 重试、不放宽双平台门禁、不改产品或 e2e 代码、不改 Playwright 配置、不发版。

局限：`always()` 只上传该次运行结束时已经写到磁盘的文件，不能补回未生成、已被覆盖或此前未上传而丢失的 trace。当前仓库未对全部 e2e 启用 Playwright `use.trace`（默认 `off`，且覆盖不到 Electron）；仅 `smoke.spec.ts` 在文件内出现失败时手工保存 `trace-retryN.zip`。其他规格若未生成 trace，结果包里也不会出现。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建

## 版本号
不升版本。本次只调整 CI 产物上传条件，不改产品功能，也不发版。

## 如何测试
- [ ] `pnpm lint` 和 `pnpm typecheck` 通过
- [ ] `pnpm test` 通过（core + main）
- [ ] `pnpm e2e` 通过
- [ ] Windows 和 macOS 上的 CI 全绿（写明 commit）
- [ ] 在应用里实际走过受影响的流程（写明是哪个）

提交时未运行上述检查：diff 仅限 workflow 两行和记录文档。请以该 PR commit 上 Windows / macOS 的 `e2e` job 为准，确认两个平台都出现可下载的 `e2e-results-windows-latest` 与 `e2e-results-macos-latest` 产物（目录存在即可，空目录由 `if-no-files-found: ignore` 处理）。若这次 CI 未出现「首次失败、重试后任务变绿」的场景，该场景仍应视为未实测，不能声称已验证重试成功后首次失败的 trace 一定在产物中。本改动没有可在应用内走的产品流程。

## 检查项
- [x] UI 改动附了改前改后截图，放在 `docs/pull-requests/assets/<文件名>/` — 无 UI 改动，不适用。
- [x] 数据库表结构变化附了迁移脚本和迁移测试 — 无表结构变化，不适用。
- [x] 打包布局、依赖、安全相关（CSP、IPC、外部内容渲染）变化在上面单独说明 — 无此类变化。
- [x] AI 声明：`ci.yml` 两项修改、工作日志和本 PR 记录由工程效能（Grok Bot）根据 `main` `460d2bd674b9805c0898754ea75d150994fbfd37` 起草并提交；已做本地静态 diff 与 PyYAML 结构检查。提交时尚未在 Windows / macOS 运行器上验证产物上传，也未跑 `pnpm` 测试。
