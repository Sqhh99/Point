# PR：test(e2e): capture titlebar at min width for #65 review

- **日期：** 2026-10-21 / **分支：** `test/titlebar-min-width` → `main` / **基线 commit：** `9857aa1` / **相关记录：** 工作日志 [2026-10-21-titlebar-min-width-capture.md](../work-logs/2026-10-21-titlebar-min-width-capture.md)

## 关联
Related to #65（标题栏被裁掉的修复，已合并为 `9857aa1`）。给 UI 设计复核提供 Windows / macOS 上的标题栏截图和数值。

## 改了什么
只加了一个 e2e 用例 `apps/desktop/e2e/titlebar-narrow.spec.ts`，不改产品代码、不改 workflow、不升版本、不动 lockfile。

用例打开一个工作区和一个文件名很长的 PDF，依次把窗口设为：
1. 最小尺寸（读 `BrowserWindow.getMinimumSize()`，当前 900×600）；
2. 1024×700；
3. 最大化。

每种状态：
- 截标题栏和整个窗口：`titlebar-<状态>-<平台>.png`、`window-<状态>-<平台>.png`；
- 测量值写入 `titlebar-<状态>-<平台>.json`：标题栏位置和高度、工作区名和文件名是否被截断、每个按钮的尺寸和是否换行或溢出、窗口按钮相对窗口和屏幕工作区边缘的距离、阅读工具栏是否溢出、`isMaximized`、屏幕工作区；
- 截图和 JSON 用 `testInfo.attach` 附到报告，文件在 `apps/desktop/test-results/<用例目录>/`；
- 每种状态在 CI 日志里打印一行 `TITLEBAR-MEASURE {...}`。

**硬断言**（在 main 上已成立）：标题栏可见、top ≥ 0、bottom ≤ 视口高、高度 36px、标题栏里每个按钮不换行，并且在标题栏和窗口之内。

**只记录、不断言**（main 上不成立，没有跳过任何用例）：
- 最窄宽度和 1024px 下，阅读工具栏溢出（Linux 实测 scrollWidth 368 > clientWidth 241 / 365）；
- 「适合宽度」「框选」换成两行。

这些修好后可以改为硬断言。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建（只加测试和记录）

## 版本号
不升版本（只加测试）。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过（本地，`9857aa1` 加本分支改动）
- [x] `pnpm test` 通过（core 205 项；main 752 项，14 项跳过，与 main 相同）
- [x] `pnpm e2e` 通过：本地 Linux xvfb + throwaway keyring，37 项全部通过，0 跳过
- [ ] Windows 和 macOS 上的 CI 全绿：推送后等待结果，下面补写
- [ ] 在应用里实际走过受影响的流程：没有走，本 PR 不改应用行为

## 检查项
- [ ] UI 改动附了改前改后截图：不适用，没有改 UI
- [ ] 数据库表结构变化附了迁移脚本和迁移测试：不适用
- [ ] 打包布局、依赖、安全相关变化在上面单独说明：不适用，没有这类变化
- [x] AI 声明：用例、工作日志和本记录由测试员 bot 生成。本地在 Linux xvfb 上验证过；Windows 和 macOS 的结果以 CI 为准。

## CI 产物说明（需要 运维发布）
`ci.yml` 的 e2e job 只在失败时上传 `apps/desktop/test-results`（`if: failure()`），绿灯时截图不会成为产物。本 PR 不改 workflow。

需要的一行改动：`.github/workflows/ci.yml` 里 `Upload e2e trace and screenshots on failure` 一步，把 `if: failure()` 改成 `if: always()`（path 保持 `apps/desktop/test-results`）。在那之前，各平台数值从 CI 日志里的 `TITLEBAR-MEASURE` 行读取。

## 没做、没覆盖
- 本地 xvfb 没有窗口管理器，`maximize()` 不生效，最大化状态只能看 CI。
- 没测高 DPI、多显示器，也没测 macOS 全屏（只测了 `maximize()`，即 zoom）。
