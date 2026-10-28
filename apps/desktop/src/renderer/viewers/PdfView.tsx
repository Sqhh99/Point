import { useEffect, useRef, useState } from "react";
import type { PageRect } from "@point/core";
import { SelectionOverlay, type OverlayMode } from "../SelectionOverlay";
import { BundledCMaps, BundledStandardFonts } from "./pdf-assets";
import { buildPageTextGeom, runsToLines, type PdfPageForGeom, type TjLineRun } from "./pdf-tj-geom";
import type { PDFDocumentProxy, PageViewport, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
/** 1 PDF point = 4/3 CSS px at 100%. */
const BASE = 96 / 72;

let pdfjsP: Promise<Pdfjs> | undefined;
/** pdf.js with its worker bundled and run in-process: no worker file path, no network. */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsP ??= (async () => {
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const g = globalThis as { pdfjsWorker?: unknown };
    g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return lib;
  })();
  return pdfjsP;
}

export interface PdfState {
  count: number;
  current: number;
}

interface Props {
  data: Uint8Array;
  zoom: number;
  /** Scroll to this page; a new seq re-runs. */
  goto: { page: number; seq: number } | null;
  /** Text of marks per page, for the shared highlight. */
  markTexts: Map<number, string[]>;
  /** Stored highlight rectangles per page (page coordinates at 100% zoom). */
  markRects: Map<number, PageRect[]>;
  /** Session selection (pending capture or mark locate); drawn as a dashed overlay on that page. */
  selection: { page: number; rects: PageRect[]; mode: OverlayMode } | null;
  fit: { seq: number; max?: number } | null;
  onFit(zoom: number): void;
  onState(s: PdfState): void;
  onReady(): void;
  onError(message: string): void;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function Page({ doc, n, scale, size, marks, rects, selection }: { doc: PDFDocumentProxy; n: number; scale: number; size: [number, number]; marks: string[]; rects: PageRect[]; selection: { rects: PageRect[]; mode: OverlayMode } | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const t = text.current;
    if (!c || !t) return;
    if (!near) {
      c.width = 0;
      t.replaceChildren();
      return;
    }
    let live = true;
    let task: RenderTask | undefined;
    void (async () => {
      try {
        const page = await doc.getPage(n);
        if (!live) return;
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.floor(viewport.width * dpr);
        c.height = Math.floor(viewport.height * dpr);
        c.style.width = `${Math.floor(viewport.width)}px`;
        c.style.height = `${Math.floor(viewport.height)}px`;
        // Pages may differ in size: the real one wins over the page-1 estimate.
        if (wrap.current) {
          wrap.current.style.width = c.style.width;
          wrap.current.style.height = c.style.height;
        }
        const ctx = c.getContext("2d");
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
        await task.promise;
        if (!live) return;
        // Layout comes from the operator list (glyph origins and advances, as the canvas drew them);
        // getTextContent only supplies the fallback font family per font and the PDF's /Lang.
        const [geom, content] = await Promise.all([buildPageTextGeom(page as unknown as PdfPageForGeom), page.getTextContent()]);
        if (!live) return;
        t.replaceChildren();
        t.style.setProperty("--scale-factor", String(viewport.scale));
        // Spans are sized by measuring their text on a canvas whose lang is the PDF's /Lang ("" when unset).
        // The layer must resolve fonts with that same lang: inheriting the app's lang="zh-CN" turns generic
        // serif/sans-serif into CJK fonts (SimSun / YaHei on Windows) whose Latin widths differ.
        t.lang = content.lang ?? "";
        // The embedded font first (pdf.js registered it under the run's font name to draw the canvas), so layer
        // glyphs have the canvas glyphs' shapes; getTextContent's fallback family when the font is not loaded.
        const families = new Map(Object.entries(content.styles).map(([k, v]) => [k, v.fontFamily]));
        const family = (name: string) => `${document.fonts.check(`10px "${name}"`) ? `"${name}", ` : ""}${families.get(name) ?? "sans-serif"}`;
        renderTextLayer(t, runsToLines(geom.runs), viewport, family);
        closeLineGaps(t);
        trackSelection(t);
        if (live) setDone((d) => d + 1);
      } catch (e) {
        if ((e as { name?: string }).name !== "RenderingCancelledException") console.warn("pdf page", n, e);
      }
    })();
    return () => {
      live = false;
      task?.cancel();
      // The spans stay until the rebuild replaces them; dropping the scale marks them as superseded
      // (a selection made in them now is lost when the new layer lands).
      t.style.removeProperty("--scale-factor");
      selectionLayers.delete(t);
    };
  }, [near, doc, n, scale]);

