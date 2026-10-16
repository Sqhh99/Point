# 2026-10-15 多模型 + 思考等级（feat/multi-model）

## 范围
- `ModelSpec` / `ProviderConfig` / 数据驱动的 `EffortLevel.writes`（Cherry Studio 风格，适配器无厂商 if/else）
- Migration 004：`conversations.model` / `effort` 可空列（幂等）
- 设置里的 DeepSeek / OpenAI / GLM 预设迁到 ModelSpec；safeStorage 密钥不动
- 对话上方：仅当前供应商的模型下拉 + 该模型声明的思考分段；供应商切换仍在设置
- `tasks:run` 不支持的 effort 硬拒绝且零写入；思考开启时不发 temperature
- Base URL 仅 https（localhost 可用 http）；请求 `redirect: manual`，拒绝跨主机
- 状态栏：设置「已保存」后立即刷新（`onSaved` → `refreshModel`）；#52 的 `test.fail` 已改成正常断言

## 官方页核对后的 effort（未核对的模型 efforts=[]）
| 模型 | efforts |
|---|---|
| deepseek-flash / deepseek-v4-pro | 关/低/高/最大（可关；`thinking.type` + `reasoning_effort`） |
| glm-5.3 / 5.3-flash | 低/高/最大（不可关） |
| glm-5.2 | 关/高/最大 |
| glm-5.1/5/5-turbo/4.6/4.5 | 关/开 |
| gpt-6-astra / gpt-6.1-sol | 低/中/高/极高/最大（无 none） |
| 其余旧 OpenAI/GLM 预设 | [] |

旧名映射：`deepseek-chat` → flash+关；`deepseek-reasoner` → flash+高；未知名 → 默认模型 + notice。

## 测试
lint/typecheck 0；core 186 + main 725；e2e 23（含状态栏即时刷新、model-bar 仅当前供应商、effort 切换）。
