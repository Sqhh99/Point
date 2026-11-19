# fix(ui): 选区松手出条、文末夹取，工具条锚定在 focus 端

#81 剩余三项。本轮升 `c`：`0.2.3` → `0.2.4`。不关闭 #81 或 #79。

## 行为
- 从阅读器按下拖选后，在 `.col-resizer` 或 AI 面板松手，仍显示选区工具条，且留在阅读视口内、不压 AI 面板。
- 在 long-90 上从 Line 03 拖到末行下方或页面盒子下方，选区停在 Line 90，不截在中段、不反向塌到 Line 01；每个目标前把 Line 03 滚回视口并重测起点（避免小视口上第一段拖选后 stale 盒打在中段）。工具条留在视口内。
- 工具条锚定在 Selection 的 focus（松手端），不再总是整段第一行。向下/向上拖后，条靠近松手行；用 programmatic 反向选区加 keyup 验证组件按 focus 定位（不声称 PDF 跨行键盘导航已支持）。三击中行仍翻到下方且不压未选正文，首行上方无正文时仍在上方。
- 行首 0–8px 起选、页边单击清选区仍保持。

## 改动
- `Reader.tsx`：article 内 pointerdown 武装，document `mouseup` 再 measure；`placeBar` 纵向锚在焦点行、水平居中用整段并集，focus 在选区下半时 `preferBelow`；document `keyup` 触发已有选区的 measure，不改写原生键盘选择。Esc / 滚动关闭后，两端未变的 keyup（例如只松 Shift）不再复活工具条。
- `PdfView.tsx`：`keepEndInLayer` 在指针不在行盒内时，即使焦点仍在 `.pdf-text` 也夹到最后/最先可及行；若本次 pointerdown 落在选区工具条上则不夹取（点击「更多」不得改写 focus）。
- `layout.ts`：`rectAtCaret` 只合并同一视觉行碎片；`placeBar` 增加 `preferBelow`。
- e2e / 夹具 / `rectAtCaret` 单测见工作日志。

## 验证
- 本地 Linux/Xvfb：typecheck；核心 vitest 211 passed；`test:main` 811 passed / 14 skipped；审查修复后 `pdf-embedded-fonts.spec.ts` 整文件一次 13/13 通过（含 200% 跨段、long-90 在 2200×1500 与 1024×677、更多/Esc+Shift、真实鼠标跨页 100/150/200%；条纹 125%/200% 仍为 0.631 / 0.773）。详见工作日志第 7–8 节。Windows / macOS CI 与真机仍未跑，不能报通过。不把 CI 重试变绿当作 #79 已修复。

Related to #81. Related to #79（共享拖选现场，不关闭）。