  // Same highlight as the other formats: lines whose text lies inside a marked passage.
  useEffect(() => {
    const t = text.current;
    if (!t) return;
    const hay = marks.map(norm);
    t.querySelectorAll(".pdf-line").forEach((line) => {
      const x = norm(line.textContent ?? "");
      const on = x.length >= 2 && hay.some((h) => h.includes(x));
      line.querySelectorAll("span").forEach((s) => s.classList.toggle("marked", on));
    });
  }, [marks, done]);

  return (
    <div className="pdf-page" ref={wrap} data-page={n} data-scale={scale} data-testid="pdf-page" style={{ width: Math.floor(size[0] * scale), height: Math.floor(size[1] * scale) }}>
      <canvas ref={canvas} aria-hidden />
      {rects.map((r, i) => (
        <div key={i} className="mark-rect" data-testid="mark-rect" style={{ left: r.x * scale / BASE, top: r.y * scale / BASE, width: r.w * scale / BASE, height: r.h * scale / BASE }} />
      ))}
      {selection && selection.rects.length > 0 && <SelectionOverlay rects={selection.rects} scale={scale} mode={selection.mode} />}
      <div className="textLayer pdf-text" ref={text} />
    </div>
  );
}

export function PdfView({ data, zoom, goto, markTexts, markRects, selection, fit, onFit, onState, onReady, onError }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState<[number, number]>([612, 792]);
  const cb = useRef({ onState, onReady, onError, onFit });
  cb.current = { onState, onReady, onError, onFit };

  useEffect(() => {
    let live = true;
    let opened: PDFDocumentProxy | undefined;
    setDoc(null);
    void (async () => {
      try {
        const lib = await loadPdfjs();
        // No scripting, forms/XFA, eval, range/stream fetching or remote fonts: bytes in, pixels out. System fonts stand in for non-embedded standard fonts.
        const d = await lib.getDocument({
          data: new Uint8Array(data),
          isEvalSupported: false,
          enableXfa: false,
          // Fonts are built from the bytes pdf.js hands us (no URL, so CSP is untouched); the path-based mode drops glyphs with the in-process worker.
          disableFontFace: false,
          useSystemFonts: true,
          useWorkerFetch: false,
          StandardFontDataFactory: BundledStandardFonts as never,
          CMapReaderFactory: BundledCMaps as never,
          disableRange: true,
          disableStream: true,
          disableAutoFetch: true,
          verbosity: 0
        }).promise;
        opened = d;
        if (!live) return void d.destroy();
        const p1 = await d.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        setSize([v.width, v.height]);
        setDoc(d);
        cb.current.onState({ count: d.numPages, current: 1 });
        cb.current.onReady();
      } catch (e) {
        if (live) cb.current.onError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      live = false;
      void opened?.destroy();
    };
  }, [data]);

  const scale = (BASE * zoom) / 100;

  // Zoom / fit-width change the page height in CSS px; scrollTop is still in the old scale's pixels, so the
  // page that was centred walks out of the IntersectionObserver and its text layer is cleared. Re-anchor
  // to the page we were looking at (and, when possible, the same offset within it).
  const anchor = useRef<{ page: number; ratio: number }>({ page: 1, ratio: 0 });
  useEffect(() => {
    const scroller = root.current?.closest(".reader-doc")?.parentElement;
    if (!doc || !scroller) return;
    const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
    let page = 1;
    let ratio = 0;
    let best = Infinity;
    root.current?.querySelectorAll<HTMLElement>(".pdf-page").forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < best) {
        best = d;
        page = Number(el.dataset.page) || 1;
        ratio = r.height > 0 ? (mid - r.top) / r.height : 0;
      }
    });
    anchor.current = { page, ratio: Math.min(1, Math.max(0, ratio)) };
    const on = () => {
      const mid2 = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
      let p = 1;
      let rat = 0;
      let b = Infinity;
      root.current?.querySelectorAll<HTMLElement>(".pdf-page").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid2);
        if (d < b) {
          b = d;
          p = Number(el.dataset.page) || 1;
          rat = r.height > 0 ? (mid2 - r.top) / r.height : 0;
        }
      });
      anchor.current = { page: p, ratio: Math.min(1, Math.max(0, rat)) };
    };
    scroller.addEventListener("scroll", on, { passive: true });
    return () => scroller.removeEventListener("scroll", on);
  }, [doc]);

  useEffect(() => {
    const scroller = root.current?.closest(".reader-doc")?.parentElement;
    if (!doc || !scroller) return;
    const { page, ratio } = anchor.current;
    const el = root.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!el) return;
    // After layout for the new scale: put the same page (same relative offset) back under the viewport middle.
    const apply = () => {
      const box = scroller.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const target = scroller.scrollTop + (r.top - box.top) + r.height * ratio - scroller.clientHeight / 2;
      scroller.scrollTop = Math.max(0, target);
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }, [scale, doc]);

  // Current page = the one nearest the middle of the scroller.
  useEffect(() => {
    const scroller = root.current?.closest(".reader-doc")?.parentElement;
    if (!doc || !scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
      let best = 1;
      let bestD = Infinity;
      root.current?.querySelectorAll<HTMLElement>(".pdf-page").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestD) {
          bestD = d;
          best = Number(el.dataset.page);
        }
      });
      cb.current.onState({ count: doc.numPages, current: best });
    };
    const on = () => raf || (raf = requestAnimationFrame(update));
    scroller.addEventListener("scroll", on, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [doc]);

  useEffect(() => {
    if (!goto || !doc) return;
    root.current?.querySelector(`[data-page="${goto.page}"]`)?.scrollIntoView({ block: "start" });
  }, [goto?.seq, doc]);

  useEffect(() => {
    if (!fit || !doc || !root.current) return;
    // Measure the panel, not the page column (which grows with the pages).
    const avail = (root.current.closest(".reader-doc")?.clientWidth ?? root.current.clientWidth) - 48;
    cb.current.onFit(Math.max(25, Math.min(fit.max ?? 400, Math.round(((avail / size[0]) / BASE) * 100))));
  }, [fit?.seq]);

  return (
    <div className="pdf-doc" ref={root} data-testid="pdf-doc">
      {doc && Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} scale={scale} size={size} marks={markTexts.get(i + 1) ?? []} rects={markRects.get(i + 1) ?? []} selection={selection?.page === i + 1 ? { rects: selection.rects, mode: selection.mode } : null} />)}
    </div>
  );
}

