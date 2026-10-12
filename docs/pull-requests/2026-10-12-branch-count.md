# fix: 「⑂ n 个分支」只数不同的文字段，改问不重复计数（0.1.2 补丁）

版本：不改版本号，不打 tag。基于 main（b1bb5a0，已包含 #46），之后又合入了 main 7bae92a（包含 #47 fork-sibling-extra.test.ts）。没有改表结构，也没有新增 IPC。

## 问题
#46 之后，从同一段文字改问时，新问题会复制原问题的分支来源。回答末尾的「⑂ n 个分支」chip 原来按分支来源的条数计数，所以同一段文字上的每次改问都会多算一个分支，下拉菜单里也会出现重复项。

## 修复（按架构设计师的方案）
- **core 新增唯一的分组函数 `groupBySpan(origins)`**：「同一段文字」的判断标准只有这一处：来源回答、start、end、quote 四项都相同。返回结果按每组第一次出现的顺序排列。
- **两处都调用它**：
  - `siblingsOf`：判断追问分支里的问题之间是否平级。原来的四字段比较已删掉，改为调用 `groupBySpan`。
  - `branchesFrom`：给 chip 用，现在返回按文字段分组的结果。`length` 就是 chip 上显示的数字，同一段文字下的多次改问只算一次。
  - 另外，`branchCounts` 也改成按不同文字段计数，和 chip 保持一致。
- **渲染进程**：chip 的数字和下拉菜单都直接用 `branchesFrom` 的结果，每段文字只显示一项，点击后进入这段文字下最新的一次提问，其他几次改问用「‹ n/m ›」切换。渲染进程里没有任何自己的比较逻辑。

## 同一个 PR 里的其他修改
- **tasks:run 入口的类型校验**（tasks-ipc.ts:49 和 :72 的 bug）：原来不是字符串的 `siblingOf` 会被转成空串，而没有对话时只检查它是否为真，所以格式不对的 `siblingOf` 会被直接忽略，照样新建对话和消息。现在请求进来时先校验类型：
  - 只要请求里有 `siblingOf` 这个键，它就必须是非空字符串（不超过 64 个字符），null 也会被拒绝。
  - `parentId` 规则相同，但允许 null（表示新的第一条问题）。数字、空串、false、数组都会被拒绝。
  - 不再先转成空串再判断真假。有没有 conversationId 都一样校验。被拒绝时什么都不写。
- **界面**（UI 设计师）：
  - 左栏「一起问（n）」按钮原来会被面板底部裁掉，现在下方留 12px 边距，按钮区不再被压缩，文字垂直居中。
  - 「⑂ n 个分支」里的 ⑂ 原来依赖字体，Linux 默认字体没有这个字，会显示成方框。现在换成内联 SVG 图标（`IconBranch`），项目里只有这一处用到 ⑂。

## 截图
![SVG 分支图标的 chip 和留出底部边距的「一起问」按钮](https://raw.githubusercontent.com/Sqhh99/Point/7d4dd86be3f599884875a2bcc2a4c92bf3708326/docs/assets/pr/2026-10-12-branch-count.png)

## 测试
- #47 `fork-sibling-extra.test.ts` 里两条 `it.fails` 改成了普通 `it`：同一段文字问了 3 次、另有一段文字时，chip 显示 2 个分支；格式不对的 `siblingOf` 在没有对话时也会被拒绝，且什么都不写。
- 新增 tasks:run 入口校验的测试：`siblingOf` 为数字、空串、null、对象或过长，`parentId` 为 0、空串、false 或数组时，不论有没有 conversationId 都会被拒绝，且什么都不写；`parentId: null` 仍然可以用。
- e2e：chip 显示「1 个分支」并带 SVG 图标；「一起问」按钮距离标记区底部至少 12px，高度至少 28px，内容没有溢出。
- core `tree.test.ts` 新增：
  - 同一段文字问了 3 次只算 1 个；start、quote 或来源回答任一不同，都算不同的文字段。
  - 分组内部按输入顺序排列。
  - `branchCounts` 和 `branchesFrom` 的计数一致。
  - 对每个分组里的每个问题检查：`siblingsOf` 返回的结果和 `groupBySpan` 的分组完全相同。
- lint、typecheck 退出码都是 0。core 151 项通过；main 669 项通过、14 项跳过（其中 10 项是只在 Windows 上跑的 junction 用例）；build 通过；e2e 14 项通过、1 项跳过。
