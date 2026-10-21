# 2026-10-21 看图报错 id、状态栏 tooltip、未配置设置页、对话 h3（fix/model-id-text-h3）

- 从 main cc868dd（#70 合入后）起分支。
- 看图报错：`vision-text.ts` 被 main（`vision.ts`）和 renderer（`AIPanel.tsx`）共用。renderer 不能引入 core 的整个入口，所以示例 id 写成字面量，再用单测对照 `PROVIDER_CONFIGS` 检查。
- tooltip：「DeepSeek」来自 main 的 `providerName`（预设的 label）。自定义端点就是改了 Base URL 的预设服务，所以在 main 里按 `customEndpoint()` 把 `providerName` 置空，StatusBar 用 `modelTooltip` 决定是否加前缀。没有新增状态字段。
- 未配置设置页：原因是表单直接用 `cfg.model`，而没有 Key 时 main 返回的是预设的 defaultModel，看图行也跟着显示「支持」。只改 renderer 的初始值和显示，main 的保存语义不变。按 UI设计员的规格：占位文字、看图开关默认关加说明、模型为空时保存不可点。保存同时保存 Key，所以首次配置要先填模型 id，已在 PR 记录里说明。
- 本地 API Key e2e 用例在没有系统加密时走拒绝路径，也要点保存，所以在该用例里先填模型 id。
- h3：只加 `margin: 12px 0 4px`；`.markdown > :first-child`（0,2,0）优先级高于 `.markdown h3`（0,1,1），开头的 h3 上边距仍为 0。为截图和计算样式断言加了 fake LLM 的 H3-PROBE 回答。
- 本地 gnome-keyring 会弹出 gcr 解锁提示导致挂起，所以 e2e 在没有 keyring 的情况下运行；需要系统加密的 6 项本地跳过，由 CI（macOS、Windows）覆盖。
- 新截图写到 `test-results/screenshots/`，CI 会无条件上传这个目录。状态栏 tooltip 的截图需要保存 Key，取自 CI 产物。