/**
 * Text layer from the operator-list runs: one `.pdf-line` span per line holding one span per run, each at the
 * run's own glyph origin (top = baseline − ascent). Canvas draws the glyphs; these spans are transparent and
 * only hit-test and select. Each run is stretched to its own PDF advance (never a whole line), and its line
 * height puts the layer font's baseline on the PDF baseline.
 */
function renderTextLayer(layer: HTMLElement, lines: TjLineRun[][], viewport: PageViewport, family: (fontName: string) => string) {
  const probe = document.createElement("canvas");
  // Measure with the layer's lang, so generic families resolve to the same fonts as in the layer.
  probe.lang = layer.lang;
  probe.style.display = "none";
  document.body.append(probe);
  const ctx = probe.getContext("2d")!;
  const boxes = new Map<string, { a: number; d: number }>();
  const box = (fam: string) => {
    let b = boxes.get(fam);
    if (!b) {
      ctx.font = `100px ${fam}`;
      const m = ctx.measureText("x");
      b = { a: m.fontBoundingBoxAscent / 100, d: m.fontBoundingBoxDescent / 100 };
      boxes.set(fam, b);
    }
    return b;
  };
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const runs = line.map((r) => {
      const [x, y] = viewport.convertToViewportPoint(r.x, r.y) as [number, number];
      const size = r.fontSize * viewport.scale;
      const asc = r.ascent / r.fontSize;
      const fam = family(r.fontName);
      const { a, d } = box(fam);
      // line-height 1 puts the baseline at (lh − a − d) / 2 + a; solve for a baseline at the PDF ascent.
      const lh = Math.min(2, Math.max(0.5, 2 * asc - a + d));
      ctx.font = `${size}px ${fam}`;
      const w = ctx.measureText(r.str).width;
      const adv = (r.advance ?? 0) * viewport.scale;
      // No advance or nothing measurable (empty / unsupported glyphs): no stretch rather than NaN or Infinity.
      const sx = w > 0 && adv > 0 && Number.isFinite(adv / w) ? adv / w : 1;
      return { r, fam, size, lh, left: x, top: y - asc * size, right: x + adv, bottom: y - asc * size + lh * size, sx, space: ctx.measureText(" ").width };
    });
    const left = Math.min(...runs.map((x) => x.left));
    const top = Math.min(...runs.map((x) => x.top));
    const el = document.createElement("span");
    el.className = "pdf-line";
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(...runs.map((x) => x.right)) - left}px`, height: `${Math.max(...runs.map((x) => x.bottom)) - top}px` });
    runs.forEach((x, i) => {
      const s = document.createElement("span");
      s.textContent = x.r.space ? `${x.r.str} ` : x.r.str;
      // scaleX from the left edge, so the run keeps its PDF x (style.css sets it too; explicit here).
      Object.assign(s.style, { left: `${x.left - left}px`, top: `${x.top - top}px`, fontSize: `${x.size}px`, fontFamily: x.fam, lineHeight: String(x.lh), transform: `scaleX(${x.sx})`, transformOrigin: "0 0" });
      // The word space reaches the next word, so a selection has no holes in justified lines.
      const next = runs[i + 1];
      // Never negative: a negative word-spacing would pull the next word's hit area over this one.
      if (x.r.space && next) s.style.wordSpacing = `${Math.max(0, (next.left - x.right) / x.sx - x.space)}px`;
      el.append(s);
    });
    frag.append(el, document.createElement("br"));
  }
  probe.remove();
  layer.append(frag);
}

/**
 * pdf.js TextLayer's selection guard (4.10 `#enableGlobalSelectionListener` / `#bindMouse`), for this span layer.
 * Each layer ends with a `.endOfContent` div; while selecting (`.selecting`) it covers the whole layer under the
 * spans. In Chromium it is moved right after the selection's moving end, so dragging into a line gap or below the
 * text hits it and the selection stays where it was instead of jumping to the end of the layer. Inside a
 * `.pdf-line` it is offset back to the layer's origin so it still covers the whole layer.
 */
