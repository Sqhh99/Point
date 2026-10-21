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
   - 模型 id 为空时，字段下方常驻一行小字「请先填写模型 id」（`.hint` + `.model-id-hint`，颜色 `var(--text-disabled)`），填了 id 后隐藏。模型输入框和「保存」都通过 `aria-describedby` 关联这行提示。
   - 「保存」用 `aria-disabled="true"`，不用原生 `disabled`：样式和禁用一致（`button:disabled, button[aria-disabled="true"]` 同一条规则：opacity 0.45、cursor default），悬停没有高亮，但仍可聚焦、可点击。点击不保存，只把焦点移到模型字段。悬停提示「请先填写模型 id」保留作为补充。
   - 在表单的输入框里按 Enter（不含输入法组字中）同样只把焦点移到模型字段。页面没有 `<form>`，所以不会提交。
   - 模型字段的候选列表（datalist）：只在预设端点列当前服务的 id（DeepSeek：`deepseek-flash`、`deepseek-v4-pro`）。自定义端点不列任何 id，也不渲染 datalist（之前自定义端点也会列出 deepseek id，本次一起改）。没有默认选中项，聚焦字段不会自动填值；↑↓ / Enter / Esc 由原生列表处理，不会保存，也不会离开设置页。
   - 只在该服务**没有 Key** 时生效（`settingsFormModel`：有 Key 显示已保存的模型，没有 Key 为空）。已配置时清空模型再保存仍回退到默认模型，行为不变。
   - 注意：「保存」同时负责保存 API Key，所以首次配置必须先填模型 id 才能存 Key。流程没有另改。
4. **对话 h3 边距**：`.markdown h3` 加 `margin: 12px 0 4px`。回答以 h3 开头时上边距为 0（沿用 `.markdown > :first-child`）。h1 20/8、h2 16/6 不变。

**不改**：保存到设置里的值、旧名称映射（deepseek-chat / deepseek-reasoner）、defaultModel 回退，`preset-fallback.test.ts` 8 项保持通过；`--read-font`、`--ui-font` 不变；CSP 不变；没有写死颜色。

## 截图（提交 `fa23e4e`）
对话 h3（第一个 h3 上边距 0，中间的 h3 上 12 下 4）。浅色 / 深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/fa23e4e908e66be2acaa19fc74c4b57f70aac149/docs/assets/pr/2026-10-21-chat-h3-light.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/fa23e4e908e66be2acaa19fc74c4b57f70aac149/docs/assets/pr/2026-10-21-chat-h3-dark.png)

未配置时的设置页（提交 `0184af6`：空模型、占位文字、字段下常驻「请先填写模型 id」、看图开关关、保存呈禁用样式）。浅色 / 深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/0184af6fdfe7eaf1bd88bc2dafb53f397b103f25/docs/assets/pr/2026-10-21-unconfigured-form-light.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/0184af6fdfe7eaf1bd88bc2dafb53f397b103f25/docs/assets/pr/2026-10-21-unconfigured-form-dark.png)

状态栏 tooltip 写死服务名**（低）：自定义端点也显示「DeepSeek · mock-math」。
   - main 的 `listModels()` 和 `view().active` 在自定义端点（Base URL 改过）时 `providerName` 为 `""`；预设端点照旧是服务名。
   - 新增 `modelTooltip`（`src/shared/model-name.ts`）：有服务名时「服务名 · id」，没有时只显示 id。StatusBar 通过它渲染。
   - 自定义端点上选预设 id（如 deepseek-flash）也不带 DeepSeek，因为请求并不发给 DeepSeek。
