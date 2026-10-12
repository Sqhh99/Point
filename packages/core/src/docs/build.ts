import type { Block, BlockInput, DocType, ParsedDoc } from "./types.js";

/** Assigns sequential ids, derives outline and title. */
export function buildDoc(type: DocType, inputs: BlockInput[], fallbackTitle: string): ParsedDoc {
  const blocks = inputs.map((b, i) => ({ ...b, id: `b${i}` }) as Block);
  const outline = blocks.flatMap((b) => (b.type === "heading" ? [{ blockId: b.id, level: b.level, text: b.text }] : []));
  const top = outline.find((o) => o.level === 1) ?? outline[0];
  return { type, title: top?.text || fallbackTitle, blocks, outline };
}
