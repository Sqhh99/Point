# 工作日志：分支对话的数据存储（⑤）

- **日期：** 2026-10-12
- **分支：** `feat/branch-storage`（从 `main` 的 `282b7ac` 拉出）
- **执行者：** 功能实现
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-branch-storage.md)

## 1. 请求
> 需要单独的对话面板。对模型的回答可以再选中一段继续追问，这时候派生出一个分支对话：主对话可以有很多分支，分支也可以再派生子分支，对话记录保存在本地。

这一项只做存储和纯函数，不做界面（界面在 ⑥）。表结构按架构设计师在群里定的 `002`。

## 2. 计划
1. 写 `002_branches`：`messages` 加 `parent_id`（可空，带索引）和 `parts_json`；旧消息在同一段对话里按 `created_at` 加 `id` 串成一条链；新建 `branch_origin` 表。
2. 在 `core/conversations/tree.ts` 写纯函数：从根到当前节点的路径、主线末端、面包屑、分支树、分支数，还有 span 校验和按 `quote` 重新定位。
3. main 进程的 `conversations.ts` 加 `createBranch`、`threadOf`、`getTree`、`getOrigins`。`historyFor` 和 `dropTrailingAssistant` 改成只走当前线程，现有调用不传 leaf 时走主线，行为和原来一样。
4. 写单元测试和集成测试。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|---|---|---|
| `packages/core/src/db/migrations/002_branches.ts` | 新迁移 | 对话树要能存在本地，旧对话要能升级上来 |
| `packages/core/src/db/migrate.ts` | 把 `002` 加进 `MIGRATIONS` | 同上 |
| `packages/core/src/conversations/tree.ts` | 新的纯函数 | 上下文只走当前分支；面包屑和分支树 |
| `packages/core/src/index.ts` | 导出 | |
| `apps/desktop/src/main/conversations.ts` | 新增分支相关的读写接口，`addMessage` 支持 `parentId` | 分支和子分支 |
| `apps/desktop/src/shared/ipc.ts` | `StoredMessage` 加 `parentId` | 渲染进程以后要用它画树 |
| `packages/core/test/tree.test.ts`、`apps/desktop/test/main/branches.test.ts` | 新测试 | 存储必须带测试（PR评审员 的门禁） |
| `apps/desktop/test/main/migrate*.test.ts` | 表名期望里补上 `branch_origin`；失败迁移用例改用新列名，避免和 `002` 撞名 | 迁移已经到 v2 |

## 4. 验证
- `pnpm test`：core 91 个、main 50 个，全部通过。
- `pnpm typecheck`、`pnpm lint`：通过。
- 两个平台的 CI：开 PR 之后才跑，结果写在 PR 里。
- 没有在真实界面上跑过，因为这个 PR 没有界面。

## 5. 遗留事项
- 还没有接 IPC 和界面，⑥ 再接。
- `parts_json` 列已经建好，但还没人写它，等 ③ 截图功能来写。
- 重新生成一条回答时，会删掉旧回答，从它派生出的分支也会跟着级联删除。⑥ 做界面时要先提示用户，或者改成保留旧回答。

## 评审后修复

- 迁移 `002` 在时间戳相同时改按 `rowid` 排序，与 v0.1.0 的显示顺序（`created_at, rowid`）一致；此前按随机 UUID `id` 排序会打乱同一毫秒内的轮次。
- `spanMatches` 拒绝起点或终点落在代理对中间的范围，避免把半个 emoji 存成引用。
- `branches-extra.test.ts` 中对应的两处 `it.fails` 改回 `it`；“重新生成删除派生分支”仍保留 `it.fails`，留到 ⑥。
