import { useEffect, useRef, useState } from "react";
import type { PageRect } from "@point/core";
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
  fit: { seq: number } | null;
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
        t.replaceChildren();
        t.style.setProperty("--scale-factor", String(viewport.scale));
        const tl = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: t, viewport });
        layer = tl;
        await tl.render();
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
          disableFontFace: true,
          useSystemFonts: true,
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
    const avail = root.current.clientWidth - 48;
    cb.current.onFit(Math.max(25, Math.min(400, Math.round(((avail / size[0]) / BASE) * 100))));
  }, [fit?.seq]);

  return (
    <div className="pdf-doc" ref={root} data-testid="pdf-doc">
      {doc && Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} scale={scale} size={size} marks={markTexts.get(i + 1) ?? []} rects={markRects.get(i + 1) ?? []} />)}
    </div>
  );
}
