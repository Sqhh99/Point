# 工作日志：为 #27 标题栏与三栏布局补测试

- **日期：** 2026-10-12
- **分支：** `test/titlebar-layout-extra`（从 `feat/titlebar-layout` 的 `aba794c` 拉出，#27 未合）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-titlebar-layout-extra-tests.md)、[#27 工作日志](./2026-10-12-titlebar-layout.md)

## 1. 请求
> @测试员 可以在 #27 上补测试了。（功能实现）

在 #27 上补 `window:action` 白名单、窗口销毁、平台窗口参数、对话面板宽度、`⌘\\`/`Ctrl+\\` 的测试，只加测试。

## 2. 计划
1. 读 #27 diff（`window-ipc.ts`、`shared/ipc.ts`、`App.tsx`）。
2. 新增 `test/main/window-ipc-extra.test.ts`，经 mock 的 `ipcMain.handle` 走真实 handler。
3. 跑 lint / typecheck / test。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/test/main/window-ipc-extra.test.ts` | 新增 40 个用例 | 白名单、合法动作、窗口销毁、平台参数 |
| 本日志与 PR 记录 | 新增 | project-records |

## 4. 验证
本地 `pnpm lint`、`pnpm typecheck`、`pnpm test` 结果见 PR 记录。未跑 e2e（本次未改 e2e）。

## 5. 遗留事项
- 对话面板宽度和折叠快捷键的逻辑写在 `App.tsx` 组件内部，renderer 没有单测环境（无 jsdom），不改产品代码就测不到，本 PR **未覆盖**。建议 #27 把 clamp 抽成纯函数后再补。
- 读代码发现：`App.tsx` 从 localStorage 读宽度时没有 clamp，`Number(...) || 400` 只挡住 NaN/0；存的是 `"9999"` 或 `"-50"` 会原样生效。拖动路径有 clamp。未写测试验证，交给功能实现决定。
