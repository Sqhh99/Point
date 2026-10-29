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
  - selectionchange 时把 `.endOfContent` 放到选区活动端所在 `.pdf-line`（及该行的 `<br>`）的后面，位于层的顶层，不进 `.pdf-line`。
  - `.selecting` 时它从层顶盖到最后一行文字的底边（`textBottom`），不盖最后一行以下的纸面。最后一行以下由 Chromium 自己命中层，选区止于层的最后一段文字，这正是期望的终点；之前盖满整层时，Chromium 会把这里的点映射到前面某个任意的 span，选区塌掉。
  - 指针落在层本身时，选区端点是子节点索引：取索引前一个节点，跳过 `.endOfContent` 自身。
  - `style.css`：`.pdf-line` 不建层叠上下文，也不接收指针（`z-index: auto; pointer-events: none`）。词 span 是 `z-index: 1; pointer-events: auto`，`.endOfContent` 是 `pointer-events: auto`。这样词 span 和 `.endOfContent` 在同一个层叠上下文里，和 pdf.js 一样。
  - 结果：拖到行间空白时选区停在该行，不会跳到后面的段落；拖到正文下方时选区止于页面最后一个词。
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
    - 选区保护：125% 下把 “techniques” 滚到视口上方，从它开始拖。每次拖动先沿文字走到目标行的最后一个词（让选区真的长到那里），再离开文字进入空白：段末短行右侧的空白（目标词 “survey.”），以及正文下方的空白纸面（目标词，页面最后一个词 “sounding.”）。
    - 断言：选区以 “techniques” 开头，并以目标词结尾（`/in the survey\.$/`、`/…each sounding\.$/`）；选区底边不超出目标行 2px；拖动时层有 `.selecting`，`.endOfContent` 紧跟在以目标词结尾的 `.pdf-line`（及其 `<br>`）之后；pointerup 后 `.selecting` 去掉，`.endOfContent` 回到层末尾。
    - 本地：行间空白 32 个词，底边 275 ≤ 276；正文下方 160 个词，以 “each sounding.” 结尾，底边 530 ≤ 532。
    - 关掉保护（不调用 `trackSelection`）再跑：行间空白那次选区跳到 “…echo sounder calibration.”（120 个词，底边 452 > 276），用例失败。
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
  - 新断言按选中文字成比例：选中行框内（含首末行）“干净纸面且被着色”的设备像素，除以选中词的几何面积。词面积取自同一份 pdf.js 在 Node 里算出的 `PageTextGeom.words`（PageRect，100%），乘 k²·dpr²（k = 缩放 / 100）。比例与平台抗锯齿和窗口大小无关；没有着色时为 0。
  - 实测（tinted / 词面积；125% 91 个词，200% 47 个词；CI run 40757035570）：

    | 平台 | 125% | 200% |
    |---|---|---|
    | Linux（xvfb） | 0.638 | 0.773 |
    | Windows CI | 0.619 | 0.760 |
    | macOS CI | 0.626 | 0.748 |

  - 门槛 `TINT_MIN = 0.51`：三平台最小值 0.619 − 余量 0.10 = 0.519，向下取整到 0.51。代码里有同样的注释。
  - 反向验证（CI run 40757997339，把 `::selection` 着色关掉）：macOS（job 123061980493）0.008，Windows（job 123061980914）0.007，两者都 < 0.51，用例失败。旧的 `> 500` 在这种情况下反而会通过（它只数干净纸面，不看是否着色）。
  - 中线颜色、`darker` 和行间空隙检查不变；`within1px >= 0.90` 不变。
- `smoke.spec.ts:672` 在 Windows 上点 “标记” 时报 “element was detached”：
  - 不是选区跟踪导致工具条重渲染：`trackSelection` 不会收起选区，也不会重挂工具条。
  - 原因是测试竞态：点 “恢复 100%” 后约 45ms，`selectIn` 就选中了第 2 页上一档缩放的旧 span。重建完成后 `replaceChildren` 把它们换掉，选区收起，工具条关闭，按钮随之卸载。main 上就有同样的写法，本 PR 多了一次 operator list 的 await，窗口变大了。本地把点击和选择放进同一个 evaluate 可以稳定复现。
  - 修复：`PdfView.tsx` 在页面 effect 的 cleanup 里去掉 `--scale-factor`，标记旧层已过期（它只用作就绪标记）。测试在选择前等待第 2 页 `.pdf-text` 的 `--scale-factor` 等于 `data-scale`。本地 smoke 16/16 通过。
  - 这一步不够：之后 Windows CI `--repeat-each=10` 仍是 9/10，本地 20 次重复也有 1 次失败（340 个用例中 1 个）。真正的根因见下文 “smoke:672 根因”。
