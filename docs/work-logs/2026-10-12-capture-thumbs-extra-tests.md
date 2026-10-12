# 工作日志：为 #38（截图缩略图与 point-capture:// 协议）补测试

- **日期：** 2026-10-12
- **分支：** `test/capture-thumbs-extra`（从 `feat/capture-thumbs` 的 `baa683d` 拉出，#38 未合）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-capture-thumbs-extra-tests.md)、[#38 工作日志](./2026-10-12-capture-thumbs.md)

## 1. 请求
给 #38 的 `point-capture://` 处理函数补测试：合法 sha 返回 200 和正确的响应头；各种非法 URL、非 GET 请求、软链接、目录、文件不存在、没有工作区时都返回 404；按 webContents 确定工作区；CSP 的 img-src 包含 point-capture:，且不含 data: 和 file:。

## 2. 计划
1. 读 `capture.ts` 新增的协议代码、`index.html` 的 CSP、已有的 `capture-protocol.test.ts`。
2. 新增 `apps/desktop/test/main/capture-protocol-extra.test.ts`。
3. 大写 sha：Chromium 会把标准 scheme 的 host 转成小写，所以只在单元测试里构造 `Request` 直接调用处理函数，断言返回 404。没有写 e2e。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/test/main/capture-protocol-extra.test.ts` | 新增 58 个用例（1 个 `it.fails`） | 见上 |
| 本日志与 PR 记录 | 新增 | project-records |

## 4. 验证
- 本地 Linux：`pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 通过：core 143；main 406 通过、4 跳过（都是已有 `open-extra` 里由平台条件控制的用例）。本 PR 的文件 58 个全部通过（含 1 个 `it.fails`），没有跳过。
- `it.fails` 临时改回 `it` 跑过，确实失败：`expected 200 to be 404`。
- 软链接相关用例用 `it.runIf(canSymlink)`：只有不能建软链接时才跳过。#38 自带的测试在 Windows 上用 `skipIf` 跳过了软链接用例；本 PR 改为按实际能力判断。

## 5. 发现的 bug（未修）
1. **截图目录是软链接时仍然会返回文件**（`apps/desktop/src/main/capture.ts` 的 `captureResponse`：只对最终文件做 `lstatSync(file)`）：如果 `.point/captures`（或 `.point`）是指向别处的软链接，那里的普通文件会以 200 返回。建议校验 `realpath(file)` 仍在 `realpath(<root>)/.point/captures` 里面。和 #37 报的 `readCapture` / `writeCapture` 跟随软链接是同一类问题。

## 6. 设计限制（不是 bug，没有标 it.fails）
- 协议请求里没有发起请求的 webContents，处理函数取的是同一 session 上第一个仍然存活的已绑定窗口。现在全局只有一个工作区，所以不会读错；如果以后每个窗口有自己的工作区，同一 session 上的窗口 A 和 B 无法区分。已测：不同 session 的未绑定窗口拿不到处理函数；同一 session 上 A 被销毁后 B 仍然可用；两个都销毁后返回 404。
