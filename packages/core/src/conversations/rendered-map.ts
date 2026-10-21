import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { spanMatches } from "./tree.js";

/** One visible character of rendered markdown and its UTF-16 offset in the source (-1 = not locatable). */
export interface VisibleChar {
  ch: string;
  off: number;
}

/**
 * The visible characters of a markdown answer, in document order, each with its source offset.
 * Built from the mdast: only `text`, `inlineCode` and `code` values are mapped. Link and image URLs,
 * markup (`**`, backticks, `[`, `](…)`), html tags and images never produce visible characters.
 */
export function visibleChars(source: string): VisibleChar[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  const out: VisibleChar[] = [];
  const push = (value: string, start?: number, end?: number) => {
    if (start === undefined || end === undefined) {
      for (const ch of value) out.push({ ch, off: -1 });
      return;
    }
    const slice = source.slice(start, end);
    // Usual case: the value is a contiguous run of the node's own source (text, `code`, fenced code).
    const at = value.length ? slice.indexOf(value) : -1;
    if (at >= 0) {
      for (let i = 0; i < value.length; i++) out.push({ ch: value[i]!, off: start + at + i });
      return;
    }
    // Escapes / entities (`\*`, `&amp;`): locate each char inside this node's slice only, never beyond it.
    let j = 0;
    for (let i = 0; i < value.length; i++) {
      const k = slice.indexOf(value[i]!, j);
      out.push({ ch: value[i]!, off: k < 0 ? -1 : start + k });
      if (k >= 0) j = k + 1;
    }
  };
  const walk = (n: Nodes) => {
    if (n.type === "text" || n.type === "inlineCode" || n.type === "code") {
      push(n.value, n.position?.start.offset, n.position?.end.offset);
      return;
    }
    if (n.type === "html" || n.type === "image" || n.type === "imageReference" || n.type === "definition") return;
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  walk(tree);
  return out;
}

const isSpace = (c: string) => /\s/.test(c);

/**
 * Map a selection on the rendered answer back to a source span, used only as the branch anchor.
 * `before` is the visible text preceding the selection, `selected` the selected visible text (both as
 * the DOM shows them). Whitespace is ignored on both sides; every other character must line up with
 * the mdast's visible characters, or the result is null (no branch). Never returns a misaligned slice.
 */
export function sourceSpanOf(source: string, before: string, selected: string): { start: number; end: number; quote: string } | null {
  const vis = visibleChars(source).filter((c) => !isSpace(c.ch));
  const pre = before.split("").filter((c) => !isSpace(c)).join("");
  const sel = selected.split("").filter((c) => !isSpace(c)).join("");
  if (!sel || pre.length + sel.length > vis.length) return null;
  for (let i = 0; i < pre.length; i++) if (vis[i]!.ch !== pre[i]) return null;
  for (let i = 0; i < sel.length; i++) {
    const v = vis[pre.length + i]!;
    if (v.ch !== sel[i] || v.off < 0) return null;
  }
  const first = vis[pre.length]!;
  const last = vis[pre.length + sel.length - 1]!;
  const start = first.off;
  let end = last.off + 1;
  // Keep a surrogate pair whole.
  const code = source.charCodeAt(last.off);
  if (code >= 0xd800 && code <= 0xdbff) end++;
  if (end <= start) return null;
  const quote = source.slice(start, end);
  return spanMatches(source, start, end, quote) ? { start, end, quote } : null;
}
