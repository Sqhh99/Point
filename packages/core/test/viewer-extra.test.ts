import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { XLSX_MAX_ROWS, docTypeOf, parseDocument, parseXlsx } from "../src/index.js";
import { makeDocx, makePdf } from "./fixtures/make.js";

type Table = { type: "table"; rows: string[][] };
const tables = (d: { blocks: { type: string }[] }) => d.blocks.filter((b): b is Table => b.type === "table").map((t) => t.rows);
const headings = (d: { blocks: { type: string; text?: string }[] }) => d.blocks.filter((b) => b.type === "heading").map((b) => b.text);

function write(wb: XLSX.WorkBook, bookType: XLSX.BookType = "xlsx"): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
}
function book(sheets: Record<string, XLSX.WorkSheet>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [n, s] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, s, n);
  return wb;
}
const enc = (s: string) => new TextEncoder().encode(s);
function utf16le(s: string, bom = true): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + s.length * 2);
  let o = 0;
  if (bom) {
    out[o++] = 0xff;
    out[o++] = 0xfe;
  }
  for (let i = 0; i < s.length; i++) {
    out[o++] = s.charCodeAt(i) & 0xff;
    out[o++] = s.charCodeAt(i) >> 8;
  }
  return out;
}

describe("xlsx workbooks", () => {
  it("keeps every non-empty sheet in order and skips empty ones", () => {
    const d = parseXlsx(write(book({
      一: XLSX.utils.aoa_to_sheet([["a"]]),
      空: XLSX.utils.aoa_to_sheet([]),
      只有空白: XLSX.utils.aoa_to_sheet([["  ", ""]]),
      三: XLSX.utils.aoa_to_sheet([["c"]])
    })), "t");
    expect(headings(d)).toEqual(["一", "三"]);
    expect(tables(d)).toEqual([[["a"]], [["c"]]]);
  });

  it("a workbook whose sheets are all empty shows the empty note", () => {
    const d = parseXlsx(write(book({ A: XLSX.utils.aoa_to_sheet([]), B: XLSX.utils.aoa_to_sheet([[""]]) })), "t");
    expect(d.blocks).toEqual([expect.objectContaining({ type: "paragraph", text: "（表格是空的）" })]);
  });

  it("merged cells show the value once (top-left) and blanks for the rest", () => {
    const s = XLSX.utils.aoa_to_sheet([["合并", null, "x"], [null, null, "y"]]);
    s["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }];
    expect(tables(parseXlsx(write(book({ S: s })), "t"))[0]).toEqual([["合并", "", "x"], ["", "", "y"]]);
  });

  it("formulas show the cached value and are not recomputed", () => {
    const s = XLSX.utils.aoa_to_sheet([[1, 2, null]]);
    s["C1"] = { t: "n", f: "A1+B1", v: 999 }; // stale cache on purpose
    expect(tables(parseXlsx(write(book({ S: s })), "t"))[0]).toEqual([["1", "2", "999"]]);
  });

  it("dates use the cell number format instead of a serial number", () => {
    // Excel stores dates as serial numbers + a format; 46307 = 2026-10-12 (timezone-independent).
    const serial = (Date.UTC(2026, 9, 12) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const s = XLSX.utils.aoa_to_sheet([["x", "y"]]);
    s["A1"] = { t: "n", v: serial, z: "yyyy-mm-dd" };
    s["B1"] = { t: "n", v: serial + 0.5, z: "yyyy-mm-dd hh:mm" };
    expect(tables(parseXlsx(write(book({ S: s })), "t"))[0]).toEqual([["2026-10-12", "2026-10-12 12:00"]]);
  });

  it("large sheet: capped at XLSX_MAX_ROWS with a note, and parses within 5s", () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => [i, `行${i}`, i * 2, "x".repeat(10)]);
    const data = write(book({ 大: XLSX.utils.aoa_to_sheet(rows) }));
    const t0 = performance.now();
    const d = parseXlsx(data, "t");
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(tables(d)[0]).toHaveLength(XLSX_MAX_ROWS);
    expect(d.blocks.at(-1)).toMatchObject({ type: "paragraph", text: `（仅显示前 ${XLSX_MAX_ROWS} 行，共 20000 行）` });
  });

  it("exactly XLSX_MAX_ROWS rows has no truncation note", () => {
    const d = parseXlsx(write(book({ S: XLSX.utils.aoa_to_sheet(Array.from({ length: XLSX_MAX_ROWS }, (_, i) => [i])) })), "t");
    expect(tables(d)[0]).toHaveLength(XLSX_MAX_ROWS);
    expect(d.blocks.some((b) => b.type === "paragraph")).toBe(false);
  });

  it("legacy .xls (BIFF8) is read", () => {
    const d = parseXlsx(write(book({ 旧: XLSX.utils.aoa_to_sheet([["名", "值"], ["甲", 1]]) }), "biff8"), "t");
    expect(tables(d)[0]).toEqual([["名", "值"], ["甲", "1"]]);
  });

  it("corrupt xlsx (zip header, garbage body) rejects instead of crashing", async () => {
    const bad = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array(200).fill(7)]);
    await expect(parseDocument("xlsx", bad, "t")).rejects.toThrow();
  });

  it("truncated xlsx rejects", async () => {
    const good = write(book({ S: XLSX.utils.aoa_to_sheet([["a"]]) }));
    await expect(parseDocument("xlsx", good.slice(0, good.length / 2), "t")).rejects.toThrow();
  });
});

