## 做了什么
修复 #53 合并后测试员在真实构建上发现的问题。

![跟进用例：Excel 旧标记定位到 B 工作表](https://raw.githubusercontent.com/Sqhh99/Point/49d00f8f2764fc442309529de1190cec453f78a5/docs/assets/pr/2026-10-15-viewer-followup.png)

1. **（高）未嵌入字体的 PDF 空白**：根因是 `disableFontFace:true` 与进程内 worker 竞态，字形全被丢弃。改为用字节建 FontFace（无 URL，CSP 不变），并把 pdf.js 标准字体和 CMap 作为懒加载 chunk 打进包，通过工厂钩子读取，不发请求。e2e 对 canvas 做非白像素断言。
2. **（高）旧 docx/xlsx 标记失效**：`b<n>` 的标记按引文重新定位到 `d<i>` / `s<n>r<m>`，高亮和点击跳转（含切换工作表）都生效；新增 core 纯函数和测试。
3. **（中）切换文档不复位滚动**：载入新文档时滚动归零，并清掉上一份 PDF 的跳页状态。
4. **（中）PDF 默认裁右侧**：就绪后自动适应宽度（不放大）。
5. **（低）Word 文字颜色**：只保留 `color:#RRGGBB`（先转成字符样式，再由清洗器输出；渲染端钩子二次限定）。

跳过 6、7。

## 安全
CSP 未改动；字体/CMap 随包打入，无网络、无 `file://` 请求；Word 的 style 属性只允许 `color:#RRGGBB`，两层校验。

## 测试
lint / typecheck 退出码 0；`pnpm test` 721 + core 171 通过；build 0；e2e 22 通过。

## 缺口
非嵌入字体的 CJK PDF 仍依赖系统字体（CMap 已打包）；Word 背景色未保留；旧区域标记无引文，无法重新定位。
