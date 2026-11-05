/**
 * Rebuild PDF text geometry from the operator list (TJ / showText offsets).
 * Pure helpers next to PdfView — not in packages/core. PdfView builds its text layer spans from these runs.
 *
 * Pin: pdf.js 4.10.38 OPS ids below. Ascents come from commonObjs font metrics (FontFaceObject),
 * not from getTextContent styles.
 */
import type { PageRect } from "@point/core";

/** 1 PDF point = 4/3 CSS px at 100% (same as PdfView / SelectionOverlay). */
export const PDF_CSS_BASE = 96 / 72;

/** pdf.js 4.10.38 OPS used by the walker (frozen snapshot — do not drift with other majors). */
export const PDFJS_4_10_TEXT_OPS = Object.freeze({
  transform: 12,
  save: 10,
  restore: 11,
  beginText: 31,
  endText: 32,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47
} as const);

export type TjGlyphRun = {
  str: string;
  /** Baseline origin in PDF user space. */
  x: number;
  y: number;
  fontName: string;
  fontSize: number;
  /** PDF-user-space ascent; box top = viewport(y) − ascent·scale. */
  ascent: number;
  advance?: number;
};

export type TjWordBox = {
  text: string;
  /** Existing PageRect: CSS px at 100% zoom, page top-left. */
  rect: PageRect;
};

export type PageTextGeom = {
  page: number;
  runs: TjGlyphRun[];
  words: TjWordBox[];
};

