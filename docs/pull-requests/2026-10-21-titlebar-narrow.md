# fix(window): 窄窗口下标题栏和阅读工具栏不换行、不溢出，布局最小宽度由常量计算

v0.2.2 批次，问题 1 的跟进。#68（测试员的 `titlebar-narrow.spec.ts`）在 Windows 和 macOS 上都失败了，本 PR 修这些问题，不改版本号。

- **标题栏**：
  - 「打开 ▾」会折行：Windows 折成 2 行；macOS 在 900 宽时折成 3 行，1024 宽时折成 2 行。
  - mac 上「打开」没有垂直居中。
  - 「打开」到文档标题的间距是 0。
  - Windows 的窗口按钮没有提示。
- **阅读工具栏**：
  - 「适合宽度」「框选」会折行，在窄窗口里溢出；
  - ‹ › − + 的点击区域不足 32×32。
- **最小宽度**：窗口最小宽度是 900，但 侧栏 240 + 阅读区 360 + 分隔条 4 + 对话区 320 = 924，而且分隔条拖动不受限制（实测出现过阅读区 256 / 对话区 400）。

已合并 #68 的分支（当前 `8d11baf`），CI 会跑测试员的断言；没有改它的断言。

## 修复
### 布局常量（`src/shared/layout-sizes.ts`，main 和 renderer 共用）
- 常量：`LIBRARY_WIDTH 240`、`READER_MIN 360`、`SPLITTER_WIDTH 4`、`CHAT_MIN 320`。侧栏宽度固定，不能拖动；已有的收起功能保留，没有新增收起方式。
- `WINDOW_MIN_WIDTH` 由上面四项相加得到（= 924），BrowserWindow 的 `minWidth` 直接用它，代码里没有写死的数字。
- 桌面网格的列宽读同一组常量（通过 CSS 变量）。对话列是 `clamp(320px, 用户宽度, 100% − 侧栏 − 分隔条 − 360px)`，窗口变窄时对话区先让出空间。
- **分隔条**：`clampChatWidth(v, { width, libraryOpen })` 同时满足对话区 ≥ 320、阅读区 ≥ 360，以及 CHAT_MAX。拖动时夹紧；窗口缩放或侧栏开合时重新夹紧。

### 标题栏
- 所有按钮 `white-space: nowrap`，图标 `flex-shrink: 0`。「打开」和窗口控制按钮不压缩，工作区名用省略号让出空间（最少保留 2em）。
- 「打开 ▾」：
  - 平时显示文件夹图标加「打开 ▾」，「打开 ▾」是同一个文本节点，所以 ▾ 不会因为换用字体而落到另一行；
  - 左侧格子不够宽时（容器查询），只显示图标和 ▾，点击区域 ≥ 32×32；
  - `title` 和 `aria-label` 都是「打开」；
  - `align-self: center`，在 36px 高的标题栏里垂直居中（mac 也一样）。
- 左侧格子右边留 12px，「打开 ▾」和文档标题之间至少 12px。
- 中间标题格最少 48px，作为拖拽区。右侧格子最少等于窗口按钮的宽度，所以窗口按钮不会被标题挤压。mac 左侧保留 78px 给红绿灯。
- 窗口按钮的提示：「最小化」「最大化 / 还原」「关闭」。
- `.shell` 的列改为 `minmax(0, 1fr)`，标题栏宽度不再被下面三栏的最小内容撑开。

### 阅读工具栏
- 页码切换（‹ 1/2 ›）和缩放百分比始终显示，不会收起。
- 空间不够时按顺序收起：
  1. 「框选」只显示图标；
  2. 「适合宽度」只显示图标；
  3. 「适合宽度」移进最右边的「⋯」菜单；
  4. 「框选」也移进「⋯」菜单。

  实现方式：ResizeObserver 加 layout effect，在绘制之前逐级判断是否溢出，所以不会闪烁。「⋯」菜单沿用标题栏「打开」菜单的样式，「适合宽度」排在第一项。
- 收起后的按钮 ≥ 32×32，`title` 是原来的提示，`aria-label` 是原来的文字。「框选」不可用时，提示仍然是「当前模型不支持图片」。
- ‹ › − + 的点击区域改为 32×32，图标字号不变。提示依次为「上一页」「下一页」「缩小」「放大」。
- 文档名用省略号让出空间。

## 截图（提交 `7e964e5`，Linux xvfb）
CI 的 Windows / macOS 截图在 artifact `e2e-screenshots-windows-latest` 和 `e2e-screenshots-macos-latest` 里：
- 本 PR 生成的：`tbfix-{min,narrowest,maximized}-<os>(-dark).png`、`toolbar-menu-min-<os>.png`；
- #68 生成的：`titlebar-*`、`window-*`、`min-width-*.json`。

最小宽度 924px 时的整个窗口（阅读区 360 / 对话区 320）：

![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-window-min.png)

最小宽度时的「⋯」菜单：

![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-toolbar-menu-min.png)

标题栏，最小宽度（浅色 / 深色）：

![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-titlebar-narrow-min.png)
![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-titlebar-narrow-min-dark.png)

比应用最小宽度更窄（440px，用来触发「打开」收起）：

![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-titlebar-narrow-narrowest.png)
![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-titlebar-narrow-narrowest-dark.png)

最大化：

![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-titlebar-narrow-maximized.png)
![](https://raw.githubusercontent.com/Sqhh99/Point/7e964e57af7d267c1c803c750b11022c2569fcf1/docs/assets/pr/2026-10-21-titlebar-narrow-maximized-dark.png)

## 测试计划
- [x] 新增单测 `test/main/layout-sizes.test.ts`：
  - minWidth 等于四项之和，main 里没有写死的数字；
  - CSS 读同一组常量；
  - 分隔条夹紧：拖到两端、窗口缩到最小、侧栏收起；
  - 工具栏收起顺序。
- [x] e2e `titlebar.spec.ts`「title bar at narrow widths」，在最小宽度、440px 和最大化三种尺寸下检查：
  - 「打开 ▾」只占一行，到文档标题 ≥ 12px，收起时 ≥ 32×32；
  - 拖拽区 ≥ 48px；
  - 窗口按钮的提示等于 aria-label；
  - 工具栏不溢出、不折行，图标按钮 ≥ 32×32 且有提示，页码和缩放始终显示；
  - 最小宽度时阅读区 ≥ 360、对话区 ≥ 320；「⋯」菜单第一项是「适合宽度」；
  - 最大化时工具栏完整显示。
- [x] 已合并 #68 `8d11baf`，本地运行通过（Linux），没有改它的断言。
- [x] 全部 e2e 39 项通过（本地 xvfb + keyring）；test:main 764 项通过（14 项跳过）；typecheck / lint 通过
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6）
- [ ] 六项 CI 全绿（需要包含 #68 的最新断言）
