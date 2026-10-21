# 2026-10-21 模型显示名（fix/model-display-name）

- 从 main 9857aa1 起分支，之后合并了 main 2da2ede。
- 排查了所有显示模型名的地方：
  - ModelBar 下拉：显示 `label` 加上「· 看图」「· 思考」，这是唯一要改的地方；
  - 状态栏：显示 `model.model`，本来就是 id；
  - 回退提示 `modelFallbackNotice`：显示 defaultModel 的 id；
  - 设置页的模型输入框：datalist 的值是 id。
- 只改了显示，`label` 字段保留在模型表里，没有删。
- 截图对应提交 `b9cf2fd`。
