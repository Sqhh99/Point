# fix(pdf): 行首 0–8px 按下再拖出应能起选

#81 Priority 2。不改版本号。工具条位置和拖过文档末尾不在本 PR。

## 行为
- 在一行正文左缘起 0–8px 内按下再向右拖，应从该行起选（单栏、双栏左/右栏；100% 与 125%）。
- 页边空白单击仍清掉选区和工具条。不把行的命中区扩到页边：只有指针落在行盒左缘 0–8px 内时才介入 Chromium 的起选。

## 改动
- `PdfView.tsx`：记录落在行首 8px 内的普通左键按下点；若随后几次 `pointermove` 后选区仍无文本（卡在 caret 边界），用 `setBaseAndExtent` 从按下点选到指针处，之后交给 Chromium 继续延伸。
- 不改 `placeBar`、`keepEndInLayer`。

## 验证
- e2e：`pdf-embedded-fonts` 按 #81 矩阵（hydro-times-std L2/L6，hydro-2col L2/L7/R2/R7，dx 0/2/4/5/6/8，100% 与 125%）无死点；在行首左侧 12px 单击仍清选区并收起工具条。
- 真机：浅色+深色各一组行首 0–8px 拖选出选的 before/after；页边单击仍清选区。
