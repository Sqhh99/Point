## 做了什么
对话输入框上方增加**当前供应商**的模型下拉和思考等级分段；设置里的 DeepSeek / OpenAI / GLM 迁到数据驱动的 `ModelSpec`（密钥仍在 safeStorage）。

![模型栏与思考等级](https://raw.githubusercontent.com/Sqhh99/Point/COMMIT/docs/assets/pr/2026-10-15-multi-model.png)

- Migration 004：对话可记住 `model` / `effort`（可空 = 用默认）
- DeepSeek 旧名映射：`deepseek-chat`→flash+思考关，`deepseek-reasoner`→flash+高；未知名回退默认并提示
- Effort 按官方页声明（未核对的模型隐藏控件）；思考开启时请求体不含 temperature
- `tasks:run` 对不支持的 effort 硬拒绝、零写入
- Base URL 仅 https（localhost 可用 http），不跟随跨主机重定向
- **状态栏在「已保存」后立即刷新**（不再等离开设置）；已把 #52 的 `test.fail` 改成正常断言

## 测试
lint / typecheck 退出码 0；unit 725+186；build 0；e2e 23 通过。

## 缺口
自定义 OpenAI 兼容端点的 UI 配置入口未做（接口已按「同一适配器的第二份 CONFIG」留好）；Point 未使用 tool calls，DeepSeek 回传 `reasoning_content` 未接。
