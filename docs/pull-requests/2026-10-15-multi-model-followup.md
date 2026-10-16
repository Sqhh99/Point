# fix(multi-model): settings:changed、tasks:run 带模型、model-notice

## 摘要
修复 #55 真机构建未通过的三项契约：设置保存后广播并刷新 ModelBar/状态栏；提问 IPC 必须带上当前模型与思考等级；不可用模型回退提示经 `model-notice` 只展示一次。

## 动机
合入后的实机验证发现 ModelBar 只在 `conversationId` 变化时拉列表，设置页改模型后状态栏/下拉不同步；`AIPanel.run()` 丢弃了 model/effort；`resolveAsk` 的 notice 未传到 UI。

## 主要改动
- IPC：`settings:changed` + `TaskEvent["model-notice"]`
- main：保存后广播；stream 发 notice；首问写入 conversation model/effort
- renderer：ModelBar/App 订阅；`run()` 透传 pick；一次展示 notice

## 测试计划
- [x] 单测 multi-model followup
- [x] e2e docs-and-model（ModelBar / 首问 / notice）
- [ ] 六项 CI 全绿
