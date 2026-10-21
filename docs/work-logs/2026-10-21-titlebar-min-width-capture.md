# 工作日志：e2e 抓取标题栏在最窄宽度、1024px 和最大化下的截图与测量（供 #65 设计复核）

- **日期：** 2026-10-21
- **分支：** `test/titlebar-min-width`（从 `main` 的 `9857aa1` 拉出，即 #65 合并后的 main）
- **执行者：** 测试员 bot
- **相关记录：** PR 记录 [2026-10-21-titlebar-min-width-capture.md](../pull-requests/2026-10-21-titlebar-min-width-capture.md)；#65 的工作日志 [2026-10-21-titlebar-clip.md](2026-10-21-titlebar-clip.md)

## 1. 请求
> open a TEST-ONLY PR on Sqhh99/Point that adds an e2e test capturing the title bar at the narrowest window width, uploaded as CI artifacts on Windows and macOS, for UI designer review of #65

> add the WINDOW-MAXIMIZED state as well as the narrowest width, on both Windows and macOS: screenshot each, and record title bar height, whether the title or buttons are clipped or overflow, whether controls wrap, and the window-control buttons' bounding boxes relative to the screen edge. Hard assertions only for what passes on main.

只加测试：不改产品代码、不改 `.github`、不升版本、不动 lockfile。

## 2. 计划
1. 从最新 main（`9857aa1`）拉分支，`pnpm install --frozen-lockfile`、`pnpm build`。
2. 在 `apps/desktop/e2e/` 新增 `titlebar-narrow.spec.ts`（文件名避开 #65 的 `titlebar.spec.ts`）：
   - 打开工作区，导入一个文件名很长的 PDF，让标题栏有工作区名和文件名，阅读工具栏也在屏幕上；
   - 依次设为最小尺寸（`getMinimumSize()`，当前 900×600）、1024×700、最大化；
   - 每种状态截标题栏和整窗，文件名带平台；测量值写 JSON，用 `testInfo.attach` 附到报告，并打印一行 `TITLEBAR-MEASURE {...}` 供在 CI 日志里读取。
3. 硬断言只放 main 上已经成立的：标题栏可见、top ≥ 0、bottom ≤ 视口高、高度 36px、标题栏内按钮不换行且在标题栏和窗口内。
4. 在 main 上不成立的（阅读工具栏在最窄宽度溢出、「适合宽度」「框选」换成两行）只记录，不断言、不跳过。
5. 查 CI 的产物上传规则。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/e2e/titlebar-narrow.spec.ts` | 新增 e2e：三种窗口状态的截图与测量，main 上成立的项做硬断言 | 设计复核需要各平台截图和数值 |
| `docs/work-logs/2026-10-21-titlebar-min-width-capture.md` | 本日志 | project-records |
| `docs/pull-requests/2026-10-21-titlebar-min-width-capture.md` | PR 记录（PR 正文） | project-records |

## 4. 验证
- `pnpm lint`、`pnpm typecheck`：通过（`9857aa1` 加本分支改动）。
- `pnpm test`：core 205 项通过；test:main 752 项通过、14 项跳过（与 main 相同）。
- 本地 Linux xvfb：新用例单独跑通过；e2e 全量（throwaway gnome-keyring，`POINT_E2E_KEYRING=1`）37 项通过，0 跳过。
- 本地测量（Linux xvfb，DPR 1）：
  - 最小 900×600：标题栏 top 0、高 36；文件名被省略号截断（宽 360px）；窗口按钮 46×36，关闭按钮贴右边 0px；阅读工具栏 scrollWidth 368 > clientWidth 241（溢出），「适合宽度」「框选」各两行。
  - 1024×700：标题栏 36；阅读工具栏 368 > 365 仍溢出，两个按钮仍两行。
  - 最大化：xvfb 没有窗口管理器，`maximize()` 不生效（`isMaximized` 仍为 false），这一项只在 Windows / macOS CI 上有意义。
- CI 结果见 PR 记录（推送后填写）。

## 5. 遗留事项
- CI 的 e2e 只在失败时上传 `apps/desktop/test-results`（`if: failure()`），绿灯时截图不会成为产物。本 PR 不改 workflow；需要 运维发布 把 `.github/workflows/ci.yml` 里「Upload e2e trace and screenshots on failure」一步的 `if: failure()` 改成 `if: always()`（path 已是 `apps/desktop/test-results`）。在那之前只能从 CI 日志的 `TITLEBAR-MEASURE` 行读数值。
- 阅读工具栏在 900px 和 1024px 下溢出、按钮换行，是 main 上的现状，只记录未断言；修复后可以改为硬断言。
