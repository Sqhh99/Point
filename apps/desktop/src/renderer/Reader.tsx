import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import type { Block, DocView, Mark, MarkAnchor, PageRect, ParsedDoc, TaskKind } from "@point/core";
import type { JSX } from "react";
import type { CaptureResult } from "../shared/ipc";
import { CaptureOverlay } from "./Capture";
import { SelectionOverlay, confirmDuration, PDF_CSS_BASE, type OverlayMode } from "./SelectionOverlay";
import { EmptyState } from "./EmptyState";
import { IconAsk, IconCapture, IconDiagram, IconExplain, IconMark, IconMore, IconNote } from "./icons";
import { isCaptureKey, outsideBodyRects, placeBar, rectAtCaret, type Box } from "./layout";
import { isViewBlockId, relocateBlock } from "@point/core/relocate";
import { DocError } from "./viewers/DocError";
import { DocxView } from "./viewers/DocxView";
import { PdfView, type PdfState } from "./viewers/PdfView";
import { capLineRects, mergeLineRects } from "./viewers/pdf-tj-geom";
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
  /** Page coordinates of the dragged rectangle (PDF); written into RegionAnchor.rects on mark. */
  rects?: PageRect[];
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

/** Anchor/focus signature of the current Selection, used to ignore a keyup that did not move it. */
function selectionKey(): string {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0 || s.isCollapsed) return "";
  const mark = (n: Node | null) => {
    if (!n) return "";
    const el = n instanceof Element ? n : n.parentElement;
    const page = el?.closest("[data-page]")?.getAttribute("data-page") ?? "";
    const line = (el?.closest(".pdf-line") ?? el)?.textContent?.replace(/\s+/g, " ").trim().slice(0, 32) ?? "";
    return `${page}:${line}:${n.nodeType}:${n.nodeType === Node.TEXT_NODE ? n.textContent?.length ?? 0 : 0}`;
  };
  return `${mark(s.anchorNode)}@${s.anchorOffset}|${mark(s.focusNode)}@${s.focusOffset}`;
}

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

/** Text boxes of the selected characters, one per text node. `Range.getClientRects()` would also return the border
 *  box of every fully selected word span, which differs from the text box in top and height. */
function textBoxes(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return Array.from(range.getClientRects());
  const out: DOMRect[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const sub = document.createRange();
    sub.selectNodeContents(n);
    if (n === range.startContainer) sub.setStart(n, range.startOffset);
    if (n === range.endContainer) sub.setEnd(n, range.endOffset);
    out.push(...Array.from(sub.getClientRects()));
  }
  return out;
}

/** PDF selections also record where they sit on the page (rects, one per line after mergeLineRects) and ~32 chars
 *  of text either side. */
function pdfAnchor(range: Range, text: string): Pick<SelectionInfo, "prefix" | "suffix" | "rects"> {
  const el = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const page = el?.closest<HTMLElement>(".pdf-page");
  if (!page) return {};
  const box = page.getBoundingClientRect();
  const k = Number(page.dataset.scale) / (96 / 72);
  // Merge to one rect per line first, then cap at MARK_LIMITS.rects (64): lines past the 63rd are unioned into
  // the last rect, never dropped.
  const rects = capLineRects(mergeLineRects(
    textBoxes(range)
      .filter((r) => r.width > 0.5 && r.height > 0.5 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom)
      .map((r) => ({ x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k }))
      .map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: r.h }))
  ), 64);
  const flat = (page.querySelector(".textLayer")?.textContent ?? "").replace(/\s+/g, " ");
  const q = text.replace(/\s+/g, " ");
  const i = flat.indexOf(q);
  return {
    rects: rects.length ? rects : undefined,
    prefix: i > 0 ? flat.slice(Math.max(0, i - 32), i) : undefined,
    suffix: i >= 0 && i + q.length < flat.length ? flat.slice(i + q.length, i + q.length + 32) : undefined
  };
}

