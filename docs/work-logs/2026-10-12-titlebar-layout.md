# 工作日志：① 自定义标题栏和三栏布局

- **日期：** 2026-10-12 / **作者：** 功能实现 / **PR：** [记录](../pull-requests/2026-10-12-titlebar-layout.md)

## 做了什么
- 新增 `main/window-ipc.ts`：`titleBarOptions(platform)` 按平台给窗口参数，`applyWindowAction` 只执行白名单动作，`watchMaximized` 推送最大化状态。
- `shared/ipc.ts` 新增 `WINDOW_ACTIONS` 和 `isWindowAction`；preload 暴露 `window.action` 和 `window.onMaximized`。
- 新增 `renderer/TitleBar.tsx`，`App.tsx` 外层改成标题栏加三栏，对话面板可拖动调宽，`⌘\` 收起左栏。

## 决定
- 白名单校验放在 main 里，renderer 传什么都不信；动作表用 `Record<WindowAction, …>`，加新动作时类型会强制补实现。
- 状态栏推迟到 ③，因为它要显示的“是否支持看图”在 ③ 才有。

## 验证
lint、typecheck 通过；core 91、main 77 个测试通过；Linux 下 e2e 10 过 1 跳过，截图见 PR 记录。

## 评审后修复
- 启动时读出的对话面板宽度先限制到 320–640px，非数字回退到 400。
- 宽度限制和收起左栏快捷键抽成 `renderer/layout.ts` 里的纯函数 `clampChatWidth`、`isToggleLibraryKey`，加了 `layout.test.ts`。
- 按 UI设计员 定的规则：`isToggleLibraryKey(e, platform)` 在 macOS 只认 `⌘\`，其他平台只认 `Ctrl+\`，按住不放（`e.repeat`）不触发。
- `clampChatWidth` 只接受十进制数字，`"0x200"` 这类十六进制、二进制、八进制写法视为无效，回到 400px。
