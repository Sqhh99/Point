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

## 评审后的追加修改（PR #78）
1. 换掉 TextLayer 后丢了 `.endOfContent` 和 `.selecting`，但 `style.css` 还在引用它们。
   - 在 `PdfView.tsx` 里按 pdf.js 4.10 的做法补回：pointerdown 加 `.selecting`；pointerup、blur、keyup 去掉；selectionchange 时把 `.endOfContent` 移到选区活动端后面。
   - `.pdf-line` 设 `z-index: auto; pointer-events: none`，`.endOfContent` 和词 span 共用层的层叠上下文。
   - 新 e2e 测拖到段末短行右侧和正文下方的空白。关掉保护时选区会跳到 “…improved accuracy.”。
2. `pdf-text-layer.spec.ts` 改为逐词（`.pdf-line > span`）测墨迹边缘。最大偏差 1.74px（125%）。
3. 叶子 span 显式设 `transform-origin: 0 0`。
4. `sx` 加 `Number.isFinite` 保护，负的 `word-spacing` 截为 0。
5. PR 记录补一句：`walkRuns` 乘 Tm·CTM 修正 #77，数据形状不变，数值会变。
6. 200% 跨段截图（浅色 + 深色），经过最差的词 “confidence”（dx −11px）。
7. 上标 `5th` / `2nd` 的选区空隙记为已知问题。

## CI 修复（第一轮 CI 后）
1. 选区着色断言 `> 500` 在 macOS（478）和 Windows（479）失败。这是中线采样数量随平台抗锯齿变化，不是渲染 bug（Windows 截图估算的全区域着色比例 0.478，Linux 0.493）。改成按面积成比例：内部行框里干净纸面且着色的像素 / 行框面积 `>= 0.35`；实测（125% / 200%）：Linux 0.479 / 0.625，macOS 0.467 / 0.601，Windows 0.46 / 0.613。`::selection` 设成透明时比例为 0，用例失败。
2. smoke “标记” 在 Windows 上 detach：测试在缩放重建前选中了旧层 span，重建后选区收起，工具条关闭。不是选区跟踪引起的重渲染。`PdfView.tsx` 的 cleanup 去掉 `--scale-factor` 标记旧层过期；测试等 `--scale-factor` 等于 `data-scale` 后再选。
3. 第二轮 CI：macOS e2e 的拖到页底用例失败。macOS 窗口约 680px 高，100% 下页面可滚动，Playwright 合成拖动在这种情况下不扩展选区（关掉保护也一样，真实 X 输入正常），而且页底目标在视口外。测试改成 125%、先滚动、目标取正文下方的视口内空白，并断言选区以 “techniques” 开头。短窗口和正常窗口都通过；保护失效时都失败。
4. 改动的文件：`apps/desktop/src/renderer/viewers/PdfView.tsx`、`apps/desktop/e2e/pdf-embedded-fonts.spec.ts`、`apps/desktop/e2e/smoke.spec.ts`，以及本日志和 PR 记录。

## 验证
- within1px：旧 0.494 / 0.455 / 0.298 / 0.264 → 新 **0.955 / 0.938 / 0.938 / 0.938**（178/178）。
- lint、typecheck 通过。单测：core 211 通过；main 787 通过、14 跳过。
- e2e（CI 修复后重跑）：47/47 通过（`POINT_E2E_KEYRING=1`，配合本地 safeStorage 桩，没有提交）。之前的“40 通过、6 跳过、1 失败”是本机没有钥匙串造成的。
- 截图：`docs/assets/pr/2026-10-28-pdf-span-selection-{light,dark}.png`，以及 `docs/assets/pr/2026-10-28-pdf-span-selection-200-cross-{light,dark}.png`。

## 遗留事项
- 上标 `5th` / `2nd` 处的选区有小空隙（上标 run 的高度没有填满整行）。
- 旋转文字和竖排文字仍按水平方向排列。
- 200% 下 maxDx 为 11px（p95 为 3px）。
