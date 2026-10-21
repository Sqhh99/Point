# 2026-10-21 框选虚线框与标记跳转（fix/region-selection-overlay）

- 从 main 00e319d 起分支，之后 merge 了含 #73 的 main（cd877bf）。
- **锚点**：按架构设计师方案 2，给 `RegionAnchor` 加可选 `rects`，不改 width/height 语义、不回填旧数据。
- **SelectionOverlay**：单一组件两个 mode（pending / confirm），多个 rect 各一块。confirm 用 CSS 动画 180+1200+180ms，reduced-motion 只保留 1.2s。
- **非 PDF**：没有 `.pdf-page` 时，用 scroller 内容坐标的 local rects，仍走同一组件（scale = PDF_CSS_BASE）。
- **定位**：`App.onLocateMark` 对文字和区域都传 `page`/`rects`；有 rects 时 confirm 高亮并滚到视口中部（上下 ≥48px）。
- **问 AI**：`close({ keepSelection: true })`，AIPanel 发送或移除缩略图时 `onCaptureClear` 清会话框。
- 框选按钮：`aria-pressed` + 浅强调色；高度 32px。
- 截图对应提交见 PR 记录。
