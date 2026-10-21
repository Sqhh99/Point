# fix(ui): 模型选择器改为上浮暗色 popover（勾选、去设置按钮）

v0.2.2 批次，问题 (f)。不改版本号。

## 问题
对话输入上方的模型选择仍是系统原生 `<select>`：不能上浮、不能统一暗色、长模型 id 被截断，「去设置」在未配置时只是灰色文字链。

## 修复
- **自定义 listbox**（禁止原生 `<select>`）：触发器为「当前模型名 + ▾」，整块可点，高度 ≥ 32px；支持 ↑↓ / Enter / Esc。
- **面板向上弹出**（底边贴触发器顶边）：背景 `--bg-elevated`、1px `--border`、圆角 8、轻阴影；`min-width: max(220px, 触发器宽)`，宽度随最长项增长，不超过所在栏（`100cqi`）；`max-height: 280px` 溢出滚动。
- **选项**：行高 ≥ 32，左右 12px；当前项右侧 ✓（`--accent`）；hover `--hover`；未配置密钥项用 `--text-disabled` 并禁用。
- **能力图标**：`vision === true` 的模型在触发器和选项里保留小眼睛图标（与 mute 图标色一致），不删。
- **「去设置」**：列表底部分隔线下方的独立按钮，高度 ≥ 32、全宽；点击关面板并打开设置。未配置空态同样改为该按钮（不再用文字链）。
- **顺手**：标题栏 / 阅读工具栏的 `.menu` 改为 `--bg-elevated` + 1px `--border` + 圆角 8 + 阴影（与 elevated 菜单一致）。

## 截图（提交 `1cba81f9e4fdece130a9654f9806f177779e4677`）
打开面板（浅色）：

![](https://raw.githubusercontent.com/Sqhh99/Point/1cba81f9e4fdece130a9654f9806f177779e4677/docs/assets/pr/2026-10-21-model-select-popover.png)

打开面板（暗色）：

![](https://raw.githubusercontent.com/Sqhh99/Point/1cba81f9e4fdece130a9654f9806f177779e4677/docs/assets/pr/2026-10-21-model-select-popover-dark.png)

选中项打勾 + 触发器：

![](https://raw.githubusercontent.com/Sqhh99/Point/1cba81f9e4fdece130a9654f9806f177779e4677/docs/assets/pr/2026-10-21-model-select-trigger.png)

## 测试计划
- [x] e2e `docs-and-model.spec.ts` 全部改为 listbox API（`pickModelBar` / `modelOptionCount`）；20 项通过
- [x] 选项文案仍为纯模型 id（无「看图」「思考」标签）；有 vision 的项带能力图标
- [x] 全部 e2e 45 项通过；test:main 782；typecheck / lint 通过
- [x] `pnpm install --frozen-lockfile`
- [ ] 六项 CI 全绿
