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

## 6. 追加（2026-10-21）：合并 main 2da2ede、截图目录、设计规则断言

### 请求
> merge main 2da2ede into the #68 branch (merge commit, no force-push), make sure all screenshots (narrowest width AND maximized, both OS) are written under apps/desktop/test-results/screenshots, push once.

> encode UI designer's narrow-titlebar rules as assertions at minimum width on both OS … It is expected these fail on main until the product fix lands; do not skip.

团队判定：第一次 CI 在 Windows 和 macOS 上 `titlebar-narrow.spec.ts:172` 失败（最小宽度下「打开 ▾」换行），这是产品缺陷。该断言保持原样，不放宽、不跳过、不修改。

### 改动
- 用 merge commit 合入 main `2da2ede`（#67：CI 每次都把 `apps/desktop/test-results/screenshots` 上传为 `e2e-screenshots-<os>`），没有 force-push。
- 截图和测量 JSON 改为写到 `apps/desktop/test-results/screenshots/`，覆盖最小宽度、1024px、最大化三种状态，文件名带平台。
- 新增 UI 设计的窄标题栏规则，只在最小宽度下检查，Windows 和 macOS 都跑。用 `expect.soft`，每条规则都会报出自己的测量值。选择器用 role、可访问名和计算样式，不依赖 class 名。
  - (a) 标题栏按钮的文字不换行：只有一行，文字高度不超过行高 + 1px。
  - (b) 收起顺序：「打开」变成纯图标之前，其他次要按钮要先变成纯图标；「打开」变成纯图标时，▾ 仍然可见。
  - (c) 纯图标按钮的点击区域 ≥ 32×32，并且有 aria-label；「打开」的 aria-label 去掉 ▾ 后等于「打开」。title 只记录。
  - (d) 最宽的一段可拖动区域 ≥ 48px（按计算出的 `-webkit-app-region` 扫描标题栏中线）。Windows：除窗口按钮外，没有控件压在标题栏按钮区上；有 Window Controls Overlay 时用它的几何，否则用应用内窗口按钮的范围。macOS：没有控件进入左侧 72px 的红绿灯区域。
- 原有的硬断言（第 172 行附近）原样保留，只改了上方的注释，说明在 Windows/macOS 上它会按预期失败。

### 验证（本地 Linux xvfb）
- `pnpm lint`、`apps/desktop` 的 `tsc --noEmit`：通过。
- 新用例单独跑通过（Linux 上「打开 ▾」不换行，(a)–(d) 都成立）。e2e 全量（throwaway keyring）37 项通过，0 跳过。
- Linux 最小宽度的测量值：最宽拖动区 494px；窗口按钮区 762–900px，没有其他控件压在上面；「打开 ▾」是一行，高 24px，不是纯图标。
- 预期 Windows 和 macOS CI 继续失败，等 功能实现 的修复合入后转绿。

## 7. 追加（第三轮，2026-10-21）：标题栏间距、标题栏按钮提示、阅读工具栏布局

### 请求
> Title bar, all states (min, 1024, maximized) both OS: '打开' vertically centered …; gap 打开 → document title >= 12px; Windows caption buttons have a hover tooltip … Reader toolbar, all states both OS: children inside the toolbar; no button text wraps; page nav and zoom % visible; collapse order 框选 → 适合宽度 → ⋯ menu; icon-only buttons >= 32x32, aria-label = original text, hover tooltip; reader pane >= 360px and chat pane >= 320px (record actual widths).

### 改动（只改 `apps/desktop/e2e/titlebar-narrow.spec.ts`）
- 新增 `layoutRules`（只读几何）、`hoverTooltip`（先找 title 或 aria-describedby，再悬停找 role=tooltip）、`overflowItems`（打开 ⋯ 菜单，列出菜单项，按 Esc 关闭）。悬停和打开菜单都放在截图之后做，不会出现在截图里。
- 断言用 `expect.soft`，覆盖三种状态和两个平台；窗口按钮提示只在非 macOS 上检查。不跳过。
- 阅读区取包含阅读工具栏的那个 `<main>`。应用外层还有一个占满整个窗口的 `<main>`，第一次误用了它，已改正。

### 验证（本地 Linux xvfb）
- lint 和 tsc 通过。e2e 全量（throwaway keyring）：36 项通过，1 项失败（本用例，预期失败），0 跳过。
- Linux 最小宽度的测量值：
  - 「打开」上下间距 6/6；到文档标题的间距 6.1px（< 12，失败）；
  - 窗口按钮没有任何悬停提示（失败）；
  - 阅读工具栏范围 240–481，「缩放」组和「框选」超出了工具栏；「适合宽度」「框选」各 2 行；没有 ⋯ 菜单；
  - 纯图标按钮：‹ › 是 28×28，− + 是 17.9×28，都没有悬停提示；
  - 阅读区 256px，对话区 400px，两者可用空间一共 660px，放不下 360 + 320。
