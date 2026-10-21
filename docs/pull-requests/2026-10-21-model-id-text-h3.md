# fix(model): 看图报错与状态栏提示用真实模型 id，未配置时设置页不预填模型，对话 h3 边距

v0.2.2 批次，#70 验收时测试员报的缺陷，加上架构设计师指出的 v0.2.1 回归。不改版本号。

## 问题与修复
1. **看图报错用旧显示名**（中）：报错写「例如 DeepSeek Flash、GPT-4o、GLM-4V Flash」，和下拉、状态栏的 id 对不上。
   - `src/shared/vision-text.ts`：改为 `deepseek-flash`、`gpt-4o`、`glm-4v-flash`，列在 `VISION_EXAMPLE_IDS` 里，用 `、` 拼进文案。
   - 没有直接从预设表取：renderer 只能用 core 的子路径，为三个 id 新加别名不划算。改为单测逐个检查这三个 id 都在 `PROVIDER_CONFIGS` 里且 `vision: true`，以后预设改名会变红。
2. **状态栏 tooltip 写死服务名**（低）：自定义端点也显示「DeepSeek · mock-math」。
   - main 的 `listModels()` 和 `view().active` 在自定义端点（Base URL 改过）时 `providerName` 为 `""`；预设端点照旧是服务名。
   - 新增 `modelTooltip`（`src/shared/model-name.ts`）：有服务名时「服务名 · id」，没有时只显示 id。StatusBar 通过它渲染。
   - 自定义端点上选预设 id（如 deepseek-flash）也不带 DeepSeek，因为请求并不发给 DeepSeek。
3. **未配置时设置页预填模型**（v0.2.1 回归）：没有 Key 时表单预填 `deepseek-flash` 和「看图：支持」，看起来像已经选了模型。按 UI设计员的空状态规格改为：
   - 模型输入框为空，占位文字「填写服务商的模型 id」，颜色 `var(--text-disabled)`（`.model-id::placeholder`）；表单里不出现任何具体模型名。
   - 看图开关默认关，下方灰色说明「模型支持图片输入时再开启」（沿用 `.hint`）。填了模型 id 后，预设模型照旧显示只读的「看图：支持 / 不支持」，自定义模型照旧显示声明勾选框。
   - 模型 id 为空时「保存」不可点，悬停提示「请先填写模型 id」。
   - 只在该服务**没有 Key** 时生效（`settingsFormModel`：有 Key 显示已保存的模型，没有 Key 为空）。已配置时清空模型再保存仍回退到默认模型，行为不变。
   - 注意：「保存」同时负责保存 API Key，所以首次配置必须先填模型 id 才能存 Key。流程没有另改。
4. **对话 h3 边距**：`.markdown h3` 加 `margin: 12px 0 4px`。回答以 h3 开头时上边距为 0（沿用 `.markdown > :first-child`）。h1 20/8、h2 16/6 不变。

**不改**：保存到设置里的值、旧名称映射（deepseek-chat / deepseek-reasoner）、defaultModel 回退，`preset-fallback.test.ts` 8 项保持通过；`--read-font`、`--ui-font` 不变；CSP 不变；没有写死颜色。

## 截图（提交 `fa23e4e`）
对话 h3（第一个 h3 上边距 0，中间的 h3 上 12 下 4）。浅色 / 深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/fa23e4e908e66be2acaa19fc74c4b57f70aac149/docs/assets/pr/2026-10-21-chat-h3-light.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/fa23e4e908e66be2acaa19fc74c4b57f70aac149/docs/assets/pr/2026-10-21-chat-h3-dark.png)

未配置时的设置页（空模型、占位文字、看图开关关、保存不可点）。浅色 / 深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/fa23e4e908e66be2acaa19fc74c4b57f70aac149/docs/assets/pr/2026-10-21-unconfigured-form-light.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/fa23e4e908e66be2acaa19fc74c4b57f70aac149/docs/assets/pr/2026-10-21-unconfigured-form-dark.png)

状态栏 tooltip（自定义端点 mock-math）：TOOLTIP_PENDING

## 测试计划
- [x] 新增 `test/main/model-id-text.test.ts`（7 项，修复前 6 项失败）：报错文案用 id、示例 id 都是支持看图的预设、`modelTooltip`、StatusBar 用它渲染、自定义端点 `providerName` 为空而预设端点为 DeepSeek、未配置时表单为空且保存不可点。
- [x] `chat-typography.test.ts`：h3 规则加 `margin: 12px 0 4px`（修复前失败）。
- [x] e2e `docs-and-model.spec.ts`：
  - 「chat h3」：H3-PROBE 回答里两个 h3 的计算样式依次为 15px/600、上 0 下 4，和 15px/600、上 12 下 4；
  - 「no key」用例加上空状态断言：模型为空、占位文字、看图开关未勾选、说明文字、保存不可点且 title 为「请先填写模型 id」、表单里没有模型名、占位颜色规则为 `var(--text-disabled)`；填 deepseek-flash 后显示「看图：支持」且保存可点；
  - 「custom endpoint」：保存 Base URL `http://127.0.0.1:9/v1`（mock，不会被请求）和 `mock-math`，状态栏 title 为 `mock-math`；改回预设端点后为 `DeepSeek · deepseek-flash`。需要系统加密，本地跳过，CI 上运行。
- [x] 本地：core 208 项通过；test:main 769 项通过、14 项跳过；e2e 33 项通过、6 项跳过（本地没有系统加密，保存 Key 的用例跳过）；lint、typecheck 通过。
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6）。
- [x] 新增内容里没有任何 API Key，端点只用 mock。
- [ ] 六项 CI 全绿
