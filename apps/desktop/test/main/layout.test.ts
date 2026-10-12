import { describe, expect, it } from "vitest";
import { CHAT_DEFAULT, CHAT_MAX, CHAT_MIN, clampChatWidth, isToggleLibraryKey } from "../../src/renderer/layout.js";

describe("clampChatWidth", () => {
  it.each([[9999, CHAT_MAX], [-50, CHAT_MIN], ["9999", CHAT_MAX], ["480", 480], [400.6, 401], [CHAT_MIN, CHAT_MIN], [CHAT_MAX, CHAT_MAX]])("%j → %j", (v, out) => {
    expect(clampChatWidth(v)).toBe(out);
  });
  it.each([[null], [""], ["abc"], [NaN], [Infinity], [undefined], [{}]])("%j falls back to default", (v) => {
    expect(clampChatWidth(v)).toBe(CHAT_DEFAULT);
  });
});

describe("isToggleLibraryKey", () => {
  const k = (o: Partial<KeyboardEvent>) => ({ key: "\\", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  it("accepts ⌘\\ and Ctrl+\\", () => {
    expect(isToggleLibraryKey(k({ metaKey: true }))).toBe(true);
    expect(isToggleLibraryKey(k({ ctrlKey: true }))).toBe(true);
  });
  it("ignores other keys and modifiers", () => {
    expect(isToggleLibraryKey(k({}))).toBe(false);
    expect(isToggleLibraryKey(k({ metaKey: true, key: "/" }))).toBe(false);
    expect(isToggleLibraryKey(k({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isToggleLibraryKey(k({ ctrlKey: true, altKey: true }))).toBe(false);
  });
});
