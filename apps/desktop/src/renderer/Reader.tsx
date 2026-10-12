import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, ParsedDoc, TaskKind } from "@point/core";

export interface SelectionInfo {
  text: string;
  context: string;
}

const ACTIONS: { kind: TaskKind; label: string }[] = [
  { kind: "explain", label: "解读概念" },
  { kind: "note", label: "记笔记" },
  { kind: "diagram", label: "画图表" },
  { kind: "ask", label: "问 AI" }
];

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
  onDocLoaded?(doc: ParsedDoc | null): void;
  onAction(kind: TaskKind, sel: SelectionInfo): void;
}

export function Reader({ docId, hasWorkspace, onDocLoaded, onAction }: ReaderProps) {
  const [doc, setDoc] = useState<ParsedDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number; sel: SelectionInfo } | null>(null);
  const articleRef = useRef<HTMLElement>(null);

  const onSelect = useCallback(() => {
    const article = articleRef.current;
    const s = window.getSelection();
    if (!article || !s || s.isCollapsed || s.rangeCount === 0) return setToolbar(null);
    const range = s.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return setToolbar(null);
    const text = s.toString().trim();
    if (!text) return setToolbar(null);
    const scroller = article.parentElement!;
    const r = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const top = Math.max(r.top - box.top + scroller.scrollTop - 44, scroller.scrollTop + 4);
    const left = Math.min(Math.max(r.left - box.left + r.width / 2, 170), box.width - 170);
    setToolbar({ top, left, sel: { text, context: contextOf(range) } });
  }, []);

  useEffect(() => {
    const clear = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) setToolbar(null);
    };
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, []);

  useEffect(() => {
    setDoc(null);
    setError(null);
    setToolbar(null);
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

  if (!docId) return <div className="placeholder">{hasWorkspace ? "从左侧导入或选择一篇文档开始阅读" : "先在左上角选择一个工作区文件夹"}</div>;
  if (error) return <div className="placeholder">无法打开文档：{error}</div>;
  if (!doc) return <div className="placeholder">正在解析…</div>;

  let lastPage: number | undefined;
  return (
    <>
    {toolbar && (
      <div className="selection-toolbar" role="toolbar" aria-label="选区操作" style={{ top: toolbar.top, left: toolbar.left }} onMouseDown={(e) => e.preventDefault()}>
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            onClick={() => {
              onAction(a.kind, toolbar.sel);
              setToolbar(null);
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    )}
    <article className="reader" data-testid="reader" ref={articleRef} onMouseUp={onSelect} onKeyUp={onSelect}>
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
