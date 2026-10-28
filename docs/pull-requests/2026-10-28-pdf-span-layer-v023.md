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
- `getTextContent` 只用来取 styles（回退字体）和 `lang`。
- 保留 `closeLineGaps`，选择器改为 `.pdf-line > span`。
- marks 仍按行匹配，在该行的叶子 span 上切换 `.marked`。`PageRect` / `MarkAnchor` / marks / SelectionOverlay 的语义不变。
- `pdf-tj-geom.ts`：
  - `walkRuns` 的字号、ascent、advance 改为乘 Tm·CTM 的缩放（之前 `1 Tf` + `12 0 0 12 Tm` 会得到 1pt）。
  - 新增 `runsToLines`：按基线分行，把 TJ 字距切开的同字体碎片合成一个词 run，并标出词后的空格。
  - geom 仍留在 `apps/desktop`，没有进 `packages/core`。
- e2e：
  - `pdf-embedded-fonts.spec.ts`：去掉 known-issue 注解，硬断言恢复为 `within1px >= 0.90`（100/125/150/200%）。分母仍是第 1 页全部词，仍要求 measured === total 且 total >= 30，`PDF-EMBEDDED-DRIFT` 日志保留。
  - `pdf-text-layer.spec.ts` / `region-selection.spec.ts`：选择器跟着嵌套结构改（`.pdf-line` / `.pdf-line > span`）。
- 单测：`test/main/pdf-tj-geom.test.ts` 新增 Tm 缩放和 `runsToLines` 分行、合词两个用例。

## UI 契约
- 字形由 canvas 画，文字层只负责命中测试和选择。
- `.pdf-text` 透明度仍是 0.25，`::selection` 仍用 `--accent`。没有重影，也没有写死颜色。

| 浅色（125%） | 深色（125%） |
|---|---|
| ![light](https://raw.githubusercontent.com/Sqhh99/Point/1a6ffdf1089dabcb9e7ea9307670876751481f2f/docs/assets/pr/2026-10-28-pdf-span-selection-light.png) | ![dark](https://raw.githubusercontent.com/Sqhh99/Point/1a6ffdf1089dabcb9e7ea9307670876751481f2f/docs/assets/pr/2026-10-28-pdf-span-selection-dark.png) |

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

## 版本号
不升版本。这是 v0.2.3 的一步，版本号和 tag 另行处理。

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`：core 211 通过；main 787 通过、14 跳过
- [x] e2e（Linux + xvfb，`apps/desktop`：`pnpm build && xvfb-run -a -s "-screen 0 2400x1700x24" pnpm exec playwright test`）：38 通过、6 跳过、1 失败
  - 失败的是 `region-selection.spec.ts`，原因是本机没有系统钥匙串（`系统加密不可用`），与本改动无关。
  - 本地临时换成 safeStorage 桩（没有提交）后，该用例通过。
- [ ] CI（Windows / macOS）

## 检查项
- [x] 最小改动，lockfile 不变（`--frozen-lockfile`）
- [x] 没有写死颜色，测试里没有写死 `/workspace` 路径
- [x] 没有降低断言门槛
- [x] AI 声明：本 PR 由 AI 助手（Grok Bot）按架构方案实现，本地跑过上面所有检查

## 遗留事项
- 旋转文字和竖排文字目前仍按水平方向排列。
- 200% 下个别词 maxDx 为 11px（p95 为 3px），来自少数字体 hinting 的差异。
