# PR：test: 补 #27 标题栏窗口操作白名单测试

- **日期：** 2026-10-12 / **分支：** `test/titlebar-layout-extra` → `feat/titlebar-layout` / **基线 commit：** `aba794c` / **相关记录：** [工作日志](../work-logs/2026-10-12-titlebar-layout-extra-tests.md)

## 关联
Related to #27

## 改了什么
新增 `apps/desktop/test/main/window-ipc-extra.test.ts`（40 个用例），通过真实注册的 `window:action` handler 测试：
- 非法输入全部拒绝且不碰窗口：空串、大小写错误、`maximize`/`destroy`/`setBounds`、`__proto__`/`constructor`/`toString`/`hasOwnProperty`/`valueOf`、前后空白和 `\0`、数字/NaN/布尔/对象/null/undefined/数组/带 toString 的对象/Symbol/String 对象、缺参。
- 三个合法动作只调用对应方法（toggleMaximize 两个方向）。
- 发送方没有窗口时 reject「窗口不存在」；窗口已销毁时 reject 而不是未捕获异常；`watchMaximized` 在 webContents 销毁后不再发送。
- macOS `hiddenInset` + 红绿灯位置、不设 frame；win32/linux 仅 `{ frame: false }`。

**未覆盖：** 对话面板宽度 clamp 与 `⌘\\`/`Ctrl+\\` 折叠——逻辑在 `App.tsx` 组件内，renderer 无单测环境，不改产品代码测不到。读代码发现持久化宽度读取时未 clamp（见工作日志），未修。没有 `it.fails`：主进程侧没发现 bug。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建（仅测试与记录）

## 版本号
不升版本。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过
- [x] `pnpm test` 通过（core + main）
- [ ] `pnpm e2e` 通过 —— 未跑，本 PR 不改 e2e 与产品代码
- [ ] Windows 和 macOS 上的 CI 全绿 —— 推送后待 CI
- [ ] 在应用里实际走过受影响的流程 —— 不适用，仅测试

## 检查项
- [ ] UI 改动附了改前改后截图 —— 无 UI 改动
- [ ] 数据库表结构变化附了迁移脚本和迁移测试 —— 无
- [ ] 打包布局、依赖、安全相关变化 —— 无
- [x] AI 声明：测试与记录由测试员 bot 生成，已在本地运行验证
