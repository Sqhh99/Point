import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetsInlineLimit } from "../../vite-assets.js";

// Chat typography rules (style.css) and the renderer build's asset rule.
const css = readFileSync(join(import.meta.dirname, "../../src/renderer/style.css"), "utf8");
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`no rule ${sel}`);
  return css.slice(i, css.indexOf("}", i));
};
const theme = (dark: boolean) => {
  const block = dark ? css.slice(css.indexOf("@media (prefers-color-scheme: dark)")) : css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"));
  const v = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
  return { danger: v("danger"), bg: v("bg"), panel: v("panel"), elevated: v("bg-elevated") };
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("chat typography", () => {
  it("KaTeX is 1.05em of chat text (overrides KaTeX's 1.21em), 1em inside headings", () => {
    expect(rule(".markdown .katex")).toContain("font-size: 1.05em");
    expect(rule(".markdown :is(h1, h2, h3, h4, h5, h6) .katex")).toContain("font-size: 1em");
  });
  it("headings: h1 18px/600 20px 0 8px, h2 16px/600 16px 0 6px, h3 15px/600 12px 0 4px; first child has no top margin", () => {
    expect(rule(".markdown h1")).toMatch(/font-size: 18px; font-weight: 600; margin: 20px 0 8px;/);
    expect(rule(".markdown h2")).toMatch(/font-size: 16px; font-weight: 600; margin: 16px 0 6px;/);
    expect(rule(".markdown h3")).toMatch(/font-size: 15px; font-weight: 600; margin: 12px 0 4px;/);
    expect(rule(".markdown > :first-child")).toContain("margin-top: 0");
  });
  it("display math box: 12px 0, 4px padding-block, slim theme-neutral scrollbar", () => {
    expect(rule(".markdown .katex-display")).toMatch(/margin: 12px 0; padding-block: 4px; overflow-x: auto; overflow-y: hidden;/);
    expect(rule(".markdown .katex-display::-webkit-scrollbar")).toContain("height: 6px");
    expect(rule(".markdown .katex-display::-webkit-scrollbar-track")).toContain("background: transparent");
    expect(rule(".markdown .katex-display::-webkit-scrollbar-thumb")).toMatch(/color-mix\(in srgb, currentColor 20%, transparent\); border-radius: 3px/);
    expect(rule(".markdown .katex-display::-webkit-scrollbar-thumb:hover")).toContain("color-mix(in srgb, currentColor 35%, transparent)");
  });
  it("--danger (KaTeX error colour) has ≥ 4.5:1 contrast on the light and dark chat backgrounds", () => {
    for (const dark of [false, true]) {
      const t = theme(dark);
      for (const bg of [t.bg, t.panel, t.elevated]) expect(contrast(t.danger, bg), `${dark ? "dark" : "light"} ${t.danger} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("renderer assetsInlineLimit", () => {
  it("never inlines fonts (CSP has no data: font-src); other assets keep Vite's default", () => {
    for (const f of ["KaTeX_Size1-Regular.woff2", "a.woff", "b.ttf", "c.otf", "D.WOFF2"]) expect(assetsInlineLimit(f)).toBe(false);
    for (const f of ["icon.png", "x.svg", "y.bcmap"]) expect(assetsInlineLimit(f)).toBeUndefined();
  });
});
