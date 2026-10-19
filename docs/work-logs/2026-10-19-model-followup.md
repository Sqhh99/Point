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
