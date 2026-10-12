import * as XLSX from "xlsx";
import { buildDoc } from "./build.js";
import type { BlockInput, ParsedDoc } from "./types.js";

/** Cap per sheet so a huge export can't freeze the reader; the note says how many rows were cut. */
export const XLSX_MAX_ROWS = 2000;

/** Each sheet becomes a heading plus one table of its formatted cell text; empty sheets are skipped. */
export function parseXlsx(data: Uint8Array, fallbackTitle = "未命名"): ParsedDoc {
  const opts = { cellFormula: false, cellHTML: false } as const;
  const wb = isBinaryWorkbook(data)
    ? XLSX.read(data, { ...opts, type: "array" })
    : // CSV: SheetJS guesses a legacy codepage for raw bytes, which garbles UTF-8 (e.g. Chinese), so decode first.
      XLSX.read(new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, ""), { ...opts, type: "string" });
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
