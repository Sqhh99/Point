# 2026-10-19 #59 后续：看图、分支选区、错误信息、发送禁用

## 背景
测试员用真实 Key 复测 v0.2.0 和 #59，发现问题 1、2、5，另外未配置时发送按钮没有禁用、「去设置」看起来像普通文字、e2e 的系统加密检查会静默跳过。#59 已合入（85d7abc），这些放到新分支处理。

## 决策
- 看图只认 `ModelSpec.vision`。main 用 resolveAsk 解析出的模型，前端用 `models:list` 返回的同一字段。e2e 的假模型保留 `POINT_FAKE_VISION=0` 这个测试开关，它只能关闭看图能力，不能开启。
- `assertVisionAllowed` 挪到 resolveAsk 之后、`captureImage` 和第一次写库之前。
- 分支选区：用 Range 在 `.markdown` 上算出渲染文本里的 offset，再对齐回源文本，对齐方式是逐个匹配非空白字符的子序列。对不上或跨度异常时，不显示追问分支按钮。
- 错误信息只解析 OpenAI 兼容格式的 `error.message`（以及 `message`），不回显响应体原文。
- 系统加密检查：CI 上必须可用，否则变红；本地可以跳过。本地 Linux 可以用 keystore-preload，配合 gnome-keyring 跑完整的保存 Key 流程。注意：要在 dbus-run-session 里先 `--replace --unlock` 再 eval 它的输出，否则会弹出 gcr 解锁提示，导致挂起。

## 验证
见 PR 记录。e2e 本地 30/30。实机用真实 Key 提问返回「收到」，错误 Key 只显示 401 加厂商 message，Key 没有出现在任何输出里。

## 第二轮（测试员预验证 5488286 未通过 + 评审 hold）
- **D1/D2**：去掉贪心对齐和长度上限，改为 mdast 可见字符偏移表（core/rendered-map.ts）。渲染端按 DOM 文本节点，逐字符收集选区前的可见文字和选中的可见文字（跳过 mermaid 的按钮和 SVG）。非空白字符必须和表逐个一致，否则返回 null。展示和发送都用 `selection.toString()`，源切片只作锚点。面包屑和分支菜单显示分支问题的 `meta.request.selection`。
- **看图来源**：新增 `askSpec`。预设 id 查能力表；当前保存的自定义 id 用用户的声明；其他未知 id 返回 undefined，由调用方回退。`update()` 和 `load()` 不再把未知 id 改回默认模型。
- **D4**：提示文案按「预设 / 自定义」分开，放在 `shared/vision-text.ts`，前后端共用。
- **D5**：AIPanel 通过 `onPick` 把 ModelBar 的选择（名称和看图能力）提升到 App，状态栏和框选按钮都读它。ModelBar 默认选中 `models:list.defaultModel`（设置页保存的模型），所以原有的状态栏断言不用改；smoke 里原来写的 "fake" 改为实际选中的 deepseek-flash。
- **颜色**：`--accent` 不改；hover 和 focus 用 color-mix 从 accent 派生；四个新变量深色也定义了。

## 第三轮（架构设计师裁定：预设服务的表外 id）
- 评审指出的位置：settings.ts:43、67-71、130-131、174-185，tasks-ipc.ts:142-146。
- 判断标准：`customEndpoint` = Base URL 规范化（去掉末尾斜杠、转小写）后和预设地址不同。只有在自定义端点上，表外 id 才算自定义模型，用户的看图声明也只在这里读取。
- 预设端点上的表外 id：
  - `load` 保留磁盘上的值，这样 `listModels` 能给出 notice。
  - `modelOf` 统一做回退，`view`、`resolveProvider`、`defaultModel` 都经过它。
  - `update` 直接存为 defaultModel。
  - `activeModelId` 仍返回保存的原值，让 `resolveAsk` 经过 `askSpec` 回退并发出 `model-notice`。
  - 提示文字保持 #56 的原样：`原模型已不可用，已改用 ${defaultModel}`（中途曾改为不带模型名的版本，后来撤回）。
- 预设路径上保存的 vision 标志仍会存下（不删，以免改动原有的 visionOverride 断言），但永远不会被读取。
- UI：轻提示放在 ModelBar 下方，加「知道了」；已关闭的记录以「对话#settings 代次」为键；ModelBar 里重复的 notice 已去掉；新增 `--bg-muted`（`--surface-2` 的别名）。
- 验证：test:main 746 项通过，e2e 33 项通过（本地 keyring，无跳过），typecheck 和 lint 干净。
- 补充：深色主题的 `--accent-hover` 改为和 white 混合（浅色仍然和 black 混合）。
