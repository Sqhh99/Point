# 2026-10-15 文档查看器（feat/doc-viewers）

## 范围
中间栏按原貌打开 PDF / Word / Excel，三种格式共用一条阅读顶栏（文件名、页/工作表切换、缩放、框选）。

## 做法
- **PDF**：`pdfjs-dist@4.10.38`（Apache-2.0），worker 随包打入；逐页 canvas + 文字层，IntersectionObserver 懒渲染；关闭 eval/XFA/range/stream/远程字体，不执行脚本、不加载注释表单。
- **Word**：main 用 `mammoth@1.13`（BSD-2）转 HTML，再经白名单清洗（只留标签，几乎不留属性；链接去 href、图片转占位）；渲染端 DOMPurify 二次清洗；图片字节用 `createImageBitmap` 画到 canvas，CSP 不放宽。文字是真实 DOM 文本。
- **Excel**：SheetJS `xlsx@0.20.3`（官方 CDN 版，Apache-2.0；不读公式、不读 VBA），真实网格：列字母、行号、合并单元格、列宽、数字右对齐；底部 `role=tab` 工作表标签；行数/列数设上限并提示。
- **空状态**：解析失败显示原因和「用系统应用打开」；渲染端只传文档 id，main 用自己存的 `docs/<id>.<ext>` 调 `shell.openPath`。
- **锚点**：沿用 text/region 锚点；PDF 文字锚点新增可选 `prefix`/`suffix`（各 ≤32 字上下文）和 `rects[]`（页面坐标，每行一个，≤64）。旧标记不受影响（字段可选，`parseAnchor` 严格校验）。定位以页码+引文为准，rects 只是绘制提示。
- **高亮**：三种格式同一色（`--accent` 12% 底 + 2px 下划线）。

## 测试
- core：`doc-view.test.ts`（三格式视图、清洗器、锚点新旧兼容和畸形输入）。
- main：`doc-viewers.test.ts`（docs:view、openExternal 只接受已存文档 id、系统打开失败）。
- e2e：`smoke.spec.ts` 新增三格式用例（翻页/缩放/工作表切换/标记同色/损坏文件空状态/CSP）。
- lint 0、typecheck 0、`pnpm test` 721 通过、build 0、e2e 21 通过（含 #52 的 test.fail 预期失败 1 条）。

## 已知缺口
- 未嵌入字体的 PDF 标准字体依赖系统字体（`useSystemFonts`），无字体的机器上文字可能不可见（文字层/选择/标记仍可用）。测试用 PDF 就是这种。
- PDF 区域截图标记沿用既有 region 锚点，未存 PDF 坐标；rects 只用于文字标记。
- `pnpm audit`：mammoth→argparse→sprintf-js 一条中等提示，无补丁版本，仅解析 Word 内部使用，不处理用户格式串。
- 未做：Word 的页眉页脚/分页还原、Excel 单元格样式（颜色/字体）。