- 第二轮 CI：macOS e2e 的 `pdf-embedded-fonts.spec.ts:360`（拖到页底）失败，报 `.selecting` 为 false。之前这条在 macOS 上没跑到过（前面 147 失败后串行跳过）。
  - 不是产品 bug。macOS runner 的窗口只有约 680px 高，比 100% 的页面矮，`main.center` 可以纵向滚动。
  - 原因 1：这种情况下，在 100% 用 Playwright（CDP）合成的鼠标拖动，Chromium 不扩展选区，插入点跟着鼠标走，选区一直是空的。关掉选区保护也一样；用 xdotool 发真实 X 输入就能正常选中。所以 macOS 上 “行间空白” 那一步其实也是空选区，只是没被断言抓住。
  - 原因 2：页底目标 y≈1184 在视口外。真实输入拖到那里会拖出窗口，带着自动滚动选中整个界面。
  - 修复（只改测试）：
    - 改在 125% 下测，和 147 的拖动同一档缩放，各平台都能正常拖。
    - 先把 “techniques” 滚到视口上方；“页底” 改成 “正文下方”，取 `min(页底 − 30, 视口底 − 20)`，并断言它在最后一行下方 20px 以外。
    - 新增断言：选区必须以 “techniques” 开头，空选区不再能蒙混通过。
  - 本地验证：正常窗口和 1800×680 的短窗口都通过，两个目标的选区都是 “techniques”。去掉 `.endOfContent` 跟进（保护失效）后，两种窗口都失败，选区跳到整段 “…in the survey.”。
- 评审（45932c4 之后）：点击文字标记时，确认闪烁画成了每个词一个框（例如 12 个），相邻词的框重叠处颜色更深。
  - 原因：span 层每个词一个叶子 span，`Range.getClientRects()` 因此按词返回矩形，标记存下的 rects 也是按词的。`PageRect` 的约定是“每行一个”。第一版 `mergeLineRects`（纵向重叠 ≥ 较矮者一半就合并）在评审中被替换，规则见下一节。

## 每行一个矩形、确认闪烁无缝（评审第二、三轮）

### 合并规则（`pdf-tj-geom.ts` 的 `mergeLineRects`）
新标记存储前（`Reader.pdfAnchor`）、已存标记绘制前、`SelectionOverlay` 绘制前，都用同一个函数：
1. 去掉落在另一个矩形里面的矩形（容差 1px）。旧标记存的是 `Range.getClientRects()`，每个整选的 span 既有元素框又有文字框，两者叠成更深的色带。
2. 两个矩形的 **top 相差 ≤ 1px、height 相差 ≤ 1px，且水平间距 < 1 个字号** 时合并为并集。`PageRect` 没有字号，用较矮者的高度代替（文字框高 = ascent + descent，约 1.1–1.2em，所以限值略大于 1em）。
   - 上标、不同字号的 run 不合并；落在本行框内的会被第 1 步去掉，突出行框的保留。
   - 两栏之间间距大于 1 个字号，不合并。
3. 矩形保持真实几何，不裁剪。相邻行的框会重叠几 px（行距 < 框高），由绘制层保证重叠处不重复着色（见下）。

`Reader.tsx` 取选区矩形时改用 `textBoxes(range)`：逐个文本节点取文字框，不再取整选 span 的元素框（元素框与文字框的 top 和高度不同）。

### 上限 64：先合并，再把第 64 行起并入最后一个矩形
`capLineRects(mergeLineRects(...), 64)`：超过 64 行时，第 64 行及之后的行取并集，成为最后一个矩形，不丢行，标记仍覆盖到选区最后一行。

### 旧标记：读取时合并
已存的按词矩形不迁移、不改存储；`PdfView.tsx` 绘制前 `mergeLineRects(rects)`，每行一个持久高亮框。

