import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  PDFJS_4_10_TEXT_OPS,
  PDF_CSS_BASE,
  buildPageTextGeom,
  runsToLines,
  walkRuns,
  type PageTextGeom,
  type TjGlyphRun,
  type TjWordBox
} from "../../src/renderer/viewers/pdf-tj-geom";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = join(root, "e2e/fixtures/pdf/hydro-serif.pdf");
const require = createRequire(import.meta.url);

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= worker;
  return pdfjs;
}

type NapiCanvas = {
  createCanvas: (w: number, h: number) => {
    width: number;
    height: number;
    getContext: (t: "2d") => CanvasRenderingContext2D & { getImageData: (x: number, y: number, w: number, h: number) => ImageData };
  };
  GlobalFonts: { register: (buf: Buffer, name?: string) => unknown; has: (name: string) => boolean };
};

function resolveNapiCanvas(): NapiCanvas {
  try {
    return require("@napi-rs/canvas") as NapiCanvas;
  } catch {
    /* fall through */
  }
  const candidates = [
    join(root, "node_modules/@napi-rs/canvas"),
    join(root, "../../node_modules/.pnpm/pdfjs-dist@4.10.38/node_modules/@napi-rs/canvas"),
    join(root, "../../node_modules/.pnpm/@napi-rs+canvas@0.1.100/node_modules/@napi-rs/canvas")
  ];
  for (const c of candidates) {
    try {
      return require(c) as NapiCanvas;
    } catch {
      /* next */
    }
  }
  throw new Error("@napi-rs/canvas not resolvable (pdfjs-dist optionalDependency)");
}

