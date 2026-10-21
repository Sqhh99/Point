# fix(pdf): 文字层选区贴合字形

v0.2.2 批次（逐项小 PR）：问题 6，PDF 文字选区和字形对不上。不改版本号。

## 根因
1. **字体解析用了不同的 lang**（主要原因）。pdf.js 给每个 span 定宽的方式，是先在一张隐藏 canvas 上量出这段文字的宽度，再按比例 `scaleX` 拉伸 span。这张 canvas 的 `lang` 是 PDF 的 /Lang，没有设置时为空。文字层 div 却继承了应用的 `<html lang="zh-CN">`。在 Windows 上，Chromium 会按语言把 `serif` / `sans-serif` 解析成 SimSun / 微软雅黑这类中文字体，它们的拉丁字母宽度和量宽时用的 Times / Arial 不一样。结果是 span 比字形宽，相互重叠、被截断，正是截图里 125% 时的样子。
   - `--scale-factor` 本身是对的（等于 `viewport.scale`），我在 100% 和 125% 下都核对过。
2. **pdf.js 官方的文字层样式只抄了一部分**。缺了 `text-align: initial`、`text-size-adjust: none`、`forced-color-adjust: none`、`overflow: clip`、`markedContent` 和 `endOfContent` 等规则，也缺 `.hiddenCanvasElement`。
   - 少了 `.hiddenCanvasElement` 规则，pdf.js 追加到 `<body>` 的测量 canvas 会按行内元素占位，整个窗口因此可以纵向滚动约 18px。这很可能也是问题 1（顶部标题栏被裁掉）的原因，问题 1 会单独开 PR 加一道防护。

## 修复
- **lang 一致**：先取 `page.getTextContent()`，把文字层容器的 `lang` 设成 `content.lang ?? ""`，和 pdf.js 量宽用的 canvas 完全一致，再交给 `TextLayer` 渲染。
- **补齐官方样式**：按 pdf.js 4.10 的 `pdf_viewer.css` 补全 `.textLayer` 规则，并加上 `.hiddenCanvasElement { display: none }`。另外显式重置可能从外层继承进来、影响字宽的属性（字重、字距、词距、缩进）。颜色都用设计变量。
- **没加的规则**：官方样式里的选区伪元素规则没有加。#44 定下的规则是选区保持系统默认高亮，相关测试也保持不变。

## 截图（提交 `98a2439`，全选三行时的选区）
100%：

![](https://raw.githubusercontent.com/Sqhh99/Point/98a2439c6b775bf1dd6f7f8f16f626129e7f1242/docs/assets/pr/2026-10-21-pdf-selection-100.png)

125%：

![](https://raw.githubusercontent.com/Sqhh99/Point/98a2439c6b775bf1dd6f7f8f16f626129e7f1242/docs/assets/pr/2026-10-21-pdf-selection-125.png)

深色 100%：

![](https://raw.githubusercontent.com/Sqhh99/Point/98a2439c6b775bf1dd6f7f8f16f626129e7f1242/docs/assets/pr/2026-10-21-pdf-selection-100-dark.png)

深色 125%：

![](https://raw.githubusercontent.com/Sqhh99/Point/98a2439c6b775bf1dd6f7f8f16f626129e7f1242/docs/assets/pr/2026-10-21-pdf-selection-125-dark.png)

## 测试计划
- [x] 新增 e2e `pdf-text-layer.spec.ts`，用 Times-Roman 三行长句，在 100% 和 125% 下分别检查：
  - 文字层的 `lang` 为空，不继承 zh-CN；
  - 每个 span 左右边缘和 canvas 上的墨迹相差不超过 3px × 缩放；
  - 全选文字层复制出来的正好是三行原文；
  - 窗口本身不可滚动（`scrollHeight - clientHeight ≤ 0`）。
- [x] fixture `makePdf` 加了可选的字体参数，默认仍是 Helvetica，原有用法不变。
- [x] 本地 xvfb 下 e2e 34 项全部通过；test:main 746 项（14 项跳过，与 main 相同）；core 197 项；typecheck 和 lint 干净；`pnpm install --frozen-lockfile` 通过（lockfile 未改动）。
- [ ] 六项 CI 全绿（Windows 的 e2e 会实际跑到 SimSun / 微软雅黑那条路径）
- 说明：box 是 Linux，fontconfig 不会按 lang 换字体，所以本地无法复现截图里的重叠，只能用上面的不变量来保证。Windows 上的效果要靠 CI 的 windows e2e 和实机复核。
