# 工作日志：fix/branch-count（2026-10-12）

- 从 origin/main b1bb5a0 拉出。开 PR 前确认过，测试员针对这个问题的测试 PR 还没有合入，所以测试是自己补的。
- 新增 `groupBySpan`，键为 [来源回答, start, end, quote]，这是判断「同一段文字」的唯一定义。`siblingsOf`、`branchesFrom`（chip）和 `branchCounts` 都调用它。
- `branchesFrom` 的返回类型从 `BranchOrigin[]` 改成了 `SpanGroup[]`。唯一的调用方是 AIPanel，已同步修改：每段文字一个菜单项，点击后进入这段文字下最新的一次提问。
- 结果：lint、typecheck 退出码 0；core 151 项；main 646 项通过、14 项跳过；build 通过；e2e 14 项通过、1 项跳过。
