# fix(ui): 选区松手出条、文末夹取，工具条锚定在 focus 端

#81 剩余三项。本轮升 `c`：`0.2.3` → `0.2.4`。不关闭 #81 或 #79。

## 行为
- 从阅读器按下拖选后，在 `.col-resizer` 或 AI 面板松手，仍显示选区工具条，且留在阅读视口内、不压 AI 面板。
- 在 long-90 上从 Line 03 拖到末行下方或页面盒子下方，选区停在 Line 90，不截在中段、不反向塌到 Line 01；工具条留在视口内。
- 工具条锚定在 Selection 的 focus（松手端或键盘移动端），不再总是整段第一行。向下/向上拖与 Shift+方向键延伸后，条靠近 focus 行；三击中行仍翻到下方且不压未选正文，首行上方无正文时仍在上方。
- 行首 0–8px 起选、页边单击清选区仍保持。

## 改动
- `Reader.tsx`：article 内 pointerdown 武装，document `mouseup` 再 measure；`placeBar` 用焦点 `.pdf-line` 的 span 并集，obstacles 仍相对整段；Shift+Up/Down 按相邻 `.pdf-line` 延伸 focus。
- `PdfView.tsx`：`keepEndInLayer` 在指针不在行盒内时，即使焦点仍在 `.pdf-text` 也夹到最后/最先可及行。
- `layout.ts`：`rectAtCaret` 只合并同一视觉行碎片。
- e2e / 夹具 / `rectAtCaret` 单测见工作日志。

## 验证
- 本地 Linux/Xvfb：typecheck；desktop `test:main` 809 passed / 14 skipped；相关 e2e 7/7 通过（含面板松手、long-90 文末、三击避让、0–8px、键盘 focus 端）。
- 未跑 Windows / macOS 与真机；开 PR 后走必需 CI。不把 CI 重试变绿当作 #79 已修复。

Related to #81. Related to #79（共享拖选现场，不关闭）。