type Mat = [number, number, number, number, number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

type Glyph = {
  unicode?: string;
  width?: number;
  isSpace?: boolean;
};

type FontMetrics = {
  ascent: number;
  descent: number;
  fontMatrix: Mat;
};

export type PdfFontObjs = {
  /** Sync get after getOperatorList has resolved font dependencies. */
  get(id: string): unknown;
};

export type PdfPageForGeom = {
  pageNumber: number;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getViewport(params: { scale: number }): {
    scale: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
  commonObjs: PdfFontObjs;
};

type FontObjLite = { ascent?: number; descent?: number; fontMatrix?: number[] };

function fontMetrics(objs: PdfFontObjs, fontRef: string): FontMetrics {
  let raw: FontObjLite | null = null;
  try {
    raw = objs.get(fontRef) as FontObjLite;
  } catch {
    raw = null;
  }
  const ascentFrac = typeof raw?.ascent === "number" && raw.ascent > 0 ? raw.ascent : 0.8;
  const descentFrac = typeof raw?.descent === "number" ? raw.descent : -0.2;
  const fm = raw?.fontMatrix;
  const fontMatrix: Mat =
    Array.isArray(fm) && fm.length >= 6
      ? [fm[0]!, fm[1]!, fm[2]!, fm[3]!, fm[4]!, fm[5]!]
      : [0.001, 0, 0, 0.001, 0, 0];
  return { ascent: ascentFrac, descent: descentFrac, fontMatrix };
}

/**
 * Walk pdf.js 4.10 operator list → glyph runs in PDF user space, then word boxes in PageRect space
 * (CSS px @ 100% = scale PDF_CSS_BASE).
 */
export async function buildPageTextGeom(page: PdfPageForGeom): Promise<PageTextGeom> {
  const ops = await page.getOperatorList();
  const runs = walkRuns(ops.fnArray, ops.argsArray, page.commonObjs);
  const viewport = page.getViewport({ scale: PDF_CSS_BASE });
  const words = runsToWords(runs, viewport);
  return { page: page.pageNumber, runs, words };
}

/** Exported for unit tests: operator walk only. */
export function walkRuns(fnArray: number[], argsArray: unknown[], objs: PdfFontObjs): TjGlyphRun[] {
  const OPS = PDFJS_4_10_TEXT_OPS;
  const runs: TjGlyphRun[] = [];
  let ctm: Mat = IDENTITY;
  const stack: Mat[] = [];

  let textMatrix: Mat = IDENTITY;
  let x = 0;
  let y = 0;
  let lineX = 0;
  let lineY = 0;
  let leading = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let textHScale = 1;
  let textRise = 0;
  let fontDirection = 1;
  let fontSize = 0;
  let fontName = "";
  let fm: FontMetrics = { ascent: 0.8, descent: -0.2, fontMatrix: [0.001, 0, 0, 0.001, 0, 0] };

  const beginText = () => {
    textMatrix = IDENTITY;
    x = lineX = 0;
    y = lineY = 0;
  };

  const moveText = (tx: number, ty: number) => {
    x = lineX += tx;
    y = lineY += ty;
  };

  const showGlyphs = (glyphs: unknown[]) => {
    if (!fontSize || !Array.isArray(glyphs) || glyphs.length === 0) return;
    const widthAdvanceScale = fontSize * fm.fontMatrix[0];
    const spacingDir = -1; // horizontal text (pdf.js CanvasGraphics)
    const hScale = textHScale * fontDirection;
    let localX = 0;
    let piece = "";
    let pieceAdvance = 0;
    let pieceStartLocal = 0;
    let pieceStarted = false;

    const flush = () => {
      if (!pieceStarted || !piece) {
        piece = "";
        pieceAdvance = 0;
        pieceStarted = false;
        return;
      }
      const tx = x + pieceStartLocal * hScale;
      const ty = y + textRise;
      const m = mul(ctm, textMatrix);
      const [ux, uy] = apply(m, tx, ty);
      // Tf size and widths are in text space; Tm/CTM may scale them (e.g. `1 Tf` + `12 0 0 12 x y Tm`).
      const sx = Math.hypot(m[0], m[1]);
      const sy = Math.hypot(m[2], m[3]);
      const size = fontSize * sy;
      runs.push({
        str: piece,
        x: ux,
        y: uy,
        fontName,
        fontSize: size,
        ascent: (fm.ascent > 0 ? fm.ascent : 0.8) * size,
        advance: pieceAdvance * Math.abs(hScale) * sx
      });
      piece = "";
      pieceAdvance = 0;
      pieceStarted = false;
    };

    for (const g of glyphs) {
      if (typeof g === "number") {
        flush();
        localX += spacingDir * g * (fontSize / 1000);
        continue;
      }
      const glyph = g as Glyph;
      const ch = glyph.unicode ?? "";
      // Break runs on whitespace so word boxing stays simple; still advance the same.
      if (ch && /\s/.test(ch)) {
        flush();
      }
      const spacing = (glyph.isSpace ? wordSpacing : 0) + charSpacing;
      const width = typeof glyph.width === "number" ? glyph.width : 0;
      const charWidth = width * widthAdvanceScale + spacing * fontDirection;
      if (ch && !/\s/.test(ch)) {
        if (!pieceStarted) {
          pieceStartLocal = localX;
          pieceStarted = true;
          piece = "";
          pieceAdvance = 0;
        }
        piece += ch;
        pieceAdvance += charWidth;
      } else if (ch && /\s/.test(ch)) {
        // whitespace: no run, just advance
      }
      localX += charWidth;
    }
    flush();
    x += localX * hScale;
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]!;
    const args = (argsArray[i] ?? []) as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? IDENTITY;
        break;
      case OPS.transform: {
        const a = args as number[];
        if (a.length >= 6) ctm = mul(ctm, [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!]);
        break;
      }
      case OPS.beginText:
        beginText();
        break;
      case OPS.endText:
        break;
      case OPS.setCharSpacing:
        charSpacing = Number(args[0]) || 0;
        break;
      case OPS.setWordSpacing:
        wordSpacing = Number(args[0]) || 0;
        break;
      case OPS.setHScale:
        textHScale = (Number(args[0]) || 100) / 100;
        break;
      case OPS.setLeading:
        leading = Number(args[0]) || 0;
        break;
      case OPS.setFont: {
        fontName = String(args[0] ?? "");
        let size = Number(args[1]) || 0;
        if (size < 0) {
          size = -size;
          fontDirection = -1;
        } else {
          fontDirection = 1;
        }
        fontSize = size;
        fm = fontMetrics(objs, fontName);
        break;
      }
      case OPS.setTextRise:
        textRise = Number(args[0]) || 0;
        break;
      case OPS.moveText:
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.setLeadingMoveText: {
        const tx = Number(args[0]) || 0;
        const ty = Number(args[1]) || 0;
        leading = -ty;
        moveText(tx, ty);
        break;
      }
      case OPS.setTextMatrix: {
        const a = args as number[];
        if (a.length >= 6) {
          textMatrix = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
          x = lineX = 0;
          y = lineY = 0;
        }
        break;
      }
      case OPS.nextLine:
        moveText(0, leading);
        break;
      case OPS.showText:
        showGlyphs((args[0] as unknown[]) ?? []);
        break;
      case OPS.showSpacedText:
        // Same glyph/number array shape as showText after the worker expands TJ.
        showGlyphs((args[0] as unknown[]) ?? []);
        break;
      case OPS.nextLineShowText:
        moveText(0, leading);
        showGlyphs((args[0] as unknown[]) ?? []);
        break;
      case OPS.nextLineSetSpacingShowText: {
        wordSpacing = Number(args[0]) || 0;
        charSpacing = Number(args[1]) || 0;
        moveText(0, leading);
        showGlyphs((args[2] as unknown[]) ?? []);
        break;
      }
      default:
        break;
    }
  }
  return runs;
}

