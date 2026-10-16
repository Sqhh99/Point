# 测试：docx / xlsx 阅读和模型设置的 e2e

日期：2026-10-15　分支：`test/e2e-docs-model-switch` → `main`　基线：`5900d7f`
相关记录：`docs/work-logs/2026-10-15-e2e-docs-model-switch.md`

## 关联
- 此前的排查显示：现有 e2e 只覆盖 Markdown、PDF 和 CSV，没有真实的 `.docx`、`.xlsx`，也没有切换服务商或模型的用例。

## 改了什么
- 新增 `apps/desktop/e2e/docs-and-model.spec.ts`，共 6 个用例，其中 1 个 `test.fail()`。只改测试，没有改产品代码。
- **A. 真实文档**（用 `POINT_FAKE_LLM=1`）：
  - 导入真实 `.docx`（用 core 的 `makeDocx` 生成）：中间栏出现标题和两段正文，文档列表里有这份文档。
  - 导入两个工作表的真实 `.xlsx`（用 SheetJS 生成）：两个工作表的单元格内容都能在中间栏看到。
  - 断言只用文字和角色定位（`getByText`、`getByRole`），不依赖标签、结构或 class。
  - 切换工作表：目前阅读器把所有工作表依次排列，没有切换控件。用例里如果出现名为「城市」的标签页或按钮就会点击它；没有就在注解里写明「没有切换控件」。无论哪种情况，另一个工作表的值都必须能看到。
  - **换成 pdfjs 画布或表格网格后是否还能用**：文字断言在表格网格里仍然成立；如果换成画布，文字不在 DOM 里，`.docx` 和 PDF 的文字断言就需要改成别的方式。
- **B. 模型设置**（不使用 `POINT_FAKE_LLM`，因为它会把状态栏固定显示为 `fake`；用例只保存和显示设置，不调用任何模型）：
  - 依次切换 OpenAI GPT / gpt-4o、智谱 GLM / glm-4-plus、DeepSeek / deepseek-reasoner，每次保存后返回阅读，状态栏显示新模型，悬停提示是「服务商 · 模型」，看图标记也随模型变化。
  - 重启应用后，选择仍然保留，设置表单里显示的服务商和模型一致，其他服务商保留各自最后一次的模型。
  - API Key：系统加密可用时，保存成功，输入框清空并提示已保存，「测试连接」可用，设置文件里没有明文 key。系统加密不可用时（Linux 容器），不保存 key，改为断言页面上可见的拒绝提示、且「测试连接」不可点。用例会在注解里写明走的是哪条路径。
- **截图**：现有的 e2e 用例已经把截图写到 `test-results/`。新用例沿用同样的做法，写入 `docs-docx.png`、`docs-xlsx.png`、`settings-openai.png`。CI 只在失败时上传 `test-results/`，所以通过时这些截图不会作为 artifact 保存。
- xlsx 库不是桌面应用的依赖，所以测试用 `createRequire` 从 `packages/core` 里加载，没有改任何 `package.json`。

## 发现的问题（产品 bug，已用 `test.fail()` 标出）
- 保存模型后，状态栏不会马上更新，要离开设置页之后才变。
- 位置：`apps/desktop/src/renderer/App.tsx:97`（只在离开设置页后重新读取当前模型）。设置页显示「已保存」时，状态栏仍然是旧的模型。
- 已确认：去掉 `test.fail()` 后，用例失败，报 `Expected: "gpt-4.1"`、`Received: "deepseek-chat"`。

## 改动类型
- [x] 仅测试、文档、CI 或构建

## 版本号
- 不升版本

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] 本地（Linux，xvfb）运行 `pnpm exec playwright test e2e/docs-and-model.spec.ts`：6 项，通过 5 项，1 项按预期失败；API Key 用例走的是「系统加密不可用」那条路径。
- [ ] 完整的 `pnpm test` 和 `pnpm e2e`：以 CI 为准，结果见下。

## 检查项
- 没有改产品代码、版本号和 workflow。

## AI 声明
- 测试和本文档由 AI（测试员）编写。
