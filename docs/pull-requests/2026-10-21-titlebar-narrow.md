# fix(window): 窄窗口下标题栏按钮不换行

v0.2.2 批次，问题 1 的跟进。#68（测试员的 `titlebar-narrow.spec.ts`）在 Windows 上失败：窗口为最小宽度时，「打开 ▾」的文字折成两行。不改版本号。

## 原因
左侧格子里，工作区名用了 `white-space: nowrap`，按钮却可以被 flex 压缩，而且允许换行。

Windows 的字体更宽，加上工作区名较长，按钮被挤窄，文字就折行了。

## 修复（按 UI设计员的规格）
- **不换行**：标题栏所有按钮 `white-space: nowrap`，图标 `flex-shrink: 0`。「打开」按钮和窗口控制按钮 `flex-shrink: 0`。空间不够时，由工作区名用省略号让出。
- **收起**：
  - 「打开 ▾」由文件夹图标、文字「打开」和 ▾ 组成。
  - 左侧格子宽度低于阈值时（容器查询；非 mac ≤ 160px，mac ≤ 230px），只隐藏文字，图标和 ▾ 保留。
  - 收起后点击区域 ≥ 32×32px。`title` 和 `aria-label` 始终是「打开」。
  - 标题栏目前没有其他可以收起的次要按钮，所以「打开」就是最后一个收起的。
- **始终保留**：
  - 中间格子是拖拽区，最少 48px；
  - Windows/Linux 右侧的三个窗口按钮固定 46px 宽，贴右，不和标题重叠；
  - mac 左侧保留 78px 给红绿灯（≥ 72px）。
- **外壳**：`.shell` 的列改为 `minmax(0, 1fr)`，标题栏的宽度不再被下面工作区三栏的最小内容撑出视口。

## 截图（提交 `634b989`，Linux xvfb；CI 的 Windows/macOS 截图在 artifact `e2e-screenshots-windows-latest` / `e2e-screenshots-macos-latest`）
最小宽度（900px，长工作区名 + 长文件名）：

![](https://raw.githubusercontent.com/Sqhh99/Point/634b989a3d21fa13a1b1c437dbe62e01c329714e/docs/assets/pr/2026-10-21-titlebar-narrow-min.png)
![](https://raw.githubusercontent.com/Sqhh99/Point/634b989a3d21fa13a1b1c437dbe62e01c329714e/docs/assets/pr/2026-10-21-titlebar-narrow-min-dark.png)

比应用最小宽度更窄（520px，用来触发收起）：

![](https://raw.githubusercontent.com/Sqhh99/Point/634b989a3d21fa13a1b1c437dbe62e01c329714e/docs/assets/pr/2026-10-21-titlebar-narrow-narrowest.png)
![](https://raw.githubusercontent.com/Sqhh99/Point/634b989a3d21fa13a1b1c437dbe62e01c329714e/docs/assets/pr/2026-10-21-titlebar-narrow-narrowest-dark.png)

最大化：

![](https://raw.githubusercontent.com/Sqhh99/Point/634b989a3d21fa13a1b1c437dbe62e01c329714e/docs/assets/pr/2026-10-21-titlebar-narrow-maximized.png)
![](https://raw.githubusercontent.com/Sqhh99/Point/634b989a3d21fa13a1b1c437dbe62e01c329714e/docs/assets/pr/2026-10-21-titlebar-narrow-maximized-dark.png)

## 测试计划
- [x] 新增 e2e `titlebar.spec.ts`「title bar at narrow widths」。在最小宽度、520px 和最大化三种尺寸下检查：
  - 「打开 ▾」只占一行，在左侧格子内，▾ 始终显示；
  - 文字在最小宽度和最大化时显示，在 520px 时收起，收起后 ≥ 32×32；
  - title 和 aria-label 都是「打开」；
  - 拖拽区 ≥ 48px；
  - 窗口按钮 3 个，各 46px，贴右，不压标题；mac 上检查红绿灯留白 ≥ 72px。

  截图写入 `apps/desktop/test-results/screenshots/`，CI 会上传。
- [x] 本地拉取 #68 的 `titlebar-narrow.spec.ts`，在本修复上运行通过，没有改它的断言。该文件不在本 PR 里。
- [x] 全部 e2e 37 项通过（本地 xvfb + keyring），typecheck / lint 通过
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6）
- [ ] 六项 CI 全绿
