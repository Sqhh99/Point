# fix(model): 模型下拉只显示真实模型 id

v0.2.2 批次，问题 4。不改版本号。

## 问题
对话框上方的模型下拉显示「DeepSeek Flash · 看图 · 思考」这样的名称和功能标签，看不出实际调用的模型 id。

## 修复
- 下拉选项的文字只显示模型 id（例如 `deepseek-flash`）。新增 `src/shared/model-name.ts` 的 `modelDisplayName`，统一显示规则。
- 去掉「· 看图」「· 思考」：
  - 看图能力仍然显示在状态栏（「支持看图 / 不支持看图」）；
  - 思考等级仍然有自己的控件。
- 未配置密钥的模型仍然带「（未配置密钥）」。这类模型的样式属于问题 3，另开 PR 处理。
- 状态栏和回退提示本来就显示 id，不用改。
- **不改**：保存到设置里的值、旧名称映射（deepseek-chat / deepseek-reasoner → deepseek-flash）、defaultModel 回退。`preset-fallback.test.ts` 的 8 项保持通过。

## 截图（提交 `b9cf2fd`；原生下拉弹层截不到，测试里临时把 select 设成 size=N 展开）
浅色：

![](https://raw.githubusercontent.com/Sqhh99/Point/b9cf2fd33434bf33bfb6dc0585be26c97b03fa10/docs/assets/pr/2026-10-21-model-names.png)

深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/b9cf2fd33434bf33bfb6dc0585be26c97b03fa10/docs/assets/pr/2026-10-21-model-names-dark.png)

## 测试计划
- [x] 新增 `test/main/model-display-name.test.ts`：
  - 所有预设模型的显示名等于 id，不含「看图」「思考」「·」；
  - ModelBar 通过 `modelDisplayName` 渲染，不再拼接标签。

  修复前 1 项失败。
- [x] `preset-fallback.test.ts` 8/8 通过；test:main 754 项通过（14 项跳过）
- [x] e2e：下拉选项文字依次为 `["deepseek-flash", "deepseek-v4-pro"]`，每个选项的文字等于它的 value。全部 e2e 通过（本地 xvfb + keyring）。
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6）
- [ ] 六项 CI 全绿