3. **未配置时设置页预填模型**（v0.2.1 回归）：没有 Key 时表单预填 `deepseek-flash` 和「看图：支持」，看起来像已经选了模型。按 UI设计员的空状态规格改为：
   - 模型输入框为空，占位文字「填写服务商的模型 id」，颜色 `var(--text-disabled)`（`.model-id::placeholder`）；表单里不出现任何具体模型名。
   - 看图开关默认关，下方灰色说明「模型支持图片输入时再开启」（沿用 `.hint`）。填了模型 id 后，预设模型照旧显示只读的「看图：支持 / 不支持」，自定义模型照旧显示声明勾选框。
   - 模型 id 为空时，字段下方常驻一行小字「请先填写模型 id」（`.hint` + `.model-id-hint`，颜色 `var(--text-disabled)`），填了 id 后隐藏。模型输入框和「保存」都通过 `aria-describedby` 关联这行提示。
   - 「保存」用 `aria-disabled="true"`，不用原生 `disabled`：样式和禁用一致（`button:disabled, button[aria-disabled="true"]` 同一条规则：opacity 0.45、cursor default），悬停没有高亮，但仍可聚焦、可点击。点击不保存，只把焦点移到模型字段。悬停提示「请先填写模型 id」保留作为补充。
   - 在表单的输入框里按 Enter（不含输入法组字中）同样只把焦点移到模型字段。页面没有 `<form>`，所以不会提交。
   - 模型字段的候选列表（datalist）：只在预设端点列当前服务的 id（DeepSeek：`deepseek-flash`、`deepseek-v4-pro`）。自定义端点不列任何 id，也不渲染 datalist（之前自定义端点也会列出 deepseek id，本次一起改）。没有默认选中项，聚焦字段不会自动填值；↑↓ / Enter / Esc 由原生列表处理，不会保存，也不会离开设置页。
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

状态栏 tooltip（自定义端点 mock-math；提交 `37bd300`，取自 CI run 39620532494 的 macOS e2e 截图）。原生 tooltip 截不到，测试临时把 `title` 属性的值打印在状态栏左侧（「悬停提示（title）：mock-math」），截图后移除。浅色 / 深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/37bd30062587ee2c3a2c679e839c147c7b3f9e39/docs/assets/pr/2026-10-21-status-tooltip-custom-light.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/37bd30062587ee2c3a2c679e839c147c7b3f9e39/docs/assets/pr/2026-10-21-status-tooltip-custom-dark.png)

## 测试计划
- [x] 新增 `test/main/model-id-text.test.ts`（9 项；最初 7 项中 6 项在修复前失败，后加的「提示行 / aria-disabled」和「候选列表」两项在对应改动前失败）：报错文案用 id、示例 id 都是支持看图的预设、`modelTooltip`、StatusBar 用它渲染、自定义端点 `providerName` 为空而预设端点为 DeepSeek、未配置时表单为空且保存不可点。
- [x] `chat-typography.test.ts`：h3 规则加 `margin: 12px 0 4px`（修复前失败）。
- [x] e2e `docs-and-model.spec.ts`：
  - 「chat h3」：H3-PROBE 回答里两个 h3 的计算样式依次为 15px/600、上 0 下 4，和 15px/600、上 12 下 4；
  - 「no key」用例加上空状态断言：模型为空、占位文字、看图开关未勾选、说明文字、表单里没有模型名、占位颜色规则为 `var(--text-disabled)`；
    - 提示行可见、颜色等于 `--text-disabled`，模型字段和「保存」的 `aria-describedby` 都指向它；填了 id 后提示隐藏，清空后重新出现；
    - 「保存」带 `aria-disabled="true"`、原生 `disabled` 为 false，opacity 0.45、cursor default，悬停前后计算样式不变；
    - 填了 API Key 而模型为空时，点「保存」和在 Key 字段按 Enter 后 `document.activeElement` 都是模型字段，没有「已保存」，`settings.get()` 仍未配置、没有 Key；
    - 候选列表：DeepSeek 只列 `deepseek-flash`、`deepseek-v4-pro`，OpenAI 只列 `gpt-*`；聚焦不填值；字段里按 ↑↓↑ Enter Esc 后仍在设置页、没有保存；Base URL 改成自定义端点后输入框没有 `list` 属性、页面里没有 datalist 和 deepseek id，按 ↓ 也不填值；改回预设端点后列表恢复；
  - 「custom endpoint」：保存 Base URL `http://127.0.0.1:9/v1`（mock，不会被请求）和 `mock-math`，状态栏 title 为 `mock-math`；改回预设端点后为 `DeepSeek · deepseek-flash`。需要系统加密，本地跳过，CI 上运行。
- [x] 本地（合入 main d00488d 之后）：core 208 项通过；test:main 781 项通过、14 项跳过；e2e 36 项通过、6 项跳过（本地没有系统加密，保存 Key 的用例跳过）；lint、typecheck 通过。
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6）。
- [x] 新增内容里没有任何 API Key，端点只用 mock。
- [x] CI run 39620532494（a01a864）六项全绿，macOS / Windows e2e 各 39 项通过
- [ ] 六项 CI 全绿（最终 head）
