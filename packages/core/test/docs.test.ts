import { describe, expect, it } from "vitest";
import { docTypeOf, parseDocument, parseDocx, parseMarkdown, parsePdf } from "../src/index.js";
import { makeDocx, makePdf } from "./fixtures/make.js";

const md = `# 熵

熵是**无序度**的度量。

## 性质

- 广延量
- 非负

1. 第一
2. 第二

\`\`\`python
print("S = k ln W")
\`\`\`

| 符号 | 含义 |
| --- | --- |
| S | 熵 |

![玻尔兹曼墓碑](tomb.png)

> 引用里的段落
`;

describe("parseMarkdown", () => {
  const doc = parseMarkdown(md, "fallback");

  it("maps every block type", () => {
    expect(doc.blocks.map(({ id: _, ...b }) => (void _, b))).toEqual([
      { type: "heading", level: 1, text: "熵" },
      { type: "paragraph", text: "熵是无序度的度量。" },
      { type: "heading", level: 2, text: "性质" },
      { type: "list", ordered: false, items: ["广延量", "非负"] },
      { type: "list", ordered: true, items: ["第一", "第二"] },
      { type: "code", lang: "python", text: 'print("S = k ln W")' },
      { type: "table", rows: [["符号", "含义"], ["S", "熵"]] },
      { type: "image", alt: "玻尔兹曼墓碑" },
      { type: "paragraph", text: "引用里的段落" }
    ]);
  });

  it("derives title, outline and stable ids", () => {
    expect(doc.title).toBe("熵");
    expect(doc.outline).toEqual([
      { blockId: "b0", level: 1, text: "熵" },
      { blockId: "b2", level: 2, text: "性质" }
    ]);
    expect(parseMarkdown(md).blocks.map((b) => b.id)).toEqual(doc.blocks.map((b) => b.id));
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(doc.blocks.length);
  });

  it("falls back to file name when there is no heading", () => {
    expect(parseMarkdown("just text", "notes").title).toBe("notes");
  });
});

describe("parseDocx", () => {
  it("keeps headings and paragraphs", async () => {
    const data = await makeDocx([
      { style: "Heading1", text: "Entropy" },
      { text: "A measure of disorder (S)." },
      { style: "Heading2", text: "Properties" },
      { text: "Extensive." }
    ]);
    const doc = await parseDocx(data, "f");
    expect(doc.type).toBe("docx");
    expect(doc.title).toBe("Entropy");
    expect(doc.blocks.map(({ id: _, ...b }) => (void _, b))).toEqual([
      { type: "heading", level: 1, text: "Entropy" },
      { type: "paragraph", text: "A measure of disorder (S)." },
      { type: "heading", level: 2, text: "Properties" },
      { type: "paragraph", text: "Extensive." }
    ]);
  });
});

describe("parsePdf", () => {
  it("extracts text per page with source page numbers", async () => {
    const data = makePdf([["Entropy basics", "Second law"], ["Page two text"]]);
    const doc = await parsePdf(data, "paper");
    expect(doc.type).toBe("pdf");
    expect(doc.title).toBe("paper");
    expect(doc.blocks.map((b) => [b.page, b.type === "paragraph" ? b.text : ""])).toEqual([
      [1, "Entropy basics"],
      [1, "Second law"],
      [2, "Page two text"]
    ]);
    // First call loads the 2 MB pdfjs worker in-process; cold Windows runners need >5s.
  }, 30_000);
});

describe("docTypeOf / parseDocument", () => {
  it("detects by extension", () => {
    expect(docTypeOf("a.PDF")).toBe("pdf");
    expect(docTypeOf("b.docx")).toBe("docx");
    expect(docTypeOf("c.markdown")).toBe("md");
    expect(docTypeOf("d.txt")).toBeUndefined();
  });

  it("dispatches by type", async () => {
    const doc = await parseDocument("md", new TextEncoder().encode("# Hi"), "x");
    expect(doc.title).toBe("Hi");
  });
});
