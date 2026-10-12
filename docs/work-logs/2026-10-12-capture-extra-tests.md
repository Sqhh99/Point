# 工作日志：为 #36（③ 区域截图、多模态、状态栏）补测试

- **日期：** 2026-10-12
- **分支：** `test/capture-extra`（从 `feat/capture` 的 `468d0c7` 拉出，#36 未合）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-capture-extra-tests.md)、[#36 工作日志](./2026-10-12-capture.md)

## 1. 请求
给 #36 补测试：截图 sha 校验、截图路径不能逃出工作区、写入是否原子、框选区域的边界、`chat:start` 只转发 role 和 content、`capabilities.vision` 拦截、`window:*` 白名单不变。只加测试。

## 2. 计划
1. 读 `capture.ts`、`vision.ts`、`ipc.ts`（chat:start）、`tasks-ipc.ts` 和已有的 `capture.test.ts`。
2. 新增 `apps/desktop/test/main/capture-extra.test.ts`。
3. 真实 bug 标 `it.fails`，再临时改回 `it` 确认它确实因为这个 bug 失败。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/test/main/capture-extra.test.ts` | 新增 98 个用例（2 个 `it.fails`） | 见上 |
| 本日志与 PR 记录 | 新增 | project-records |

## 4. 验证
- 本地 Linux：`pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 通过：core 143；main 418，其中 414 通过、4 跳过。4 个跳过都是已有 `open-extra` 里由平台条件控制的用例，本 PR 的文件没有跳过。
- 2 条 `it.fails` 临时改回 `it` 跑过，确实失败：
  - 软链接读取：`expected [Function] to throw an error`
  - 软链接写入：`expected false to be true`
- 软链接相关的 2 条用 `it.runIf(canSymlink)`：不能建软链接的环境才会跳过。Windows CI 之前跑过软链接用例，能建。
- 原子写入：ESM 下拦截不到 `node:fs` 的调用，所以没有直接断言“先写 .tmp 再 rename”，只验证结果：写完后只剩 `<sha>.png`、没有 `.tmp` 残留；上次崩溃留下的 `.tmp` 不影响下一次写入；相同内容重复写不产生第二个文件。

## 5. 发现的 bug（未修）
1. **读取截图会跟随软链接**（`apps/desktop/src/main/capture.ts:59-60`，`readCapture` 的 `existsSync(file)` / `readFileSync(file)`）：如果 `.point/captures/<sha>.png` 是指向工作区外的软链接，就会读出任意文件，并当作截图 base64 发给模型。工作区是用户自己的文件夹，可能来自同步盘或 git 仓库。建议用 `lstat` 拒绝非普通文件，或者校验 `realpath` 仍在 `<root>/.point/captures` 里面。
2. **写入截图会写到软链接指向的地方**（`capture.ts:48-52`，`writeCapture` 的 `mkdirSync` / `writeFileSync` / `renameSync`）：如果 `.point/captures` 是指向别处的软链接，PNG 会写到工作区外。修法同上。
3. 小问题：如果有一个目录叫 `<sha>.png`，`writeCapture` 看到 `existsSync` 为真就直接返回这个 sha，`readCapture` 再读时抛出原始的 `EISDIR` 错误，不是中文提示。不会越界，没有标 `it.fails`，只用测试记录了当前行为。

## 6. 没覆盖的
- renderer 里的框选交互（`Capture.tsx`）、状态栏 UI：没有 renderer 单测环境。`dragRect` 已有 #36 自带的测试。
- `capturePage` 真正截出来的像素：要在 e2e 里验证，本 PR 不改 e2e。