type Viewport = {
  scale: number;
  convertToViewportPoint(x: number, y: number): number[];
};

/** Group consecutive runs on the same baseline into words; emit PageRect @ 100% CSS px. */
export function runsToWords(runs: TjGlyphRun[], viewport: Viewport): TjWordBox[] {
  const words: TjWordBox[] = [];
  let i = 0;
  while (i < runs.length) {
    const start = runs[i]!;
    // Skip pure-space runs (should not exist, but be safe).
    if (!start.str || /^\s+$/.test(start.str)) {
      i++;
      continue;
    }
    let text = start.str;
    let minX = start.x;
    let maxX = start.x + (start.advance ?? 0);
    const baselineY = start.y;
    let ascent = start.ascent;
    let j = i + 1;
    // Merge runs that sit on the same baseline with no gap that looks like a space.
    // (Whitespace already flushed as separate advances; adjacent letter runs on one line merge.)
    while (j < runs.length) {
      const r = runs[j]!;
      if (!r.str || /^\s+$/.test(r.str)) break;
      const sameLine = Math.abs(r.y - baselineY) < Math.max(0.5, start.fontSize * 0.05);
      const gap = r.x - maxX;
      // A gap larger than ~0.25em is a word break (space was consumed as advance without a run).
      if (!sameLine || gap > Math.max(start.fontSize, r.fontSize) * 0.15) break;
      text += r.str;
      maxX = Math.max(maxX, r.x + (r.advance ?? 0));
      minX = Math.min(minX, r.x);
      ascent = Math.max(ascent, r.ascent);
      j++;
    }
    const p0 = viewport.convertToViewportPoint(minX, baselineY);
    const p1 = viewport.convertToViewportPoint(maxX, baselineY);
    const vx0 = p0[0]!, vy0 = p0[1]!, vx1 = p1[0]!;
    const ascentPx = ascent * viewport.scale;
    // Descent ≈ 0.25·em when not stored on the run (architect lock has ascent only).
    const h = ascentPx + 0.25 * start.fontSize * viewport.scale;
    words.push({
      text,
      rect: {
        x: Math.min(vx0, vx1),
        y: vy0 - ascentPx,
        w: Math.abs(vx1 - vx0),
        h
      }
    });
    i = j;
  }
  return words;
}

/** One run of a text line, with whether a word space follows it (a gap the PDF drew as advance, not a glyph). */
export type TjLineRun = TjGlyphRun & { space: boolean };

/**
 * Group runs (content order) into lines: same baseline, moving forward. A gap wider than 0.15 em between two
 * runs is a word space (same threshold as runsToWords); pieces of one word are merged. Upright text only.
 */
