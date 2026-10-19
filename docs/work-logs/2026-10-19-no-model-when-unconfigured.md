# 2026-10-19 未配置时不显示模型

## 问题
没有 API Key 时，ModelBar 和状态栏仍显示 DeepSeek Flash。提问后才失败（auth），不清楚原因。

## 定位
- `listModels()` 不管有没有 Key 都返回预设，`configured` 只是一个标记。
- ModelBar 和 AIPanel 的默认值取 `models.find(configured) ?? models[0]`，于是回退到 DeepSeek。
- 状态栏读 `view().active.model`，它总有值（默认服务商是 deepseek）。

## 决策
- 在源头修：`models:list` 未配置时返回空列表，并加 `configured` 字段；UI 只渲染收到的内容。
- `SettingsView.active` 保持不变（设置表单和现有单测都依赖它），另加 `configured` 布尔值给状态栏用，改动最小。
- `tasks:run` 的拒绝放在所有输入校验之后、第一次写库之前，原有的校验错误文案保持不变。
- `resolveAsk` 的回退目标从 `view().active.model` 换成 main 内部的 `activeModelId()`，效果相同，只是不再从 view 读取。
- e2e「模型设置」套件以前在没有 Key 的情况下断言状态栏显示模型名，那正是这个 bug。现在第一个用例断言未配置状态；后面的用例在保存时带一个假 Key（不发请求），所以原有断言保持原样。

## 验证
- `pnpm typecheck`、`pnpm lint`、core vitest 186 项、desktop test:main 731 项，全部通过。
- 本地 xvfb e2e 23 项通过，5 项跳过：Playwright 启动的 Electron 在本机只拿到 basic_text 后端，系统加密不可用，所以跳过需要保存 Key 的用例。CI 的 macOS 和 Windows 有系统加密，会实际运行。
- 实机：用 CDP 连接构建产物（xvfb + gnome-keyring，系统加密可用），真实 Key 只放在环境变量里。未配置时 `models:list` 为 0 项，状态栏「未配置」，提问被拒绝；保存 Key 后状态栏立即变为 deepseek-flash，下拉只有 DeepSeek Flash 和 V4 Pro，真实提问返回「收到」。渲染进程拿到的 settings 和 userData 的 JSON 里都没有 Key。
