# fix(models): 看图按本次实际模型判断、追问分支按屏幕文字、错误只显示厂商 message、未配置禁用发送、状态栏跟随 ModelBar

#59 的后续 PR（v0.2.1）。不改版本号、tag 或 release。

## 修复内容
### 1. 看图能力来源（高）
- 规则：只看本次 `tasks:run` 解析出的 modelId。预设 modelId 查能力表（`ModelSpec.vision`）；用户保存的自定义 modelId 用用户的声明。前端和 main 读同一个来源：前端读 `models:list` 每个模型的 `vision`，main 用 `resolveAsk` 解析出的 spec。不再使用 `providerFor().vision`，也不再看设置页的默认模型。
- main 在第一次写入之前检查。v4-pro 加图片，即使绕过 UI 直接走 IPC，也会被拒绝，0 会话、0 消息。
- 设置页：
  - 预设模型整行隐藏勾选框，改为一行只读的「看图：支持 / 不支持」，取自 `ModelSpec.vision`。
  - 自定义模型显示勾选框「声明此模型支持看图」，副文案「由你自行声明，应用会按此判断」。勾选后前后端都会按它判断。
- 表外 model id 的处理（架构设计师裁定）：
  - **自定义 OpenAI 兼容端点**（Base URL 改成了不是预设的地址）：保留表外或自由填写的 id，能力取用户的声明。
  - **预设服务**（DeepSeek / OpenAI / 智谱，Base URL 是预设地址；末尾斜杠和大小写不算不同）：表外 id 不会当作自定义模型。已知旧名照旧映射（deepseek-chat / deepseek-reasoner → deepseek-flash）。其他 id 回退到该服务的 `defaultModel`，并给出和 #56 一样的提示「原模型已不可用，已改用 {defaultModel}」。预设路径上永远不读用户的看图声明。
  - 覆盖到的地方：
    - 设置的读取：`load` 不改写磁盘，读取时由 `modelOf` 回退。
    - 设置的保存：`update` 遇到表外 id 存为 defaultModel。
    - `models:list`：恢复 notice，不列出该 id。
    - `resolveAsk`：请求体里的 id 和对话记住的 id 都会回退，并发出 `model-notice`；发给厂商的请求里永远是 defaultModel。
    - `specOf` / `askSpec`：只有自定义端点才会造出自定义 spec。
  - 设置页：预设服务里填了表外 id 时，不显示勾选框，改为一行只读「预设服务只能用列表中的模型，保存后将改用 {defaultModel}」，看图那一行按 defaultModel 显示。
- 「不支持图片」提示：
  - 预设模型提示换一个支持看图的模型。
  - 只有自定义模型才提到「声明此模型支持看图」。
### 回退提示的显示（UI设计员）
- 在 ModelBar 下方显示一条轻提示，复用原来的 `.model-notice`，不是弹窗也不是 toast。背景用 `--bg-muted`（新增，两套主题里都只是 `--surface-2` 的别名，没有新颜色值），文字用 `--text-secondary`，右侧的「知道了」链接用 `--accent`（hover 和 focus 样式与「去设置」一致）。
- 来源有两个：`models:list` 的 notice，和本次提问的 `model-notice`。ModelBar 里原来那个 span 已去掉，避免显示两次。
- 每个对话只显示一次：点「知道了」后，在这个对话里不再出现；第一次提问新建出来的对话也会继承这次关闭。切换到新对话、或者重新配置（settings:changed）之后可以再次出现。
- 提示文字保持 #56 的原样，改措辞要等 v0.3.0 的 zh-CN 字符串表。
### 2. 追问分支（中高）
- 选区在屏幕上显示的文字，就是展示和发送的文字：草稿、引用卡、面包屑、分支菜单，以及发给模型的 selection，都用这段文字。
- 源文本的 span（start、end、源切片）只作为定位锚点，保留给 `spanMatches` 和同 span 分组使用。
- 定位方式：`@point/core/rendered-map` 从 mdast 建一张「可见字符 → 源 offset」的表。只映射 text、inlineCode、code 节点的值；链接只映射链接文字，URL 和标记符号永远不进表。选区里非空白字符按位置逐个对上，任何一个对不上就返回 null（不开分支），绝不返回一段错位的切片。旧的贪心匹配和长度上限已经删掉。
### 5. Key 错误信息（低）
只显示状态码加厂商的 `error.message`，不再显示原始 JSON。
### 状态栏跟随 ModelBar（D5）
- 状态栏显示 ModelBar 当前选中的模型和它的看图能力。数据和看图检查同源：AIPanel 把选中的模型提升到 App，状态栏和框选按钮都读它。
- 未配置时仍显示「未配置」。
- ModelBar 的默认选中是设置页保存的那个模型。
### 未配置时禁用发送
发送按钮禁用，颜色用 `--text-disabled`，没有提示框。main 在写入之前的拒绝仍保留，作为兜底。
### 设计变量
- `--accent` 保持蓝色 #2f6feb，不改。
- `--accent-hover`：浅色 `color-mix(in srgb, var(--accent) 85%, black)`，深色 `color-mix(in srgb, var(--accent) 85%, white)`（深色背景下 hover 变亮）。
- `--focus-ring`：`color-mix(in srgb, var(--accent) 40%, transparent)`。
- `--text-secondary`：浅色 #6B6860；深色从深色主题的 `--muted` 和 `--text` 混出来。
- `--text-disabled`：浅色 #A8A49A，深色 `rgb(255 255 255 / 0.35)`。
- 以上四个变量浅色和深色都有定义。Electron 32（Chromium 128）支持 color-mix，计算样式已确认。
### e2e 系统加密检查
5 处都改为：`process.env.CI` 为真时断言 `encryptionAvailable === true`，不满足就变红；只有本地运行允许跳过。本地 Linux 可以设 `POINT_E2E_KEYRING=1`，通过 `e2e/keystore-preload.cjs` 使用 gnome-keyring。

