# feat(pdf): v0.2.3 TJ 文字几何 buildPageTextGeom（尚未换 TextLayer）

v0.2.3 第一步。不改版本号。不替换 UI 文字层。

## 做了什么
- 新增 `apps/desktop/src/renderer/viewers/pdf-tj-geom.ts`：从 pdf.js 4.10 `getOperatorList` 重建 `TjGlyphRun` / `TjWordBox` / `PageTextGeom`（架构锁定的数据形状）。
- 单测 + 诊断：`apps/desktop/test/main/pdf-tj-geom.test.ts`（`pnpm --filter @point/desktop run test:main -- test/main/pdf-tj-geom.test.ts`）。

## 没做什么
- 不改 PdfView TextLayer、SelectionOverlay、marks、`PageRect`。
- 不恢复 e2e `within1px ≥ 0.90`（仍为 0.20 + known-issue，留给接上 Option A 之后）。

## 四档缩放（hydro-serif，geom-fillText ↔ canvas xcorr）

| 缩放 | 测到 / 词数 | within1px | p95Dx | maxDx |
|---|---|---|---|---|
| 100% | 178 / 178 | 1.000 | 0 | 0 |
| 125% | 178 / 178 | 1.000 | 0 | 0 |
| 150% | 178 / 178 | 1.000 | 0 | 0 |
| 200% | 178 / 178 | 1.000 | 0 | 0 |

说明：该诊断验证 **TJ walker 与 pdf.js 画布字形位置一致**；DOM TextLayer 的 e2e 漂移要等下一 PR 用 Option A 按 run 绝对定位 span。

证据：`/workspace/evidence/pdf-tj-geom/pdf-tj-geom-drift.json`（日志行 `PDF-TJ-GEOM-DRIFT`）。
