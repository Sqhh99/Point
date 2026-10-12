import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, ParsedDoc, TaskKind } from "@point/core";
import type { JSX } from "react";
import type { CaptureResult } from "../shared/ipc";
import { CaptureOverlay } from "./Capture";
import { EmptyState } from "./EmptyState";
import { IconAsk, IconCapture, IconDiagram, IconExplain, IconNote } from "./icons";
import { isCaptureKey, type Box } from "./layout";

export interface SelectionInfo {
  text: string;
  context: string;
  page?: number;
}

const ACTIONS: { kind: TaskKind; label: string; Icon: () => JSX.Element }[] = [
  { kind: "explain", label: "解读概念", Icon: IconExplain },
  { kind: "note", label: "记笔记", Icon: IconNote },
  { kind: "diagram", label: "画图表", Icon: IconDiagram },
  { kind: "ask", label: "问 AI", Icon: IconAsk }
];

const TOOLBAR_H = 36;
const GAP = 8;
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
  onCapture(r: CaptureResult): void;
  onCaptureError(message: string): void;
}

export function Reader({ docId, hasWorkspace, onDocLoaded, onAction, onOpenWorkspace, onOpenFile, onOpenRecent, vision, onCapture, onCaptureError }: ReaderProps) {
  const [capture, setCapture] = useState<Box | null>(null);
  const [doc, setDoc] = useState<ParsedDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number; sel: SelectionInfo } | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToolbar(null);
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
    // Above the selection with an 8px gap; flip below when there is no room above.
    const roomAbove = r.top - box.top >= TOOLBAR_H + GAP;
    const top = (roomAbove ? r.top - box.top - GAP - TOOLBAR_H : r.bottom - box.top + GAP) + scroller.scrollTop;
    const half = (toolbarRef.current?.offsetWidth ?? 340) / 2 + 4;
    const left = Math.min(Math.max(r.left - box.left + r.width / 2, half), box.width - half);
    setToolbar({ top, left, sel: { text, context: contextOf(range), page: pageOf(range) } });
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
    const onSel = () => window.getSelection()?.isCollapsed && close();
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
        onDone={(r) => {
          setCapture(null);
          onCapture(r);
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
        style={{ top: toolbar.top, left: toolbar.left }}
        onMouseDown={(e) => {
          // Keep the text selection while clicking a button.
          if ((e.target as HTMLElement).closest("button")) e.preventDefault();
        }}
      >
        {ACTIONS.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            onClick={() => {
              onAction(kind, toolbar.sel);
              close();
            }}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    )}
    <article className="reader" data-testid="reader" ref={articleRef} onMouseUp={onSelectEnd} onKeyUp={(e) => e.key !== "Escape" && onSelectEnd()}>
      {doc.blocks.map((b) => {
        const marker = b.page !== undefined && b.page !== lastPage ? b.page : undefined;
        lastPage = b.page ?? lastPage;
        return (
          <div key={b.id} className="block">
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
