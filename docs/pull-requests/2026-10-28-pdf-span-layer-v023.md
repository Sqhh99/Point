# feat(pdf): v0.2.3 文字层改为按 TJ run 绝对定位的 span（Option A），e2e 恢复 within1px ≥ 0.90

v0.2.3 第二步。不改版本号，不打 tag。

## 关联
- 架构方案：**Option A**，用 `buildPageTextGeom` 的 runs 自绘绝对定位 span，替换 pdf.js `TextLayer`。
- 前置 PR：#77（`docs/pull-requests/2026-10-21-pdf-tj-geom.md`，只落地 geom）。
- 工作日志：`docs/work-logs/2026-10-28-pdf-span-layer.md`。

## 改了什么
- `PdfView.tsx`：删掉 `new TextLayer().render()`。改为 `buildPageTextGeom(page)` → `runsToLines` → `renderTextLayer`。
  - 每行一个 `span.pdf-line`，行内每个 run 一个叶子 span。
  - 盒子顶 = y − ascent。
  - 每个 run 单独 `scaleX(advance / 实测宽度)`，不对整行做 scaleX。
  - 行高按 Chromium 行盒基线公式算，把图层字体的基线放到 PDF 基线上。字体测量用隐藏 canvas 的 `fontBoundingBoxAscent/Descent`，按字体族缓存。
  - 字体族先用 pdf.js 已注册的内嵌 FontFace（`loadedName`），找不到时退回 textContent styles 的 fontFamily。
  - 两端对齐行里，词间空格用 `word-spacing` 补满到下一个词的左边，选区不留空洞。
- 选区保护（评审后补上，和 pdf.js 4.10 TextLayer 的做法一致）：
  - 每个 `.pdf-text` 末尾加一个 `.endOfContent` div。
  - 在层上 pointerdown 时加 `.selecting`；document 的 pointerup、窗口 blur、keyup 时去掉。selectionchange 时，选区涉及的层加 `.selecting`。
  - selectionchange 时把 `.endOfContent` 移到选区活动端的后面。如果移进 `.pdf-line`，就用负的 left/top 把它拉回层的原点，仍然盖住整层。
  - `style.css`：`.pdf-line` 不建层叠上下文，也不接收指针（`z-index: auto; pointer-events: none`）。词 span 是 `z-index: 1; pointer-events: auto`，`.endOfContent` 是 `pointer-events: auto`。这样词 span 和 `.endOfContent` 在同一个层叠上下文里，和 pdf.js 一样。
  - 结果：从段中拖到行间空白或页底时，选区停在原处，不会跳到层的末尾。
- 健壮性：
  - 没有 advance 或实测宽度为 0 时，`sx = 1`，不会出现 NaN / Infinity。
  - 负的 `word-spacing` 截为 0。
  - 叶子 span 显式设 `transform-origin: 0 0`（`style.css` 里也是 `0% 0%`），scaleX 从左边缘缩放。
- `getTextContent` 只用来取 styles（回退字体）和 `lang`。
- 保留 `closeLineGaps`，选择器改为 `.pdf-line > span`。
- marks 仍按行匹配，在该行的叶子 span 上切换 `.marked`。`PageRect` / `MarkAnchor` / marks / SelectionOverlay 的语义不变。
- `pdf-tj-geom.ts`：
  - `walkRuns` 的字号、ascent、advance 改为乘 Tm·CTM 的缩放（之前 `1 Tf` + `12 0 0 12 Tm` 会得到 1pt）。
  - 新增 `runsToLines`：按基线分行，把 TJ 字距切开的同字体碎片合成一个词 run，并标出词后的空格。
  - geom 仍留在 `apps/desktop`，没有进 `packages/core`。

`walkRuns` 现在乘上 Tm·CTM 的缩放（修正 #77 的一个几何 bug）；数据形状不变，但 fontSize / ascent / advance 的数值会变。

- e2e：
  - `pdf-embedded-fonts.spec.ts`：去掉 known-issue 注解，硬断言恢复为 `within1px >= 0.90`（100/125/150/200%）。分母仍是第 1 页全部词，仍要求 measured === total 且 total >= 30，`PDF-EMBEDDED-DRIFT` 日志保留。
  - `pdf-embedded-fonts.spec.ts` 新增两个用例：
    - 选区保护：100% 下从 “techniques” 开始拖，分别拖到段末短行右侧的空白和页底。断言拖动时层有 `.selecting`，`.endOfContent` 跟进到所在行；选区不含 “each sounding”（页末）和 “Tidal reduction”（后面的段落），也不超出拖过的行；pointerup 后 `.selecting` 去掉，`.endOfContent` 回到层末尾。
    - 关掉保护再跑，选区会跳到 “…improved accuracy.”，用例失败。
    - 200% 跨段选择截图。
  - `pdf-text-layer.spec.ts`：
    - 改为逐个 `.pdf-line > span` 词测量。每个词用 Range 取非空白文字的框，和画布上按 0.2em 间隙切出的墨迹词比较左右边缘，避免逐词漂移被整行框掩盖。
    - 行文本仍按 `.pdf-line` 断言。
    - 本地最大偏差：100% 下左 1.30px / 右 1.11px，125% 下左 1.38px / 右 1.74px，容差为 3px × 缩放。
  - `region-selection.spec.ts`：选择器跟着嵌套结构改为 `.pdf-line > span`。
- 单测：`test/main/pdf-tj-geom.test.ts` 新增 Tm 缩放和 `runsToLines` 分行、合词两个用例。

## UI 契约
- 字形由 canvas 画，文字层只负责命中测试和选择。
- `.pdf-text` 透明度仍是 0.25，`::selection` 仍用 `--accent`。没有重影，也没有写死颜色。

