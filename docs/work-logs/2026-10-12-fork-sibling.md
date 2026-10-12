# 工作日志：fix/fork-sibling（2026-10-12）

- 从 origin/main b7ff2a4 拉出，已包含 #44 和 #45。
- 任务里写的是 `conversations:send`，但项目里没有这个 IPC，发送统一走 `tasks:run`，所以 `siblingOf` 加在 TaskRequest 上。
- 只复制分支来源还不够：core 原来的 `siblingsOf` 对带分支来源的问题只返回它自己，改问后仍然不会显示 2/2。所以把它改成按「同一个来源回答、同样的 start、end、quote」把这些问题归为平级。
- 测试员的 `it.fails` 用的是旧接口 `parentId: bq.parentId`，转正时改成 `siblingOf: bq.id`。这正是这次修复要求的新接口，期望的结果没有变。
- 已知问题：同一段文字下有多条改问时，「⑂ n 个分支」chip 会把它们分别计数，没有合并。
- 结果：lint、typecheck 退出码 0；core 149 项；main 646 项通过、14 项跳过；build 通过；e2e 14 项通过、1 项跳过。
