import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import type { Block, DocView, Mark, MarkAnchor, PageRect, ParsedDoc, TaskKind } from "@point/core";
import type { JSX } from "react";
import type { CaptureResult } from "../shared/ipc";
import { CaptureOverlay } from "./Capture";
import { EmptyState } from "./EmptyState";
import { IconAsk, IconCapture, IconDiagram, IconExplain, IconMark, IconMore, IconNote } from "./icons";
import { isCaptureKey, placeBar, type Box } from "./layout";
import { isViewBlockId, relocateBlock } from "@point/core/relocate";
import { DocError } from "./viewers/DocError";
import { DocxView } from "./viewers/DocxView";
import { PdfView, type PdfState } from "./viewers/PdfView";
import { ReaderBar } from "./viewers/ReaderBar";
import { SheetGrid, SheetTabs } from "./viewers/SheetView";

export interface SelectionInfo {
  text: string;
  context: string;
  page?: number;
  blockId?: string;
  /** PDF: extracted-text context around the quote, and where it sits on the page. */
  prefix?: string;
  suffix?: string;
  rects?: PageRect[];
}

/** A finished region capture, with where it sits in the document. */
export interface RegionInfo extends CaptureResult {
  page?: number;
  blockId?: string;
}

type BarAction = "ask" | "mark" | "explain" | "note" | "diagram";
// Design v0.2: 「问 AI · 标记 · 解读」; 记笔记 / 画图表 stay reachable under 「更多」 for text.
const MAIN_ACTIONS: { id: BarAction; label: string; Icon: () => JSX.Element }[] = [
  { id: "ask", label: "问 AI", Icon: IconAsk },
  { id: "mark", label: "标记", Icon: IconMark },
  { id: "explain", label: "解读", Icon: IconExplain }
];
const MORE_ACTIONS: { id: BarAction; label: string; Icon: () => JSX.Element }[] = [
  { id: "note", label: "记笔记", Icon: IconNote },
  { id: "diagram", label: "画图表", Icon: IconDiagram }
];

function blockAt(el: Element | null): { blockId?: string; page?: number } {
  const b = el?.closest("[data-block-id]");
  const page = Number(el?.closest("[data-page]")?.getAttribute("data-page"));
  return { blockId: b?.getAttribute("data-block-id") ?? undefined, page: Number.isInteger(page) && page > 0 ? page : undefined };
}

const TOOLBAR_H = 36;
const SHOW_DELAY_MS = 120;

function pageOf(range: Range): number | undefined {
  const el = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest("[data-page]");
  const n = Number(el?.getAttribute("data-page"));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Text of the blocks just before and after the selection, for prompt context. */
function contextOf(range: Range): string {
  const blockOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest(".block") ?? null;
  const first = blockOf(range.startContainer);
  const last = blockOf(range.endContainer);
  const parts = [first?.previousElementSibling, first, last !== first ? last : null, last?.nextElementSibling];
  return parts
    .filter((e): e is Element => !!e)
    .map((e) => e.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

/** PDF selections also record where they sit on the page (rects) and ~32 chars of text either side. */
function pdfAnchor(range: Range, text: string): Pick<SelectionInfo, "prefix" | "suffix" | "rects"> {
  const el = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const page = el?.closest<HTMLElement>(".pdf-page");
  if (!page) return {};
  const box = page.getBoundingClientRect();
  const k = Number(page.dataset.scale) / (96 / 72);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0.5 && r.height > 0.5 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom)
    .slice(0, 64)
    .map((r) => ({ x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k }))
    .map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: r.h }));
  const flat = (page.querySelector(".textLayer")?.textContent ?? "").replace(/\s+/g, " ");
  const q = text.replace(/\s+/g, " ");
  const i = flat.indexOf(q);
  return {
    rects: rects.length ? rects : undefined,
    prefix: i > 0 ? flat.slice(Math.max(0, i - 32), i) : undefined,
    suffix: i >= 0 && i + q.length < flat.length ? flat.slice(i + q.length, i + q.length + 32) : undefined
  };
}

const stripIpc = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function BlockView({ b }: { b: Block }) {
  const common = { "data-block-id": b.id, "data-page": b.page };
  switch (b.type) {
    case "heading": {
      const H = `h${Math.min(Math.max(b.level, 1), 6)}` as "h1";
      return <H {...common}>{b.text}</H>;
    }
    case "paragraph":
      return <p {...common}>{b.text}</p>;
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L {...common}>
          {b.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </L>
      );
    }
    case "code":
      return (
        <pre {...common}>
          <code>{b.text}</code>
        </pre>
      );
    case "table":
      return (
        <table {...common}>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "image":
      return (
        <figure className="image-placeholder" {...common}>
          图片{b.alt ? `：${b.alt}` : ""}
        </figure>
      );
  }
}

