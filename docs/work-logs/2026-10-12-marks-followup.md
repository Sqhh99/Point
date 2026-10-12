# 工作日志：④ 标记跟进修复（2026-10-12）

- 在单独的 worktree 里从 origin/main 拉出 `fix/marks-followup`，后来又合入了 main 的最新提交 f2204b0（包含 #41），用的是普通合并，不 rebase。
- 一开始按需求把区域锚点改成了 `{ sha, page, rect }`。后来收到指示，要保留现在的结构（#41 的测试是按 sha、page 和宽高写的），就回退了这部分。确认现在的锚点里没有路径字段。
- 根因：tasks-ipc 会把空串 docId 原样传下去，loadBatch 里又用 `docId && …` 短路，结果「没有 docId」就等于「不检查标记属于哪个文档」。两处都改了。
- `::selection` 测试一开始是被我自己写的一条 CSS 注释触发的，改了注释的措辞。
- 结果：lint、typecheck 退出码 0；core 143 项；main 620 项通过、4 项跳过；build 通过；e2e 13 项通过、1 项跳过。