describe("buildPageTextGeom (hydro-serif)", () => {
  it("pins pdf.js 4.10 OPS ids used by the walker", async () => {
    const pdfjs = await loadPdfjs();
    for (const [name, id] of Object.entries(PDFJS_4_10_TEXT_OPS)) {
      expect(pdfjs.OPS[name as keyof typeof pdfjs.OPS], name).toBe(id);
    }
  });

  it("emits runs and ≥30 words with PageRect @ 100% CSS px", async () => {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(readFileSync(fixture));
    const doc = await pdfjs.getDocument({
      data,
      verbosity: 0,
      isEvalSupported: false,
      disableFontFace: false,
      useSystemFonts: true
    }).promise;
    try {
      const page = await doc.getPage(1);
      const geom = await buildPageTextGeom(page as Parameters<typeof buildPageTextGeom>[0]);
      expect(geom.page).toBe(1);
      expect(geom.runs.length).toBeGreaterThan(30);
      expect(geom.words.length).toBeGreaterThanOrEqual(30);
      expect(geom.runs.every((r) => r.ascent > 0 && r.fontSize > 0 && r.str.length > 0)).toBe(true);
      const w = geom.words[0]!;
      expect(w.rect.w).toBeGreaterThan(0);
      expect(w.rect.h).toBeGreaterThan(0);
      const vp = page.getViewport({ scale: PDF_CSS_BASE });
      expect(w.rect.x).toBeGreaterThanOrEqual(0);
      expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(vp.width + 1);
      expect(geom.words.some((x) => x.text === "Depth" || x.text.startsWith("Depth"))).toBe(true);
    } finally {
      await doc.destroy();
    }
  });

  it("diagnostic: geom fillText vs canvas ink at 100/125/150/200% (prints ratios; soft floor)", async () => {
    const pdfjs = await loadPdfjs();
    const canvasMod = resolveNapiCanvas();
    const data = new Uint8Array(readFileSync(fixture));
    const doc = await pdfjs.getDocument({
      data,
      verbosity: 0,
      isEvalSupported: false,
      disableFontFace: true,
      fontExtraProperties: true,
      useSystemFonts: true
    }).promise;
    try {
      const page = await doc.getPage(1);
      const geom = await buildPageTextGeom(page as Parameters<typeof buildPageTextGeom>[0]);
      expect(geom.words.length).toBeGreaterThanOrEqual(30);

      const fontNames = [...new Set(geom.runs.map((r) => r.fontName))];
      for (const name of fontNames) {
        const f = page.commonObjs.get(name) as { data?: Uint8Array | ArrayBuffer };
        if (!f?.data) throw new Error(`font ${name} has no data`);
        canvasMod.GlobalFonts.register(Buffer.from(f.data as ArrayBuffer), name);
        expect(canvasMod.GlobalFonts.has(name)).toBe(true);
      }

      const drift: Record<string, Drift> = {};
      for (const z of [100, 125, 150, 200]) {
        const scale = (PDF_CSS_BASE * z) / 100;
        drift[z] = await measurePaintedDrift(page, geom, scale, canvasMod);
      }
      const shifted: PageTextGeom = {
        ...geom,
        words: geom.words.map((w) => ({ ...w, rect: { ...w.rect, x: w.rect.x + 5 } })),
        runs: geom.runs.map((r) => ({ ...r, x: r.x + 5 / PDF_CSS_BASE }))
      };
      const bad = await measurePaintedDrift(page, shifted, PDF_CSS_BASE, canvasMod);
      expect(bad.within1px, "shifted geom must drift").toBeLessThan(0.5);

      const line = { fixture: "hydro-serif.pdf", method: "geom-fillText-xcorr", drift };
      console.log(`PDF-TJ-GEOM-DRIFT ${JSON.stringify(line)}`);
      // Optional evidence file: only when POINT_TJ_EVIDENCE is set, else try os.tmpdir(); never hardcode /workspace.
      const evidenceDir = process.env.POINT_TJ_EVIDENCE || tmpdir();
      try {
        mkdirSync(evidenceDir, { recursive: true });
        writeFileSync(join(evidenceDir, "pdf-tj-geom-drift.json"), JSON.stringify(line, null, 2));
      } catch {
        /* CI runners may lack the path; console.log above is enough */
      }
      for (const [z, d] of Object.entries(drift)) {
        expect(d.total, `${z}% words`).toBeGreaterThanOrEqual(30);
        expect(d.words, `${z}% measured`).toBe(d.total);
        expect(d.within1px, `${z}% soft`).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await doc.destroy();
    }
  });
});

describe("walkRuns / runsToLines", () => {
  const O = PDFJS_4_10_TEXT_OPS;
  const fonts = { get: () => ({ ascent: 0.75, fontMatrix: [0.001, 0, 0, 0.001, 0, 0] }) };
  const g = (s: string) => [...s].map((unicode) => ({ unicode, width: 500, isSpace: unicode === " " }));

  it("scales size, ascent and advance by the text matrix (`1 Tf` + `12 0 0 12 x y Tm`)", () => {
    const runs = walkRuns([O.beginText, O.setFont, O.setTextMatrix, O.showText], [[], ["F1", 1], [12, 0, 0, 12, 100, 700], [g("ab")]], fonts);
    expect(runs).toEqual([{ str: "ab", x: 100, y: 700, fontName: "F1", fontSize: 12, ascent: 9, advance: 12 }]);
  });

  it("groups runs into lines, merges pieces of a word and marks word spaces", () => {
    const run = (str: string, x: number, y: number, advance: number): TjGlyphRun => ({ str, x, y, fontName: "F1", fontSize: 10, ascent: 7.5, advance });
    const lines = runsToLines([run("Dep", 10, 700, 15), run("th", 25.2, 700, 10), run(" ", 35.2, 700, 2.5), run("is", 37.7, 700, 10), run("next", 10, 688, 20)]);
    expect(lines.map((l) => l.map((r) => [r.str, r.space]))).toEqual([
      [
        ["Depth", true],
        ["is", false]
      ],
      [["next", false]]
    ]);
    expect(lines[0]![0]!.advance).toBeCloseTo(25.2);
  });
});

type Drift = { words: number; total: number; within1px: number; p95Dx: number; maxDx: number };

// pdf.js page proxy — kept structural/loose for the Node harness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function measurePaintedDrift(page: any, geom: PageTextGeom, scale: number, canvasMod: NapiCanvas): Promise<Drift> {
  const viewport = page.getViewport({ scale }) as {
    width: number;
    height: number;
    scale: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
  const W = Math.ceil(viewport.width);
  const H = Math.ceil(viewport.height);
  const canvasFactory = {
    create(w: number, h: number) {
      const canvas = canvasMod.createCanvas(w, h);
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(pair: { canvas: { width: number; height: number } }, w: number, h: number) {
      pair.canvas.width = w;
      pair.canvas.height = h;
    },
    destroy() {}
  };

  const pagePair = canvasFactory.create(W, H);
  await page.render({ canvasContext: pagePair.context, viewport, canvasFactory }).promise;
  const A = pagePair.context.getImageData(0, 0, W, H);

  const layerPair = canvasFactory.create(W, H);
  const lctx = layerPair.context;
  lctx.fillStyle = "#fff";
  lctx.fillRect(0, 0, W, H);
  lctx.fillStyle = "#000";
  lctx.textBaseline = "alphabetic";
  for (const run of geom.runs) {
    const pt = viewport.convertToViewportPoint(run.x, run.y);
    lctx.font = `${run.fontSize * viewport.scale}px "${run.fontName}"`;
    lctx.fillText(run.str, pt[0]!, pt[1]!);
  }
  const B = lctx.getImageData(0, 0, W, H);

  const dark = (img: ImageData, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const i = (y * W + x) * 4;
    return img.data[i]! * 0.3 + img.data[i + 1]! * 0.59 + img.data[i + 2]! * 0.11 < 150 ? 1 : 0;
  };

  const k = scale / PDF_CSS_BASE;
  const rows = geom.words.map((w) => wordXcorr(w, k, A, B, dark));
  const within = rows.filter((r) => Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1).length / Math.max(1, rows.length);
  const ax = rows.map((r) => Math.abs(r.dx)).sort((a, b) => a - b);
  return {
    total: geom.words.length,
    words: rows.length,
    within1px: +within.toFixed(3),
    maxDx: ax.at(-1) ?? 0,
    p95Dx: ax[Math.floor(ax.length * 0.95)] ?? 0
  };
}

function wordXcorr(
  word: TjWordBox,
  k: number,
  A: ImageData,
  B: ImageData,
  dark: (img: ImageData, x: number, y: number) => number
): { dx: number; dy: number } {
  const l = word.rect.x * k;
  const t = word.rect.y * k;
  const r = (word.rect.x + word.rect.w) * k;
  const b = (word.rect.y + word.rect.h) * k;
  const h = Math.max(1, b - t);
  const S = Math.max(4, Math.ceil(0.35 * h));
  const bm: [number, number][] = [];
  for (let y = Math.floor(t); y < Math.ceil(b); y++) {
    for (let x = Math.floor(l); x < Math.ceil(r); x++) if (dark(B, x, y)) bm.push([x, y]);
  }
  if (bm.length < 8) return { dx: S + 1, dy: S + 1 };
  let best = { dx: 0, dy: 0, score: -1 };
  for (let dy = -S; dy <= S; dy++) {
    for (let dx = -S; dx <= S; dx++) {
      let sc = 0;
      for (const [x, y] of bm) sc += dark(A, x + dx, y + dy);
      if (sc > best.score || (sc === best.score && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) {
        best = { dx, dy, score: sc };
      }
    }
  }
  return { dx: -best.dx, dy: -best.dy };
}
