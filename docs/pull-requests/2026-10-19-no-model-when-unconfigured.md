# fix(models): 未配置 API Key 时不显示默认 DeepSeek 模型

## 摘要
未保存任何 API Key 时，输入框上方的模型栏和状态栏仍显示默认的 DeepSeek 模型，但该模型并不可用。本 PR 改为：未配置时不列出任何模型，模型栏显示只读的「未配置模型」和「去设置」，状态栏显示「未配置」，提问在发请求前就被拒绝并给出明确原因。保存 Key 后（沿用 #56 的 `settings:changed` 广播）立即列出该 API 的模型。

## 根因
`settings.ts` 的 `listModels()` 无论有没有 Key 都返回当前服务商的全部预设，只是把每项的 `configured` 标成 false；而默认服务商是 deepseek，ModelBar 在没有已配置模型时回退到 `models[0]`，状态栏直接显示 `view().active.model`。于是没有 Key 时也会出现「DeepSeek Flash」。

## 主要改动
- main `settings.ts`：新增 `configuredOf`（当前服务商有 encKey 或 e2e 假模型）；`models:list` 未配置时返回 `{ configured: false, models: [] }`；`SettingsView` 增加 `configured`。Key 本身不会出现在任何返回值里。
- main `tasks-ipc.ts`：在第一次写库前检查，未配置则抛出「尚未配置模型：请先在设置里填写 API Key」，不建会话、不写消息、不发请求。已有会话里的旧模型名仍走原来的 `resolveAsk` 回退逻辑。
- renderer：ModelBar 未配置时只显示文字「未配置模型」和文字链接「去设置」（没有下拉箭头，也没有 DeepSeek 名称）；状态栏显示「未配置」；AIPanel 把这个拒绝显示为「未配置模型」加「去设置」，保存 Key 后提示自动消失。
- style：`.model-empty` 用 `--muted`；下拉选中项用已有的 `--surface-2`。只用设计变量，不做整体配色调整。

## 截图（提交 `6459107`）
未配置，模型栏：

![未配置模型栏](https://raw.githubusercontent.com/Sqhh99/Point/64591079a33a215b24ece2951944008b06ed1601/docs/assets/pr/2026-10-19-unconfigured-modelbar.png)

未配置，设置页（状态栏显示「未配置」，提问被拒绝）：

![未配置设置页](https://raw.githubusercontent.com/Sqhh99/Point/64591079a33a215b24ece2951944008b06ed1601/docs/assets/pr/2026-10-19-unconfigured-settings.png)

保存 Key 后，设置页（状态栏立即显示 deepseek-flash）：

![已配置设置页](https://raw.githubusercontent.com/Sqhh99/Point/64591079a33a215b24ece2951944008b06ed1601/docs/assets/pr/2026-10-19-configured-settings.png)

保存 Key 后，模型栏只列出当前 API 的模型：

![已配置模型栏](https://raw.githubusercontent.com/Sqhh99/Point/64591079a33a215b24ece2951944008b06ed1601/docs/assets/pr/2026-10-19-configured-modelbar.png)

## 测试计划
- [x] 单测 `multi-model.test.ts`：未配置时 `models:list` 为空且 `configured=false`；有 Key 时列出模型、`view()` 不含 Key；未配置时 `tasks:run` 被拒绝，0 会话 0 消息
- [x] e2e `docs-and-model.spec.ts`：没有 Key 时没有可选模型、没有 DeepSeek 名称，状态栏显示「未配置」，提问被拒绝且什么都不写；保存 Key 后立即出现该 API 的模型
- [x] 现有断言没有放宽。「模型设置」套件里每个服务商保存时都会带一个假 Key，因为现在没有 Key 就是未配置；依赖保存 Key 的用例在系统加密不可用时跳过（CI 的 macOS 和 Windows 都可用）
- [x] 本地实机：xvfb 加 gnome-keyring 运行构建产物，用环境变量里的真实 DeepSeek Key 提问，返回「收到」；渲染进程和 userData 的 JSON 里都没有明文 Key
- [ ] 六项 CI 全绿

不改版本号、tag 或 release。
