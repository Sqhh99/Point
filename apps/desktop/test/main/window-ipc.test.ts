import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {}, ipcMain: { handle: vi.fn() } }));
const { applyWindowAction, titleBarOptions } = await import("../../src/main/window-ipc.js");

function fakeWin(max = false) {
  return { minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), close: vi.fn(), isMaximized: () => max };
}

describe("window actions", () => {
  it("runs whitelisted actions", () => {
    const w = fakeWin();
    applyWindowAction(w, "minimize");
    applyWindowAction(w, "toggleMaximize");
    applyWindowAction(w, "close");
    expect(w.minimize).toHaveBeenCalledOnce();
    expect(w.maximize).toHaveBeenCalledOnce();
    expect(w.close).toHaveBeenCalledOnce();
  });

  it("toggleMaximize restores a maximized window", () => {
    const w = fakeWin(true);
    applyWindowAction(w, "toggleMaximize");
    expect(w.unmaximize).toHaveBeenCalledOnce();
    expect(w.maximize).not.toHaveBeenCalled();
  });

  it.each([["setBounds"], ["__proto__"], ["toString"], [""], [null], [{ action: "close" }], [["close"]]])("rejects %j", (a) => {
    const w = fakeWin();
    expect(() => applyWindowAction(w, a)).toThrow("不支持的窗口操作");
    expect([w.minimize, w.maximize, w.unmaximize, w.close].every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("uses an inset title bar on macOS and a frameless window elsewhere", () => {
    expect(titleBarOptions("darwin")).toMatchObject({ titleBarStyle: "hiddenInset" });
    expect(titleBarOptions("win32")).toEqual({ frame: false });
  });
});
