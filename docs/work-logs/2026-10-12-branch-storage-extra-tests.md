# 工作日志：分支对话存储的补充测试

- **日期：** 2026-10-12
- **分支：** `test/branch-storage-extra`（从 #23 的 `feat/branch-storage` `f72da51` 拉出）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-branch-storage-extra-tests.md)

## 1. 请求
> @测试员 可以在这个分支上补你列的那几类测试了。（功能实现，#23）

在 #23 已有测试之外，补上不重复的用例：真实 v0.1.0 库迁移、深层分支、同一回答多分支、非法 span、从用户消息派生、关闭重开持久化、重新生成保留分支（已知限制）。

## 2. 计划
1. 读 #23 的 `branches.test.ts`、`migrate-fixture.test.ts`、`tree.test.ts`，列出已覆盖的情况。
2. 新增 `apps/desktop/test/main/branches-extra.test.ts`，只写没覆盖的。
3. 对测出的问题用 `it.fails` 记录，不改产品代码。
4. 本地跑 lint、typecheck、test。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/test/main/branches-extra.test.ts` | 新增 17 个用例（其中 4 个 `it.fails`） | 补测分支对话存储 |
| `docs/work-logs/2026-10-12-branch-storage-extra-tests.md` | 本文件 | project-records |
| `docs/pull-requests/2026-10-12-branch-storage-extra-tests.md` | PR 记录 | project-records |

没有改产品代码，没有改版本号。

## 4. 验证
- `pnpm lint` 通过，`pnpm typecheck` 通过。
- `pnpm test`：core 91 个、main 67 个全过（main 原 50 个，新增 17 个）。
- 把 4 个 `it.fails` 临时改成普通 `it` 跑过一次，确认它们失败的原因就是下面描述的问题，而不是测试写错。
- 没跑 `pnpm e2e`：本次只加了 main 进程的集成测试，没碰界面。

## 5. 测出的问题（只记录，不修）
1. **迁移 002 的同毫秒排序和 v0.1.0 不一致。** v0.1.0 显示消息用 `ORDER BY created_at, rowid`；002 遇到 `created_at` 相同时按 `id`（随机 UUID）排。真实 fixture 里那段 6 条消息的对话有 5 条在同一毫秒写入，迁移后的主线顺序被打乱，发给模型的上下文顺序也会错。#23 里 `migrate.test.ts` 的合成用例恰好断言了按 `id` 排，所以没发现。
2. **span 可以切开代理对。** `spanMatches` 只比较 `slice` 是否等于 `quote`，如果 `quote` 本身就是被切出的半个 emoji（孤立代理），会被接受，存下一个坏掉的引用。
3. **重新生成会删掉派生分支**（#23 已知限制，⑥ 处理）。

## 6. 遗留事项
- 修复后把对应的 `it.fails` 改回 `it`。
