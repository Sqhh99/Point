import { describe, expect, it } from "vitest";
import { buildDocView, docxBlockTexts, isViewBlockId, relocateBlock } from "../src/index";
import { makeDocx, makeXlsx } from "./fixtures/make";

describe("relocating marks made before the original-look viewers", () => {
  it("block ids of the new viewers vs the old extracted-text ids", () => {
    expect(["d0", "d12", "s0r3", "s10r200"].every(isViewBlockId)).toBe(true);
    expect(["b3", "d", "s1", "dx1", ""].some(isViewBlockId)).toBe(false);
  });
  it("docx: top-level block texts line up with d<i>, nested text included", () => {
    expect(docxBlockTexts("<h1>A</h1><ul><li>x</li><li>y &amp; z</li></ul><hr><p>q</p>")).toEqual(["A", "x y & z", "", "q"]);
  });
  it("docx: finds the paragraph by quote, tolerating whitespace and partial quotes", async () => {
    const v = await buildDocView("docx", await makeDocx([{ text: "第一段" }, { text: "第二段 的 内容" }]));
    expect(relocateBlock(v, "第二段  的\n内容")).toBe("d1");
    expect(relocateBlock(v, "不存在的句子")).toBeUndefined();
  });
  it("xlsx: finds sheet and row", async () => {
    const v = await buildDocView("xlsx", await makeXlsx([{ name: "A", rows: [["a", "b"]] }, { name: "B", rows: [["x"], ["target cell"]] }]));
    expect(relocateBlock(v, "target cell")).toBe("s1r1");
  });
  it("pdf and md have nothing to relocate", async () => {
    expect(relocateBlock({ kind: "md" }, "x")).toBeUndefined();
  });
});
