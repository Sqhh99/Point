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

## 8. PR #86 独立审查后的修复（run 44475431855）

对照 B 报告 `/workspace/evidence/pr86-b-review/REVIEW.md` 与 CI run `44475431855` 原始结果包（Windows 200% 跨段、macOS long-90），先核对现场和当前代码再改。未放宽既有 startsWith/endsWith / Line 03 起点断言，未再升版本（仍 0.2.4），未改 CI / 锁文件 / 依赖。

### CI 现场

- Windows 200% 跨段（`:479`，真实鼠标）：首跑 `:502` `startsWith("According")` 为 false，retry `:504` `endsWith("moving")` 为 false。日志未打印实际选区文本。该用例在 `:515` 截图前失败，不能用其它用例截图替代。后续新功能用例因 serial 被跳过。
- macOS long-90（`:903`）：**第一个**目标「below the last line」通过（以 Line 03 起、到 Line 90）；**第二个**「below the page」失败，选区以 Line 54 起、仍到 Line 90。首跑与 retry 相同。macOS workArea 为 1024×677，`2200×1500` 会被缩小。
- 本机用当前 head、同样 1024×677 复现：第一段拖选后 `scrollTop=557`，第一可见行约 Line 51；第二段若复用拖前 Line 03 盒（Y 仍约 139，但 live 盒已在 -423，视口外），mousedown 打在现有视口中部，选区从 Line 55 起。与 CI 的 Line 54 同一机制。证据：`/workspace/evidence/pr86-ci-44475431855/diag/long90-small-viewport.json`。

Windows 200% 在干净 main `#85`（`2a90488`）的 e2e 总结果为成功，本次失败不能单凭重试或放宽断言处理；测试改为在拖选前确认 According / moving 均在阅读视口内，断言改为 `toMatch(/^According\b/)` / `/moving$/`（契约不变，失败时带出实际文本）。

### P2 与最小修复

1. **B1** `keepEndInLayer`：document `pointerup` 若本次 `pointerdown` 落在 `.selection-toolbar` 上则不夹取。工具条按钮 `mousedown.preventDefault()` 会保留 Selection，点击「更多」不得改写 focus。仍对正文拖选和测试里的合成 `pointerup` 夹取。曾误用「必须本次 PDF 拖动手势」导致合成夹取用例失败，已收回该过严条件（见首次失败日志 `local-linux/pdf-embedded-fonts-first-run.log`）。
2. **B2** `Reader`：Esc / 滚动 `close()` 记下当前 Selection 签名；随后 `keyup` 若两端未变（例如只松 Shift）不再 `measure` 复活工具条。选区真正被键盘改动后仍可出条。不能恢复全局 Shift+Arrow 改写。
3. **B3** 键盘测试 oracle：产品 `measure` 在 trim 后 `text.length < 2` 时隐藏工具条。测试不再在 `len >= 1` 时要求出条；`len === 1` 断言条保持隐藏，`len >= 2` 才要求可见。这是按契约修正 oracle，不是放宽。

### 测试与跨页

- long-90：每个松手目标前把 Line 03 滚回阅读视口并**重新测量**盒；另加 1024×677 Linux 回归（模拟 macOS CI workArea，不当成 mac / 真机 PASS）。断言仍要求以 Line 03 起、到 Line 90。
- 新增真实鼠标跨页拖选：`hydro-times-std-2p.pdf`，按住从第 1 页 `calibration` 滚到第 2 页 `techniques`，覆盖 100/150/200%。标注 Linux/Xvfb，不是 Win/mac CI 或真机 PASS。原两页用例里 `setBaseAndExtent` + 合成事件的跨页段仍保留，不再把它当作真实跨页矩阵。

### 本机验证（Linux / Xvfb `DISPLAY=:5`，`--retries=0`）

- typecheck 通过。
- `env -u POINT_FAKE_LLM` `test:main`：811 passed / 14 skipped。
- 过严护栏下整文件首次失败（合成 pointerup 未夹取），已留存，未当作通过。
- 修正护栏后整文件一次 13/13 通过（约 59s）。日志：`/workspace/evidence/pr86-ci-44475431855/local-linux/pdf-embedded-fonts-first-run-after-toolbar-guard.log`。含 200% 跨段、long-90 两个窗口尺寸、更多/Esc+Shift、真实鼠标跨页 100/150/200%。条纹比仍为 125% 0.631、200% 0.773。
- 未跑：Windows / macOS CI、真机。#79 仍单独保留。

## 9. 审查后结构修正（手势夹取与端点快照）

