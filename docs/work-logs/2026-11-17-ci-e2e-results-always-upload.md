# 工作日志：CI 始终尝试上传完整 e2e 结果包

- **日期：** 2026-11-17
- **分支：** `ci/e2e-results-always-upload`（从 `main` 的 `460d2bd674b9805c0898754ea75d150994fbfd37` 拉出）
- **执行者：** 工程效能
- **相关记录：** [PR 记录](../pull-requests/2026-11-17-ci-e2e-results-always-upload.md)

## 1. 请求
> 允许你用已登录 GitHub CLI 在独立工作区提交这个 CI 小 PR，并检查 Windows/macOS 运行结果；不合并、不发布。

只改 `.github/workflows/ci.yml` 中完整 `e2e-results` 产物的上传条件与步骤名，并按仓库约定附上独立记录。不改产品、e2e、Playwright 配置、版本、runner、超时或重试，不合并、不发版、不关闭 issue。

## 2. 计划
1. 只读确认远端没有同类开放 PR 或同名分支，再独立克隆最新 `main`。
2. 在独立分支只改 ci.yml 两项，并按 `project-records` 写工作日志和 PR 记录。
3. 本地静态验证后提交、推送一次并开小 PR（Related to #79，不写 closes）。
4. 等待 Windows/macOS CI，检查 `e2e-results` 产物；不合并、不发布。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `.github/workflows/ci.yml` | 将「Upload e2e trace and screenshots on failure」改为「Upload e2e trace and screenshots」，`if: failure()` 改为 `if: always()`。路径 `apps/desktop/test-results`、14 天保留期、`if-no-files-found: ignore`、截图上传步骤、runner、超时/重试与双平台门禁均未改。 | 任务失败后重试变绿时，仍尝试上传本轮已生成的完整结果目录 |
| `docs/work-logs/2026-11-17-ci-e2e-results-always-upload.md` | 新增本日志 | project-records |
| `docs/pull-requests/2026-11-17-ci-e2e-results-always-upload.md` | 新增 PR 记录，同时作为 PR 正文 | project-records |

## 4. 验证
- 已跑：对基线 `ci.yml` 做统一 diff；PyYAML `safe_load` 原文与改后文件；结构对比仅 `jobs.e2e.steps[7]` 的 `name` 与 `if` 两处不同。
- 提交时尚未运行 `pnpm lint` / `typecheck` / `test` / `e2e`（本改动不涉及产品或测试代码），也尚未在 Windows / macOS 运行器上验收产物上传。
- Playwright 配置未改。`use.trace` 未设置，默认 `off`，且该选项覆盖不到 Electron。仅 `smoke.spec.ts` 手工录制，并在文件内有失败时写出 `trace-retry${retry}.zip`。`always()` 只能上传本轮作业结束时磁盘上已有的文件，不能恢复未生成、已被覆盖或此前因 `if: failure()` 而丢失的 trace。

## 5. 遗留事项
- 开 PR 后检查 Windows / macOS 的 `e2e-results-*` 产物。若这次未出现「首次失败、重试后任务变绿」，该场景视为未实测，不能声称首次失败 trace 保证留存。
- Related to #79，本改动不修复 Windows 偶发拖选失败的根因，不能单独关闭该 issue。
- 不合并、不发版、不打 tag。
