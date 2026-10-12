# ③ 补充：截图缩略图（point-capture:// 协议）

基于 #36（`feat/capture`），合进 `feat/capture`。版本保持 0.1.1。

## 做了什么
- **只读协议 `point-capture://<sha>`**（`src/main/capture.ts`）：
  - 在 ready 之前调用 `registerSchemesAsPrivileged`，权限只有 `{ standard: true, secure: true }`，没有开 `supportFetchAPI`、`corsEnabled`、`bypassCSP`。
  - 每个窗口创建时调用 `bindCaptureProtocol(win.webContents)`，在这个窗口自己的 session 上 `protocol.handle`。
  - 工作区通过 `workspaceForSession(session)` 查找：协议请求里拿不到 webContents，所以按 session 查。session 上至少有一个已绑定、未销毁的窗口时，返回当前工作区；其他情况一律当作没有工作区。这一版不做多窗口分区，以后做多窗口时只改这一个函数。
  - 处理函数 `captureResponse(root, url)`：
    - 只用 `new URL(url).hostname` 取 sha，交给 `assertCaptureSha` 校验，路径只由 `capturePath` 拼，不会直接用 URL 拼路径。
    - pathname 必须是 `/`，search、hash、端口、用户信息都必须为空，原始 URL 也必须正好是 `point-capture://<sha>/`。标准 scheme 会把 host 转成小写，所以大写的 sha 也会在这一步被挡下。
    - 读文件直接用 #36 的 `readCapture`：截图目录的 realpath 必须在工作区内；文件先用 lstat 确认是普通文件，再用 `O_NOFOLLOW` 打开（Windows 用 `O_RDONLY`），并且 fstat 得到的 dev/ino 要和 lstat 一致。符号链接、目录、指向工作区外的截图目录、读的过程中被替换、没有工作区、文件不存在、非 GET 请求，都返回 404。
    - 成功时 `Content-Type: image/png`，`Cache-Control: private, max-age=31536000, immutable`（截图按内容寻址，内容不会变）。
- **CSP**：HTML meta 里加了 `img-src 'self' point-capture:`。没有加 `data:` 和 `file:`。main 里没有任何地方通过响应头设置 CSP，测试里也锁定了这一点。
- **界面**（按 UI设计员 的规格，只用现有 CSS 变量）：
  - 输入框上方原来的文字「已附截图（W×H）」换成 48px 高的缩略图，圆角 4px，右上角有 × 移除按钮。
  - 对话气泡里原来的「[截图]」文字（在 `AIPanel.tsx` 的 `QuoteCard` 里生成）换成图片，最大宽度 240px。sha 本来就存在 `meta.request.image` 里。
  - 点击气泡里的图会打开大图浮层（`--panel` 底），按 Esc 或点击任意位置关闭。
  - 截图失效（返回 404）时，原位置显示同尺寸的占位框：`--surface-2` 底、1px `--border` 描边，居中 12px `--muted` 文字「截图已失效」。现有变量里没有 `--surface`，所以用了最接近的 `--surface-2`。输入框里的占位框保持 48px 高，× 仍然可用；气泡里的占位框最宽 240px，不能点，也不会打开大图。

## 测试
- 新增 `test/main/capture-protocol.test.ts`：
  - 有效 sha 返回 200，检查 Content-Type、Cache-Control 和图片字节，并确认 canonical URL 的 pathname 是 `/`。
  - 以下 19 种 URL 都返回 404：大写、长度不对、`../`、编码的 `../`、编码的 `/`、多余路径、`/..`、query、空 query、hash、`/?`、`/#`、`//`、端口、userinfo、`.png` 后缀、空 host 等。
  - 文件缺失、其他 scheme、没有工作区、别的工作区、符号链接、目录，都返回 404。
  - 注册权限只有 standard + secure。
  - 未绑定或已销毁的 webContents 拿不到工作区；POST 请求返回 404。
  - CSP：`img-src` 正好是 `'self' point-capture:`，不含 `data:`、`file:`、`blob:`、`*`；main 不设置 CSP 头。
- 合入 #39（测试员 补的协议和 CSP 测试）。原来标成 `it.fails` 的「截图目录软链接到工作区外」用例现在是普通用例，并且通过。
- e2e 新增「截图已失效」：在 main 里 stub 掉框选和提问，让它们返回一个磁盘上不存在的 sha。输入框和气泡都显示占位框，点击气泡不会打开大图。
- e2e（在原有的框选用例里扩展，截图时对话里的气泡图和输入框上方的缩略图同时可见）：框选后缩略图可见，高 48px，`naturalWidth>0`；× 能移除；重新框选后发送，气泡里的图能加载，宽度不超过 240；点击打开大图，Esc 和点击都能关闭；在渲染进程里，带路径、带 query、不存在的 sha 都加载失败。
- lint、typecheck 退出码都是 0。core 143 项通过；main 511 项通过、4 项跳过；e2e 12 项通过、1 项跳过（原有的、Linux 上系统加密不可用的用例）。

## 截图
![气泡里的截图和输入框上方的缩略图](https://raw.githubusercontent.com/Sqhh99/Point/feat/capture-thumbs/docs/assets/pr/2026-10-12-capture-thumbs.png)
![大图](https://raw.githubusercontent.com/Sqhh99/Point/feat/capture-thumbs/docs/assets/pr/2026-10-12-capture-lightbox.png)
