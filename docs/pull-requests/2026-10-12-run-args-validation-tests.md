# 测试：tasks:run 参数类型校验（parentId / siblingOf）与 groupBySpan

日期：2026-10-12　分支：`test/run-args-validation` → `main`　基线：`a52febb`（包含 #48 413e936）
相关记录：`docs/work-logs/2026-10-12-run-args-validation-tests.md`、#47

## 关联
- #48：`tasks:run` 先做类型校验；新增共享的 `groupBySpan`。
- #47 的两条 `it.fails` 已经被 #48 改成普通 `it`，现在都通过：
  - `fork-sibling-extra.test.ts:93`（没有对话时，畸形的 siblingOf 被拒绝）。
  - `fork-sibling-extra.test.ts:245`（「⑂ 2 个分支」）。

## 改了什么
- 新增 `apps/desktop/test/main/run-args-validation.test.ts`，共 42 个用例。
  - 每个拒绝用例都对比了 messages、branch_origin、conversations 三张表的行数，确认一行都没有写入。
- **parentId**：
  - 以下值不论带不带 `conversationId`，都报「无效的 parentId」：数字、0、空串、false、true、对象、数组、65 个字符的字符串。
  - `null` 会新增一条首问。合法的 id 会接在对应消息下面。不传或传 `undefined` 时，等同于没有这个字段。
- **siblingOf**：
  - `null` 和上面那些畸形值，不论带不带 `conversationId`，都报「无效的 siblingOf」。
  - 格式合法但没有对话时，报「对话不存在」，什么都不写。
  - 合法的 siblingOf 会被接受。
- **groupBySpan**（通过公开的 `branchCounts`、`branchesFrom`、`siblingsOf` 验证）：
  - 同一段文字的多次改问合并成一组，三个函数给出的结果一致。
  - source、start、end、quote 任意一项不同，都分成不同的组。
  - id 或 quote 里含分隔符或引号，或者数字拼接后看起来一样，分组键都不会冲突。
  - 输入为空、来源未知时，结果为 0。

## 发现的问题
- 无。

## 改动类型
- [x] 仅测试、文档、CI 或构建

## 版本号
- 不升版本

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`：core 151 项通过；main 711 项通过、14 项跳过（Linux 本地；跳过的是原有用例，以及只在 Windows 上运行的联接用例）。

## 检查项
- 没有改产品代码、版本号和 workflow。

## AI 声明
- 测试和本文档由 AI（测试员）编写。
