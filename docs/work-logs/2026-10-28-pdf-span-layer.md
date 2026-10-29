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
4. 评审：确认闪烁按词画框，重叠处更深。第一版 `mergeLineRects`（纵向重叠 ≥ 较矮者一半算同一行）在后续评审中替换，见下一节。

## 评审第二、三轮：每行一个矩形，确认闪烁无缝
1. 合并规则（`mergeLineRects`，存储前、读取后、确认闪烁前共用）：先去掉落在另一个矩形里的矩形（容差 1px，旧标记里 span 元素框和文字框叠在一起）；再把 top 相差 ≤ 1px、height 相差 ≤ 1px 且水平间距 < 1 个字号（用较矮者的高度代替）的矩形合并。上标、不同字号单独保留；两栏间距大于 1 个字号不合并。矩形不裁剪。
2. 上限：`capLineRects(mergeLineRects(...), 64)`，先合并，超过 64 行时第 64 行起并入最后一个矩形，不丢行。单测用 80 行选区验证。
3. 旧标记：不迁移，读取时合并，每行一个持久框。`Reader.tsx` 改用 `textBoxes(range)` 逐文本节点取文字框。
4. 双色缝隙：每个框各自半透明，相邻行框重叠 1.4px（100%）/ 2.8px（200%）处着色两次。只在绘制层修：框是不透明 `--accent`，容器统一透明度（确认闪烁 0.25，持久高亮 0.12，下划线单独一层）。
5. 着色断言：着色像素 / 选中词的几何面积（`PageTextGeom.words`），实测 Linux 0.638 / 0.773、Windows 0.619 / 0.760、macOS 0.626 / 0.748（125% / 200%，CI run 40757035570）。门槛 0.51 = 最小值 0.619 − 0.10，向下取整。反证 CI run 40757997339：关掉着色后 macOS 0.008、Windows 0.007，失败。
6. 拖选保护：`.endOfContent` 放在活动端所在 `.pdf-line`（及 `<br>`）之后、层的顶层，只盖到最后一行文字的底边（`textBottom`）。盖满整层时，拖到正文下方会被 Chromium 映射到前面某个 span，选区塌掉。e2e 先沿文字走到目标词再进空白，断言选区以目标词结尾：行间空白 32 个词止于 “survey.”，正文下方 160 个词止于 “each sounding.”。关掉保护后行间空白那次跳到 “…echo sounder calibration.”，用例失败。
7. smoke:672 根因：“恢复 100%” 后滚动重新锚定到第 2 页中部，第一行 “Viewer page two” 在可见阅读区上方，选择条被夹到窗口顶部（40 次中 39 次 y ∈ [0, 36]）；Playwright 把按钮滚进视图时阅读区滚动，onScroll 关闭选择条，按钮卸载。测试改为先把该行滚到中部、等 300ms 静止再选，并断言选择条在阅读区内。本地 40 次重复 680/680 通过（修复前 20 次 340 个中失败 1 个）。
8. e2e：1 / 3 / 12 行 → 存储行带 `[1, 3, 12]`、矩形 `[1, 3, 13]`（多 1 个是突出行框的上标 “th”），重启后不变。确认闪烁 100% / 200% × 浅 / 深：行内与行界颜色差都为 0（浅 202,218,249，深 213,226,250）。缝隙检查等行框静止后再截图，截图后复核行框未移动（点击标记的跳转会滚动；之前有一次因此在 100% 深色量到 42）。
9. 第三轮 CI：macOS 200% 浅色缝隙检查失败（行内差 191）。基线那一行字色像素比纸面多，按整行取众数取到了字色。测试改为在闪烁结束后再截一张同区域图，只在其中纯白的纸面像素上取背景（两次截图之间滚动位置必须不变）。本地每组合 5 次重复 15/15，worst 都是 0；反向验证（每个框各自 25% 透明）行界差 39，失败。
10. Windows CI smoke ×10（临时分支，run 40765435854）：170/170。
11. 截图：`docs/assets/pr/2026-10-28-pdf-span-text-confirm-lines-{100,200}-{light,dark}-x4.png`，以及更新后的 `2026-10-28-pdf-span-text-confirm-{light,dark}.png`。

## 验证
- within1px：旧 0.494 / 0.455 / 0.298 / 0.264 → 新 **0.955 / 0.938 / 0.938 / 0.938**（178/178）。
- lint、typecheck 通过。单测：core 211 通过；main 795 通过、14 跳过。
- e2e（最终代码）：49/49 通过（`POINT_E2E_KEYRING=1`，配合本地 safeStorage 桩，没有提交）。之前的“40 通过、6 跳过、1 失败”是本机没有钥匙串造成的。
- 截图：`docs/assets/pr/2026-10-28-pdf-span-selection-{light,dark}.png`，以及 `docs/assets/pr/2026-10-28-pdf-span-selection-200-cross-{light,dark}.png`。

## 遗留事项
- 上标 `5th` / `2nd` 处的选区有小空隙（上标 run 的高度没有填满整行）。
- 旋转文字和竖排文字仍按水平方向排列。
- 200% 下 maxDx 为 11px（p95 为 3px）。

## 2026-10-29
- d930a89：“标记” 点击 flake 的根因是选择条弹出动画中点击，Playwright 重试时滚动阅读区，onScroll 关掉选择条。新增 `e2e/bar.ts` 的 `clickOnBar`，等动画结束后再点击。更正了之前 “滚动重新锚定” 的说法，那只是触发方式之一。
- bc13a35 / 0be1ea0：拖到页面最后一行右侧松手时，终点跑出正文（`.col-resizer`、AI 面板），在 pointerup 时收回；修了 selectionchange 里两端都没动时保护跳到起点行的问题。
- 本轮：多页时只在最后一个被选中的页里找行，第 1 页松手收不回；双栏时按 DOM 顺序取到左栏的行。改成在所有选中的页里按指针 x、y 定行，并加上方向判断（往上拖时镜像处理，不让选区反向）。新增两页、双栏 fixture 和 e2e，三条反证都已做。规则见 PR 记录 “拖出正文后收回选区终点”。
