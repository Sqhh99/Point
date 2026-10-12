import { describe, expect, it } from "vitest";
import { dragRect, isCaptureKey } from "../../src/renderer/layout.js";

const k = (o: Partial<KeyboardEvent>) => ({ key: "S", metaKey: false, ctrlKey: false, altKey: false, shiftKey: true, repeat: false, ...o });

describe("isCaptureKey", () => {
  it("⌘⇧S on mac, Ctrl+Shift+S elsewhere", () => {
    expect(isCaptureKey(k({ metaKey: true }), "darwin")).toBe(true);
    expect(isCaptureKey(k({ ctrlKey: true }), "win32")).toBe(true);
    expect(isCaptureKey(k({ ctrlKey: true, key: "s" }), "linux")).toBe(true);
  });
  it.each([
    ["other platform modifier (mac)", k({ ctrlKey: true }), "darwin"],
    ["other platform modifier (win)", k({ metaKey: true }), "win32"],
    ["no shift", k({ ctrlKey: true, shiftKey: false }), "win32"],
    ["alt", k({ ctrlKey: true, altKey: true }), "win32"],
    ["repeat", k({ ctrlKey: true, repeat: true }), "win32"],
    ["other key", k({ ctrlKey: true, key: "O" }), "win32"]
  ])("ignores %s", (_n, e, p) => expect(isCaptureKey(e, p)).toBe(false));
});

describe("dragRect", () => {
  const bounds = { x: 100, y: 50, width: 400, height: 300 };
  it("normalises any drag direction", () => {
    expect(dragRect({ x: 300, y: 200 }, { x: 150, y: 100 }, bounds)).toEqual({ x: 150, y: 100, width: 150, height: 100 });
  });
  it("clips to the bounds", () => {
    expect(dragRect({ x: 0, y: 0 }, { x: 1000, y: 1000 }, bounds)).toEqual(bounds);
  });
  it("too small is null", () => {
    expect(dragRect({ x: 200, y: 200 }, { x: 202, y: 260 }, bounds)).toBeNull();
    expect(dragRect({ x: 0, y: 0 }, { x: 50, y: 40 }, bounds)).toBeNull();
  });
});
