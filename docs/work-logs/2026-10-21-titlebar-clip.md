# 2026-10-21 标题栏被裁（问题 1）

- 分支 `fix/titlebar-clip`，从 main 开出；#62 合并后已合入 main（94e4906），没有 rebase。
- 排查：
  - 窗口参数（`frame:false` / `hiddenInset`）、`.titlebar` 的高度、`.shell` 的网格都正常。
  - 在 #63 的诊断中发现，打开 PDF 后 body 末尾有一个行内的 `CANVAS.hiddenCanvasElement`，文档可以多滚 18px。截图里标题栏只露出下半截，和这个量级吻合。
  - 根本原因是外壳依赖 body 不溢出，而 body 本身可以滚动。
- 修复：`html, body { overflow:hidden }`，`#app { position:fixed; inset:0 }`。只用 overflow:hidden 不够，因为 `scrollIntoView` 和直接设置 scrollTop 仍然能滚动 overflow:hidden 的视口，所以要用 fixed 把外壳钉住。
- 验证：新增 e2e。先在没有修复的 CSS 上跑，失败（top -418）；加上修复后通过；全量 e2e 35 项通过。
