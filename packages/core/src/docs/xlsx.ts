import * as XLSX from "xlsx";
import { buildDoc } from "./build.js";
import type { BlockInput, ParsedDoc } from "./types.js";

/** Cap per sheet so a huge export can't freeze the reader; the note says how many rows were cut. */
export const XLSX_MAX_ROWS = 2000;

/** Each sheet becomes a heading plus one table of its formatted cell text; empty sheets are skipped. */
export function readWorkbook(data: Uint8Array): XLSX.WorkBook {
  // No formulas, no HTML, no VBA/macros (vbaraw stays off). cellStyles only makes SheetJS keep column widths.
  const opts = { cellFormula: false, cellHTML: false, bookVBA: false, cellStyles: true } as const;
  return isBinaryWorkbook(data)
    ? XLSX.read(data, { ...opts, type: "array" })
    : // CSV: SheetJS guesses a legacy codepage for raw bytes, which garbles Chinese, so decode it ourselves.
      XLSX.read(decodeCsv(data), { ...opts, type: "string" });
}

export function parseXlsx(data: Uint8Array, fallbackTitle = "未命名"): ParsedDoc {
  const wb = readWorkbook(data);
  const blocks: BlockInput[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false }) as unknown[][])
      .map((r) => r.map((c) => String(c ?? "")));
    if (!rows.some((r) => r.some((c) => c.trim() !== ""))) continue;
    const width = Math.max(...rows.map((r) => r.length));
    const kept = rows.slice(0, XLSX_MAX_ROWS).map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
    blocks.push({ type: "heading", level: 2, text: name }, { type: "table", rows: kept });
    if (rows.length > XLSX_MAX_ROWS) blocks.push({ type: "paragraph", text: `（仅显示前 ${XLSX_MAX_ROWS} 行，共 ${rows.length} 行）` });
  }
  if (blocks.length === 0) blocks.push({ type: "paragraph", text: "（表格是空的）" });
  return { ...buildDoc("xlsx", blocks, fallbackTitle), title: fallbackTitle };
}

/** .xlsx is a zip (PK), .xls is an OLE compound file; anything else is treated as CSV text. */
function isBinaryWorkbook(d: Uint8Array): boolean {
  const zip = d[0] === 0x50 && d[1] === 0x4b;
  const ole = d[0] === 0xd0 && d[1] === 0xcf && d[2] === 0x11 && d[3] === 0xe0;
  return zip || ole;
}

/**
 * CSV text: a BOM wins (UTF-8, UTF-16LE/BE — Excel's "Unicode text" export); otherwise strict UTF-8,
 * falling back to GB18030 (a superset of GBK), which is what Excel writes on Chinese Windows.
 */
export function decodeCsv(d: Uint8Array): string {
  if (d[0] === 0xef && d[1] === 0xbb && d[2] === 0xbf) return new TextDecoder("utf-8").decode(d.subarray(3));
  if (d[0] === 0xff && d[1] === 0xfe) return new TextDecoder("utf-16le").decode(d.subarray(2));
  if (d[0] === 0xfe && d[1] === 0xff) return new TextDecoder("utf-16be").decode(d.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(d);
  } catch {
    return new TextDecoder("gb18030").decode(d);
  }
}
