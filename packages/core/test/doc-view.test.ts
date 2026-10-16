import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildDocView, parseAnchor, sanitizeDocxHtml } from "../src/index";
import { makeDocx, makePdf } from "./fixtures/make";

describe("doc views", () => {
  it("pdf: hands the original bytes to the renderer", async () => {
    const bytes = makePdf([["a"], ["b"]]);
    const v = await buildDocView("pdf", bytes);
    expect(v.kind).toBe("pdf");
    expect(v.kind === "pdf" && v.data.length).toBe(bytes.length);
  });

  it("docx: headings and text become sanitized html", async () => {
    const v = await buildDocView("docx", await makeDocx([{ style: "Heading1", text: "标题" }, { text: "正文 <b>x</b>" }]));
    expect(v.kind).toBe("docx");
    if (v.kind !== "docx") return;
    expect(v.html).toContain("<h1>标题</h1>");
    expect(v.html).not.toMatch(/<script|onerror|href=|style=/);
  });

  it("docx sanitizer removes active content and attributes", () => {
    const out = sanitizeDocxHtml(
      '<p onclick="x()" style="color:red">hi<script>alert(1)</script><a href="https://evil.test">l</a><img src="https://evil.test/a.png"><iframe src="x"></iframe></p><style>p{}</style>'
    );
    expect(out).toBe("<p>hil[图片]</p>");
    expect(sanitizeDocxHtml("a < b > c")).not.toMatch(/[<>]/);
  });

  it("xlsx: real grid with sheets, merges and widths; sheet order kept", async () => {
    const wb = XLSX.utils.book_new();
    const a = XLSX.utils.aoa_to_sheet([["姓名", "分数"], ["张三", 90]]);
    a["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    a["!cols"] = [{ wch: 20 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, a, "成绩");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "第二张");
    const v = await buildDocView("xlsx", new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    expect(v.kind === "xlsx" && v.sheets.map((s) => s.name)).toEqual(["成绩", "第二张"]);
    if (v.kind !== "xlsx") return;
    expect(v.sheets[0]!.rows[0]![0]).toMatchObject({ v: "姓名", cs: 2 });
    expect(v.sheets[0]!.rows[1]![1]).toMatchObject({ v: "90", n: true });
    expect(v.sheets[0]!.widths[0]).toBe(20);
  });

  it("garbage bytes throw instead of rendering", async () => {
    await expect(buildDocView("docx", new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe("pdf text anchors", () => {
  const base = { kind: "text", text: "熵", page: 2 };
  it("old anchors (no prefix/suffix/rects) still parse unchanged", () => {
    expect(parseAnchor(base)).toEqual(base);
  });
  it("keeps prefix, suffix and rects, rounded to 2 decimals", () => {
    const a = parseAnchor({ ...base, prefix: "前", suffix: "后", rects: [{ x: 1.234, y: 2, w: 30, h: 10 }] });
    expect(a).toMatchObject({ prefix: "前", suffix: "后", rects: [{ x: 1.23, y: 2, w: 30, h: 10 }] });
  });
  it.each([
    [{ rects: "x" }],
    [{ rects: [{ x: -1, y: 0, w: 1, h: 1 }] }],
    [{ rects: [{ x: 0, y: 0, w: 0, h: 1 }] }],
    [{ rects: [{ x: NaN, y: 0, w: 1, h: 1 }] }],
    [{ rects: Array.from({ length: 65 }, () => ({ x: 0, y: 0, w: 1, h: 1 })) }],
    [{ prefix: "x".repeat(201) }]
  ])("rejects malformed %j", (extra) => {
    expect(() => parseAnchor({ ...base, ...extra })).toThrow();
  });
});