export function runsToLines(runs: TjGlyphRun[]): TjLineRun[][] {
  const lines: TjLineRun[][] = [];
  let line: TjLineRun[] = [];
  let right = 0;
  for (const r of runs) {
    if (!r.str || /^\s+$/.test(r.str)) continue;
    const prev = line.at(-1);
    const sameLine = prev && Math.abs(r.y - prev.y) < Math.max(0.5, prev.fontSize * 0.05) && r.x > right - prev.fontSize * 0.5;
    if (prev && !sameLine) {
      lines.push(line);
      line = [];
    } else if (prev) {
      prev.space = r.x - right > Math.max(prev.fontSize, r.fontSize) * 0.15;
      // Pieces of one word (split by a kerning adjustment) become one run spanning all of them.
      if (!prev.space && r.fontName === prev.fontName && Math.abs(r.fontSize - prev.fontSize) < 0.01) {
        prev.str += r.str;
        right = r.x + (r.advance ?? 0);
        prev.advance = right - prev.x;
        continue;
      }
    }
    line.push({ ...r, space: false });
    right = r.x + (r.advance ?? 0);
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * One function for every text-mark rect list: new marks before they are stored (`Reader.pdfAnchor`), stored marks
 * (including legacy per-word ones, merged on read, never migrated) before `.mark-rect` draws them, and the
 * SelectionOverlay. Steps:
 * 1. Drop a rect that lies inside another (1px tolerance): legacy marks stored `Range.getClientRects()` with each
 *    fully selected span's element box and its text box, so the two stacked into a darker band.
 * 2. Merge two rects into one when their tops and their heights each differ by <= 1px and the horizontal gap
 *    between them is under one font size. `PageRect` has no font size, so the smaller rect height stands in for it
 *    (the text box height is the font's ascent + descent, about 1.1–1.2 em, so the limit is a little over 1 em).
 *    A superscript or a different-size run stays a separate rect; one inside its line's box is then dropped by
 *    step 1 again, one that sticks out stays. Columns further apart than one font size stay separate.
 * Rects keep their true geometry: boxes of consecutive lines may overlap by a few px (line pitch < box height);
 * the draw layer (opaque boxes under one container opacity) keeps the overlap from tinting twice.
 * Output order: top to bottom, then left to right. The input is not modified.
 */
export function mergeLineRects(rects: readonly PageRect[]): PageRect[] {
  const inside = (a: PageRect, b: PageRect) => a !== b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const dropContained = (rs: PageRect[]) => rs.filter((a, i) => !rs.some((b, j) => inside(a, b) && !(inside(b, a) && j > i)));
  const lines: PageRect[] = [];
  for (const r of dropContained(rects.map((r) => ({ ...r }))).sort((a, b) => a.x - b.x || a.y - b.y)) {
    // Gap threshold is the shorter box height (≈1.17 × font size), not the font size: PageRect has no font size.
    const line = lines.find((l) => Math.abs(l.y - r.y) <= 1 && Math.abs(l.h - r.h) <= 1 && r.x - (l.x + l.w) < Math.min(l.h, r.h) && l.x - (r.x + r.w) < Math.min(l.h, r.h));
    if (!line) {
      lines.push(r);
      continue;
    }
    const x1 = Math.max(line.x + line.w, r.x + r.w), y1 = Math.max(line.y + line.h, r.y + r.h);
    line.x = Math.min(line.x, r.x);
    line.y = Math.min(line.y, r.y);
    line.w = x1 - line.x;
    line.h = y1 - line.y;
  }
  const out = dropContained(lines).sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/**
 * At most `max` rects (the stored mark's limit) without losing any of the selection: when there are more, the
 * rects from the `max`-th on are unioned into the last one (their bounding box), so the mark still reaches the
 * selection's last line. Expects `mergeLineRects` output (one rect per line, top to bottom).
 */
export function capLineRects(rects: readonly PageRect[], max: number): PageRect[] {
  if (rects.length <= max) return rects.slice();
  const tail = rects.slice(max - 1);
  const x0 = Math.min(...tail.map((r) => r.x)), y0 = Math.min(...tail.map((r) => r.y));
  const x1 = Math.max(...tail.map((r) => r.x + r.w)), y1 = Math.max(...tail.map((r) => r.y + r.h));
  return [...rects.slice(0, max - 1), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }];
}
