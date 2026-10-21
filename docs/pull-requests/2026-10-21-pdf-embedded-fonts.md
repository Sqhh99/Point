# fix(pdf): 修复 PDF 选区重影、深色条纹和行间白缝（嵌入字体偏移为已知问题，v0.2.3）

v0.2.2 批次，问题 5 的后续（测试员在嵌入字体的 PDF 上复测 #63 未通过）。不改版本号。

本 PR 修复三项：**选区重影、深色条纹、行间白缝**。嵌入字体时单词位置偏移**没有修复**，是已知问题，留到 v0.2.3。问题 5 保持打开。

发版说明原话：「选区重影已修复，嵌入字体时字位置偏移是已知问题，v0.2.3 修」

## 问题（测试员复测，嵌入字体 + 两端对齐的 PDF）
1. 重影：选中后，文字层的字形以系统高亮色显示出来，和画布上的字形错开，看起来是两层字。
2. 深色条纹：相邻 span 重叠的地方高亮叠了两次，出现深色竖条。
3. 行间白缝：多行选区每行之间露出一条白色页面。
4. 字位置偏移：文字层的单词和画布上的单词左右错开几个像素（已知问题，见下）。

## 修复（只作用于 `.pdf-text`，应用其他地方仍是 #44 的系统默认高亮）
- **重影、深色条纹**：按 pdf.js 上游查看器的做法：
  - 文字层字形始终透明，选中时也是；
  - 整个文字层 `opacity: 0.25`，`::selection` 用实色 `var(--accent)`；
  - 透明度放在整层上，而不是每个 span 上，所以重叠的 span 只合成一次，没有条纹；
  - 不用 mix-blend-mode。
  - 文字层里标记的底色相应调到 48%，乘上 25% 后和其他格式的 12% 一致。
- **行间白缝**：文字层渲染完后，给每个 span 设置行高，等于到下一行的距离再加 1px（只在同一栏、同一段内）：
  - 相邻行重叠 1px，不会因为取整留下细缝；
  - 字形位置不变；
  - 上标这类小字号 span 使用同一行的高度，选区里不留洞。
- **#44 测试调整**：`marks-followup.test.ts` 原来断言 CSS 里没有任何 `::selection`。按架构设计师的裁定，改为「所有 `::selection` 选择器都以 `.pdf-text` 开头」，应用其他地方仍然不允许自定义选区。

## 已知问题：嵌入字体时字位置偏移（v0.2.3）
选区重影已修复；嵌入字体时字位置偏移是已知问题（实测 1px 内比例 0.26–0.49），v0.2.3 用 operator list 的 TJ 位置文本层修。

第 1 页文字层的全部单词（Linux 本地）：

| 缩放 | 测到 / 该页单词数 | 1px 内比例 | 95% 分位偏移 | 最大偏移 |
|---|---|---|---|---|
| 100% | 178 / 178 | 0.494 | 5px | 6px |
| 125% | 178 / 178 | 0.455 | 7px | 8px |
| 150% | 178 / 178 | 0.298 | 8px | 9px |
| 200% | 178 / 178 | 0.264 | 11px | 12px |

CI 上各平台的数据见 `PDF-EMBEDDED-DRIFT` 日志行，以及 `pdf-embedded-drift-<平台>.json`。

- 本 PR 的比例下限是 0.20，只用来防止回退；v0.2.3 修复后改回 0.90。
- e2e 报告里这条测试带有 `known-issue: embedded-font drift, v0.2.3` 标注。
- 限时探查过两种方法，都没达到 90%，所以没有提交：
  - 文字层改用嵌入字体：0.534 / 0.404 / 0.376 / 0.011；
  - 再用词距代替 scaleX：0.646 / 0.461 / 0.522 / 0.011。
- 原因：LibreOffice 用 TJ 位移做字距调整，pdf.js 的 textContent 每行只有一项，拿不到单字位置。详见工作日志。

## 截图（提交 `ef7900e`）
125%，选中前两段，浅色：

![](https://raw.githubusercontent.com/Sqhh99/Point/ef7900ed0cdcb15f8a5c985793c3ede0071d850c/docs/assets/pr/2026-10-21-pdf-embedded-selection-125.png)

125%，深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/ef7900ed0cdcb15f8a5c985793c3ede0071d850c/docs/assets/pr/2026-10-21-pdf-embedded-selection-125-dark.png)

200%，选中第一段，浅色：

![](https://raw.githubusercontent.com/Sqhh99/Point/ef7900ed0cdcb15f8a5c985793c3ede0071d850c/docs/assets/pr/2026-10-21-pdf-embedded-selection-200.png)

200%，深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/ef7900ed0cdcb15f8a5c985793c3ede0071d850c/docs/assets/pr/2026-10-21-pdf-embedded-selection-200-dark.png)

已知小瑕疵：上标（5th、2nd）后面的空格不属于任何 span，选区在那里有一道约 1 个空格宽的竖缝。

## 测试计划
- [x] 测试样例 `e2e/fixtures/pdf/`：
  - `hydro-serif.pdf`：嵌入 Nimbus Roman 子集，两端对齐，带上标；
  - `hydro-times-std.pdf`：同样的文字，使用不嵌入的 Times-Roman。

  用测试员的生成器 `gen.py`、`std.cjs` 重新生成，生成器一起提交，说明见 README（文字为原创；字体许可是 AGPL-3.0 加字体例外）。
- [x] 新增 e2e `pdf-embedded-fonts.spec.ts`（带 known-issue 标注）：
  - 选区样式：整层透明度 0.25，span 透明度 1，字形和选中字形都透明，选区背景等于 `--accent`。
  - 125% 和 200% 下的像素检查（浅色主题）：
    - 选区色约为 rgb(203, 219, 250)（每个通道误差 ≤ 4）；
    - 无重影、无深色条纹：周围 1px 内没有字形的纸面像素，比统一选区色深的不超过 0.5%；
    - 同段相邻行之间没有一行未染色的纸面（无白缝）。
  - 100 / 125 / 150 / 200% 下，比对文字层和画布上的每个单词：
    - 分母是第 1 页文字层的全部单词（样例为 178 个，和 `pdftotext` 一致），不只是视口里看得到的；
    - 视口比页面小时（macOS runner 只有 1024×677），会滚动取景，直到每个单词都完整出现过一次；
    - 硬断言：测到的单词数等于该页文字层单词数，单词数 ≥ 30（防止文字层缺失时 0/0 也能通过），1px 内比例 ≥ 0.20；
    - CI 输出的 `PDF-EMBEDDED-DRIFT` 行记录每档缩放的单词数和比例。
  - 浅色、深色截图。
  - 本地在 2200×1500、2200×677（模拟 macOS runner）、1024×677 三种窗口下都通过。

  修复前样式断言失败（透明度为 1）。
- [x] 原有 `pdf-text-layer.spec.ts` 通过；全部 e2e 41 项通过（本地 xvfb + keyring）；test:main 772 项通过（14 项跳过）；typecheck / lint 通过
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6）
- [ ] 六项 CI 全绿
