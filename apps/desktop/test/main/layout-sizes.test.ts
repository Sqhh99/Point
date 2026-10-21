import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_MIN, LIBRARY_COLLAPSED_WIDTH, LIBRARY_WIDTH, READER_MIN, SPLITTER_WIDTH, WINDOW_MIN_WIDTH } from "../../src/shared/layout-sizes.js";
import { CHAT_MIN as LAYOUT_CHAT_MIN, clampChatWidth, deskVars, readChatPref } from "../../src/renderer/layout.js";
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

describe("splitter clamp (reader ≥ READER_MIN, chat ≥ CHAT_MIN)", () => {
  const open = (width: number) => ({ width, libraryOpen: true });
  it("dragging the chat wider stops where the reader would drop below 360", () => {
    expect(clampChatWidth(9999, open(1280))).toBe(1280 - LIBRARY_WIDTH - SPLITTER_WIDTH - READER_MIN);
    expect(clampChatWidth(9999, open(WINDOW_MIN_WIDTH))).toBe(CHAT_MIN);
    expect(clampChatWidth(9999, open(2000))).toBe(2000 - LIBRARY_WIDTH - SPLITTER_WIDTH - READER_MIN); // no fixed maximum
  });
  it("persisted point.chatWidth is clamped on load: '5000' → reader keeps 360, '0' → chat 320, junk → default", () => {
    for (const w of [WINDOW_MIN_WIDTH, 1024, 1280, 1920]) {
      expect(w - LIBRARY_WIDTH - SPLITTER_WIDTH - clampChatWidth("5000", open(w))).toBe(READER_MIN);
      expect(clampChatWidth("0", open(w))).toBe(CHAT_MIN);
      expect(clampChatWidth(5000, open(w)) + LIBRARY_WIDTH + SPLITTER_WIDTH + READER_MIN).toBe(w);
    }
    expect(clampChatWidth("abc", open(1280))).toBe(400);
  });
  it("dragging the chat narrower stops at 320", () => {
    expect(clampChatWidth(0, open(1280))).toBe(CHAT_MIN);
  });
  it("a shrinking window re-clamps the chat first; at the minimum both minimums hold exactly", () => {
    const chat = clampChatWidth(640, open(WINDOW_MIN_WIDTH));
    expect(chat).toBe(CHAT_MIN);
    expect(WINDOW_MIN_WIDTH - LIBRARY_WIDTH - SPLITTER_WIDTH - chat).toBe(READER_MIN);
    for (let w = WINDOW_MIN_WIDTH; w <= 1600; w += 37) {
      const c = clampChatWidth(640, open(w));
      expect(c).toBeGreaterThanOrEqual(CHAT_MIN);
      expect(w - LIBRARY_WIDTH - SPLITTER_WIDTH - c).toBeGreaterThanOrEqual(READER_MIN);
    }
  });
  it("collapsed library frees its width for the chat", () => {
    expect(clampChatWidth(9999, { width: WINDOW_MIN_WIDTH, libraryOpen: false })).toBe(WINDOW_MIN_WIDTH - LIBRARY_COLLAPSED_WIDTH - SPLITTER_WIDTH - READER_MIN);
  });
});

describe("stored chat preference vs shown width", () => {
  it("the preference keeps any width ≥ CHAT_MIN; the window only clamps what is shown", () => {
    expect(readChatPref("5000")).toBe(5000);
    expect(readChatPref("0")).toBe(CHAT_MIN);
    expect(readChatPref(null)).toBe(400);
    const pref = readChatPref("600");
    const shown = (w: number) => clampChatWidth(pref, { width: w, libraryOpen: true });
    expect(shown(1920)).toBe(600);
    expect(shown(WINDOW_MIN_WIDTH)).toBe(CHAT_MIN); // shrunk
    expect(shown(1920)).toBe(600); // re-enlarged: back to the preference (nothing was written)
  });
});
