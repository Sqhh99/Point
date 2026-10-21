# 2026-10-21 模型选择器 popover（fix/model-select-popover）

- 从 main ab41e6b（#74）起分支。
- 去掉原生 `<select>`，按 UI 设计员规格做向上弹出的 listbox；未配置态「去设置」改为 32px 按钮。
- 能力图标：列表里 `vision` 为 true 时显示眼睛 SVG，颜色 `--muted`，与选项/触发器文字横排对齐。
- 宽度：`container-type: inline-size` 在 `.model-bar` 上，popover `max-width: 100cqi`，避免超出对话栏。
- e2e 用 `data-value` / `role=option` 替代 `selectOption` 与 `option` 查询；`modelOptionCount` 结束后 Esc 关掉面板，避免「去设置」和库脚「设置」撞名。
