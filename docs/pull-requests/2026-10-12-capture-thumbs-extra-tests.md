# PR：test: 补 #38 point-capture:// 协议与 CSP 的边界测试

- **日期：** 2026-10-12 / **分支：** `test/capture-thumbs-extra` → `feat/capture-thumbs` / **基线 commit：** `baa683d` / **相关记录：** [工作日志](../work-logs/2026-10-12-capture-thumbs-extra-tests.md)

## 关联
Related to #38

## 改了什么
新增 `apps/desktop/test/main/capture-protocol-extra.test.ts`（58 个用例）：
- **200：** 返回的字节和原图一致，`image/png`，`Cache-Control` 包含 private 和 immutable，没有 CORS 头；404 的响应正文里不包含工作区路径。
- **404（直接调用 `captureResponse`）：**
  - host：大写或大小写混合的 host、大写 scheme、缺少末尾 `/`、host 里有百分号编码、host 末尾带点、IP 或 localhost 作为 host。
  - path：编码的 `/`、`\`、`..`、NUL，未编码的 `..` 和反斜杠。
  - URL 的其他部分：search、hash、端口、userinfo、只带用户名。
  - 格式不对：opaque 形式、三斜杠、首尾空白、中间有 tab、不是 URL、空串、http 和 file scheme。
  - 文件：文件不存在、截图目录不存在、有一个目录叫 `<sha>.png`、没有工作区（null 或空串）、截图文件是软链接。
  - **截图目录本身是软链接时仍返回 200，标 `it.fails`。**
- **处理函数：**
  - HEAD、POST、PUT、DELETE、OPTIONS、PATCH 都返回 404。
  - 大写 sha 用构造的 `Request` 直接调用处理函数，返回 404（Chromium 会把 host 转成小写，只能在单元测试里覆盖）。
  - 两个窗口共用一个 session 时只注册一次处理函数。
  - 关闭工作区后立即返回 404；切换工作区后只返回新工作区的截图。
  - 另一个 session 上的未绑定窗口拿不到处理函数；同一 session 上 A 被销毁后 B 仍可用，两个都销毁后返回 404。
- **CSP：** 只有一个 CSP meta 标签；`img-src` 只有 `'self' point-capture:`；所有指令里都没有 data:、file:、blob:、*、http:、https:、'unsafe-eval'；point-capture: 只出现在 img-src；没有 connect-src；scheme 的 privileges 里没有 bypassCSP、supportFetchAPI、corsEnabled、allowServiceWorkers、stream。

## 发现的 bug（未修，标 `it.fails`，已确认会失败）
1. `apps/desktop/src/main/capture.ts` 的 `captureResponse` 只对最终文件做 `lstatSync`：`.point/captures` 是指向别处的软链接时，那里的普通文件会以 200 返回。

设计限制（没有标 it.fails）：处理函数拿不到发起请求的 webContents，同一 session 上的多个窗口无法区分。现在全局只有一个工作区，所以不影响。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建（仅测试与记录）

## 版本号
不升版本。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过
- [x] `pnpm test` 通过（core 143；main 406 通过、4 跳过，都是已有 `open-extra` 里由平台条件控制的用例）
- [ ] `pnpm e2e` 通过 —— 没跑，本 PR 不改 e2e
- [ ] Windows 和 macOS 上的 CI 全绿 —— 推送后等 CI，结果以 PR 页面上的 checks 为准
- [ ] 在应用里实际走过受影响的流程 —— 不适用

## 检查项
- [ ] UI 改动附了改前改后截图 —— 无
- [ ] 数据库表结构变化附了迁移脚本和迁移测试 —— 无
- [ ] 打包布局、依赖、安全相关变化 —— 无（测试覆盖了协议和 CSP 的安全边界）
- [x] AI 声明：测试和记录由测试员 bot 生成，已在本地 Linux 上运行验证