`e400daa` 的 `clamp = e.button === 0 && !pressOnToolbar` 仍会在任意左键 pointerup（页面 / 面板点击且 Selection 被保留）上夹取；注释里为合成测试保留该行为，不能接受。

- `PdfView`：仅当本次左键、`pressLayer` 有值且已进入 `dragging` 时才 `keepEndInLayer`。没有这次合法 PDF 拖选，pointerup 不夹取。去掉 `pressOnToolbar`。
- 旧合成跨页 / 出界夹取：先在起点 span 上派发 `pointerdown` + `pointermove(buttons=1)` 再 `setBaseAndExtent` 和 `pointerup`。另加无手势的 pointerup 断言：逃逸端不得被夹回层内。
- `Reader`：关闭时记下 `{anchorNode, anchorOffset, focusNode, focusOffset}`，keyup 用节点引用比较；同文不同 node 视为已变更，可再出条。不再用页码+文本指纹。
- 单测：`sameSelectionEnds`（同引用相等，同文不同 node 不相等）。e2e：Esc / 滚动后只松 Shift 不出条；Esc 后在已关闭选区外真实拖选可出条；同文换到第 2 页 node 后 keyup 出条；「更多」和面板非拖选点击不改 focus。

验证（Linux / Xvfb `DISPLAY=:5`，`--retries=0`，版本仍 0.2.4）：
- typecheck 通过。
- `env -u POINT_FAKE_LLM` `test:main`：815 passed / 14 skipped（含 4 个端点比较用例）。
- 整文件首次跑因「Esc 后从原选区内部起拖」未出条失败（浏览器把已有选区当拖放），日志 `local-linux/pdf-embedded-fonts-first-run-gesture-ends.log`。随后改为从已关闭选区外的 During→decade 起拖，同一轮修正后整文件一次 14/14 通过（约 1.0m）：`local-linux/pdf-embedded-fonts-first-run-gesture-ends-2.log`。未放宽 200% / Line 03 契约。未跑 Win/mac CI 与真机。#79 仍保留。


## 10. 测试输入路径与端点契约（B5 / run 44480116908 之后，本提交）

本提交不改产品代码、不升版本（仍 0.2.4）、不放宽断言、不加超时/重试、不改 CI 配置。只改 e2e 输入、契约与失败现场采集。

### 前提对照（仅 Linux/Xvfb，不能写成 mac 结论）

时间序列证据见 `/workspace/evidence/pr86-b5-crosspage/DIAG.md`。要点：

- B5 旧 100/150% 越过 `techniques` 到 `publication` 仍 PASS，是松手命中点不在目标词，`keepEndInLayer` 在 pointerup 当帧夹到行末；不是 pointerup 后浏览器改写。
- 按住期间 `evaluate(scrollTop)` 会丢掉跨页 native anchor（选区塌成 `"on."`）。`mouse.wheel` 在本机可以滚动且保留 anchor，属于支持的交互，跨页六格只用它在按住后滚动。
- 短窗（1024×677）100% 在错误输入路径上曾出现 collapsed，这是 Linux 实测，不能直接定论 mac 工具条不显示。对照后：在活坐标、预先声明 caret、端点在窗内时，短窗 100/125/150% 上下拖都能形成 range。大窗通过不能替代短窗实际交互；本轮短窗六格都跑了，没有跳过。
- Windows 两页两栏 / line-gap 本机未复现。行隙与两页夹取用例包了轻量 `withGestureTrace`：pointerdown/move/up、selectionchange，以及 measure 后约 120ms 的 coords/scrollTop/anchor-focus offset/目标 hit。只在失败时 `test.info.attach` JSON 与 `console.log`，不是公共日志框架。下一轮 CI 应用这份现场判别，而不是猜成 #79。

### 输入与契约

- 起止 caret 在输入前用 `caretRangeFromPoint` 声明（词 + 精确 node offset）。向下：较早词的词首按下、较晚词的词末松开；向上相反，保证两个词都在 document-order 文本里。不允许 `contains(techniques)` 或把 offset 8 的 `techniqu` 当成完整词。Element 节点上的 Selection.anchor 会先解析到文本再比词。
- focus 邻近（更近且 ≤ 8+36+1）、阅读视口内、不覆盖未选 `.pdf-line` 都断言；未选行用 `range.intersectsNode` 排除。
- 同页 focus-end：大窗用 `During` → 页末唯一的 `sounding.`。1024×677 窄栏会把 `sounding.` 裁在阅读区右侧，松手点若落在裁切区会打空；测试在 **当前 scrollLeft=0** 下改用该末行里距边 24px 以内的可见词（本机短窗声明为 `each` / `of` / `propagated` 及对应 offset），不靠临时 `scrollLeft` 再被起始滚动打回。短窗矩阵跑完后把窗口恢复 1280×800，再跑键盘/programmatic 段（那一段原本按标准窗写，不能拿窄栏结果冒充）。
- 跨页六格：`calibration.` ↔ 第 2 页 `techniques`，上/下 × 100/150/200%。先 evaluate 把第 2 页滚进视口预加载文本层（200% 时只停在第 1 页不会虚拟化出第 2 页），再滚回起点；按住后只 `mouse.wheel`。按下后先在同一词上拖出 range，再滚向终点。任一格失败会收集该格/锚点时序，不标 PASS。