/** Client-pixel capture box → page PageRect(s). Only PDFs (`.pdf-page`) produce rects. */
function pageRectsFromClient(rect: Box): { page: number; rects: PageRect[] } | null {
  const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const page = el?.closest<HTMLElement>(".pdf-page");
  if (!page) return null;
  const n = Number(page.dataset.page);
  if (!Number.isInteger(n) || n < 1) return null;
  const box = page.getBoundingClientRect();
  const k = Number(page.dataset.scale) / (96 / 72);
  if (!(k > 0)) return null;
  const r: PageRect = {
    x: Math.max(0, Math.round(((rect.x - box.left) / k) * 100) / 100),
    y: Math.max(0, Math.round(((rect.y - box.top) / k) * 100) / 100),
    w: Math.max(0.01, Math.round((rect.width / k) * 100) / 100),
    h: Math.max(0.01, Math.round((rect.height / k) * 100) / 100)
  };
  return { page: n, rects: [r] };
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
  /** Scroll to a block / page (from the marks list); a new seq re-runs. `rects` draws SelectionOverlay. */
  locate: { blockId?: string; page?: number; text?: string; rects?: PageRect[]; seq: number } | null;
  /** Bumped when the composer drops a capture (send or remove); clears the pending dashed overlay. */
  clearSelectionSeq?: number;
}

