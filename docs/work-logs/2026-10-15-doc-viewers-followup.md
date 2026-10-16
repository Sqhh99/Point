# 2026-10-15 文档查看器跟进（fix/doc-viewers-followup）

测试员在真实构建上对 #53 的验证发现的问题。

| # | 问题 | 原因 | 处理 |
|---|---|---|---|
| 1 | 未嵌入字体的 PDF 整页空白 | `disableFontFace:true` 走字形路径模式，与进程内 worker 竞态（`Requesting object that isn't resolved yet Helvetica_path_*`），字形全被丢弃；标准字体/CMap 也没有本地来源 | `disableFontFace:false`（用 pdf.js 给的字节建 FontFace，无 URL，CSP 不变）；标准字体（Foxit/Liberation）和 CMap 作为懒加载 chunk 打进包（`pdf-assets.ts`，`import.meta.glob ?inline`），通过 pdf.js 的 `StandardFontDataFactory`/`CMapReaderFactory` 钩子读取，`useWorkerFetch:false`，不发任何请求 |
| 2 | 旧标记（`b<n>`）在 docx/xlsx 上不再高亮/跳转 | 新视图的块 id 是 `d<i>`、`s<n>r<m>` | core 新增 `relocate.ts`：`docxBlockTexts`、`relocateBlock`、`isViewBlockId`；非新格式 id 的文字标记按引文重新定位到块（Word 按顶层块文本，Excel 跨工作表按行文本）；高亮和点击跳转（含切换到对应工作表）都走同一个解析。渲染端通过 `@point/core/relocate` 别名只打包这一个纯文件 |
| 3 | 切换文档不复位滚动 | 滚动容器沿用上一文档的 scrollTop；还有上一份 PDF 的 `goto` 在新 PDF 加载后重放 | 载入新文档时 scrollTop/Left 清零，并清空 `goto`/`fit` |
| 4 | PDF 默认 100% 比面板宽，右侧被裁 | 固定 100% | PDF 就绪后自动适应宽度（上限 100%，不放大）；测量面板（`.reader-doc`）而不是随页面变宽的页面列 |
| 5 | Word 文字颜色丢失 | mammoth 不读 run 颜色 | 转换前把 `<w:color>` 改写成字符样式 `ptc-RRGGBB`（写进 styles.xml），样式表映射成 `span.ptc-RRGGBB`；清洗器只对该类名输出 `style="color:#RRGGBB"`；渲染端 DOMPurify 钩子只放行完全匹配 `color:#RRGGBB` 的 style。失败则无颜色 |

跳过：6、7（按要求）。

## 测试
- core：`relocate.test.ts`（id 判断、块文本、Word/Excel 重新定位）、`doc-view.test.ts` 增加颜色和清洗用例。
- e2e：新增跟进用例——未嵌入字体 PDF 的 canvas 有非白像素；默认适应宽度（页面右缘在阅读区内）；切换文档滚动归零；Word 红字（`rgb(255,0,0)`，style 恰为 `color:#FF0000`）；用旧格式（`b7`、`b9`）创建的标记在 Word/Excel 上高亮并可跳转（Excel 跳到 B 工作表）。
- lint 0、typecheck 0、`pnpm test` 721 + core 171 通过、build 0、e2e 22 通过。

## CI 跟进（缩放后 page 2 文字层消失）
根因（测试员）：适应宽度后再缩放时 `scrollTop` 仍是旧缩放比例下的像素，当前页离开 IntersectionObserver，文字层被清空。产品修复：缩放变化后按 `{page, offsetRatio}` 重新锚定当前页；保留 IO 卸载，不常驻屏外页。断言未削弱。

## 缺口
- 非嵌入字体的 CJK PDF：CMap 已打包（编码可解），但字形仍需系统字体；没有 CJK 标准字体可打包，未做像素断言。
- 只保留文字颜色，Word 的高亮/背景色未保留。
- 旧的区域（region）标记只有 `b<n>`，没有引文，无法重新定位，不高亮。