const selectionLayers = new Map<HTMLElement, HTMLDivElement>();
let selectionListening = false;
let prevRange: Range | null = null;

function resetSelectionLayer(end: HTMLDivElement, layer: HTMLElement) {
  layer.append(end);
  Object.assign(end.style, { left: "", top: "", width: "", height: "" });
  layer.classList.remove("selecting");
}

function trackSelection(layer: HTMLElement) {
  const end = document.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  selectionLayers.set(layer, end);
  layer.onpointerdown = () => layer.classList.add("selecting");
  if (selectionListening) return;
  selectionListening = true;
  let pointerDown = false;
  const resetAll = () => selectionLayers.forEach(resetSelectionLayer);
  document.addEventListener("pointerdown", () => (pointerDown = true));
  document.addEventListener("pointerup", () => ((pointerDown = false), resetAll()));
  window.addEventListener("blur", () => ((pointerDown = false), resetAll()));
  document.addEventListener("keyup", () => !pointerDown && resetAll());
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return resetAll();
    const active = new Set<HTMLElement>();
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      for (const l of selectionLayers.keys()) if (r.intersectsNode(l)) active.add(l);
    }
    for (const [l, end] of selectionLayers) {
      if (active.has(l)) l.classList.add("selecting");
      else resetSelectionLayer(end, l);
    }
    const range = sel.getRangeAt(0);
    const modifyStart = !!prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (anchor && !modifyStart && range.endOffset === 0) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? null;
      } while (anchor && !anchor.childNodes.length);
    }
    prevRange = range.cloneRange();
    const parent = anchor?.parentElement;
    const layer = parent?.closest<HTMLElement>(".pdf-text");
    const end = layer && selectionLayers.get(layer);
    if (!anchor || !parent || !layer || !end || anchor === end) return;
    const off = parent === layer ? { x: 0, y: 0 } : { x: parent.offsetLeft, y: parent.offsetTop };
    Object.assign(end.style, { left: `${-off.x}px`, top: `${-off.y}px`, width: `${layer.clientWidth}px`, height: `${layer.clientHeight}px` });
    parent.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  });
}

