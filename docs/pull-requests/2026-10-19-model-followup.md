# fix(models): 看图按本次实际模型判断、加粗文字可追问分支、错误只显示厂商 message、未配置时禁用发送

#59 的后续 PR（v0.2.1）。修复测试员复测发现的问题 1、2、5，以及未配置状态下 UI 的剩余问题。不改版本号、tag 或 release。

## 修复内容
1. **[高] 看图判断用错了模型。** 以前用的是设置页的默认模型（`providerFor().vision`）。复现：设置页选 flash（支持看图），ModelBar 选 v4-pro（不支持看图），框选截图提问后图片照样发出，模型回复 "Unsupported Image"。
   - main：`resolveAsk` 返回本次解析出的模型的 `ModelSpec.vision`。`tasks:run` 在写任何东西之前用它做检查，覆盖 ModelBar 选择和对话记住的模型两种情况。
   - 前端：`models:list` 每个模型带上同一个 `ModelSpec.vision`。AIPanel 按 ModelBar 当前选中的模型判断，阅读器的「框选」按钮跟着它启用或禁用。选 v4-pro 后发送已附图片的问题，会显示原有的「当前模型不支持图片」，截图保留。
   - 注意：对于预设模型，设置页的「该模型支持看图」勾选框不再影响提问时的检查（按约定只用 ModelSpec）。
2. **[中高] 选中回答里的加粗等格式文字时，不出现「追问分支」。** 原因是用渲染后的文字去 markdown 源文本里 `indexOf`，而源文本多了 `**`。改为：先在渲染后的纯文本上取选区，再用 `sourceSpanOf`（core/tree）映射回源文本的 offset。得到的 quote 就是源文本的切片，并通过 `spanMatches` 校验。
5. **[低] Key 错误时显示厂商的原始 JSON。** `errorFromStatus` 现在只显示状态码加厂商的 `error.message`。不是 JSON 的响应体（比如 HTML）只显示状态码。
- **未配置时禁用发送按钮。** 判断依据是 `models:list.configured`。按钮颜色用 `--text-disabled`，没有提示框。main 在任何写入之前的拒绝仍然保留，作为兜底。
- **「去设置」链接。** 颜色 `--accent`、无下划线；悬停时 `--accent-hover` 加下划线；`:focus-visible` 是 2px 的 `--focus-ring`。旁边的「未配置模型」用 `--text-secondary`。`:root` 里只新增了 `--accent-hover`、`--focus-ring`、`--text-secondary`、`--text-disabled` 四个变量，现有变量没有改。
- **e2e 系统加密检查。** 共 5 处：4 个保存 Key 的用例加上 smoke 里原有的 1 个。现在 `process.env.CI` 为真时断言 `encryptionAvailable === true`，不满足就变红，不再跳过。只有本地运行才允许跳过。本地 Linux 可以设 `POINT_E2E_KEYRING=1`，通过 `e2e/keystore-preload.cjs` 使用 gnome-keyring。这只在 e2e 里，产品代码和 CI workflow 都没有改。

## 截图（提交 `31daefa`）
未配置：ModelBar 和状态栏（发送按钮禁用，状态栏显示「未配置」）

![未配置](https://raw.githubusercontent.com/Sqhh99/Point/31daefac8335cf144709bb1e9aa475496f18bb58/docs/assets/pr/2026-10-19-followup-unconfigured-modelbar-status.png)

未配置：「去设置」获得键盘焦点（`--focus-ring`）

![焦点](https://raw.githubusercontent.com/Sqhh99/Point/31daefac8335cf144709bb1e9aa475496f18bb58/docs/assets/pr/2026-10-19-followup-unconfigured-link-focus.png)

已配置：ModelBar 和状态栏

![已配置](https://raw.githubusercontent.com/Sqhh99/Point/31daefac8335cf144709bb1e9aa475496f18bb58/docs/assets/pr/2026-10-19-followup-configured-modelbar-status.png)

Key 错误：只显示状态码和厂商 message（截图里是一个故意填错的假 Key）

![错误Key](https://raw.githubusercontent.com/Sqhh99/Point/31daefac8335cf144709bb1e9aa475496f18bb58/docs/assets/pr/2026-10-19-followup-wrong-key-error.png)

悬停样式在截图里看不出来，用计算样式确认过：`rgb(197,106,75)` 加 underline。

## 测试计划
- [x] core vitest 191 项：新增 `sourceSpanOf` 4 项、错误信息 1 项
- [x] desktop test:main 733 项：新增 2 项，覆盖 flash 到 v4-pro 的看图拒绝、对话记住的不支持看图的模型，两种情况都是 0 会话 0 消息
- [x] e2e 30 项全部通过（本地 xvfb，`POINT_E2E_KEYRING=1`，没有跳过）：
  - 未配置时发送按钮禁用；直接调 IPC 被拒绝且写入为 0
  - 保存 Key 后发送按钮可用、模型出现
  - 选 v4-pro 后「框选」禁用；flash 下截图后切到 v4-pro 再发送被拒绝，写入为 0
  - 选中跨越加粗边界的文字可以追问分支，存下的 quote 等于源文本切片
- [x] 本地设 `CI=1` 且没有 keyring 时，保存 Key 的用例变红
- [x] 实机：用真实 DeepSeek Key（只放在环境变量里）向 flash 提问，返回「收到」；用错误的 Key 提问只显示「鉴权失败 (401): …」；渲染进程拿到的 settings 里没有 Key
- [ ] 六项 CI 全绿