describe("csv", () => {
  const expected = [["名字", "备注"], ["张三", "你好"]];
  it("UTF-8 without BOM", () => {
    expect(tables(parseXlsx(enc("名字,备注\n张三,你好\n"), "t"))[0]).toEqual(expected);
  });
  it("UTF-8 with BOM (Excel's 'CSV UTF-8')", () => {
    expect(tables(parseXlsx(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("名字,备注\r\n张三,你好\r\n")]), "t"))[0]).toEqual(expected);
  });
  it("quotes, escaped quotes, commas and newlines inside cells", () => {
    const csv = 'a,b\n"含,逗号","他说""好"""\n"两\n行",x\n';
    expect(tables(parseXlsx(enc(csv), "t"))[0]).toEqual([["a", "b"], ["含,逗号", '他说"好"'], ["两\n行", "x"]]);
  });
  it("empty csv shows the empty note", () => {
    expect(parseXlsx(new Uint8Array(), "t").blocks).toEqual([expect.objectContaining({ text: "（表格是空的）" })]);
  });
  it("numbers like leading zeros / long ids are not mangled into numbers", () => {
    expect(tables(parseXlsx(enc("id\n00123\n"), "t"))[0]).toEqual([["id"], ["00123"]]);
  });

  // Bug: everything that is not zip/OLE is decoded as UTF-8. Excel's "Unicode Text"/UTF-16 CSV
  // (BOM FF FE) comes out as mojibake with NUL characters.
  it.fails("UTF-16LE with BOM", () => {
    expect(tables(parseXlsx(utf16le("名字,备注\r\n张三,你好\r\n"), "t"))[0]).toEqual(expected);
  });

  // Bug: Excel on Chinese Windows saves "CSV (逗号分隔)" as GBK; decoding it as UTF-8 garbles every Chinese cell.
  it.fails("GBK (Excel default on Chinese Windows)", () => {
    // "名字,备注\r\n张三,你好\r\n" in GBK
    const gbk = new Uint8Array([0xc3, 0xfb, 0xd7, 0xd6, 0x2c, 0xb1, 0xb8, 0xd7, 0xa2, 0x0d, 0x0a, 0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0xc4, 0xe3, 0xba, 0xc3, 0x0d, 0x0a]);
    expect(tables(parseXlsx(gbk, "t"))[0]).toEqual(expected);
  });
});

/** Appends an /Encrypt dictionary (standard handler, unknown user password) as an incremental update. */
function encryptedPdf(): Uint8Array {
  let s = new TextDecoder("latin1").decode(makePdf([["secret"]]));
  const prev = Number(/startxref\n(\d+)/.exec(s)![1]);
  const size = Number(/\/Size (\d+)/.exec(s)![1]);
  const hex = (n: number) => "<" + "ab".repeat(n) + ">";
  const off = s.length;
  s += `${size} 0 obj\n<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O ${hex(32)} /U ${hex(32)} >>\nendobj\n`;
  const xref = s.length;
  s += `xref\n${size} 1\n${String(off).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${size + 1} /Root 1 0 R /Prev ${prev} /Encrypt ${size} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

describe("pdf / docx edge files", () => {
  it("encrypted PDF rejects (no hang, no crash)", async () => {
    await expect(parseDocument("pdf", encryptedPdf(), "t")).rejects.toThrow();
  }, 15_000);

  it.each(["pdf", "docx"] as const)("0-byte %s rejects", async (type) => {
    await expect(parseDocument(type, new Uint8Array(), "t")).rejects.toThrow();
  });
  it("0-byte md is an empty doc titled by the file name", async () => {
    const d = await parseDocument("md", new Uint8Array(), "空文件");
    expect(d.title).toBe("空文件");
  });

  it("a PDF named .docx rejects as docx", async () => {
    await expect(parseDocument("docx", makePdf([["x"]]), "t")).rejects.toThrow();
  });
  it("a DOCX named .pdf rejects as pdf", async () => {
    await expect(parseDocument("pdf", await makeDocx([{ text: "x" }]), "t")).rejects.toThrow();
  }, 15_000);
  it("a DOCX named .xlsx rejects (zip but no workbook)", async () => {
    await expect(parseDocument("xlsx", await makeDocx([{ text: "x" }]), "t")).rejects.toThrow();
  });
});

describe("docTypeOf edge names", () => {
  it.each([
    ["报告.PDF", "pdf"], ["表 📊.xlsx", "xlsx"], ["a.b.c.csv", "xlsx"], ["dir.pdf/x.md", "md"], ["C:\\docs\\a.DOCX", "docx"]
  ])("%s → %s", (n, t) => expect(docTypeOf(n)).toBe(t));
  it.each([["a.pdf."], ["a.pdf "], [".pdf"], ["pdf"], ["a.pdf\\"], ["a.exe"], ["a.xlsm"]])("%j is not a document", (n) => {
    // ".pdf" alone: hidden file with no name — accepted or not, it must never be "exe"-like; only assert the clear cases
    if (n === ".pdf") return void expect(["pdf", undefined]).toContain(docTypeOf(n));
    expect(docTypeOf(n)).toBeUndefined();
  });
});
