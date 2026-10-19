import { describe, expect, it } from "vitest";
import { sourceSpanOf, spanMatches, visibleChars } from "../src/index.js";

/** The rendered text the DOM would show (mdast visible chars), for building selections in tests. */
const rendered = (src: string) => visibleChars(src).map((c) => c.ch).join("");
const pick = (src: string, text: string, nth = 0) => {
  const r = rendered(src);
  let i = -1;
  for (let k = 0; k <= nth; k++) i = r.indexOf(text, i + 1);
  if (i < 0) throw new Error(`not rendered: ${text}`);
  return sourceSpanOf(src, r.slice(0, i), text);
};

describe("visibleChars", () => {
  it("never maps link URLs or markup", () => {
    const src = "[A](http://b.c) b 和 c，**粗** 与 `x_y`";
    expect(rendered(src)).toBe("A b 和 c，粗 与 x_y");
    for (const c of visibleChars(src)) expect(src[c.off]).toBe(c.ch);
  });
});

describe("sourceSpanOf (mdast offset map)", () => {
  const link = "[A](http://b.c) b 和 c";

  it("link case 1: 「b 和 c」 after a link maps to the text, not into the URL", () => {
    const s = pick(link, "b 和 c")!;
    expect(s.quote).toBe("b 和 c");
    expect(s.start).toBe(link.indexOf(" b 和 c") + 1);
  });

  it("link case 2: 「A b」 across the link end spans the link source, not 「A](http://b」", () => {
    const s = pick(link, "A b")!;
    expect(s.quote).toBe("A](http://b.c) b");
    expect(s.start).toBe(1);
    expect(spanMatches(link, s.start, s.end, s.quote)).toBe(true);
  });

  it("link case 3: crossing a very long link still maps (no length cap)", () => {
    const url = "https://example.com/" + "x".repeat(2000);
    const src = `前文 [很长的链接](${url}) 后文结束`;
    const s = pick(src, "文 很长的链接 后文")!;
    expect(s.quote.startsWith("文 [很长的链接](https://example.com/")).toBe(true);
    expect(s.quote.endsWith(") 后文")).toBe(true);
  });

  it("bold: text inside bold maps to the inner chars; a whole bold item maps from the first visible char", () => {
    const src = "- **前提**：条件成立\n- 第二项";
    expect(pick(src, "前提")!.quote).toBe("前提");
    expect(pick(src, "前提：条件成立")!.quote).toBe("前提**：条件成立");
  });

  it("inline code: maps inside the backticks", () => {
    const src = "调用 `run_task()` 即可";
    expect(pick(src, "run_task()")!.quote).toBe("run_task()");
    expect(pick(src, "调用 run_task")!.quote).toBe("调用 `run_task");
  });

  it("whole list item with bold + inline code + link", () => {
    const src = "格式探针：\n\n- **粗体要点**：带 `inline_code` 与 [链接文字](https://example.com/docs/page) 的一项\n- 第二项普通文字\n";
    const s = pick(src, "粗体要点：带 inline_code 与 链接文字 的一项")!;
    expect(s.quote).toBe("粗体要点**：带 `inline_code` 与 [链接文字](https://example.com/docs/page) 的一项");
  });

  it("picks the selected occurrence, not the first", () => {
    const src = "**甲** 甲";
    expect(pick(src, "甲", 1)).toMatchObject({ start: 6, end: 7, quote: "甲" });
    expect(pick(src, "甲", 0)).toMatchObject({ start: 2, end: 3 });
  });

  it("returns null when the DOM text does not line up with the source (never a dirty slice)", () => {
    expect(sourceSpanOf("abc", "", "xyz")).toBeNull();
    expect(sourceSpanOf("abc def", "zz", "def")).toBeNull();
    expect(sourceSpanOf("abc", "", "")).toBeNull();
    expect(sourceSpanOf("abc", "abc", "d")).toBeNull();
  });

  it("escapes and entities stay within their own node", () => {
    const src = "a \\*b\\* &amp; c";
    expect(rendered(src)).toBe("a *b* & c");
    expect(pick(src, "& c")!.quote).toBe("&amp; c");
  });
});
