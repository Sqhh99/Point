# PR：test: 补 layout.ts 宽度与快捷键的边界测试

- **日期：** 2026-10-12 / **分支：** `test/layout-extra` → `feat/titlebar-layout` / **基线 commit：** `4160f2e` / **相关记录：** [工作日志](../work-logs/2026-10-12-layout-extra-tests.md)

## 关联
Related to #27

## 改了什么
新增 `apps/desktop/test/main/layout-extra.test.ts`（54 个用例），补 `layout.test.ts` 的缺口：
- `clampChatWidth`：319/320/321、639/640/641、边界小数（319.9、320.4、639.6、640.1）、0/-0、±Infinity；字符串 `"319"`/`"641"`、前后空白、`"1e3"`、`"4.5e2"`、`"0x200"`；纯空白、`"Infinity"`、`"500px"`、`"NaN"`、布尔、数组、Symbol、BigInt 回落到默认值；250–700 区间扫描，结果都是范围内整数；按存储的字符串读回时结果不变。
- `isToggleLibraryKey`：⌘ 和 Ctrl 都接受（同时按也接受）；带 Shift/Alt 的组合、只按 Shift/Alt、`|`、`Backslash`、`Dead`、`Unidentified`、空 key、其他键都拒绝。
- **`it.fails`（真实 bug，未修）：** 按住快捷键时会收到自动重复的 keydown，`isToggleLibraryKey` 不检查 `e.repeat`，左栏会反复开合。已临时改回 `it` 确认它因 `expected true to be false` 失败。

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
- [ ] `pnpm e2e` 通过 —— 未跑，本 PR 不改 e2e 和产品代码
- [ ] Windows 和 macOS 上的 CI 全绿 —— 推送后等 CI
- [ ] 在应用里实际走过受影响的流程 —— 不适用，只加测试

## 检查项
- [ ] UI 改动附了改前改后截图 —— 无 UI 改动
- [ ] 数据库表结构变化附了迁移脚本和迁移测试 —— 无
- [ ] 打包布局、依赖、安全相关变化 —— 无
- [x] AI 声明：测试和记录由测试员 bot 生成，已在本地运行验证
