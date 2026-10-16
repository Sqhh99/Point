import type { DocView } from "./view.js";

// Pure and import-light on purpose: the renderer bundles this file directly (no mammoth/xlsx/node).
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|[<>]/g;
const VOID = new Set(["br", "hr"]);
// A selection spans these as line/cell breaks, so they count as whitespace when matching a quote.
const BREAKS = new Set(["li", "p", "td", "th", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "br"]);

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Text of each top-level element of the sanitized docx HTML, in order: index i is the reader's block id `d<i>`. */
export function docxBlockTexts(html: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    if (m[0] === "<" || m[0] === ">") continue;
    if (depth > 0 && out.length) out[out.length - 1] += html.slice(last, m.index);
    last = m.index + m[0].length;
    const name = m[2].toLowerCase();
    if (depth > 0 && out.length && BREAKS.has(name)) out[out.length - 1] += " ";
    if (m[1] === "/") depth = Math.max(0, depth - 1);
    else if (VOID.has(name)) {
      if (depth === 0) out.push("");
    } else {
      if (depth === 0) out.push("");
      depth++;
    }
  }
  return out.map((t) => squash(decode(t)));
}

/**
 * Marks made before the original-look viewers carry a block id of the old extracted-text model (`b<n>`),
 * which no longer exists. This finds the block that now holds the quote: `d<i>` for Word, `s<n>r<m>` for Excel.
 */
export function relocateBlock(view: DocView, quote: string): string | undefined {
  const q = squash(quote);
  if (!q) return undefined;
  const probes = [q, q.split(/\n/)[0] ? squash(quote.split(/\n/)[0]!) : q, q.slice(0, 40)].filter(Boolean);
  const hit = (texts: string[]) => {
    for (const p of probes) {
      const i = texts.findIndex((t) => t && (t.includes(p) || (p.length > 3 && p.includes(t) && t.length >= 2)));
      if (i >= 0) return i;
    }
    return -1;
  };
  if (view.kind === "docx") {
    const i = hit(docxBlockTexts(view.html));
    return i >= 0 ? `d${i}` : undefined;
  }
  if (view.kind === "xlsx") {
    for (let s = 0; s < view.sheets.length; s++) {
      const i = hit(view.sheets[s]!.rows.map((r) => squash(r.map((c) => c.v).join(" "))));
      if (i >= 0) return `s${s}r${i}`;
    }
  }
  return undefined;
}

/** Block ids the current viewers produce. */
export const isViewBlockId = (id: string): boolean => /^d\d+$/.test(id) || /^s\d+r\d+$/.test(id);
