# ④ 标记跟进修复

版本：保持 0.1.1，不升。基于 main（f2204b0，已包含 #40 和 #41）。

## 做了什么
1. **浮动条位置**：新增纯函数 `placeBar`（`renderer/layout.ts`）。浮动条放在选区上方 8px；上方放不下时，翻到选区下方 8px。无论哪种情况，浮动条在垂直方向都不会和选区（含 8px 间距）重叠。水平方向以选区为中心，并限制在容器内。文字选区和框选截图都用这个函数，尺寸取浮动条渲染出来的实际宽高。
2. **标记段落样式**：有标记的段落用 `--accent` 12% 透明度作底色（`color-mix`），底部加 2px `--accent` 下划线（`inset box-shadow`）。选中文字保持系统默认的高亮，CSS 里没有任何 `::selection` 覆盖，有测试保证。
3. **一起问必须带 docId**：
   - `tasks-ipc.ts` 的 validate 原来会把空串 docId 原样传下去，现在空串视为没有。
   - `marks-ipc.ts` 的 `loadBatch`：docId 缺失、为空或为 null 时，报「一起问需要指定文档」；格式不对时报「无效的文档 id」；每个标记都必须属于这个文档，原来的 `docId && …` 短路已去掉。
   - #41 里两条 `it.fails`（docId 为 "" 和 undefined）改成了普通 `it`。#41 里那条记录 bug 的 loadBatch 用例，改为断言这些情况都会被拒绝。
4. **区域锚点**：确认 `RegionAnchor` 现在没有 path 或 imagePath 字段，只有 sha、宽高、page 和 blockId。写入时 `parseAnchor` 会丢掉所有未知字段，#41 的测试已覆盖，带 path 或 imagePath 的输入会被剥掉。按指示保持现在的结构，不另加 migration；003 只更新了注释。
- Windows junction 的测试还没在 main 上出现，所以这次没有改截图目录的检查。

## 测试
- 新增 `marks-followup.test.ts`：
  - `placeBar`：上方 8px、翻到下方、空间刚好够时留在上方；对各种位置和选区高度（包括很高的选区）逐一检查，确认都不会盖住选区；水平方向限制在容器内。
  - 标记段落的 CSS 规则；CSS 里没有 `::selection`。
- `marks-extra.test.ts`：两条 `it.fails` 改成 `it`；新增对 loadBatch 直接调用时各种 docId 输入的断言。
- lint、typecheck 退出码都是 0。core 143 项通过；main 620 项通过、4 项跳过；build 通过；e2e 13 项通过、1 项跳过。

## 截图
![标记段落样式和浮动条](https://raw.githubusercontent.com/Sqhh99/Point/c36e9e5d32adc4b2af185287673b9c220718c315/docs/assets/pr/2026-10-12-marks-followup.png)
