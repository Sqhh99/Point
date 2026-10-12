import mammoth from "mammoth";
import { buildDoc } from "./build.js";
import { parseMarkdown } from "./markdown.js";
import type { ParsedDoc } from "./types.js";

/** DOCX → markdown (mammoth keeps headings/lists/tables) → blocks via the md parser. */
export async function parseDocx(data: Uint8Array, fallbackTitle = "未命名"): Promise<ParsedDoc> {
  // convertToMarkdown exists at runtime but is missing from mammoth's type definitions.
  const toMd = (mammoth as unknown as { convertToMarkdown: typeof mammoth.convertToHtml }).convertToMarkdown;
  const { value } = await toMd({ buffer: Buffer.from(data) });
  // mammoth escapes markdown punctuation; unescape for display text.
  const md = parseMarkdown(value, fallbackTitle);
  const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1");
  const blocks = md.blocks.map(({ id: _id, ...b }) => {
    void _id;
    if (b.type === "heading" || b.type === "paragraph" || b.type === "code") return { ...b, text: unescape(b.text) };
    if (b.type === "list") return { ...b, items: b.items.map(unescape) };
    if (b.type === "table") return { ...b, rows: b.rows.map((r) => r.map(unescape)) };
    return b;
  });
  return buildDoc("docx", blocks, fallbackTitle);
}
