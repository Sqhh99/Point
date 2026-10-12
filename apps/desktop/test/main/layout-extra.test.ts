import { describe, expect, it } from "vitest";
import { CHAT_DEFAULT, CHAT_MAX, CHAT_MIN, clampChatWidth, isToggleLibraryKey } from "../../src/renderer/layout.js";

describe("clampChatWidth boundaries and parsing", () => {
  it.each([
    [319, CHAT_MIN], [320, 320], [321, 321], [639, 639], [640, 640], [641, CHAT_MAX],
    [319.9, CHAT_MIN], [320.4, 320], [639.6, 640], [640.1, CHAT_MAX], [0, CHAT_MIN], [-0, CHAT_MIN],
    [-Infinity, CHAT_DEFAULT], [Infinity, CHAT_DEFAULT],
    ["319", CHAT_MIN], ["641", CHAT_MAX], ["320", 320], ["640", 640], ["500.5", 501],
    [" 500 ", 500], ["\t480\n", 480], ["1e3", CHAT_MAX], ["4.5e2", 450], ["0x200", 512], ["0", CHAT_MIN], ["-50", CHAT_MIN]
  ])("%j → %j", (v, out) => {
    expect(clampChatWidth(v)).toBe(out);
  });

  it.each([[" "], ["\t\n"], ["Infinity"], ["-Infinity"], ["500px"], ["5 00"], ["NaN"], [true], [[500]], [Symbol("x")], [10n]])(
    "%s falls back to default",
    (v) => {
      expect(clampChatWidth(v)).toBe(CHAT_DEFAULT);
    }
  );

  it("always returns an integer within range for any numeric input", () => {
    for (let v = 250; v <= 700; v += 0.37) {
      const out = clampChatWidth(v);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(CHAT_MIN);
      expect(out).toBeLessThanOrEqual(CHAT_MAX);
    }
  });

  it("is idempotent on the persisted string form", () => {
    for (const v of [100, 333.3, 640, 9999]) expect(clampChatWidth(String(clampChatWidth(v)))).toBe(clampChatWidth(v));
  });
});

describe("isToggleLibraryKey modifiers and keys", () => {
  const k = (o: Partial<KeyboardEvent> = {}) =>
    ({ key: "\\", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...o }) as KeyboardEvent;

  it("accepts both ⌘ and Ctrl, and both together (same handler on every platform)", () => {
    expect(isToggleLibraryKey(k({ metaKey: true }))).toBe(true);
    expect(isToggleLibraryKey(k({ ctrlKey: true }))).toBe(true);
    expect(isToggleLibraryKey(k({ metaKey: true, ctrlKey: true }))).toBe(true);
  });

  it.each([
    [{ metaKey: true, shiftKey: true }], [{ metaKey: true, altKey: true }], [{ ctrlKey: true, altKey: true, shiftKey: true }],
    [{ shiftKey: true }], [{ altKey: true }], [{ ctrlKey: true, key: "|" }], [{ metaKey: true, key: "Backslash" }],
    [{ ctrlKey: true, key: "\\\\" }], [{ ctrlKey: true, key: "Dead" }], [{ ctrlKey: true, key: "Unidentified" }],
    [{ ctrlKey: true, key: "" }], [{ ctrlKey: true, key: "b" }], [{ metaKey: true, key: "]" }]
  ])("rejects %j", (o) => {
    expect(isToggleLibraryKey(k(o))).toBe(false);
  });

  // Bug: holding ⌘\ / Ctrl+\ fires repeated keydown events and App toggles the left column on each,
  // so it flickers open/closed. The helper ignores KeyboardEvent.repeat.
  it.fails("ignores auto-repeat keydown (holding the shortcut must not flicker the column)", () => {
    expect(isToggleLibraryKey(k({ ctrlKey: true, repeat: true }))).toBe(false);
  });
});
