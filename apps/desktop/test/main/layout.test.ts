import { describe, expect, it } from "vitest";
import { CHAT_DEFAULT, CHAT_MAX, CHAT_MIN, clampChatWidth, isToggleLibraryKey, selectionEnds, sameSelectionEnds } from "../../src/renderer/layout.js";

describe("clampChatWidth", () => {
  it.each([[9999, CHAT_MAX], [-50, CHAT_MIN], ["9999", CHAT_MAX], ["480", 480], [400.6, 401], [CHAT_MIN, CHAT_MIN], [CHAT_MAX, CHAT_MAX]])("%j → %j", (v, out) => {
    expect(clampChatWidth(v)).toBe(out);
  });
  it.each([[null], [""], ["abc"], [NaN], [Infinity], [undefined], [{}]])("%j falls back to default", (v) => {
    expect(clampChatWidth(v)).toBe(CHAT_DEFAULT);
  });
});

describe("isToggleLibraryKey", () => {
  const k = (o: Partial<KeyboardEvent>) => ({ key: "\\", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...o });
  it("accepts ⌘\\ and Ctrl+\\", () => {
    expect(isToggleLibraryKey(k({ metaKey: true }), "darwin")).toBe(true);
    expect(isToggleLibraryKey(k({ ctrlKey: true }), "win32")).toBe(true);
  });
  it("ignores other keys and modifiers", () => {
    expect(isToggleLibraryKey(k({}), "win32")).toBe(false);
    expect(isToggleLibraryKey(k({ metaKey: true, key: "/" }), "darwin")).toBe(false);
    expect(isToggleLibraryKey(k({ ctrlKey: true, shiftKey: true }), "win32")).toBe(false);
    expect(isToggleLibraryKey(k({ ctrlKey: true, altKey: true }), "win32")).toBe(false);
  });
});

describe("sameSelectionEnds", () => {
  const ends = (anchorNode: object, focusNode: object, anchorOffset = 0, focusOffset = 10) => ({
    anchorNode: anchorNode as Node,
    anchorOffset,
    focusNode: focusNode as Node,
    focusOffset
  });
  it("treats the same node references and offsets as equal", () => {
    const n = { text: "techniques and equipment" };
    const a = ends(n, n, 0, 10);
    expect(sameSelectionEnds(a, { ...a })).toBe(true);
  });
  it("does not treat different nodes with the same text and offsets as equal", () => {
    const a = ends({ text: "techniques and equipment" }, { text: "techniques and equipment" });
    const b = ends({ text: "techniques and equipment" }, { text: "techniques and equipment" });
    expect(a.anchorNode).not.toBe(b.anchorNode);
    expect(sameSelectionEnds(a, b)).toBe(false);
  });
  it("is false when only one side is missing", () => {
    const n = { text: "techniques" };
    expect(sameSelectionEnds(null, ends(n, n))).toBe(false);
    expect(sameSelectionEnds(ends(n, n), null)).toBe(false);
    expect(sameSelectionEnds(null, null)).toBe(false);
  });
  it("selectionEnds is null for a collapsed or empty Selection", () => {
    expect(selectionEnds(null)).toBeNull();
    expect(selectionEnds({ rangeCount: 0 } as Selection)).toBeNull();
    expect(selectionEnds({ rangeCount: 1, isCollapsed: true, anchorNode: {}, focusNode: {} } as Selection)).toBeNull();
  });
});
