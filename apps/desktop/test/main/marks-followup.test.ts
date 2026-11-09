import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BAR_GAP, outsideBodyRects, placeBar, type Rect } from "../../src/renderer/layout.js";

const box: Rect = { top: 100, left: 0, width: 800, height: 600 };
const bar = { width: 240, height: 36 };
const overlaps = (sel: Rect, top: number) => {
  const a = sel.top - box.top;
  const b = a + sel.height;
  return top < b + BAR_GAP && top + bar.height > a - BAR_GAP;
};

describe("placeBar", () => {
  it("sits 8px above the selection when there is room", () => {
    const sel = { top: 300, left: 200, width: 100, height: 20 };
    const p = placeBar(sel, box, bar);
    expect(p.below).toBe(false);
    expect(p.top + bar.height).toBe(sel.top - box.top - 8);
    expect(p.left).toBe(250);
  });
  it("flips 8px below when there is not enough room above", () => {
    const sel = { top: 120, left: 200, width: 100, height: 20 };
    const p = placeBar(sel, box, bar);
    expect(p.below).toBe(true);
    expect(p.top).toBe(sel.top - box.top + sel.height + 8);
  });
  it("exactly enough room stays above", () => {
    const p = placeBar({ top: box.top + bar.height + 8, left: 0, width: 10, height: 10 }, box, bar);
    expect(p.below).toBe(false);
    expect(p.top).toBe(0);
  });
  it("never covers the selection (sweep of positions and heights, including tall selections)", () => {
    for (let t = box.top - 50; t < box.top + 700; t += 7) {
      for (const h of [1, 18, 60, 400]) {
        const sel = { top: t, left: 10, width: 50, height: h };
        expect(overlaps(sel, placeBar(sel, box, bar).top), `top=${t} h=${h}`).toBe(false);
      }
    }
  });
  it("clamps horizontally inside the container", () => {
    expect(placeBar({ top: 400, left: 0, width: 10, height: 10 }, box, bar).left).toBe(124);
    expect(placeBar({ top: 400, left: 790, width: 10, height: 10 }, box, bar).left).toBe(800 - 124);
    expect(placeBar({ top: 400, left: 50, width: 10, height: 10 }, { ...box, width: 100 }, bar).left).toBe(50);
  });

  it("flips below when sitting above would cover body text outside the selection", () => {
    const sel = { top: 300, left: 200, width: 100, height: 20 };
    const above = { top: 250, left: 200, width: 120, height: 20 };
    const p = placeBar(sel, box, bar, { obstacles: [above] });
    expect(p.below).toBe(true);
    expect(p.top).toBe(sel.top - box.top + sel.height + 8);
  });
  it("stays above when body text is far enough not to meet the bar", () => {
    const sel = { top: 300, left: 200, width: 100, height: 20 };
    const far = { top: 140, left: 200, width: 120, height: 20 };
    const p = placeBar(sel, box, bar, { obstacles: [far] });
    expect(p.below).toBe(false);
    expect(p.top + bar.height).toBe(sel.top - box.top - 8);
  });
  it("stays above when the only extra body is below the selection", () => {
    const sel = { top: 300, left: 200, width: 100, height: 20 };
    const under = { top: 340, left: 200, width: 120, height: 20 };
    const p = placeBar(sel, box, bar, { obstacles: [under] });
    expect(p.below).toBe(false);
  });
  it("after a cover-flip, a below slot that leaves the container is clamped inside", () => {
    // Selection near the bottom: above would cover a line, below would overflow.
    const sel = { top: box.top + 560, left: 200, width: 100, height: 20 };
    const above = { top: box.top + 510, left: 200, width: 120, height: 20 };
    const p = placeBar(sel, box, bar, { obstacles: [above] });
    expect(p.below).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + bar.height).toBeLessThanOrEqual(box.height);
  });
  it("after a cover-flip, a below slot that also covers body slides off that text", () => {
    const sel = { top: 300, left: 200, width: 100, height: 20 };
    const above = { top: 250, left: 200, width: 120, height: 20 };
    const under = { top: 340, left: 200, width: 120, height: 20 };
    const p = placeBar(sel, box, bar, { obstacles: [above, under] });
    expect(p.below).toBe(true);
    expect(p.top).toBe(under.top - box.top - bar.height);
    expect(p.top + bar.height).toBeLessThanOrEqual(under.top - box.top);
  });
  it("after a cover-flip, an in-viewport next-paragraph collision slides up off that line", () => {
    // #82 4014f20: triple-click mid-page line; below+8 covered the next paragraph by 12.656px.
    const sel = { top: 295.109375, left: 200, width: 400, height: 24.484375 };
    const above = { top: 251.109375, left: 200, width: 400, height: 36 };
    const next = { top: 350.9375, left: 200, width: 400, height: 24 };
    const p = placeBar(sel, box, bar, { obstacles: [above, next] });
    expect(p.below).toBe(true);
    expect(p.top).toBe(next.top - box.top - bar.height);
    expect(p.top + bar.height).toBeLessThanOrEqual(next.top - box.top);
  });
  it("ignores body that does not overlap the bar horizontally", () => {
    const sel = { top: 300, left: 200, width: 100, height: 20 };
    const side = { top: 250, left: 0, width: 40, height: 20 };
    const p = placeBar(sel, box, bar, { obstacles: [side] });
    expect(p.below).toBe(false);
    expect(p.top + bar.height).toBe(sel.top - box.top - 8);
  });
});

describe("outsideBodyRects", () => {
  it("drops boxes that share the selection's vertical span", () => {
    const sel = { top: 100, left: 0, width: 50, height: 20 };
    const same = { top: 100, left: 60, width: 40, height: 20 };
    const above = { top: 70, left: 0, width: 50, height: 20 };
    const below = { top: 130, left: 0, width: 50, height: 20 };
    expect(outsideBodyRects(sel, [same, above, below])).toEqual([above, below]);
  });
  it("keeps the next wrapped line when its box overlaps the selection by a few pixels", () => {
    // hydro-serif at 125%: consecutive .pdf-line boxes overlap by ~2.48px.
    const sel = { top: 273.109375, left: 358, width: 646, height: 24.484375 };
    const next = { top: 295.109375, left: 358, width: 755, height: 24.484375 };
    const same = { top: 273.109375, left: 1023, width: 91, height: 24.484375 };
    expect(outsideBodyRects(sel, [next, same])).toEqual([next]);
  });
});

describe("marked paragraph style", () => {
  const css = readFileSync(join(import.meta.dirname, "../../src/renderer/style.css"), "utf8");
  it("uses --accent at 12% with a 2px --accent underline", () => {
    const rule = css.match(/\.reader \.block\.marked[^{]*\{([^}]*)\}/)![1];
    expect(rule).toContain("color-mix(in srgb, var(--accent) 12%, transparent)");
    expect(rule).toMatch(/inset 0 -2px 0 var\(--accent\)/);
  });
  it("leaves text selection to the system ::selection (only the PDF text layer styles its own, upstream pdf.js style)", () => {
    const rules = [...css.matchAll(/([^{}]*::selection[^{}]*)\{/g)].map((m) => m[1]!.trim());
    expect(rules.length).toBeGreaterThan(0);
    for (const sel of rules) for (const part of sel.split(",")) expect(part.trim()).toMatch(/^\.pdf-text\b/);
  });
});
