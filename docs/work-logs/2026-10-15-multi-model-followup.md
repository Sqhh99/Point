# 2026-10-15 multi-model followup

## 背景
#55（multi-model）合入后，真机构建验证失败（main `f5110fb`）。架构师给出三条契约，本分支逐项补齐。

## 改动

### 1. `settings:changed` 广播
- main：`settings:update` / `settings:setKey` 成功后 `BrowserWindow.getAllWindows()` 广播 `settings:changed`。
- preload：`settings.onChanged(cb)`。
- ModelBar：挂载时订阅，不再仅依赖 `conversationId` 刷新 `models:list`。
- App 状态栏：订阅同一事件并 `refreshModel()`（保留 Settings `onSaved` 作为同窗兜底）。

### 2. `tasks:run` 携带 model/effort
- `AIPanel.run()`（原 ~300–315）把 `pickModel` / `pickEffort` 写入 TaskRequest；分支追问与 regenerate 同理。
- 已有对话：ModelBar `pick` 立刻 `conversations.setModel`。
- 首次提问：`createConversation` 后立刻 `setConversationModel(ask.model, ask.effort)`，与本次 run 解析结果一致。

### 3. resolveAsk notice → `model-notice`
- `TaskEvent` 增加 `{ type: "model-notice"; message }`。
- stream 在 delta 前发送一次；AIPanel 展示 `task-model-notice`，下次 ask 清空；可手动关闭。
- fake LLM 路径仍解析模型/思考与 notice，便于 e2e。

## 测试
- 单测：broadcast、首问落库、model-notice 事件。
- e2e：保存设置后状态栏/ModelBar 刷新；首问记忆；renderer 收到 model-notice。
