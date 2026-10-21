import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_MIN, LIBRARY_COLLAPSED_WIDTH, LIBRARY_WIDTH, READER_MIN, SPLITTER_WIDTH, WINDOW_MIN_WIDTH } from "../../src/shared/layout-sizes.js";
import { CHAT_MIN as LAYOUT_CHAT_MIN, deskVars } from "../../src/renderer/layout.js";
import { COLLAPSE_LEVELS, collapseState } from "../../src/renderer/viewers/ReaderBar.js";

describe("desk layout sizes", () => {
  it("design minimums: reader ≥ 360, chat ≥ 320", () => {
    expect(READER_MIN).toBe(360);
    expect(CHAT_MIN).toBe(320);
    expect(LAYOUT_CHAT_MIN).toBe(CHAT_MIN);
  });
  it("window minimum width = open sidebar + reader min + splitter + chat min (computed, not hard-coded)", () => {
    expect(WINDOW_MIN_WIDTH).toBe(LIBRARY_WIDTH + READER_MIN + SPLITTER_WIDTH + CHAT_MIN);
    expect(LIBRARY_COLLAPSED_WIDTH).toBeLessThan(LIBRARY_WIDTH); // collapsing only adds room
    const main = readFileSync(join(import.meta.dirname, "../../src/main/index.ts"), "utf8");
    expect(main).toMatch(/minWidth: WINDOW_MIN_WIDTH,/);
    expect(main).not.toMatch(/minWidth: \d/);
  });
  it("the renderer grid reads the same constants", () => {
    expect(deskVars(400)).toMatchObject({ "--chat-min": "320px", "--reader-min": "360px", "--library-width": `${LIBRARY_WIDTH}px`, "--splitter-width": `${SPLITTER_WIDTH}px` });
    const css = readFileSync(join(import.meta.dirname, "../../src/renderer/style.css"), "utf8");
    expect(css).toContain("clamp(var(--chat-min, 320px), var(--chat-width, 400px), calc(100% - var(--library) - var(--splitter-width, 4px) - var(--reader-min, 360px)))");
  });
});

describe("reader toolbar collapse order", () => {
  it("框选 icon → 适合宽度 icon → 适合宽度 into ⋯ → 框选 into ⋯", () => {
    expect(COLLAPSE_LEVELS).toBe(4);
    expect([0, 1, 2, 3, 4].map(collapseState)).toEqual([
      { actionsIcon: false, fitIcon: false, fitInMenu: false, actionsInMenu: false },
      { actionsIcon: true, fitIcon: false, fitInMenu: false, actionsInMenu: false },
      { actionsIcon: true, fitIcon: true, fitInMenu: false, actionsInMenu: false },
      { actionsIcon: true, fitIcon: true, fitInMenu: true, actionsInMenu: false },
      { actionsIcon: true, fitIcon: true, fitInMenu: true, actionsInMenu: true }
    ]);
  });
});
