# 工作日志：为 #27 的 layout.ts 补边界测试

- **日期：** 2026-10-12
- **分支：** `test/layout-extra`（从 `feat/titlebar-layout` 的 `4160f2e` 拉出，#27 未合）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-layout-extra-tests.md)、[#27 工作日志](./2026-10-12-titlebar-layout.md)、[上一轮测试日志](./2026-10-12-titlebar-layout-extra-tests.md)

## 1. 请求
功能实现在 `4160f2e` 抽出 `renderer/layout.ts`（`clampChatWidth`、`isToggleLibraryKey`）和 `layout.test.ts`。审查测试缺口，有实质缺口才补，不阻塞 #27。

## 2. 计划
1. 读 `layout.ts`、`layout.test.ts`、`App.tsx` 的调用处。
2. 列缺口：319/641、边界小数、-Infinity、空白字符串、`1e3`/`0x200`、组合修饰键、非 `\\` 键、自动重复事件。
3. 新增 `test/main/layout-extra.test.ts`，真实 bug 标 `it.fails`，并改回 `it` 确认它确实因 bug 失败。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/test/main/layout-extra.test.ts` | 新增 54 个用例（1 个 `it.fails`） | 补宽度和快捷键的边界 |
| 本日志与 PR 记录 | 新增 | project-records |

## 4. 验证
- 把 `it.fails` 临时改回 `it` 跑过：`AssertionError: expected true to be false`，1 失败 53 通过，失败原因就是下面的 bug。已改回。
- 本地 `pnpm lint`、`pnpm typecheck`、`pnpm test` 结果见 PR 记录。未跑 e2e。

## 5. 遗留事项
- **Bug（未修）：** `isToggleLibraryKey` 不看 `KeyboardEvent.repeat`，`App.tsx` 每次 keydown 都切换左栏。按住 ⌘\\ / Ctrl+\\ 时，系统的自动重复会让左栏反复开合。修法：`e.repeat` 为真时返回 false，修好后把 `it.fails` 改回 `it`。
- 现状记录（不算 bug）：macOS 上 Ctrl+\\、Windows 上 Win+\\（metaKey）也能触发；`"0x200"` 会被当成 512。测试锁定的是当前行为，要改的话由功能实现和 UI设计员决定。
