import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, Mark, MarkAnchor, ParsedDoc, TaskKind } from "@point/core";
import type { JSX } from "react";
import type { CaptureResult } from "../shared/ipc";
import { CaptureOverlay } from "./Capture";
import { EmptyState } from "./EmptyState";
import { IconAsk, IconCapture, IconDiagram, IconExplain, IconMark, IconMore, IconNote } from "./icons";
import { isCaptureKey, placeBar, type Box } from "./layout";

export interface SelectionInfo {
  text: string;
  context: string;
  page?: number;
  blockId?: string;
}

/** A finished region capture, with where it sits in the document. */
export interface RegionInfo extends CaptureResult {
  page?: number;
  /** Rectangle in the reader's content coordinates (what a region mark stores). */
  rect: { x: number; y: number; width: number; height: number };
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
  locate: { blockId?: string; y?: number; seq: number } | null;
}

export function Reader({ docId, hasWorkspace, onDocLoaded, onAction, onOpenWorkspace, onOpenFile, onOpenRecent, vision, onCapture, onCaptureError, onMark, onRegionExplain, marks, locate }: ReaderProps) {
  const [capture, setCapture] = useState<Box | null>(null);
  const [more, setMore] = useState(false);
  const [doc, setDoc] = useState<ParsedDoc | null>(null);
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
    setToolbar({ top, left, sel: { text, context: contextOf(range), page: pageOf(range), blockId: where.blockId } });
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

  // Jump back to a mark's block and flash it briefly.
  useEffect(() => {
    if (!locate || !doc) return;
    const article = articleRef.current;
    if (locate.y !== undefined && article) {
      // Region marks: scroll to the stored rectangle (content coordinates).
      article.parentElement?.scrollTo({ top: Math.max(0, article.offsetTop + locate.y - 40) });
      return;
    }
    if (!locate.blockId) return;
    const el = article?.querySelector(`[data-block-id="${CSS.escape(locate.blockId)}"]`)?.closest(".block");
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("located");
    const t = window.setTimeout(() => el.classList.remove("located"), 1200);
    return () => window.clearTimeout(t);
  }, [locate?.seq, doc]);

  /** Same floating bar for a region: above the captured rectangle (below when there is no room). */
  const showRegionBar = (r: CaptureResult, rect: Box) => {
    const scroller = articleRef.current?.parentElement;
    if (!scroller) return onCapture(r);
    const box = scroller.getBoundingClientRect();
    const where = blockAt(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    const p = placeBar({ top: rect.y, left: rect.x, width: rect.width, height: rect.height }, box, barSize(260));
    const top = p.top + scroller.scrollTop;
    const left = p.left;
    const art = articleRef.current!.getBoundingClientRect();
    const contentRect = { x: Math.max(0, Math.round(rect.x - art.left)), y: Math.max(0, Math.round(rect.y - art.top)), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    setToolbar({ top, left, region: { ...r, page: where.page, rect: contentRect } });
  };

  const run = (id: BarAction) => {
    if (!toolbar) return;
    const { sel, region } = toolbar;
    close();
    if (region) {
      if (id === "ask") onCapture(region);
      else if (id === "mark") onMark({ kind: "region", sha: region.sha, page: region.page, rect: region.rect });
      else if (id === "explain") onRegionExplain(region);
      return;
    }
    if (!sel) return;
    if (id === "mark") {
      onMark({ kind: "text", text: sel.text, blockId: sel.blockId, page: sel.page, context: sel.context });
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
    setError(null);
    setCapture(null);
    close();
    onDocLoaded?.(null);
    if (!docId) return;
    let live = true;
    window.point.docs
      .get(docId)
      .then((d) => {
        if (!live) return;
        setDoc(d);
        onDocLoaded?.(d);
      })
      .catch((e: Error) => live && setError(e.message));
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
  if (error) return <div className="placeholder">无法打开文档：{error}</div>;
  if (!doc) return <div className="placeholder">正在解析…</div>;

  const marked = new Set(marks.map((m) => (m.anchor.kind === "text" ? m.anchor.blockId : undefined)).filter((x): x is string => !!x));
  let lastPage: number | undefined;
  const mod = window.point.platform === "darwin" ? "⌘⇧S" : "Ctrl+Shift+S";
  return (
    <>
    <div className="reader-toolbar" role="toolbar" aria-label="阅读工具">
      {/* Disabled buttons swallow hover, so the tooltip lives on the wrapper. */}
      <span title={vision ? undefined : "当前模型不支持图片"}>
      <button
        className="tool-button"
        data-testid="capture-button"
        onClick={startCapture}
        disabled={!vision}
        title={vision ? `框选截图（${mod}）` : "当前模型不支持图片"}
        aria-pressed={!!capture}
      >
        <IconCapture />
        <span>框选</span>
      </button>
      </span>
    </div>
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
    <article className="reader" data-testid="reader" ref={articleRef} onMouseUp={onSelectEnd} onKeyUp={(e) => e.key !== "Escape" && onSelectEnd()}>
      {doc.blocks.map((b) => {
        const marker = b.page !== undefined && b.page !== lastPage ? b.page : undefined;
        lastPage = b.page ?? lastPage;
        return (
          <div key={b.id} className={marked.has(b.id) ? "block marked" : "block"}>
            {marker !== undefined && marker > 1 && <div className="page-marker">第 {marker} 页</div>}
            <BlockView b={b} />
          </div>
        );
      })}
      {doc.blocks.length === 0 && <div className="placeholder">这篇文档没有可提取的文字</div>}
    </article>
    </>
  );
}