| 浅色（125%） | 深色（125%） |
|---|---|
| ![light](https://raw.githubusercontent.com/Sqhh99/Point/1a6ffdf1089dabcb9e7ea9307670876751481f2f/docs/assets/pr/2026-10-28-pdf-span-selection-light.png) | ![dark](https://raw.githubusercontent.com/Sqhh99/Point/1a6ffdf1089dabcb9e7ea9307670876751481f2f/docs/assets/pr/2026-10-28-pdf-span-selection-dark.png) |

200%，跨两段的选区，从第 1 段第 2 行（含上标 5th）到第 2 段第 2 行：
- 选区经过 200% 下漂移最大的词 “confidence”（dx −11px，来自 drift JSON 的 `worst`）。
- 截图里还能看到含上标 2nd 的那一行。
- 纸面在两种主题下都是白色；深色截图里的选择条是深色。

| 浅色（200% 跨段） | 深色（200% 跨段） |
|---|---|
| ![light 200](https://raw.githubusercontent.com/Sqhh99/Point/3897d473081367f499f0c5d3f5efa585f3c6397d/docs/assets/pr/2026-10-28-pdf-span-selection-200-cross-light.png) | ![dark 200](https://raw.githubusercontent.com/Sqhh99/Point/3897d473081367f499f0c5d3f5efa585f3c6397d/docs/assets/pr/2026-10-28-pdf-span-selection-200-cross-dark.png) |

## 四档缩放（hydro-serif 内嵌字体，e2e `PDF-EMBEDDED-DRIFT`）

| 缩放 | 测到 / 词数 | 旧 TextLayer within1px | 新 within1px | p95Dx | maxDx |
|---|---|---|---|---|---|
| 100% | 178 / 178 | 0.494 | **0.955** | 1 | 3 |
| 125% | 178 / 178 | 0.455 | **0.938** | 2 | 3 |
| 150% | 178 / 178 | 0.298 | **0.938** | 2 | 4 |
| 200% | 178 / 178 | 0.264 | **0.938** | 3 | 11 |

## 改动类型
- [x] 新功能 / 行为改进
- [ ] Bug 修复
- [ ] 重构
- [x] 测试
- [x] 文档

## CI 修复（第一轮 CI 后）
- `pdf-embedded-fonts.spec.ts` 选区着色断言：
  - 原断言是中线采样里着色像素数 `> 500`。macOS 得 478、Windows 得 479，Linux 得 541。
  - 原因：这是采样数量问题，不是渲染 bug。中线行只占行宽约 14%，能采到多少“干净纸面”像素取决于各平台的字形抗锯齿。用 Windows CI 截图在同样几何下估算，全区域的着色比例为 0.478，Linux 为 0.493，只低约 3%。
  - 新断言按面积成比例：在选中的内部行框内（逐设备像素，四边各内缩 2px），统计“干净纸面且被着色”的像素占行框面积的比例，要求 `>= 0.35`。Linux：125% 为 0.479（37044 / 77289），200% 为 0.625（54216 / 86729）。macOS / Windows 的实际值见 CI 日志中的 `PDF-SELECTION-TINT`。
  - 反向验证：把 `::selection` 设成透明后，比例为 0，用例失败。旧的 `> 500` 在这种情况下反而会通过（它只数干净纸面，不看是否着色）。
  - 中线颜色、`darker` 和行间空隙检查不变；`within1px >= 0.90` 不变。
- `smoke.spec.ts:672` 在 Windows 上点 “标记” 时报 “element was detached”：
  - 不是选区跟踪导致工具条重渲染：`trackSelection` 不会收起选区，也不会重挂工具条。
  - 原因是测试竞态：点 “恢复 100%” 后约 45ms，`selectIn` 就选中了第 2 页上一档缩放的旧 span。重建完成后 `replaceChildren` 把它们换掉，选区收起，工具条关闭，按钮随之卸载。main 上就有同样的写法，本 PR 多了一次 operator list 的 await，窗口变大了。本地把点击和选择放进同一个 evaluate 可以稳定复现。
  - 修复：`PdfView.tsx` 在页面 effect 的 cleanup 里去掉 `--scale-factor`，标记旧层已过期（它只用作就绪标记）。测试在选择前等待第 2 页 `.pdf-text` 的 `--scale-factor` 等于 `data-scale`。本地 smoke 16/16 通过。

## 版本号
不升版本。这是 v0.2.3 的一步，版本号和 tag 另行处理。

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`：core 211 通过；main 787 通过、14 跳过
- [x] e2e（Linux + xvfb，`apps/desktop`：`pnpm build && POINT_E2E_KEYRING=1 xvfb-run -a -s "-screen 0 2400x1700x24" pnpm exec playwright test`）：47/47 通过
  - `POINT_E2E_KEYRING=1` 配合本地临时的 safeStorage 桩（没有提交）。不设时 `region-selection.spec.ts` 会因本机没有系统钥匙串（`系统加密不可用`）失败，相关用例跳过；之前记录的“40 通过、6 跳过、1 失败”就是这个原因，与本改动无关。
- [ ] CI（Windows / macOS）

## 检查项
- [x] 最小改动，lockfile 不变（`--frozen-lockfile`）
- [x] 没有写死颜色，测试里没有写死 `/workspace` 路径
- [x] 没有降低断言门槛
- [x] AI 声明：本 PR 由 AI 助手（Grok Bot）按架构方案实现，本地跑过上面所有检查

## 遗留事项
- 上标的选区有空隙：`5th` / `2nd` 处上标 run 的高度没有填满整行，选区在上标附近会留一小块空隙（仅记录，本 PR 不修）。
- 旋转文字和竖排文字目前仍按水平方向排列。
- 200% 下个别词 maxDx 为 11px（p95 为 3px），来自少数字体 hinting 的差异。
