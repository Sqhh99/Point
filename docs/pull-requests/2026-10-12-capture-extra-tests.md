# PR：test: 补 #36 截图 sha、路径、写入、框选区域、chat:start 与看图拦截的测试

- **日期：** 2026-10-12 / **分支：** `test/capture-extra` → `feat/capture` / **基线 commit：** `468d0c7` / **相关记录：** [工作日志](../work-logs/2026-10-12-capture-extra-tests.md)

## 关联
Related to #36

## 改了什么
新增 `apps/desktop/test/main/capture-extra.test.ts`（98 个用例）：
- **`isCaptureSha` / `assertCaptureSha`：**
  - 接受：全数字的 sha、普通 sha。
  - 拒绝：63、65 位；大写；前后空白、换行、CRLF、tab；`../`、`..\`、`/`、`\`、绝对路径、盘符；NUL；带 `.png`；全角数字、阿拉伯-印度数字、西里尔字母 а、组合字符、零宽空格、emoji；`0x` 前缀。
  - 拒绝非字符串：number、bigint、NaN、布尔、null、undefined、String 对象、带 toString 的对象、数组、Buffer、Symbol。
  - 每一项都同时检查 `capturePath` 和 `readCapture`。
- **路径不能逃出工作区：** 截图不存在时给出明确的报错；有一个目录叫 `<sha>.png` 时会报错，不会写到别处；没有打开工作区时，截图和带图的任务都被拒绝。**截图文件是指向工作区外的软链接，标 `it.fails`；`.point/captures` 本身是软链接，标 `it.fails`。**
- **写入：** 只留下 `<sha>.png`、没有 `.tmp` 残留；残留的 `.tmp` 不影响下一次写入；相同内容只写一次；内容不同就是不同的文件。
- **框选区域：** 4×4 和 10000×10000 两个边界、四舍五入正好到边界的值、负零；3、3.49、10001、10000.5、负数、Infinity、缺字段、字符串、bigint、布尔、数组、非对象都被拒绝。
- **`chat:start`：** 用 spy 拦截发给 FakeProvider 的消息，断言每条只有 `role` 和 `content`。images、name、tool_calls、image_url、`__proto__` 都被去掉；OpenAI 格式的 content parts 不会原样传过去；未知 role 变成 user；null 或非对象的条目不会崩溃；非数组被拒绝。
- **看图拦截：** `assertVisionAllowed` 的四种组合和错误 code；模型不支持看图时，即使截图不存在，报的也是“当前模型不支持图片”（说明没有先读文件），不会调用模型，也不会创建对话；支持看图时，图片只附在最后一条用户消息上。
- **`window:*`：** 白名单仍是那三个动作；没有新增 `window:*` 通道。

## 发现的 bug（未修，标 `it.fails`，已确认会失败）
1. `apps/desktop/src/main/capture.ts:59-60`：`readCapture` 会跟随软链接，可以读出工作区外的任意文件并发给模型。
2. `apps/desktop/src/main/capture.ts:48-52`：`writeCapture` 在 `.point/captures` 是软链接时，会写到工作区外。

小问题（没有标 `it.fails`）：`<sha>.png` 是目录时，报的是原始 `EISDIR` 错误。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建（仅测试与记录）

## 版本号
不升版本。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过
- [x] `pnpm test` 通过（core 143；main 414 通过、4 跳过，都是已有 `open-extra` 里由平台条件控制的用例）
- [ ] `pnpm e2e` 通过 —— 没跑，本 PR 不改 e2e
- [ ] Windows 和 macOS 上的 CI 全绿 —— 推送后等 CI，结果以 PR 页面上的 checks 为准
- [ ] 在应用里实际走过受影响的流程 —— 不适用

## 检查项
- [ ] UI 改动附了改前改后截图 —— 无
- [ ] 数据库表结构变化附了迁移脚本和迁移测试 —— 无
- [ ] 打包布局、依赖、安全相关变化 —— 无（测试覆盖了 IPC 和路径的安全边界）
- [x] AI 声明：测试和记录由测试员 bot 生成，已在本地 Linux 上运行验证
