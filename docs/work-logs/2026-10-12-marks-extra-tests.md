# 工作日志：为 ④ 标记与一起问（#40）补测试

- **日期：** 2026-10-12
- **分支：** `test/marks-extra`（从 `main` 的 `5b43d8c` 拉出；#40 已 squash 合入）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-marks-extra-tests.md)

## 1. 请求
给 ④ 补单元测试和集成测试，覆盖这些方面：
- 迁移 003 可以重复执行，并且排在 001、002 之后；
- 每个数据库连接都开启了外键检查（foreign_keys）；
- 删除文档时级联删除它的标记；删除标记时不删除截图文件；
- 标记位置（anchor）的校验；core 和 main 的 `isCaptureSha` 行为一致；
- 一起问：按勾选顺序组织内容、最多 20 个、不接受其他文档的标记、区域标记要校验 sha、模型不支持看图时返回 no_vision。

已知 bug：`loadBatch` 在 docId 为空时不检查标记属于哪个文档，写成 `it.fails`。

根据 fix/marks-followup 的计划（RegionAnchor 只存 sha、page 和 rect），区域标记的往返测试只断言 sha 和 page，并新增一条：存进数据库的 anchor_json 里不能有 path 或 imagePath。

## 2. 计划
1. 读 `packages/core/src/marks/index.ts`、`003_marks.ts`、`marks-ipc.ts`、`tasks-ipc.ts` 和已有的 `marks.test.ts`。
2. 新增 `apps/desktop/test/main/marks-extra.test.ts`，临时目录统一用 `realpathSync.native`。
3. `it.fails` 临时改回 `it` 确认它确实失败。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/test/main/marks-extra.test.ts` | 新增 74 个用例（2 个 `it.fails`，是同一个 bug 的两种输入） | 见上 |
| 本日志与 PR 记录 | 新增 | project-records |

## 4. 验证
- 本地 Linux：`pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 通过：core 143；main 617，其中 613 通过、4 跳过（都是已有 `open-extra` 里由平台条件控制的用例）。本 PR 的文件 74 个全部通过，没有跳过。
- `it.fails` 临时改回 `it` 跑过：docId 为 `""` 和不传 docId 两种情况都报 `promise resolved … instead of rejecting`，确实失败。
- 当前代码的 RegionAnchor 本来就不存路径（只有 kind、sha、width、height、blockId、page），所以“anchor_json 里没有 path/imagePath”是普通 `it`，并且现在就通过。
- 写测试时发现：better-sqlite3 默认就开启 foreign_keys。所以“关掉外键时不会级联删除”这条测试要显式执行 `foreign_keys = OFF`，用来证明这个设置确实影响结果。

## 5. 发现的 bug（未修）
1. **一起问时 docId 为空或不传，就不检查标记属于哪个文档：**
   - `apps/desktop/src/main/marks-ipc.ts:38` 只在 `docId` 有值时才比对 `m.docId !== docId`。
   - `apps/desktop/src/main/tasks-ipc.ts:26` 的 `validate` 把 docId 原样传下去，`""` 也可以。
   - 结果是来自不同文档的标记可以放进同一个问题。
   - 建议：传了 `marks` 就必须同时传合法的 docId；或者不靠 docId，直接要求所有标记属于同一个文档。

## 6. 附记：#35 的最后一次 CI
- #35（`test/viewer-extra`）合入 `9615c0f` 后的 run 38281429267：Windows、macOS 两个平台的 check、e2e、package 都通过。
  - check (windows-latest)：core 138；main 266 通过、3 跳过（只在 POSIX 上跑的用例）。
  - check (macos-latest)：core 138；main 267 通过、2 跳过（只在 win32 上跑的用例）。
  - e2e 两个平台都是 12 passed。
- #35 的工作日志写完时这次 run 还没跑完，所以补记在这里。
