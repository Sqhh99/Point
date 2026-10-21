# 2026-10-21 PDF 文字层对齐（问题 6）

- 分支 `fix/pdf-text-layer`，起点 main `cbb8a90`。
- 诊断：写了临时 e2e，比较每个 span 的边框和 canvas 墨迹范围（DSF 1 / 1.25，缩放 100% / 125%）。Linux 上 span 和墨迹相差都在 1–2px 以内，`--scale-factor` 正确，所以截图里的问题出在 Windows 的字体解析上。
  - 读 pdf.js 4.10 源码：`TextLayer.#layout` 用 `#getCtx(this.#lang)` 量宽，那张 canvas 设了 `canvas.lang = lang`，而 span 继承 `html[lang=zh-CN]`。Windows 上 Chromium 按语言选通用字体族，于是两边用的字体不同，`scaleX` 失真。
  - 同一个诊断还发现 `CANVAS.hiddenCanvasElement` 按行内元素挂在 body 末尾，`document.scrollingElement` 能多滚 18px，和问题 1 的截图相符。
- 修复：设置容器的 `lang`，补齐官方 CSS（不含选区伪元素规则，#44 的测试要求 CSS 里不出现它），加上 `.hiddenCanvasElement`。
- 测试：新增 e2e（墨迹对齐、lang、复制文字、窗口不可滚动）。第一次跑 test:main 时，被 #44 的「CSS 里不得有 ::selection」断言拦下，已去掉该规则（连注释里也不写这个词），断言保持不变。
- 风险：截图里选中的文字以白色显示，可能是 Windows 默认的选中文字颜色。lang 修好之后，这些文字会和字形重合，不再错位重叠。如果仍然觉得刺眼，需要产品决定是否放宽 #44 的规则。