interface ReaderProps {
  docId: string | null;
  hasWorkspace: boolean;
  onOpenWorkspace(): void;
  onOpenFile(): void;
  onOpenRecent(index: number, path: string): void;
  onDocLoaded?(doc: ParsedDoc | null): void;
  onAction(kind: TaskKind, sel: SelectionInfo): void;
  /** Whether the current model accepts images; capture is disabled otherwise. */
  vision: boolean;
  /** 问 AI on a region: attach it to the composer. */
  onCapture(r: CaptureResult): void;
  onCaptureError(message: string): void;
  onMark(anchor: MarkAnchor): void;
  /** 解读 on a region. */
  onRegionExplain(r: RegionInfo): void;
  marks: Mark[];
  /** Scroll to a block (from the marks list); a new seq re-runs. */
  locate: { blockId?: string; page?: number; text?: string; seq: number } | null;
}

export function Reader({ docId, hasWorkspace, onDocLoaded, onAction, onOpenWorkspace, onOpenFile, onOpenRecent, vision, onCapture, onCaptureError, onMark, onRegionExplain, marks, locate }: ReaderProps) {
  const [capture, setCapture] = useState<Box | null>(null);
  const [more, setMore] = useState(false);
  const [doc, setDoc] = useState<ParsedDoc | null>(null);
  const [view, setView] = useState<DocView | null>(null);
  const [title, setTitle] = useState("");
  const [zoom, setZoom] = useState(100);
  const [sheet, setSheet] = useState(0);
  const [pdf, setPdf] = useState<PdfState>({ count: 0, current: 1 });
  const [pdfReady, setPdfReady] = useState(false);
  const [goto, setGoto] = useState<{ page: number; seq: number } | null>(null);
  const [fit, setFit] = useState<{ seq: number; max?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number; sel?: SelectionInfo; region?: RegionInfo } | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  /** The bar's real size once rendered; a fallback before the first paint. */
  const barSize = (fallbackWidth = 340) => ({ width: toolbarRef.current?.offsetWidth || fallbackWidth, height: toolbarRef.current?.offsetHeight || TOOLBAR_H });

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToolbar(null);
    setMore(false);
  }, []);

  const measure = useCallback(() => {
    const article = articleRef.current;
    const s = window.getSelection();
    if (!article || !s || s.isCollapsed || s.rangeCount === 0) return setToolbar(null);
    const range = s.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return setToolbar(null);
    const text = s.toString().trim();
    if (text.length < 2) return setToolbar(null);
    const scroller = article.parentElement!;
    const r = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    // Above the selection with an 8px gap; flipped below when there is no room; never on top of it.
    const p = placeBar(r, box, barSize());
    const top = p.top + scroller.scrollTop;
    const left = p.left;
    const where = blockAt(range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement);
    setToolbar({ top, left, sel: { text, context: contextOf(range), page: pageOf(range), blockId: where.blockId, ...pdfAnchor(range, text) } });
  }, []);

  const onSelectEnd = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(measure, SHOW_DELAY_MS);
  }, [measure]);

  // Dismiss on Esc, outside click, scroll, or when the selection collapses.
  useEffect(() => {
    if (!toolbar) return;
    const scroller = articleRef.current?.parentElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      // Tab moves into the toolbar; native focus order then walks its buttons, Enter triggers.
      if (e.key === "Tab" && !toolbarRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        toolbarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) close();
    };
    const onSel = () => !toolbar.region && window.getSelection()?.isCollapsed && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("selectionchange", onSel);
    scroller?.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("selectionchange", onSel);
      scroller?.removeEventListener("scroll", close);
    };
  }, [toolbar, close]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** The block a text mark sits on in this view; marks from the extracted-text era (`b<n>`) are relocated by their quote. */
  const blockFor = useCallback(
    (a: { blockId?: string; text: string }): string | undefined => {
      if (!view || view.kind === "pdf") return a.blockId;
      if (view.kind === "md" || (a.blockId && isViewBlockId(a.blockId))) return a.blockId;
      return relocateBlock(view, a.text);
    },
    [view]
  );
  const markedIds = useMemo(() => new Set(marks.map((m) => (m.anchor.kind === "text" ? blockFor(m.anchor) : undefined)).filter((x): x is string => !!x)), [marks, blockFor]);

  // Jump back to a mark: its block (switching sheet first for Excel) or, in a PDF, its page.
  useEffect(() => {
    if (!locate || !(doc || view)) return;
    const target = locate.blockId && blockFor({ blockId: locate.blockId, text: locate.text ?? "" });
    if (target) {
      const m = /^s(\d+)r\d+$/.exec(target);
      if (m && view?.kind === "xlsx" && Number(m[1]) !== sheet) return setSheet(Number(m[1]));
      const el = articleRef.current?.querySelector(`[data-block-id="${CSS.escape(target)}"]`)?.closest(".block");
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("located");
      const t = window.setTimeout(() => el.classList.remove("located"), 1200);
      return () => window.clearTimeout(t);
    }
    if (locate.page && view?.kind === "pdf") setGoto({ page: locate.page, seq: locate.seq });
  }, [locate?.seq, doc, view, sheet, pdfReady]);

  /** Same floating bar for a region: above the captured rectangle (below when there is no room). */
  const showRegionBar = (r: CaptureResult, rect: Box) => {
    const scroller = articleRef.current?.parentElement;
    if (!scroller) return onCapture(r);
    const box = scroller.getBoundingClientRect();
    const where = blockAt(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    const p = placeBar({ top: rect.y, left: rect.x, width: rect.width, height: rect.height }, box, barSize(260));
    const top = p.top + scroller.scrollTop;
    const left = p.left;
    setToolbar({ top, left, region: { ...r, ...where } });
  };

  const run = (id: BarAction) => {
    if (!toolbar) return;
    const { sel, region } = toolbar;
    close();
    if (region) {
      if (id === "ask") onCapture(region);
      else if (id === "mark") onMark({ kind: "region", sha: region.sha, width: region.width, height: region.height, blockId: region.blockId, page: region.page });
      else if (id === "explain") onRegionExplain(region);
      return;
    }
    if (!sel) return;
    if (id === "mark") {
      onMark({ kind: "text", text: sel.text, blockId: sel.blockId, page: sel.page, context: sel.context, prefix: sel.prefix, suffix: sel.suffix, rects: sel.rects });
      window.getSelection()?.removeAllRanges();
    } else onAction(id, sel);
  };

  const startCapture = useCallback(() => {
    const scroller = articleRef.current?.parentElement;
    if (!scroller || !vision) return;
    close();
    window.getSelection()?.removeAllRanges();
    const r = scroller.getBoundingClientRect();
    setCapture({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [vision, close]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isCaptureKey(e, window.point.platform)) return;
      e.preventDefault();
      startCapture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, startCapture]);

  useEffect(() => {
    setDoc(null);
    setView(null);
    setError(null);
    setCapture(null);
    setZoom(100);
    setSheet(0);
    setPdf({ count: 0, current: 1 });
    setPdfReady(false);
    setGoto(null); // a previous PDF's "go to page 2" must not replay on the next one
    setFit(null);
    setTitle("");
    // A new document starts at the top, whatever the previous one's scroll position was.
    const scroller = articleRef.current?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollLeft = 0;
    close();
    onDocLoaded?.(null);
    if (!docId) return;
    let live = true;
    const api = window.point.docs;
    // The text blocks (title, markdown, prompts) and the original-looking view load side by side.
    void Promise.allSettled([api.get(docId), api.view(docId)]).then(([text, shown]) => {
      if (!live) return;
      if (shown.status === "rejected") return setError(stripIpc(shown.reason));
      if (shown.value.kind === "md" && text.status === "rejected") return setError(stripIpc(text.reason));
      const d = text.status === "fulfilled" ? text.value : null;
      setTitle(d?.title ?? "");
      setView(shown.value);
      if (shown.value.kind === "md") setDoc(d);
      onDocLoaded?.(d);
    });
    return () => {
      live = false;
    };
  }, [docId]);

  if (!docId)
    return hasWorkspace ? (
      <div className="placeholder">从左侧选择一篇文档，或者再打开一个文件</div>
    ) : (
      <EmptyState onOpenWorkspace={onOpenWorkspace} onOpenFile={onOpenFile} onOpenRecent={onOpenRecent} />
    );
  if (error && docId) return <DocError docId={docId} message={error} />;
  if (!view || (view.kind === "md" && !doc))
    return (
      <div className="placeholder" aria-busy="true" data-testid="doc-loading">
        正在打开…
      </div>
    );

  const markTexts = new Map<number, string[]>();
  const markRects = new Map<number, PageRect[]>();
  for (const m of marks) {
    const a = m.anchor;
    if (a.kind !== "text" || !a.page) continue;
    if (a.rects?.length) markRects.set(a.page, [...(markRects.get(a.page) ?? []), ...a.rects]);
    else markTexts.set(a.page, [...(markTexts.get(a.page) ?? []), a.text]);
  }
  let lastPage: number | undefined;
  const mod = window.point.platform === "darwin" ? "⌘⇧S" : "Ctrl+Shift+S";
  const sheets = view.kind === "xlsx" ? view.sheets : [];
  const loading = view.kind === "pdf" && !pdfReady;
  const switcher =
    view.kind === "pdf"
      ? { unit: "页" as const, label: `${pdf.current} / ${pdf.count || "…"}`, canPrev: pdf.current > 1, canNext: pdf.current < pdf.count, onPrev: () => setGoto({ page: pdf.current - 1, seq: Date.now() }), onNext: () => setGoto({ page: pdf.current + 1, seq: Date.now() }) }
      : view.kind === "xlsx" && sheets.length > 0
        ? { unit: "工作表" as const, label: `${sheet + 1} / ${sheets.length}`, canPrev: sheet > 0, canNext: sheet < sheets.length - 1, onPrev: () => setSheet(sheet - 1), onNext: () => setSheet(sheet + 1) }
        : undefined;
  return (
    <>
    <ReaderBar title={title || "文档"} switcher={switcher} zoom={zoom} onZoom={setZoom} onFitWidth={view.kind === "pdf" ? () => setFit({ seq: Date.now() }) : undefined} loading={loading}>
      {/* Disabled buttons swallow hover, so the tooltip lives on the wrapper. */}
      <span title={vision ? undefined : "当前模型不支持图片"}>
      <button
        className="tool-button"
        data-testid="capture-button"
        onClick={startCapture}
        disabled={!vision || loading}
        title={vision ? `框选截图（${mod}）` : "当前模型不支持图片"}
        aria-pressed={!!capture}
      >
        <IconCapture />
        <span>框选</span>
      </button>
      </span>
    </ReaderBar>
    {capture && (
      <CaptureOverlay
        bounds={capture}
        onCancel={() => setCapture(null)}
        onDone={(r, rect) => {
          setCapture(null);
          showRegionBar(r, rect);
        }}
        onError={(m) => {
          setCapture(null);
          onCaptureError(m);
        }}
      />
    )}
    {toolbar && (
      <div
        ref={toolbarRef}
        className="selection-toolbar"
        role="toolbar"
        aria-label="选区操作"
        data-kind={toolbar.region ? "region" : "text"}
        style={{ top: toolbar.top, left: toolbar.left }}
        onMouseDown={(e) => {
          // Keep the text selection while clicking a button.
          if ((e.target as HTMLElement).closest("button")) e.preventDefault();
        }}
      >
        {[...MAIN_ACTIONS, ...(more && toolbar.sel ? MORE_ACTIONS : [])].map(({ id, label, Icon }) => (
          <button key={id} onClick={() => run(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
        {toolbar.sel && !more && (
          <button onClick={() => setMore(true)} aria-label="更多" title="记笔记 · 画图表">
            <IconMore />
          </button>
        )}
      </div>
    )}
    <article
      className={view.kind === "md" ? "reader" : `reader-doc doc-${view.kind}`}
      data-testid="reader"
      data-kind={view.kind}
      ref={articleRef}
      onMouseUp={onSelectEnd}
      onKeyUp={(e) => e.key !== "Escape" && onSelectEnd()}
    >
      {view.kind === "md" && doc && (
        <div style={{ zoom: zoom / 100 }}>
          {doc.blocks.map((b) => {
            const marker = b.page !== undefined && b.page !== lastPage ? b.page : undefined;
            lastPage = b.page ?? lastPage;
            return (
              <div key={b.id} className={markedIds.has(b.id) ? "block marked" : "block"}>
                {marker !== undefined && marker > 1 && <div className="page-marker">第 {marker} 页</div>}
                <BlockView b={b} />
              </div>
            );
          })}
          {doc.blocks.length === 0 && <div className="placeholder">这篇文档没有可提取的文字</div>}
        </div>
      )}
      {view.kind === "pdf" && (
        <PdfView
          data={view.data}
          zoom={zoom}
          goto={goto}
          markTexts={markTexts}
          markRects={markRects}
          fit={fit}
          onFit={setZoom}
          onState={setPdf}
          onReady={() => {
            setPdfReady(true);
            // Open at the panel width instead of a fixed 100% that clips the right edge.
            setFit({ seq: Date.now(), max: 100 });
          }}
          onError={(m) => setError(`PDF 无法渲染：${m}`)}
        />
      )}
      {view.kind === "docx" && <DocxView html={view.html} images={view.images} zoom={zoom} markedIds={markedIds} />}
      {view.kind === "xlsx" &&
        (sheets[sheet] ? <SheetGrid sheet={sheets[sheet]} index={sheet} zoom={zoom} markedIds={markedIds} /> : <div className="placeholder">这个表格是空的</div>)}
    </article>
    {view.kind === "xlsx" && sheets.length > 0 && <SheetTabs sheets={sheets} active={sheet} onSelect={setSheet} />}
    </>
  );
}
