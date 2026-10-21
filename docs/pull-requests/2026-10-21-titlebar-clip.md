# fix(window): 标题栏不再被顶出窗口

v0.2.2 批次（逐项小 PR）：问题 1，顶部标题栏被裁掉。不改版本号。

## 根因
截图里被裁掉的是整个应用外壳的顶部，不是标题栏自身的高度或样式出了问题。窗口配置是 Windows / Linux 用 `frame: false`、macOS 用 `hiddenInset`，没有 `titleBarOverlay`。标题栏固定 36px，`.shell` 是 `grid-template-rows: 36px 1fr 24px; height: 100%`，这些都没问题。

问题出在 **`<body>` 是可以滚动的页面**：
- 任何追加到 body 的节点都会让文档变高。实测打开 PDF 后，pdf.js 的测量 canvas 让 `document.scrollingElement` 多出约 18px 的滚动量（#63 会把它的样式修正）。
- 一旦文档可以滚动，阅读器里的 `scrollIntoView`（跳页、定位标记）会顺带滚动视口，整个外壳就被向上推，标题栏顶部被裁掉。
- 在 main 上，用 e2e 让 body 变高并滚动视口，标题栏的 top 是 **-418px**。

## 修复
- `html, body { overflow: hidden }`。
- `#app { position: fixed; inset: 0 }`：外壳钉在视口上，视口即使被程序滚动，fixed 元素也不会移动。
- 这样无论第三方库往 body 里加什么、谁调用 `scrollIntoView`，标题栏都留在 y = 0。改动只有 CSS，Windows 和 macOS 都适用。

## 截图（提交 `020c14e`）
浅色：

![](https://raw.githubusercontent.com/Sqhh99/Point/020c14e972e50e0ac36b10a6ee4708f97c4d4b34/docs/assets/pr/2026-10-21-titlebar-light.png)

深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/020c14e972e50e0ac36b10a6ee4708f97c4d4b34/docs/assets/pr/2026-10-21-titlebar-dark.png)

## 测试计划
- [x] 新增 e2e `titlebar.spec.ts`。打开 6 页 PDF 后，依次检查三种情况：
  1. 刚打开时；
  2. body 追加 400px 的节点，并把视口滚到 500；
  3. 对第 6 页和第 1 页调用 `scrollIntoView`。

  每一步都断言：标题栏 top = 0、高度 36、`.shell` 的上下边贴住视口。在 main 上这个用例会失败（top = -418），修复后通过。
- [x] 本地 e2e 35 项全部通过（xvfb + keyring，没有跳过）；test:main 752 项（14 项跳过，与 main 相同）；typecheck 和 lint 干净；`pnpm install --frozen-lockfile` 通过。
- [ ] 六项 CI 全绿
- 说明：box 是 Linux，没法在真实的 Windows 窗口上复现。修复针对的是和平台无关的原因（文档可滚动），Windows 和 macOS 的 e2e 会在 CI 上跑同一个用例。Windows 最大化时 frameless 窗口出界的说法没有找到证据，没有改窗口参数。