### 缝隙在绘制层修复
- 双色（行间更深的一条缝）的原因：每个框各自带半透明背景，相邻行的框重叠 1.4px（100%）/ 2.8px（200%），重叠处着色两次。
- 修复只在绘制层：
  - `SelectionOverlay` 的框都放在一个容器里。确认框是不透明的 `--accent`，容器统一带透明度 0.25（含动画；`prefers-reduced-motion` 下直接 0.25）。
  - 持久高亮同理：`.mark-rect` 是不透明 `--accent`，放在透明度 0.12 的 `.mark-rects` 容器里；每行 2px 的 `--accent` 下划线放在上面单独的 `.mark-lines` 层。
  - 没有写死颜色；矩形本身不裁剪。

### 单测（`test/main/pdf-tj-geom.test.ts`）
- 同一行、间距小于 1 个字号的词合并为每行一个框。
- 上标单独保留，除非落在本行框内。
- 两栏间距大于 1 个字号时不合并。
- top 相差 3px 的两个框保持两个，不合并成更高的并集。
- 旧标记中落在 span 元素框里的文字框被去掉。
- `capLineRects`：不超过上限时不变；**80 行**选区，第 64–80 行并入最后一个矩形而不是丢掉。

### e2e（`region-selection.spec.ts`）
- 选 1 / 3 / 12 行：存储的行带数 === `[1, 3, 12]`，存储的矩形数 === `[1, 3, 13]`。12 行那条多出的 1 个是第 6 行末尾的上标 “th”，它突出行框，按规则单独保留。页面上持久高亮框 13 个（12 行各一个 + 上标）。
- 重启应用后：行带数仍为 `[1, 3, 12]`，矩形数不变，每行一个持久框。
- 12 行确认闪烁的缝隙检查，100% / 200% × 浅色 / 深色：取前三个相互接触的行框，按像素行取背景色的众数，行内与行界处的颜色差都 ≤ 3（每通道）。
  - 背景只在“干净纸面”像素上取：闪烁消失后对同一区域再截一张，只用那张里纯白（255,255,255）的像素。macOS 200% 下基线那一行墨迹比纸面多，原来按整行取众数会取到字色（差 191），这不是缝。
  - 测量前等行框在两帧之间不再移动，截图后再量一次，必须相同；两张截图之间滚动位置必须不变（点击标记后的跳转会滚动阅读区，之前有一次因此在本地 100% 深色量到 42）。
  - 反向验证：把绘制层改回每个框各自 25% 透明（容器不透明），100% 浅色行界处变成 163,192,247，与行内差 39，用例失败。

| 缩放 / 主题 | 行内 RGB | 行界 RGB | 重叠（px） | 最大差 |
|---|---|---|---|---|
| 100% 浅色 | 202,218,249 | 202,218,249 | 1.39 / 1.41 | 0 / 0 |
| 100% 深色 | 213,226,250 | 213,226,250 | 1.39 / 1.41 | 0 / 0 |
| 200% 浅色 | 202,218,249 | 202,218,249 | 2.8 / 2.8 | 0 / 0 |
| 200% 深色 | 213,226,250 | 213,226,250 | 2.8 / 2.8 | 0 / 0 |

（Linux，dpr 1，日志 `TEXT-CONFIRM-SEAM`。Windows CI 数值完全相同；macOS CI 为 203,219,250 / 214,226,251，差都是 0。纸面两种主题下都是白色，深色下 `--accent` 不同，着色也不同。）

截图（×4 最近邻放大，固定在提交 463494f）：

