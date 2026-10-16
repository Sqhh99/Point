## 做了什么
PDF、Word、Excel 现在在中间栏按**原貌**显示（此前只是提取文字的 HTML）。三种格式共用一条顶栏：文件名、页/工作表切换、缩放（PDF 另有适应宽度）、框选。

| PDF | Word |
|---|---|
| ![PDF](https://raw.githubusercontent.com/Sqhh99/Point/COMMIT/docs/assets/pr/2026-10-15-viewer-pdf.png) | ![Word](https://raw.githubusercontent.com/Sqhh99/Point/COMMIT/docs/assets/pr/2026-10-15-viewer-docx.png) |

| Excel（底部工作表标签） | 解析失败的空状态 |
|---|---|
| ![Excel](https://raw.githubusercontent.com/Sqhh99/Point/COMMIT/docs/assets/pr/2026-10-15-viewer-xlsx.png) | ![空状态](https://raw.githubusercontent.com/Sqhh99/Point/COMMIT/docs/assets/pr/2026-10-15-viewer-empty.png) |

- PDF：pdf.js 逐页 canvas + 文字层，可选字、框选、标记；Word：清洗后的 HTML，图片内联；Excel：列字母/行号/合并/列宽的真实网格。
- 选区提问、框选提问、标记在三种格式上行为一致，高亮同一颜色。
- 损坏文件显示原因和「用系统应用打开」（main 只用自己存的文档路径）。

## 安全
- 不执行文档内容：PDF 关闭脚本/eval/XFA/远程字体；docx 白名单清洗两遍，链接去 href；xlsx 不读公式和 VBA。
- 渲染端只传文档 id，文件读取和 `shell.openPath` 都在 main 内、路径由 main 校验。
- CSP 未改动（e2e 断言无 http(s)/data:/unsafe-eval）；docx 图片用 `createImageBitmap` 画 canvas。
- 依赖：pdfjs-dist 4.10.38（Apache-2.0，已含 CVE-2024-4367 修复）、mammoth 1.13（BSD-2）、xlsx 0.20.3（官方 CDN 版）。`pnpm audit` 仅 sprintf-js 一条中等提示（经 mammoth，无补丁，不可达）。

## 锚点
沿用 text/region 锚点；PDF 文字锚点新增可选 `prefix`/`suffix`/`rects[]`，旧标记兼容；定位以页码+引文为准，rects 仅作绘制提示。

## 测试
lint / typecheck 退出码 0；`pnpm test` 721 通过；build 0；e2e 21 通过（另有 #52 的 test.fail 预期失败）。新增 core / main 单测与三格式 e2e（翻页、缩放、工作表切换、标记同色、空状态）。

## 缺口
未嵌入字体的 PDF 依赖系统字体；区域截图标记不存 PDF 坐标；Word 页眉页脚和 Excel 单元格样式未还原。