### 本机验证（Linux / Xvfb `DISPLAY=:5`，`--retries=0`）

- typecheck 通过。
- `env -u POINT_FAKE_LLM` `test:main`：815 passed / 14 skipped。
- 目标对照：`pdf-embedded-fonts` 中 focus-end 与跨页六格先单独跑通；随后整文件一次 14/14 通过（约 1.3m）。日志：`/workspace/evidence/pr86-b5-crosspage/local-linux/target-first-run-14.log`、`full-first-run.log`。条纹比仍为 125% 0.631、200% 0.773。
- 跨页六格实际端点（本机）：各格 anchor/focus 为第 1 页 `calibration.` offset 0 与第 2 页 `techniques` offset 10，document-order 文本以 `calibration.` 起、以 `techniques` 止，长度 150。
- 未跑：Windows / macOS CI、真机、独立复核。作者 Linux 证据与独立/双平台证据分开。#79 仍单独保留，不以本机绿或 CI 重试绿称其已修复。

### 未满足

- 尚未 push、未更新 PR、未触发双平台 CI，因此还没有 Windows 两页两栏 / line-gap 的失败现场 JSON，也没有 mac 短窗工具条现场。
- 短窗 100% 在错误路径下 collapsed 的对照只说明 Linux/Xvfb；不能写成「mac 测试问题」。
- 独立审查仍未跑本轮测试改动。


## 11. run 44486518704：分离前置输入与产品失败

- Windows：AI panel 松手后文本只有 `techniq`；行隙用例首轮 `.endOfContent` 邻接行断言失败、重试通过，不能视作修复。此轮下载包没有找到手势 JSON，因此没有可据以判断截断发生时刻的现场，不推断产品根因。
- macOS：同文异节点回归用例第一页用 `end.r - 2` 真实鼠标只选到 `equipmen`，第二页却程序化选到完整 `equipment`；在验证 node 身份之前，两个前置选区已经不等价。该回归改为两页都精确构造 `techniques and equipment` 并通过 keyup 驱动工具条；保留同文、异 node、Esc 后重新出条断言。真实鼠标跨页六格不删不改。
- macOS 首轮还有点击「更多」后「记笔记」未出现（重试通过）；此项不宣称已修复，增加失败现场采集。
- 面板/分栏松手用例先声明真实鼠标 caret，离开 reader 前要求完整 `techniques and equipment` 及起止 offset，松手后原有 reader 文本、出条、视口等断言保留。这样下一轮能分清有效选区在离开 reader 前还是之后丢失。
- 失败诊断显式写入 `test.info().outputPath` 后再 attach；采集自身失败会报 `PDF-GESTURE-TRACE-ERROR`，不再静默吞掉。增加事件目标及 guard 邻接文本。未修改公共 CI、重试或超时。
- 本地诊断自检：临时在离开 reader 前抛出 `intentional-diagnostic-probe`，如期失败并生成含 pointer/selection 时序的 JSON 附件；随后撤销临时抛错。日志 `evidence/pr86-ci-44486518704/diagnostic-probe.log`（本机绝对根目录 `/workspace/`）。这不是产品测试 PASS。
- 产品文件、版本（0.2.4）、锁文件均未改；六个 build 资源删除不纳入提交。
- 本地验证（Linux/Xvfb `DISPLAY=:5`）：tsc/typecheck、变更测试文件 ESLint、diff 检查通过；定向两例 2/2，之后整文件 `--retries=0` 一次 14/14（含未变动的跨页六格与短窗矩阵）。日志 `/workspace/evidence/pr86-ci-44486518704/local-target.log`、`local-full.log`。本次未重跑 main 单测（产品未改）；上轮 815/14 skipped 不是本次重跑结果。Win/mac 新结果尚待收集；不报双平台通过，不合并、不关闭 #81/#79。
