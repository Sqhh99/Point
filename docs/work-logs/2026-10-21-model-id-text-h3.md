# 2026-10-21 看图报错 id、状态栏 tooltip、未配置设置页、对话 h3（fix/model-id-text-h3）

- 从 main cc868dd（#70 合入后）起分支。
- 看图报错：`vision-text.ts` 被 main（`vision.ts`）和 renderer（`AIPanel.tsx`）共用。renderer 不能引入 core 的整个入口，所以示例 id 写成字面量，再用单测对照 `PROVIDER_CONFIGS` 检查。
- tooltip：「DeepSeek」来自 main 的 `providerName`（预设的 label）。自定义端点就是改了 Base URL 的预设服务，所以在 main 里按 `customEndpoint()` 把 `providerName` 置空，StatusBar 用 `modelTooltip` 决定是否加前缀。没有新增状态字段。
- 未配置设置页：原因是表单直接用 `cfg.model`，而没有 Key 时 main 返回的是预设的 defaultModel，看图行也跟着显示「支持」。只改 renderer 的初始值和显示，main 的保存语义不变。按 UI设计员的规格：占位文字、看图开关默认关加说明、模型为空时保存不可点。保存同时保存 Key，所以首次配置要先填模型 id，已在 PR 记录里说明。
- 本地 API Key e2e 用例在没有系统加密时走拒绝路径，也要点保存，所以在该用例里先填模型 id。
- h3：只加 `margin: 12px 0 4px`；`.markdown > :first-child`（0,2,0）优先级高于 `.markdown h3`（0,1,1），开头的 h3 上边距仍为 0。为截图和计算样式断言加了 fake LLM 的 H3-PROBE 回答。
- 本地 gnome-keyring 会弹出 gcr 解锁提示导致挂起，所以 e2e 在没有 keyring 的情况下运行；需要系统加密的 6 项本地跳过，由 CI（macOS、Windows）覆盖。
- 新截图写到 `test-results/screenshots/`，CI 会无条件上传这个目录。状态栏 tooltip 的截图需要保存 Key，取自 CI 产物。
- 跟进（UI设计员裁定，保留「先填模型 id 才能保存」的流程）：
  - 字段下常驻提示「请先填写模型 id」。提示放在 label 里会让输入框的可访问名变成「模型 请先填写模型 id」，`getByLabel("模型", { exact: true })` 就找不到了，所以输入框加了 `aria-label="模型"`，再用 `aria-describedby` 关联提示。
  - 「保存」改为 `aria-disabled`，点击时把焦点移到模型字段；Enter 在设置页的输入框里做同样的事。Playwright 的 `toBeEnabled` 把 aria-disabled 当作禁用，所以 e2e 读取原生 `disabled` 属性，点击用 `force`（只跳过可操作性检查，仍是真实鼠标点击）。
  - 第一次改 CSS 时用字符串替换，把 `.tool-button:disabled` 也改了，和 #69 冲突；处理冲突时按 d00488d 的 style.css 重新只加了两条规则，#69 的工具栏样式没有动。
  - 自定义端点原来也会列出 deepseek 的 datalist 候选（`preset.models` 不分端点）。现在只在预设端点列当前服务的 id，自定义端点不渲染 datalist。
