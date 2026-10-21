import { describe, expect, it } from "vitest";
import { mathSpans, normalizeMathDelimiters, sourceSpanOf, spanMatches, visibleChars } from "../src/index.js";

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

describe("math (remark-math, shared with the renderer)", () => {
  const src = "## 一、有效声压：$p_e = \\dfrac{P}{\\sqrt{2}}$\n\n其中 $P$ 是峰值，\\(\\sqrt{2}\\) 来自正弦。\n\n\\[\nL = 20\\lg\\frac{p}{p_0}\n\\]\n\n$$x^2$$\n\n结论在这里。";

  it("finds $…$, \\(…\\), \\[…\\] and $$…$$ with the right display mode and TeX", () => {
    const m = mathSpans(src);
    expect(m.map((x) => [x.tex, x.display])).toEqual([
      ["p_e = \\dfrac{P}{\\sqrt{2}}", false],
      ["P", false],
      ["\\sqrt{2}", false],
      ["L = 20\\lg\\frac{p}{p_0}", true],
      ["x^2", true]
    ]);
    for (const x of m) expect(src.slice(x.start, x.end)).toMatch(/^(\$|\\\(|\\\[)/);
  });

  it("normalising \\( \\) and \\[ \\] keeps every offset (same length) and leaves code alone", () => {
    const s = "a \\(x\\) b `\\(y\\)`\n\n```\n\\[z\\]\n```\n";
    const n = normalizeMathDelimiters(s);
    expect(n.length).toBe(s.length);
    expect(n).toBe("a $$x$$ b `\\(y\\)`\n\n```\n\\[z\\]\n```\n");
    expect(mathSpans(s).map((x) => x.tex)).toEqual(["x"]);
  });

  it("math produces no visible chars; text around it still maps to its own source", () => {
    expect(rendered(src)).not.toContain("dfrac");
    expect(rendered(src)).not.toContain("sqrt");
    for (const c of visibleChars(src)) expect(src[c.off]).toBe(c.ch);
  });

  it("a selection after a formula still aligns (the DOM skips .katex the same way)", () => {
    expect(pick(src, "是峰值")).toEqual({ start: src.indexOf("是峰值"), end: src.indexOf("是峰值") + 3, quote: "是峰值" });
    expect(pick(src, "来自正弦")?.quote).toBe("来自正弦");
    expect(pick(src, "结论在这里")?.quote).toBe("结论在这里");
  });

  it("a selection that spans a formula returns null (no branch), never a slice with TeX in it", () => {
    // Visible "其中是峰值" around $P$: the chars align, but the span would cover the formula.
    const r = rendered(src);
    const i = r.indexOf("其中");
    expect(sourceSpanOf(src, r.slice(0, i), "其中 是峰值")).toBeNull();
    // A selection made only of KaTeX glyphs (no source chars) → null.
    expect(sourceSpanOf(src, r.slice(0, i), "p e = P 2")).toBeNull();
  });

  it("a dollar amount that is not closed stays text", () => {
    const s = "价格是 $5，没有公式";
    expect(mathSpans(s)).toEqual([]);
    expect(pick(s, "$5")?.quote).toBe("$5");
  });
});
