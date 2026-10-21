import { describe, expect, it } from "vitest";
import { fillMath, withMathTokens } from "../../src/renderer/math.js";

// Renderer math pipeline (pure string steps; DOMPurify runs between them in the app).
const render = (text: string) => {
  const { src, spans } = withMathTokens(text);
  return { src, spans, html: fillMath(src, spans) };
};

describe("chat math rendering", () => {
  it("inline $…$ becomes inline KaTeX (no raw TeX left in the text)", () => {
    const { src, html } = render("一、有效声压：$p_e = \\dfrac{P}{\\sqrt{2}}$");
    expect(src).not.toContain("dfrac");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("katex-display");
    expect(html).toContain("<math");
    expect(html.replace(/<annotation[\s\S]*?<\/annotation>/g, "")).not.toContain("\\dfrac");
  });

  it("$$…$$ on its own lines and \\[…\\] render as display blocks; \\(…\\) inline", () => {
    expect(render("$$\nx^2\n$$").html).toContain("katex-display");
    expect(render("\\[\nL = 20\\lg\\frac{p}{p_0}\n\\]").html).toContain("katex-display");
    expect(render("$$x^2$$").html).toContain("katex-display");
    const inl = render("由 \\(\\sqrt{2}\\) 得").html;
    expect(inl).toContain('class="katex"');
    expect(inl).not.toContain("katex-display");
  });

  it("math inside code stays code text (not a token)", () => {
    const { src, spans } = render("用 `$x$` 和\n\n```\n\\(y\\)\n```\n");
    expect(spans).toEqual([]);
    expect(src).toContain("`$x$`");
  });

  it("KaTeX runs untrusted: \\href and \\html commands do not produce links or raw HTML", () => {
    const { html } = render("$\\href{javascript:alert(1)}{x}$ $\\htmlId{a}{b}$ $\\url{http://e.x}$");
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/href=/);
    // The TeX source may appear as escaped text (annotation / error title), never as markup.
    expect(html.replace(/<annotation[\s\S]*?<\/annotation>/g, "").replace(/title="[^"]*"/g, "")).not.toMatch(/<[^>]*javascript:/);
    expect(html).not.toContain('id="a"');
  });

  it("a bad formula shows its source in the danger colour variable, never throws", () => {
    const { html } = render("$\\frac{1}{$ 和 $x$");
    expect(html).toContain("var(--danger)");
  });

  it("private-use token characters in the model text cannot forge a formula", () => {
    const { html, spans } = render("\uE0000\uE001 text $a$");
    expect(spans).toHaveLength(1);
    expect((html.match(/class="katex"/g) ?? []).length).toBe(1);
  });
});