## 截图（提交 `845841d`）
未配置，浅色（发送按钮禁用，状态栏显示「未配置」）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-unconfigured-modelbar-status.png)

未配置，「去设置」获得焦点（浅色）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-unconfigured-link-focus.png)

未配置，深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-unconfigured-dark.png)

未配置，深色，「去设置」获得焦点：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-unconfigured-dark-focus.png)

已配置，ModelBar 选 flash：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-configured-modelbar-status.png)

已配置，ModelBar 选 v4-pro（状态栏跟随，显示「不支持看图」）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-configured-v4pro-status.png)

设置页，预设模型（只读的「看图：不支持」）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-settings-vision-preset.png)

设置页，自定义端点上的自定义模型（勾选框「声明此模型支持看图」和副文案）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-settings-vision-custom.png)

设置页，预设服务里填了表外 id（不显示勾选框，提示保存后改用默认模型）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-settings-vision-preset-unknown.png)

预设回退提示，浅色和深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-model-fallback-notice.png)

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-model-fallback-notice-dark.png)

Key 错误（截图里是一个故意填错的假 Key）：

![](https://raw.githubusercontent.com/Sqhh99/Point/845841dcc56e1405130319c5ce2a390961bf7441/docs/assets/pr/2026-10-19-followup-wrong-key-error.png)

## 测试计划
- [x] core vitest 197 项
  - `rendered-map.test.ts`：链接三种情况（「b 和 c」、「A b」、跨越超长链接）、加粗、行内代码、整条格式化列表项、同一段文字出现多次时取被选中的那一处、对不上时返回 null、转义和实体
  - 401 JSON 的错误信息里没有 `{`
- [x] desktop test:main 746 项（14 项跳过，与 main 相同）
  - `preset-fallback.test.ts`（新增）：
    - deepseek 预设端点保存了表外 id：`listModels` 返回「原模型已不可用，已改用 deepseek-flash」；提问时 `ask.model` 为 deepseek-flash；用 stub 的 fetch 检查发给厂商的请求，model 为 deepseek-flash，请求里没有出现那个表外 id。
    - 请求体里带表外 id、对话记住了已删除的模型：同样回退并提示。
    - glm 表外 id 加上 vision:true：声明被忽略。
    - 保存表外 id 时存为 defaultModel；Base URL 只有末尾斜杠或大小写不同，仍算预设端点。
    - 旧名映射：没有提示。
    - 自定义端点上的表外 id：保留，声明生效，发给厂商的就是这个 id。
  - 预设模型忽略用户勾选：flash 勾掉照样能发图，v4-pro 勾上照样拒绝，并且提示里没有「勾选」
  - 自定义端点加自定义模型并声明看图：图片提问成功，跑在 my-vl-1 上
  - 自定义模型没声明或取消勾选：拒绝，0 写入
  - 新工作区里绕过 UI，用 IPC 发 v4-pro 加图片：拒绝，0 会话、0 消息
- [x] e2e 33 项全部通过（本地 xvfb，`POINT_E2E_KEYRING=1`，没有跳过）
  - 三击选中整条格式化列表项，以及跨链接的部分选区：分支的 selection 等于屏幕上显示的文字（innerText），锚点等于源切片
  - 加粗选区
  - 设置页里看图那一行：预设模型；预设服务里填表外 id（没有勾选框，显示回退提示）；自定义端点上的自定义模型
  - 预设回退提示：显示在 ModelBar 下方，颜色来自变量，ModelBar 不列出表外 id；点「知道了」后隐藏，在本对话提问不再出现；新对话或 settings:changed 之后再次出现；对话记住的模型是 deepseek-flash
  - 设置页是 flash、ModelBar 选 v4-pro：状态栏显示 v4-pro 和「不支持看图」，框选按钮禁用；截图后发送被拒绝，0 写入
- [x] 实机（真实 DeepSeek Key 只放在环境变量里）
  - 向 flash 提问，返回「收到」
  - 选 v4-pro 后状态栏显示 v4-pro 和「不支持看图」
  - 错误的 Key 只显示 401 加厂商 message
  - 渲染进程拿到的 settings 里没有 Key
- [ ] 六项 CI 全绿
