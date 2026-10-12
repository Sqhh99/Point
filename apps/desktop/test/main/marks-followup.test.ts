import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BAR_GAP, placeBar, type Rect } from "../../src/renderer/layout.js";

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
});

describe("marked paragraph style", () => {
  const css = readFileSync(join(import.meta.dirname, "../../src/renderer/style.css"), "utf8");
  it("uses --accent at 12% with a 2px --accent underline", () => {
    const rule = css.match(/\.reader \.block\.marked[^{]*\{([^}]*)\}/)![1];
    expect(rule).toContain("color-mix(in srgb, var(--accent) 12%, transparent)");
    expect(rule).toMatch(/inset 0 -2px 0 var\(--accent\)/);
  });
  it("leaves text selection to the system ::selection", () => {
    expect(css).not.toMatch(/::selection/);
  });
});