/**
 * Selection gaps between lines: run spans are about one font-size tall, so a multi-line selection
 * shows strips of page between lines. Give each span a line box as tall as the distance to the next line
 * below it (same column, close enough to be the same paragraph), centred on the glyphs so they don't move.
 * Ratios are in em, so they hold for the span's own font size.
 */
function closeLineGaps(layer: HTMLElement) {
  const spans = [...layer.querySelectorAll<HTMLElement>(".pdf-line > span")].filter((s) => s.textContent);
  const lr = layer.getBoundingClientRect();
  const boxes = spans.map((s) => {
    const r = s.getBoundingClientRect();
    return { s, top: r.top - lr.top, bottom: r.bottom - lr.top, left: r.left - lr.left, right: r.right - lr.left, size: parseFloat(getComputedStyle(s).fontSize) };
  });
  // Spans grouped by line top (half-pixel buckets), tops ascending: one pass over the rows below each span.
  const rows = new Map<number, typeof boxes>();
  for (const b of boxes) {
    const k = Math.round(b.top * 2) / 2;
    rows.set(k, [...(rows.get(k) ?? []), b]);
  }
  const tops = [...rows.keys()].sort((a, b) => a - b);
  const bands: { b: (typeof boxes)[number]; top: number; bottom: number }[] = [];
  for (const b of boxes) {
    if (!(b.size > 0)) continue;
    const h = b.bottom - b.top;
    // Next line: the first row below this span (within 1.8 × its height) that overlaps it horizontally.
    let pitch = 0;
    for (const t of tops) {
      if (t <= b.top + h * 0.5) continue;
      if (t - b.top >= h * 1.8) break;
      if (rows.get(t)!.some((o) => o.left < b.right && o.right > b.left)) {
        pitch = t - b.top;
        break;
      }
    }
    if (!(pitch > h && pitch < h * 1.8)) continue;
    // 1px more than the pitch: adjacent lines overlap by a pixel instead of leaving a rounding seam. The
    // selection is solid inside the layer (opacity is on the layer), so the overlap is not darker.
    const box = pitch + 1;
    const lh = box / b.size;
    b.s.style.lineHeight = String(lh);
    b.s.style.marginTop = `${-(lh - h / b.size) / 2}em`;
    bands.push({ b, top: b.top - (box - h) / 2, bottom: b.bottom + (box - h) / 2 });
  }
  // Smaller spans inside a line (superscripts, footnote marks) take the band of the nearest full-size span
  // of that line, so the selection has no hole around them. Their glyphs are transparent, so moving the
  // text inside the taller box is invisible.
  const done = new Set(bands.map((x) => x.b));
  for (const b of boxes) {
    if (done.has(b) || !(b.size > 0)) continue;
    const mid = (b.top + b.bottom) / 2;
    let best: (typeof bands)[number] | null = null;
    let dist = Infinity;
    for (const x of bands) {
      if (mid < x.top || mid > x.bottom || x.b.size <= b.size) continue;
      const d = Math.max(0, x.b.left - b.right, b.left - x.b.right);
      if (d < dist) [best, dist] = [x, d];
    }
    if (!best || dist > best.b.size * 2) continue;
    b.s.style.lineHeight = String((best.bottom - best.top) / b.size);
    b.s.style.marginTop = `${(best.top - b.top) / b.size}em`;
  }
}
