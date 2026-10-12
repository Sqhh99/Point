import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { XLSX_MAX_ROWS, docTypeOf, parseDocument, parseXlsx } from "../src/index.js";

function book(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("xlsx", () => {
  it("maps extensions", () => {
    expect(docTypeOf("a.XLSX")).toBe("xlsx");
    expect(docTypeOf("a.xls")).toBe("xlsx");
    expect(docTypeOf("a.csv")).toBe("xlsx");
  });

  it("turns each non-empty sheet into a heading and a padded table", async () => {
    const d = await parseDocument("xlsx", book({ 成绩: [["姓名", "分数"], ["张三", 90], ["李四"]], 空: [], 备注: [["ok"]] }), "表");
    expect(d.title).toBe("表");
    expect(d.blocks.map((b) => b.type)).toEqual(["heading", "table", "heading", "table"]);
    expect(d.blocks[1]).toMatchObject({ rows: [["姓名", "分数"], ["张三", "90"], ["李四", ""]] });
    expect(d.outline.map((o) => o.text)).toEqual(["成绩", "备注"]);
  });

  it("caps very long sheets and says so", () => {
    const rows = Array.from({ length: XLSX_MAX_ROWS + 5 }, (_, i) => [i]);
    const d = parseXlsx(book({ s: rows }), "x");
    expect(d.blocks[1]).toMatchObject({ type: "table" });
    expect((d.blocks[1] as { rows: string[][] }).rows).toHaveLength(XLSX_MAX_ROWS);
    expect(d.blocks[2]).toMatchObject({ type: "paragraph", text: expect.stringContaining(String(XLSX_MAX_ROWS + 5)) });
  });

  it("an empty workbook still renders a note", () => {
    expect(parseXlsx(book({ a: [] }), "x").blocks).toEqual([expect.objectContaining({ type: "paragraph" })]);
  });

  it("does not evaluate formulas or keep HTML", () => {
    const ws = XLSX.utils.aoa_to_sheet([["<img src=x onerror=alert(1)>"]]);
    ws["B1"] = { t: "n", f: "1+1", v: 2 };
    ws["!ref"] = "A1:B1";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "s");
    const d = parseXlsx(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer), "x");
    expect((d.blocks[1] as { rows: string[][] }).rows[0]).toEqual(["<img src=x onerror=alert(1)>", "2"]);
  });

  it("reads UTF-8 CSV (with or without BOM) without garbling Chinese", () => {
    for (const text of ["姓名,分数\n张三,90\n", "\uFEFF姓名,分数\n张三,90\n"]) {
      const doc = parseXlsx(new TextEncoder().encode(text), "scores");
      const table = doc.blocks.find((b) => b.type === "table");
      expect(JSON.stringify(table)).toContain("张三");
      expect(JSON.stringify(table)).toContain("姓名");
    }
  });
});
