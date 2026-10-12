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
5. **截图目录防 junction**（合入 main 90bdd78，其中包含 #43 `capture-junction.test.ts`）：
   - 问题：`capturesDir` 原来先递归 mkdir，再检查路径，所以即使写入最终被拒，也已经在工作区外的目标位置建出了一个空的 `captures` 文件夹。
   - 现在去掉了递归 mkdir，从工作区的真实路径出发，一层一层往下走（先 `.point`，再 `captures`）。每一层都先取真实路径，确认还在工作区内，再往下一层；某一层不存在时，在已经确认过的真实父目录里普通地 mkdir 一层，然后再取一次真实路径确认。只读调用时遇到缺失的层直接报错，不创建任何东西。
   - 任何一层是指向工作区外的 junction 或 symlink 时，都会在创建子目录之前被拒绝。
   - #43 里这条 `it.fails` 已改成普通 `it`。

## 测试
- 新增 `marks-followup.test.ts`：
  - `placeBar`：上方 8px、翻到下方、空间刚好够时留在上方；对各种位置和选区高度（包括很高的选区）逐一检查，确认都不会盖住选区；水平方向限制在容器内。
  - 标记段落的 CSS 规则；CSS 里没有 `::selection`。
- `marks-extra.test.ts`：两条 `it.fails` 改成 `it`；新增对 loadBatch 直接调用时各种 docId 输入的断言。
- lint、typecheck 退出码都是 0。core 143 项通过；main 620 项通过、14 项跳过（多出来的 10 项是 junction 用例，只在 Windows 上跑）；build 通过；e2e 13 项通过、1 项跳过。用 `POINT_JUNCTION_AS_SYMLINK=1` 在 Linux 上用目录 symlink 模拟 junction，capture-junction 的 10 项全部通过。

## 截图
![标记段落样式和浮动条](https://raw.githubusercontent.com/Sqhh99/Point/c36e9e5d32adc4b2af185287673b9c220718c315/docs/assets/pr/2026-10-12-marks-followup.png)
