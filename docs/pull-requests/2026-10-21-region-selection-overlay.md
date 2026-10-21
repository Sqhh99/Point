# fix(reader): 框选松手保留虚线框，点击标记跳回并用 SelectionOverlay 高亮

v0.2.2 批次，问题 (e)。不改版本号。

## 问题
1. 框选松手后虚线框立刻消失，只剩浮动条，看不出选了哪一块。
2. 左栏点击区域标记时，`onLocateMark` 只给文字锚点传 `page`，区域标记即使有页码也不跳转；区域锚点也没有页坐标，无法画回原框。

## 修复
### 数据（方案 2，架构设计师）
`RegionAnchor` 新增可选 `rects?: PageRect[]`（语义与文字锚点相同：100% 缩放、页左上角原点的 CSS px）。`parseAnchor` 复用现有 `parseRects`。`width`/`height` 仍是 PNG 像素。不改 `Mark` 顶层、不新增 kind、不回填旧标记。

### SelectionOverlay（单一组件）
`mode: "pending" | "confirm"`，每个 rect 各画一块，`pointer-events: none`。

| mode | 用途 | 样式 |
|---|---|---|
| `pending` | 拖选中 / 松手待操作 | 1.5px dashed `var(--accent)`，圆角 2px；填充 `color-mix(--accent 12%)`（fallback `rgba(47,111,235,0.12)`） |
| `confirm` | 点击标记后 | 无虚线；实心 `--accent` 约 25%；180ms 淡入 → 保留约 1.2s → 180ms 淡出；`prefers-reduced-motion: reduce` 时无动画 |

会话态（不入库）：PDF 用 `{ mode, page, rects }` 画在页内；非 PDF 用 scroller 内容坐标的 local rects。浮层在则 pending 框在；Esc / 点别处 / 新选区清除；「问 AI」保留到消息发出（或移除缩略图）。

### 点击标记
- 新区域标记：捕获时写 `page + rects`（至少一个）。点击 → 跳该页，`confirm` 画选区；目标尽量视口中部，上下至少留 48px。
- 旧区域标记（无 rects）：只按 `page`/`blockId` 跳，不画精确框，不整页闪。
- 文字标记：有 `rects` 就 `confirm`；没有就沿用 quote/page + `.located`。跳转不再只认 `kind === "text"`。

### 框选按钮
`aria-pressed`；按下时浅强调色背景；高度 ≥ 32px。

## 截图（提交 `a8aef8b961e013bd0d61d5d5c7c52ea9e394c316`）
松手后虚线仍在（浅 / 暗）：

![](https://raw.githubusercontent.com/Sqhh99/Point/a8aef8b961e013bd0d61d5d5c7c52ea9e394c316/docs/assets/pr/2026-10-21-region-pending.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/a8aef8b961e013bd0d61d5d5c7c52ea9e394c316/docs/assets/pr/2026-10-21-region-pending-dark.png)

点击区域标记落到原框（浅 / 暗）：

![](https://raw.githubusercontent.com/Sqhh99/Point/a8aef8b961e013bd0d61d5d5c7c52ea9e394c316/docs/assets/pr/2026-10-21-region-confirm.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/a8aef8b961e013bd0d61d5d5c7c52ea9e394c316/docs/assets/pr/2026-10-21-region-confirm-dark.png)

点击文字标记高亮（浅 / 暗）：

![](https://raw.githubusercontent.com/Sqhh99/Point/a8aef8b961e013bd0d61d5d5c7c52ea9e394c316/docs/assets/pr/2026-10-21-text-confirm.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/a8aef8b961e013bd0d61d5d5c7c52ea9e394c316/docs/assets/pr/2026-10-21-text-confirm-dark.png)

## 测试计划
- [x] core：`RegionAnchor` 带 rects 往返；旧区域锚点无 rects 仍解析；非法 rects 拒绝
- [x] marks / marks-extra：区域 rects 入库与读出
- [x] e2e `region-selection.spec.ts`：pending 虚线、标记后 confirm、文字标记 confirm、框选按钮高度与 `aria-pressed`
- [x] smoke：Markdown 上框选后也有 `selection-overlay`；问 AI 后保留到移除缩略图
- [x] 全部 e2e 45 项通过；test:main 782 项通过；typecheck / lint 通过
- [x] `pnpm install --frozen-lockfile`（pnpm 10.34.6）
- [ ] 六项 CI 全绿