export function Reader({ docId, hasWorkspace, onDocLoaded, onAction, onOpenWorkspace, onOpenFile, onOpenRecent, vision, onCapture, onCaptureError, onMark, onRegionExplain, marks, locate, clearSelectionSeq }: ReaderProps) {
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
  /**
   * Session selection overlay (not persisted).
   * - PDF: page + PageRects, drawn inside PdfView
   * - other: local PageRects in the scroller's content coordinates
   */
  const [selection, setSelection] = useState<
    | { mode: OverlayMode; page: number; rects: PageRect[] }
    | { mode: OverlayMode; local: PageRect[] }
    | null
  >(null);
  const articleRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** Selection still in place after Esc / scroll hid the bar: a lone Shift keyup must not revive it. */
  const dismissedSel = useRef<string | null>(null);

  /** The bar's real size once rendered; a fallback before the first paint. */
  const barSize = (fallbackWidth = 340) => ({ width: toolbarRef.current?.offsetWidth || fallbackWidth, height: toolbarRef.current?.offsetHeight || TOOLBAR_H });

  const close = useCallback((opts?: { keepSelection?: boolean }) => {
    window.clearTimeout(timer.current);
    dismissedSel.current = selectionKey() || dismissedSel.current;
    setToolbar(null);
    setMore(false);
    if (!opts?.keepSelection) setSelection(null);
  }, []);

  useEffect(() => {
    if (clearSelectionSeq) setSelection(null);
  }, [clearSelectionSeq]);

  // Confirm flash: remove after fade+hold+fade (or hold only when reduced-motion).
  useEffect(() => {
    if (selection?.mode !== "confirm") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setSelection(null), confirmDuration(reduced));
    return () => window.clearTimeout(t);
  }, [selection]);

  // After 「问 AI」 the bar is gone but the dashed overlay stays until Esc / click outside / send.
  useEffect(() => {
    if (!selection || selection.mode !== "pending" || toolbar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".ai-panel, .selection-toolbar, .capture-overlay")) return;
      setSelection(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [selection, toolbar]);

  const measure = useCallback(() => {
    const article = articleRef.current;
    const s = window.getSelection();
    if (!article || !s || s.isCollapsed || s.rangeCount === 0) return setToolbar(null);
    const range = s.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return setToolbar(null);
    const text = s.toString().trim();
    if (text.length < 2) return setToolbar(null);
    const scroller = article.parentElement!;
    const union = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    // Spans are absolutely positioned, so a .pdf-line element's own box is not the glyph line.
    const lineBox = (el: Element) => {
      const boxes = el.classList.contains("pdf-line")
        ? [...el.querySelectorAll<HTMLElement>(":scope > span")].map((s) => s.getBoundingClientRect()).filter((b) => b.width >= 1 && b.height >= 1)
        : [el.getBoundingClientRect()].filter((b) => b.width >= 1 && b.height >= 1);
      if (!boxes.length) return null;
      const top = Math.min(...boxes.map((b) => b.top));
      const left = Math.min(...boxes.map((b) => b.left));
      return { top, left, width: Math.max(...boxes.map((b) => b.right)) - left, height: Math.max(...boxes.map((b) => b.bottom)) - top };
    };
    const body: { top: number; left: number; width: number; height: number }[] = [];
    for (const el of article.querySelectorAll(".pdf-line, .block")) {
      if (!el.textContent?.trim()) continue;
      const b = lineBox(el);
      if (b) body.push(b);
    }
    // Anchor at the Selection focus (the release / keyboard moving end), not the document-order
    // Range end or the union's first line. Obstacles are body lines outside the focus line, so
    // earlier selected lines block "above the last line" without treating the whole highlight
    // as a slab that would push the bar past later unselected paragraphs.
    const focusEl = s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement;
    const pdfLine = focusEl?.closest(".pdf-line");
    const clientRects = [...range.getClientRects()]
      .filter((c) => c.width >= 1 && c.height >= 1)
      .map((c) => ({ top: c.top, left: c.left, width: c.width, height: c.height }));
    let r = { top: union.top, left: union.left, width: union.width, height: union.height };
    if (pdfLine && article.contains(pdfLine)) {
      const picked = lineBox(pdfLine);
      if (picked) r = picked;
    } else if (s.focusNode && clientRects.length) {
      try {
        const caret = document.createRange();
        caret.setStart(s.focusNode, s.focusOffset);
        caret.collapse(true);
        const c = caret.getBoundingClientRect();
        const picked = rectAtCaret({ top: c.top, left: c.left, width: Math.max(c.width, 1), height: Math.max(c.height, 1) }, clientRects);
        if (picked) r = picked;
      } catch {
        // Keep the union if the focus caret cannot be resolved.
      }
    }
    // Anchor vertically at the focus line; centre horizontally on the whole highlight so a
    // short last line does not pull the bar over the previous full line. When the focus is
    // the lower end, try below first so "above the last line" cannot sit on earlier selected
    // text. Obstacles: unselected body, plus body lines clearly on the inner side of the focus.
    const unionRect = { top: union.top, left: union.left, width: union.width, height: union.height };
    const preferBelow = r.top + r.height / 2 >= union.top + union.height / 2;
    const inner = body.filter((b) => {
      const mid = b.top + b.height / 2;
      return preferBelow ? mid < r.top - r.height / 2 : mid > r.top + r.height + r.height / 2;
    });
    const p = placeBar({ top: r.top, left: union.left, width: union.width, height: r.height }, box, barSize(), {
      obstacles: [...outsideBodyRects(unionRect, body), ...inner],
      preferBelow
    });
    const top = p.top + scroller.scrollTop;
    const left = p.left;
    const where = blockAt(range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement);
    setSelection(null);
    setToolbar({ top, left, sel: { text, context: contextOf(range), page: pageOf(range), blockId: where.blockId, ...pdfAnchor(range, text) } });
  }, []);

  const onSelectEnd = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(measure, SHOW_DELAY_MS);
  }, [measure]);

  const onKeySelectEnd = useCallback(() => {
    if (dismissedSel.current && dismissedSel.current === selectionKey()) return;
    dismissedSel.current = null;
    onSelectEnd();
  }, [onSelectEnd]);

  // A drag that starts in the article must still open the bar when the pointer is
  // released on .col-resizer or the AI panel: those sit outside <article>, so the
  // article's onMouseUp never runs. Clicks that start outside stay a dismiss.
  useEffect(() => {
    let armed = false;
    const inArticle = (t: EventTarget | null) => !!(t instanceof Node && articleRef.current?.contains(t));
    const onDown = (e: PointerEvent) => {
      armed = e.button === 0 && inArticle(e.target);
    };
    const onUp = (e: MouseEvent) => {
      if (armed && e.button === 0) onSelectEnd();
      armed = false;
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("mouseup", onUp);
    };
  }, [onSelectEnd]);

  // Keyboard selections never hit article.onKeyUp: the PDF text layer is not a focused
  // control. A document keyup opens / repositions the bar at the existing Selection focus.
  // Native keyboard extend is left unchanged; this effect does not rewrite Shift+Arrow.
  useEffect(() => {
    const field = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true']");
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape" || field(e.target)) return;
      const article = articleRef.current;
      const s = window.getSelection();
      if (!article || !s || s.rangeCount === 0 || s.isCollapsed) return;
      if (!article.contains(s.anchorNode) && !article.contains(s.focusNode)) return;
      onKeySelectEnd();
    };
    document.addEventListener("keyup", onKeyUp);
    return () => document.removeEventListener("keyup", onKeyUp);
  }, [onKeySelectEnd]);

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
    // Scroll dismisses the floating bar; region dashed overlay stays (it lives on the page).
    const onScroll = () => (toolbar.region ? close({ keepSelection: true }) : close());
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("selectionchange", onSel);
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("selectionchange", onSel);
      scroller?.removeEventListener("scroll", onScroll);
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

  // Jump back to a mark: rects → confirm SelectionOverlay; else block .located / page only.
  useEffect(() => {
    if (!locate || !(doc || view)) return;
    const scroller = articleRef.current?.parentElement;

    const centerInView = (el: Element) => {
      if (!scroller) return el.scrollIntoView({ block: "center" });
      const margin = 48;
      const er = el.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const ideal = sr.top + sr.height / 2 - er.height / 2;
      let delta = er.top - ideal;
      const topAfter = er.top - delta;
      const botAfter = er.bottom - delta;
      if (topAfter < sr.top + margin) delta = er.top - (sr.top + margin);
      if (botAfter > sr.bottom - margin) delta = er.bottom - (sr.bottom - margin);
      scroller.scrollTop += delta;
    };

    if (locate.rects?.length && locate.page) {
      setSelection({ mode: "confirm", page: locate.page, rects: locate.rects });
      if (view?.kind === "pdf") setGoto({ page: locate.page, seq: locate.seq });
      // After paint, bring the overlay (or page) to the middle with ≥48px margins.
      requestAnimationFrame(() => {
        const el =
          scroller?.querySelector(`[data-testid="selection-overlay"][data-mode="confirm"]`) ??
          scroller?.querySelector(`[data-page="${locate.page}"]`);
        if (el) centerInView(el);
      });
      return;
    }
    setSelection(null);
    const target = locate.blockId && blockFor({ blockId: locate.blockId, text: locate.text ?? "" });
    if (target) {
      const m = /^s(\d+)r\d+$/.exec(target);
      if (m && view?.kind === "xlsx" && Number(m[1]) !== sheet) return setSheet(Number(m[1]));
      const el = articleRef.current?.querySelector(`[data-block-id="${CSS.escape(target)}"]`)?.closest(".block");
      if (!el) return;
      centerInView(el);
      el.classList.add("located");
      const t = window.setTimeout(() => el.classList.remove("located"), 1200);
      return () => window.clearTimeout(t);
    }
    // Old region marks (no rects): jump by page only — no whole-page flash.
    if (locate.page && view?.kind === "pdf") setGoto({ page: locate.page, seq: locate.seq });
  }, [locate?.seq, doc, view, sheet, pdfReady]);

  /** Same floating bar for a region: above the captured rectangle (below when there is no room). */
  const showRegionBar = (r: CaptureResult, rect: Box) => {
    const scroller = articleRef.current?.parentElement;
    if (!scroller) return onCapture(r);
    const box = scroller.getBoundingClientRect();
    const where = blockAt(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    const placed = pageRectsFromClient(rect);
    const page = placed?.page ?? where.page;
    const rects = placed?.rects;
    if (placed) {
      setSelection({ mode: "pending", page: placed.page, rects: placed.rects });
    } else {
      // Article-scroller content coords so the dashed box scrolls with the document.
      setSelection({
        mode: "pending",
        local: [
          {
            x: rect.x - box.left + scroller.scrollLeft,
            y: rect.y - box.top + scroller.scrollTop,
            w: rect.width,
            h: rect.height
          }
        ]
      });
    }
    const p = placeBar({ top: rect.y, left: rect.x, width: rect.width, height: rect.height }, box, barSize(260));
    const top = p.top + scroller.scrollTop;
    const left = p.left;
    setToolbar({ top, left, region: { ...r, blockId: where.blockId, page, rects } });
  };

  const run = (id: BarAction) => {
    if (!toolbar) return;
    const { sel, region } = toolbar;
    if (region) {
      // 「问 AI」: keep the dashed overlay until the composer sends / drops the capture.
      if (id === "ask") {
        close({ keepSelection: true });
        onCapture(region);
        return;
      }
      close();
      if (id === "mark") {
        const a: MarkAnchor = { kind: "region", sha: region.sha, width: region.width, height: region.height };
        if (region.blockId) a.blockId = region.blockId;
        if (region.page) a.page = region.page;
        if (region.rects?.length) a.rects = region.rects;
        onMark(a);
      } else if (id === "explain") onRegionExplain(region);
      return;
    }
    close();
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
    <ReaderBar
      title={title || "文档"}
      switcher={switcher}
      zoom={zoom}
      onZoom={setZoom}
      onFitWidth={view.kind === "pdf" ? () => setFit({ seq: Date.now() }) : undefined}
      loading={loading}
      actions={[
        {
          id: "capture",
          label: "框选",
          icon: <IconCapture />,
          onClick: startCapture,
          disabled: !vision || loading,
          title: vision ? `框选截图（${mod}）` : "当前模型不支持图片",
          pressed: !!capture,
          testId: "capture-button"
        }
      ]}
    />
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
    {selection && "local" in selection && (
      <SelectionOverlay rects={selection.local} scale={PDF_CSS_BASE} mode={selection.mode} />
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
      onKeyUp={(e) => e.key !== "Escape" && onKeySelectEnd()}
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
          selection={selection && "page" in selection ? selection : null}
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
