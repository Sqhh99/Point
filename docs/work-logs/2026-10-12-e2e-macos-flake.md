# 工作日志：修复 e2e 随机失败（笔记 id 全是数字时被 YAML 加引号）

- **日期：** 2026-10-12
- **分支：** `test/e2e-macos-flake`（从 `main` 的 `41c3898` 拉出）
- **执行者：** 测试员
- **相关记录：** [PR 记录](../pull-requests/2026-10-12-e2e-macos-flake.md)

## 1. 请求
macOS e2e 时好时坏：#31 在 `smoke.spec.ts` 第 261 行等笔记列表按钮超时，#28 在选区任务、不可信输出、模型报错三个用例超时。要找到根因；如果是测试的问题，只改测试。

## 2. 计划
1. 拉三次失败的 macOS e2e 日志（job 114863794367 #28、114872005024 main、114889413762 #31），和通过的对比。CI 没上传 trace 或截图。
2. 读 `smoke.spec.ts`、`packages/core/src/notes/index.ts`、`playwright.config.ts`。
3. 只改测试并补一个确定会触发的单测。

## 3. 根因
- **第一次失败都在同一处断言：** `smoke.spec.ts` 选区任务用例检查笔记 frontmatter 的正则是 `id: [\\w-]+`。三次失败里收到的分别是 `id: "62499056"`、`id: "21387138"`、`id: "37259515"`。
- **为什么会加引号：** 笔记 id 是 `randomUUID().slice(0, 8)`（`packages/core/src/notes/index.ts:67`），8 位十六进制。全是数字的概率是 (10/16)^8 ≈ 2.3%，再加上形如 `1234e567` 的情况。`yaml` 的 `stringify` 会给这种看起来像数字的字符串加引号，保证读回来还是字符串，这是正确的写法。`parseNote` 读回来也是字符串，产品行为正确。
- **为什么连锁失败：** 所有用例共用一个 Electron 应用，后面的用例依赖前面留下的状态（工作区、文档、插入的笔记）。Playwright 重试时重新启动应用、换新的 userData，只重跑失败的那一个用例，这时没有工作区，所以要么等 `doc-list` 里的文档超时，要么因为没有工作区等不到可编辑的 `.composer textarea`。后面依赖笔记的导出用例（#31 的第 261 行）也跟着超时。
- **不是 macOS 特有：** 每次跑大约 3% 的概率失败。Windows 只是这几次没抽中。#27 之前的 main（run 38266937688）也失败过，和三栏布局无关。

## 4. 改动的文件
| 文件 | 改动 | 对应的需求 |
|------|------|------------|
| `apps/desktop/e2e/smoke.spec.ts` | 正则同时接受 `id: abc` 和 `id: "123"`；整个文件 `test.describe.configure({ mode: "serial" })` | 去掉 flake，避免连锁超时；重试时整个文件重跑 |
| `packages/core/test/notes.test.ts` | 新增 4 个用例，用固定的数字形 id 验证写入加引号、读回是字符串、`list` 正常 | 把 2.3% 的随机情况变成每次都跑到的测试 |
| 本日志与 PR 记录 | 新增 | project-records |

## 5. 验证
- 用 node 跑过：新正则对 `id: "37259515"` 和 `id: 3a7f9c21` 都匹配，旧正则对 `"37259515"` 不匹配，复现了失败。
- 本地：`pnpm lint`、`pnpm typecheck`、`pnpm test` 通过（core 95、main 189）；Linux 下 `pnpm build` 后 `xvfb-run pnpm e2e` 连跑 3 次，每次 10 通过 1 跳过（safeStorage 不可用，原来就会跳过）。
- 本地没有 macOS，macOS 结果看 CI。

## 6. 遗留事项
- 建议 运维发布 在 CI 里开 `trace: "retain-on-failure"`，失败时上传 `apps/desktop/test-results`。本 PR 不改 workflow。
- 产品侧可以考虑让 id 不会全是数字（比如加字母前缀），但不是 bug，不在本 PR 改。
