# 2026-10-21 PDF TJ 几何（v0.2.3 第一步，仅 geom）

- 分支 `feat/pdf-tj-geom-v023`，起点 main `0e2e908`。
- **范围**：只落地 `buildPageTextGeom`（+ 纯函数 / 单测 / 诊断），**不**替换 TextLayer UI，不改 `PageRect` / `MarkAnchor` / SelectionOverlay / marks。
- **位置**：`apps/desktop/src/renderer/viewers/pdf-tj-geom.ts`（紧挨 PdfView，不进 `packages/core`）。
- **路径**：`getOperatorList` → 钉死的 pdf.js 4.10 OPS（setFont / showText / showSpacedText / TJ 数字间隙 / CTM+Tm）→ `TjGlyphRun[]` → viewport@`PDF_CSS_BASE` → `TjWordBox`（现有 `PageRect`）。
- **ascent**：优先 `commonObjs` 字体（FontFaceObject）的 ascent×fontSize，否则 `0.8·fontSize`；不用 textContent styles 作唯一来源。
- **诊断**：`test/main/pdf-tj-geom.test.ts` 用 `@napi-rs/canvas`（pdfjs optionalDependency）把 geom runs `fillText` 到离屏层，与 `page.render` 画布做逐词 xcorr。hydro-serif 四档缩放 within1px = **1.0**（178/178）；故意 +5px 后 soft 断言 within1px &lt; 0.5，防止空比。这是 **walker↔画布** 校验，不是 DOM TextLayer e2e；接上 Option A span 后再把 e2e 硬门槛改回 ≥0.90。
- 证据：`/workspace/evidence/pdf-tj-geom/pdf-tj-geom-drift.json`。
