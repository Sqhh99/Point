# 工作日志：#81 剩余三项（出条、文末夹取、松手端锚定）

- **日期：** 2026-11-17 至 2026-11-18
- **分支：** `feat/selection-release-end`（从当时 `main` 的 `460d2bd` 拉出，后普通合并 `origin/main` `2a90488` / #85）
- **执行者：** 端到端开发 A
- **相关记录：** [PR 记录](../pull-requests/2026-11-18-selection-release-end.md)

## 1. 请求
继续修复 [#81](https://github.com/Sqhh99/Point/issues/81) 剩余三项：AI 面板 / `.col-resizer` 松手出条；拖过文末选区截断或塌缩；工具条锚定在 Selection focus（松手 / 键盘移动端）。同一修复轮升 `c` 一次。不关 #81 的部分完成，不把 #79 当同根因关闭。本轮暂不远端 push / 开 PR。

## 2. 计划
1. 出条：document 级 `mouseup`（article 内按下才 armed）。
2. 文末夹取：扩大 `keepEndInLayer`，指针不在行盒内时即使焦点仍在 `.pdf-text` 也夹到最后 / 最先可及行。
3. 松手端锚定：按 focus 行定位；先定位键盘用例「等距」失败是判据塌缩还是定位错误，不放宽断言。
4. 合并最新 main（#85），写记录，升到 0.2.4。

## 3. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/src/renderer/Reader.tsx` | 出条：article 内 pointerdown 武装，document mouseup 再 measure。锚定：以焦点行的 span 并集为纵向锚点，水平居中用整段并集；focus 在选区下半时 `preferBelow`。障碍为选区外正文加 focus 内侧真实行。键盘：仅 document `keyup` 触发已有选区的 measure。见第 6–7 节。 | 面板/分隔条松手出条；松手端 / 键盘端锚定 |
| `apps/desktop/src/renderer/viewers/PdfView.tsx` | `keepEndInLayer`：指针不在行上时不再因焦点仍在层内而 return，夹到该方向最后 / 最先可及行的行端。 | 拖过文末 |
| `apps/desktop/src/renderer/layout.ts` | `rectAtCaret`：只合并 mid-Y 同行的碎片。`placeBar` 增加 `preferBelow`（下方槽位优先）。 | 锚定回退路径 |
| `apps/desktop/e2e/fixtures/pdf/long-90-lines.pdf` 等 | 生成并纳入 90 行夹具。 | 文末回归 |
| `apps/desktop/e2e/pdf-embedded-fonts.spec.ts` | 出条、文末、松手端回归。键盘段改为原生 Shift+Right 探测 + programmatic 反向选区加 keyup（组件定位，不声称跨行键盘导航）；oracle 为独立 span 并集，距离断言未放宽。 | 行为测试 |
| `apps/desktop/test/main/marks-followup.test.ts` | `rectAtCaret` 与 `placeBar`/`preferBelow` 单测。 | 单位测试 |
| 根目录 / `packages/core` / `apps/desktop` 的 `package.json` | `0.2.3` → `0.2.4` | 本轮修复升 c |
| 本日志与 PR 记录 | project-records | 记录 |

未提交、也未处理工作区里 6 个无关的 `apps/desktop/build/*` 删除。

## 4. 验证
- 已跑（Linux / Xvfb `DISPLAY=:5`，本机构建的 Electron 32.3.3，`POINT_FAKE_LLM=1`）：
  - `pnpm --filter @point/desktop run typecheck` 通过。
  - `pnpm --filter @point/desktop run test:main`：809 passed，14 skipped（含新增 `rectAtCaret` 用例）。
  - `pnpm --filter @point/desktop run build` 通过。
  - e2e 自包含用例 7/7 通过：逃出 article 夹取、页边单击清选、三击避让、0–8px 矩阵、面板/分隔条松手出条、long-90 拖过文末到 Line 90、上下拖 + 键盘 focus 端锚定。键盘距离断言未放宽。
- 未跑：完整 `pdf-embedded-fonts` 串行文件的前几项中，「选区着色条纹」在本机首次出现 0.011 > 0.005（本轮未改选区绘制；未放宽断言，也未当作本修复验收）。Windows / macOS CI 与真机未在本轮执行，不能报通过。

键盘「等距」结论：旧 oracle/`rectAtCaret` 把整段高大 client rect 并进焦点行，focus 与 other 变成同一盒子，`keyDist === keyToOther === 66.95`，`toBeLessThan` 在判据上不可满足；同时 `.pdf-line` 元素盒不是字形行，三击第一行间隙曾变成约 2px。另外 `Selection.modify("line")` 不能跨视觉 `.pdf-line`。修复后两端可区分，条靠在 focus 行旁。证据：`/workspace/evidence/pr81-selection-release-end/`。

## 5. 遗留事项
- 未 push、未开 PR、未合并、未发布。
- #81 须三项都经验收后再关；#79 Windows 偶发拖选仍单独保留，本轮未修其根因。
- Windows / macOS 必需 CI 需在开 PR 后跑。本机无这两个平台。
- sticky 阅读工具条与 `placeBar` 容器是否要互斥，仍建议在审查时看一眼，本轮未改。

## 6. 后续收窄（移除全局键盘改写）
`8e8ab03` 在 `Reader.tsx` 增加了全局 `Shift+Arrow` `keydown` 改写（`extendPdfLine` 走相邻整行，左右 `modify("character")` 并忽略 Ctrl/Meta）。这超出 #81 松手端定位范围，本轮用新提交移除该改写，只保留 document `keyup` 在已有非折叠选区上调用 `onSelectEnd`，仍按 Selection focus 几何定位。

键盘验收改为：
- 探测原生 `Shift+Right`（行内可用语义）。若选区仍折叠，记为 PDF 文本层既有键盘限制，不在本 PR 新造跨行导航。
- 在不同真实行上设置反向/正向 programmatic Selection，再派发 document `keyup`，作为组件定位验证（不声称真实跨行键盘操作通过）。oracle 用 focus/anchor 所在 `.pdf-line` 的 span 并集，要求两行 mid-Y 可区分；距离断言未放宽（更近，且 ≤ 8+36+1）。

条纹 A/B（相同 Linux/Xvfb `DISPLAY=:5`，`--retries=0`，只跑该用例一次；不改基线、不提交资源删除）：
- 干净 main 独立 worktree `/workspace/Point-main-stripe-ab` @ `2a90488`：通过。日志 `/workspace/evidence/pr81-selection-release-end/ab-stripe/main-stripe.log`。
- 本分支整文件一次的结果见下方验证补充。

## 7. 本轮验证补充
- `pnpm --filter @point/desktop run typecheck` 通过。
- 核心 `vitest run`：14 文件，211 passed。
- `test:main`：本 shell 继承了 `POINT_FAKE_LLM=1` 时，模型预设相关 13 项失败（期望 `deepseek-flash` 却得到 `fake`），与选区改动无关。`env -u POINT_FAKE_LLM` 后：放置修复前 809 passed / 14 skipped；本提交后 811 passed / 14 skipped。
- 条纹 A/B（相同 Linux/Xvfb `DISPLAY=:5`，`--retries=0`，不改基线、不提交资源删除），证据与说明 `/workspace/evidence/pr81-selection-release-end/ab-stripe/AB-RESULT.md`：
  - 干净 main worktree `/workspace/Point-main-stripe-ab` @ `2a90488` 一次通过。125% tintedOfWordArea 0.631，200% 0.773。截图：工具条在整段选区下方。
  - 收窄键盘改写后、放置修复前，本分支整文件一次失败：125% `darker` 0.044 > 0.005（0.59）。截图确认条压在 focus 末行上方的已选正文上。因果是松手端锚定把 sel 收成 focus 行后仍优先上方槽，且障碍只有选区外正文。这是本轮回归，不是基线条纹，未放宽 0.005。
  - 修复：`preferBelow`（focus 在选区下半时先试下方），水平居中用整段并集，障碍加上 focus 内侧真实行。再跑整文件一次：10/10 通过。条纹 125%/200% 与 main 相同（0.631 / 0.773）。截图 `feature-prefer-below-125-linux.png` 与 main 一致，条在选区下方间隙，不压中间行。
- 该次整文件覆盖：条纹、行隙拖选、200% 跨段截图、两页两栏出界夹取（跨页）、单击/三击、0–8px、AI 面板/分隔条松手、long-90 文末、上下拖 100/125/150 与 programmatic focus 端（含反向选区）。距离断言未放宽。
- 未跑：Windows / macOS CI 与真机。缩放在松手端用例中覆盖 100/125/150，未另做独立跨页缩放矩阵。#79 未修。
