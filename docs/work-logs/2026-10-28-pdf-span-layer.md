# 2026-10-28 PDF 文字层改为 TJ run span（v0.2.3 第二步，Option A）

## 请求
- 用 `buildPageTextGeom` 的 runs 自绘绝对定位 span，替换 pdf.js `TextLayer`（架构 Option A）。
- e2e `pdf-embedded-fonts` 恢复硬断言 `within1px >= 0.90`（100/125/150/200%），去掉 known-issue 注解。

## 计划
- 分支 `feat/pdf-span-layer-v023`，起点 main `643b815`。
- geom 留在 `apps/desktop`。`PageRect` / `MarkAnchor` / marks / SelectionOverlay 的语义不变。`getTextContent` 只取 styles 和 lang。
- 不对整行做 scaleX，盒子顶 = y − ascent，保留 `closeLineGaps`。

## 改动的文件
- `apps/desktop/src/renderer/viewers/PdfView.tsx`：新增 `renderTextLayer`（`.pdf-line` 行 span + 每个 run 一个叶子 span，用 Chromium 行盒公式对齐基线，每个 run 单独 scaleX，空格用 word-spacing 补满），marks 和 `closeLineGaps` 跟着改。
- `apps/desktop/src/renderer/viewers/pdf-tj-geom.ts`：`walkRuns` 乘上 Tm·CTM 缩放；新增 `TjLineRun` / `runsToLines`。
- `apps/desktop/test/main/pdf-tj-geom.test.ts`：新增 2 个用例。
- `apps/desktop/e2e/pdf-embedded-fonts.spec.ts`、`pdf-text-layer.spec.ts`、`region-selection.spec.ts`。
- `docs/assets/pr/2026-10-28-pdf-span-selection-{light,dark}.png`。

## 过程
1. 第一版 span 用 TJ 原始 run，被字距切成 683 个碎片，标点漂移最大。`runsToLines` 合词后变为 178 个词，和 pdftotext 一致。
2. 退回字体 sans-serif 时，within1px 只有 0.65 / 0.88 / 0.13 / 0.67（基线公式依赖字体度量）。改为优先用 pdf.js 已注册的内嵌 FontFace 后，四档都达到 0.93 以上。
3. 两端对齐行的选区在词间有空洞，给词后的空格加 word-spacing 补满。

## 验证
- within1px：旧 0.494 / 0.455 / 0.298 / 0.264 → 新 **0.955 / 0.938 / 0.938 / 0.938**（178/178）。
- lint、typecheck 通过。单测：core 211 通过；main 787 通过、14 跳过。
- e2e：38 通过、6 跳过、1 失败。失败的是 region-selection，原因是本机没有钥匙串；本地换 safeStorage 桩后通过，桩没有提交。
- 截图：`docs/assets/pr/2026-10-28-pdf-span-selection-{light,dark}.png`。

## 遗留事项
- 旋转文字和竖排文字仍按水平方向排列。
- 200% 下 maxDx 为 11px（p95 为 3px）。
