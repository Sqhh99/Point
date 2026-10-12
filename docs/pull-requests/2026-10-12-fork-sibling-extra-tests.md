# 测试：改问（siblingOf）补充

日期：2026-10-12　分支：`test/fork-sibling-extra` → `main`　基线：`b1bb5a0`（#46）
相关记录：`docs/work-logs/2026-10-12-fork-sibling-extra-tests.md`、`docs/pull-requests/2026-10-12-fork-sibling.md`

## 关联
- #46：「从这里分支」改问时改用 `tasks:run` 的 `siblingOf` 字段。

## 改了什么
- 新增 `apps/desktop/test/main/fork-sibling-extra.test.ts`，共 13 个用例，其中 2 个 `it.fails`。
- **校验**：每个用例都对比了消息数、`branch_origin` 行数和对话数，确认被拒绝的请求一行都没有写入。
  - `siblingOf` 和以下任一字段同时传，都会被拒绝：`parentId`（包括 `null`）、`branch`、`regenerate`。
  - `siblingOf` 指向回答、指向别的对话、是不存在的 id、是畸形值（数字、空串、对象、数组、布尔），都会被拒绝。
- **改问**：
  - 追问分支首问改问：新问题和原问题同一个父消息，`branch_origin` 原样复制（`source_msg_id`、`start`、`end`、`quote` 都相同）。core 的 `siblingsOf` 依次显示 2/2、3/3，面包屑保留在分支里。
  - 用触发器让写入 `branch_origin` 失败：新消息也没有写入，说明两者在同一事务里。
  - 主线问题改问（包括第一问）：不写 `branch_origin`。
  - 嵌套追问分支改问：复制的是内层的来源，面包屑保持嵌套。
  - 上下文隔离：改问后，发给模型的内容只有根 → 新问题这条路径，不含原问题、原问题的回答和主线后续内容。
  - 重新加载工作区后，平级关系和复制的 `branch_origin` 都还在。
- **⑂ 分支数**（按设计师的口径：统计不同的来源段落，分组键是来源回答 id + start + end + quote，和 `siblingsOf` 一致）：
  - 两段不同的文字：计 2。
  - 同一段文字、但 start/end 不同：分开计数，而且不算平级。
  - 不同回答里相同的位置：各自计数。

## 发现的问题（已用 it.fails 标出，均已确认改回 it 后会失败）
1. **⑂ 分支数把改问也算进去了**：`AIPanel.tsx:582` 显示的是 `branchesFrom(...).length`，而 `tree.ts:177` 每个问题都返回一条。
   - 复现：同一段文字被问 3 次，另有一段文字被问 1 次。期望显示 2，实际是 4（`expected 4 to be 2`）。
   - 用例只断言界面看得到的数字，不依赖还不存在的函数名。修好后把 `it.fails` 改成 `it` 即可。
2. **没有对话 id 时，畸形的 siblingOf 被静默忽略**：
   - `tasks-ipc.ts:49` 把非字符串的值变成 `""`；`tasks-ipc.ts:72` 只检查真假值。
   - 结果：`{ siblingOf: 123 }` 不带 `conversationId` 时请求成功，新建了对话和消息（`promise resolved instead of rejecting`）。
   - 带 `conversationId` 时会被正确拒绝。

## 改动类型
- [x] 仅测试、文档、CI 或构建

## 版本号
- 不升版本

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`：core 149 项通过；main 659 项通过、14 项跳过（Linux 本地；跳过的是原有用例，以及只在 Windows 上运行的联接用例）。

## 检查项
- 没有改产品代码、版本号和 workflow。

## AI 声明
- 测试和本文档由 AI（测试员）编写。
