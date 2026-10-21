import { useEffect, useRef, useState } from "react";
import type { PageRect } from "@point/core";
import { BundledCMaps, BundledStandardFonts } from "./pdf-assets";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";

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
  fit: { seq: number; max?: number } | null;
  onFit(zoom: number): void;
  onState(s: PdfState): void;
  onReady(): void;
  onError(message: string): void;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function Page({ doc, n, scale, size, marks, rects }: { doc: PDFDocumentProxy; n: number; scale: number; size: [number, number]; marks: string[]; rects: PageRect[] }) {
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
    let layer: { cancel(): void } | undefined;
    void (async () => {
      try {
        const lib = await loadPdfjs();
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
        const content = await page.getTextContent();
        if (!live) return;
        t.replaceChildren();
        t.style.setProperty("--scale-factor", String(viewport.scale));
        // pdf.js sizes each span by measuring its text on a canvas whose lang is the PDF's /Lang ("" when
        // unset). The layer must resolve fonts with that same lang: inheriting the app's lang="zh-CN"
        // turns generic serif/sans-serif into CJK fonts (SimSun / YaHei on Windows) whose Latin widths
        // differ, so spans overlap and drift from the glyphs.
        t.lang = content.lang ?? "";
        const tl = new lib.TextLayer({ textContentSource: content, container: t, viewport });
        layer = tl;
        await tl.render();
        if (!live) return;
        closeLineGaps(t);
        if (live) setDone((d) => d + 1);
      } catch (e) {
        if ((e as { name?: string }).name !== "RenderingCancelledException") console.warn("pdf page", n, e);
      }
    })();
    return () => {
      live = false;
      task?.cancel();
      layer?.cancel();
    };
  }, [near, doc, n, scale]);

  // Same highlight as the other formats: spans whose text lies inside a marked passage.
  useEffect(() => {
    const t = text.current;
    if (!t) return;
    const hay = marks.map(norm);
    t.querySelectorAll("span").forEach((s) => {
      const x = norm(s.textContent ?? "");
      s.classList.toggle("marked", x.length >= 2 && hay.some((h) => h.includes(x)));
    });
  }, [marks, done]);

  return (
    <div className="pdf-page" ref={wrap} data-page={n} data-scale={scale} data-testid="pdf-page" style={{ width: Math.floor(size[0] * scale), height: Math.floor(size[1] * scale) }}>
      <canvas ref={canvas} aria-hidden />
      {rects.map((r, i) => (
        <div key={i} className="mark-rect" data-testid="mark-rect" style={{ left: r.x * scale / BASE, top: r.y * scale / BASE, width: r.w * scale / BASE, height: r.h * scale / BASE }} />
      ))}
      <div className="textLayer pdf-text" ref={text} />
    </div>
  );
}

export function PdfView({ data, zoom, goto, markTexts, markRects, fit, onFit, onState, onReady, onError }: Props) {
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
      {doc && Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} scale={scale} size={size} marks={markTexts.get(i + 1) ?? []} rects={markRects.get(i + 1) ?? []} />)}
    </div>
  );
}

/**
 * Selection gaps between lines: spans are one font-size tall (line-height 1), so a multi-line selection
 * shows strips of page between lines. Give each span a line box as tall as the distance to the next line
 * below it (same column, close enough to be the same paragraph), centred on the glyphs so they don't move.
 * Ratios are in em, so they hold for the span's own font size.
 */
function closeLineGaps(layer: HTMLElement) {
  const spans = [...layer.querySelectorAll<HTMLElement>("span:not(.markedContent)")].filter((s) => s.textContent);
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
    const lh = pitch / b.size;
    b.s.style.lineHeight = String(lh);
    b.s.style.marginTop = `${-(lh - h / b.size) / 2}em`;
    bands.push({ b, top: b.top - (pitch - h) / 2, bottom: b.bottom + (pitch - h) / 2 });
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
