import { parseDocx } from "./docx.js";
import { parseMarkdown } from "./markdown.js";
import { parsePdf } from "./pdf.js";
import { parseXlsx } from "./xlsx.js";
import type { DocType, ParsedDoc } from "./types.js";

export const DOC_EXTENSIONS: Record<DocType, string[]> = { pdf: ["pdf"], docx: ["docx"], md: ["md", "markdown"], xlsx: ["xlsx", "xls", "csv"] };

export function docTypeOf(fileName: string): DocType | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return (Object.keys(DOC_EXTENSIONS) as DocType[]).find((t) => DOC_EXTENSIONS[t].includes(ext));
}

export async function parseDocument(type: DocType, data: Uint8Array, fallbackTitle: string): Promise<ParsedDoc> {
  if (type === "md") return parseMarkdown(new TextDecoder().decode(data), fallbackTitle);
  if (type === "docx") return parseDocx(data, fallbackTitle);
  if (type === "xlsx") return parseXlsx(data, fallbackTitle);
  return parsePdf(data, fallbackTitle);
}

export { parseDocx, parseMarkdown, parsePdf, parseXlsx };
export { XLSX_MAX_ROWS, decodeCsv } from "./xlsx.js";
export type { Block, DocType, OutlineItem, ParsedDoc } from "./types.js";