| | 浅色 | 深色 |
|---|---|---|
| 100% | ![100 light](https://raw.githubusercontent.com/Sqhh99/Point/463494fed79b732723a061b6ece802d2e38d6a32/docs/assets/pr/2026-10-28-pdf-span-text-confirm-lines-100-light-x4.png) | ![100 dark](https://raw.githubusercontent.com/Sqhh99/Point/463494fed79b732723a061b6ece802d2e38d6a32/docs/assets/pr/2026-10-28-pdf-span-text-confirm-lines-100-dark-x4.png) |
| 200% | ![200 light](https://raw.githubusercontent.com/Sqhh99/Point/463494fed79b732723a061b6ece802d2e38d6a32/docs/assets/pr/2026-10-28-pdf-span-text-confirm-lines-200-light-x4.png) | ![200 dark](https://raw.githubusercontent.com/Sqhh99/Point/463494fed79b732723a061b6ece802d2e38d6a32/docs/assets/pr/2026-10-28-pdf-span-text-confirm-lines-200-dark-x4.png) |

| 确认闪烁（浅色） | 确认闪烁（深色） |
|---|---|
| ![confirm light](https://raw.githubusercontent.com/Sqhh99/Point/463494fed79b732723a061b6ece802d2e38d6a32/docs/assets/pr/2026-10-28-pdf-span-text-confirm-light.png) | ![confirm dark](https://raw.githubusercontent.com/Sqhh99/Point/463494fed79b732723a061b6ece802d2e38d6a32/docs/assets/pr/2026-10-28-pdf-span-text-confirm-dark.png) |

## smoke:672 根因
- 点 “恢复 100%” 后，`PdfView` 重新锚定滚动位置，让第 2 页（当前页）的中部对准视图中部（这里 scrollTop 1213）。第 2 页第一行 “Viewer page two” 因此在可见阅读区上方（滚动区顶部 y=36）。
- 选择条在选区上方，被夹到窗口顶部：插桩记录 40 次中 39 次 y ∈ [0, 36]，1 次 y ∈ [−1, 35]。
- Playwright 点击 “标记” 前把按钮滚动到可见，阅读区随之滚动，`Reader` 的 onScroll 关闭选择条，按钮卸载：“element was detached”。
- 修复（只改测试，用户只会选看得见的文字）：等第 2 页 `--scale-factor` 等于 `data-scale`；把 “Viewer page two” 所在的 span 滚到视图中部；等 300ms 内第 2 页既无滚动也无 DOM 变化；再选择。新增断言：选择条在可见阅读区之内。
- 验证：修复前本地 20 次重复 340 个用例中失败 1 个；只加静止等待时 40 次重复失败 2 个；最终修复本地 40 次重复 680/680 通过。
- Windows CI `smoke.spec.ts --repeat-each=10`（临时分支 `tmp/pr78-smoke-repeat`，不改主 CI 配置，run 40765435854，job 123088196461）：170/170 通过（修复前 run 40757035570 为 9/10）。

## 版本号
不升版本。这是 v0.2.3 的一步，版本号和 tag 另行处理。

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`：core 211 通过；main 795 通过、14 跳过
- [x] e2e（Linux + xvfb，`apps/desktop`：`pnpm build && POINT_E2E_KEYRING=1 xvfb-run -a -s "-screen 0 2400x1700x24" pnpm exec playwright test`）：49/49 通过（`region-selection.spec.ts` 单独 `--repeat-each=10`：30/30）
  - `POINT_E2E_KEYRING=1` 配合本地临时的 safeStorage 桩（没有提交）。不设时 `region-selection.spec.ts` 会因本机没有系统钥匙串（`系统加密不可用`）失败，相关用例跳过；之前记录的“40 通过、6 跳过、1 失败”就是这个原因，与本改动无关。
- [ ] CI（Windows / macOS）
- 临时分支 CI（最终代码，run 40765435854）：Windows 着色 / 区域 / 拖选 6/6，smoke ×10 170/170；macOS 着色 0.626 / 0.748、拖选两个目标通过，区域缝隙 200% 浅色因字色被当成背景失败，已按上文修正测试，修正后的重跑见 run 40767480319。

## 检查项
- [x] 最小改动，lockfile 不变（`--frozen-lockfile`）
- [x] 没有写死颜色，测试里没有写死 `/workspace` 路径
- [x] 没有降低断言门槛
- [x] AI 声明：本 PR 由 AI 助手（Grok Bot）按架构方案实现，本地跑过上面所有检查

## 遗留事项
- 上标的选区有空隙：`5th` / `2nd` 处上标 run 的高度没有填满整行，选区在上标附近会留一小块空隙（仅记录，本 PR 不修）。
- 旋转文字和竖排文字目前仍按水平方向排列。
- 200% 下个别词 maxDx 为 11px（p95 为 3px），来自少数字体 hinting 的差异。

## “标记” 点击 flake 的真正根因（更正上文 “smoke:672 根因”）
- 上文把原因归到 “恢复 100%” 后滚动重新锚定、选择条被夹到窗口顶部。这只是其中一种触发方式，按那一节修复后，Windows smoke ×10 与 macOS region ×10 仍偶发 “element was detached”。
- 真正的原因：选择条有 0.12s 的弹出动画（transform）。动画中点击时，Playwright 判定按钮 “not stable”，重试时强制把按钮滚进视图（block end / center / start）。这一滚动让阅读区也滚动，`Reader` 的 onScroll 关闭选择条，按钮卸载。CPU 繁忙时滚动事件先于重试的点击到达。本地加压 20 次中有 8 次失败。
- 修复（只改测试，d930a89）：新增 `e2e/bar.ts` 的 `clickOnBar`，先等选择条可见、所有动画结束，再点击；smoke 与 region 两处都改用它。用户点击时选择条已经停稳。

## 拖出正文后收回选区终点（bc13a35、0be1ea0 和本轮）
- 现象：拖选到某一页最后一行右侧松手时，`.endOfContent` 在这一行之后，层里后面已经没有文字。Chromium 把选区终点放到文档里下一处文字上（`.col-resizer`、AI 面板），选区扩出正文，选择条也不出现。多页文档从第 1 页开始拖、在正文右侧松手，选区一直扩到 AI 面板（测试员实测 2941–2983 个字符）。
- 修复（`PdfView.tsx` 的 `keepEndInLayer`，在 pointerup 时执行，早于选择条和 `pdfAnchor` 读选区）。终点已在 `.pdf-text` 里时不处理；否则按下面的规则收回：
  1. 定页：只在选区覆盖的页里找。
  2. 定行：在覆盖指针 y 的行里，取左端 ≤ 指针 x、且最靠右的那一行（双栏时落在右栏）。没有行覆盖指针 y 时，先用同样条件选出这一栏（左端 ≤ 指针 x，且右端越过最靠右那一行的左端），再取上方最近的一行；往上拖时取下方最近的一行。指针落在两页之间时，取到的就是上方那一页的最后一行。
  3. 定位置：收回到这一行里起点在指针左边的最后一个文本段的末尾，没有就收回到行首。往上拖时镜像处理：收回到终点在指针右边的第一个文本段的开头，没有就收回到行尾。
  4. 不反向：方向按松手前选区终点在起点之前还是之后判断。收回后的终点如果越过起点，往下拖时停在起点所在行的行尾，往上拖时停在行首。
  - `extend` 引发的 selectionchange 晚于这次 pointerup 到达，会重新挂上保护，所以再用一次性的 selectionchange 监听复位一次。
  - 同时修了 selectionchange 里 “两端都没动” 的情况：之前被当成起点在动，保护跳到起点所在行，下一次命中映射到那里，+30px 时选区塌成 “S-44 5”。现在两端都没动时直接返回。
- 新 fixture：`e2e/fixtures/pdf/hydro-times-std-2p.pdf`（`std.cjs` 生成，同一页两份），`hydro-2col.pdf`（`gen.py` 的双栏版本改为四段 ×3，LibreOffice 转出，两栏都排满）。
- e2e：
  - `pdf-embedded-fonts.spec.ts` 拖选用例：行间空白、中间行右侧 +30px、最后一行右侧 +3px / +30px、正文下方，每个目标都断言终点在 `.pdf-text` 里、选择条可见。另有直接检查：终点放到 `.col-resizer` 后在中间行右侧 pointerup，选区止于这一行。
  - 新用例 “an end released past the article is pulled back on the page and column under the pointer”：
    - 两页文档，终点在 `.col-resizer`，在第 1 页中间行右侧 pointerup：止于 “in the survey.”。
    - 往上拖（终点在文档列表上），在上面一行右侧 pointerup：仍是反向选区，从下一行行首 “S-44” 到 “survey.”。
    - 往下拖时指针在起点上方：不反向，停在起点所在行的行尾。
    - 两页文档真实拖动：从第 1 页 “techniques” 拖过 “survey.” 后在其右侧 +30px 松手，选区止于 “survey.”，终点在 `.pdf-text` 里，选择条可见。
    - 双栏文档：在右栏最后一行右侧 +30px pointerup，止于右栏的 “each sounding.”，不落进左栏。
  - 反证：两页那条在 `0be1ea0` 上失败（只在最后一个被选中的页里找行）；双栏那条在按 DOM 顺序取第一行的版本上失败（落在左栏的 “…depth measurements”）；不反向那条在没有方向判断的版本上失败（选区翻成反向）。
- 在 AI 面板或分栏条上松手时选择条不出现、选择条锚在松手那一端、长选区滚动后选择条看不见：`main` 上就有，排到 0.3.0，另开问题，不在本 PR。
- 行首 0–8px 内起拖选不中：按下点正好落在字符偏移的分界上时，Chromium 拖动只移动光标、不建选区。`main` 也有这个问题，只是位置不同（测试员基线：main 6 处，本 PR 3 处）。本 PR 的验收口径是选不中的位置不多于 main；修复（按下点补建选区）另开 0.3.0 的 PR，补丁暂存在本机。
