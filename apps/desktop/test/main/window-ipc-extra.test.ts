import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (e: unknown, ...a: unknown[]) => unknown>(), win: null as unknown }));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => ipc.win) },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void ipc.handlers.set(ch, fn) }
}));
const { applyWindowAction, registerWindowIpc, titleBarOptions, watchMaximized } = await import("../../src/main/window-ipc.js");
const { IPC, WINDOW_ACTIONS, isWindowAction } = await import("../../src/shared/ipc.js");

function fakeWin(max = false) {
  return { minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(() => max) };
}
const untouched = (w: ReturnType<typeof fakeWin>) =>
  [w.minimize, w.maximize, w.unmaximize, w.close, w.isMaximized].every((f) => f.mock.calls.length === 0);

const invoke = (...args: unknown[]) => Promise.resolve().then(() => ipc.handlers.get(IPC.windowAction)!({ sender: {} }, ...args));

beforeEach(() => {
  ipc.handlers.clear();
  ipc.win = null;
  registerWindowIpc();
});

describe("window:action whitelist", () => {
  it("exposes exactly minimize / toggleMaximize / close", () => {
    expect([...WINDOW_ACTIONS].sort()).toEqual(["close", "minimize", "toggleMaximize"]);
  });

  it.each([
    [""], ["Minimize"], ["CLOSE"], ["togglemaximize"], ["maximize"], ["unmaximize"], ["destroy"], ["setBounds"],
    ["__proto__"], ["constructor"], ["toString"], ["hasOwnProperty"], ["valueOf"],
    [" close"], ["close "], ["\tminimize\n"], ["close\u0000"],
    [0], [1], [NaN], [true], [{}], [null], [undefined], [["close"]], [{ toString: () => "close" }], [Symbol("close")]
  ])("rejects %s via IPC and touches nothing", async (a) => {
    const w = fakeWin();
    ipc.win = w;
    await expect(invoke(a)).rejects.toThrow("不支持的窗口操作");
    expect(untouched(w)).toBe(true);
    expect(isWindowAction(a)).toBe(false);
  });

  it("rejects a missing argument", async () => {
    const w = fakeWin();
    ipc.win = w;
    await expect(invoke()).rejects.toThrow("不支持的窗口操作");
    expect(untouched(w)).toBe(true);
  });

  it("a String object is not accepted as a string", () => {
    const w = fakeWin();
    expect(() => applyWindowAction(w, new String("close"))).toThrow();
    expect(untouched(w)).toBe(true);
  });
});

describe("window:action valid calls via IPC", () => {
  it("minimize calls only minimize", async () => {
    const w = fakeWin();
    ipc.win = w;
    await invoke("minimize");
    expect(w.minimize).toHaveBeenCalledOnce();
    expect([w.maximize, w.unmaximize, w.close].every((f) => f.mock.calls.length === 0)).toBe(true);
  });
  it("toggleMaximize maximizes a normal window", async () => {
    const w = fakeWin(false);
    ipc.win = w;
    await invoke("toggleMaximize");
    expect(w.maximize).toHaveBeenCalledOnce();
    expect(w.unmaximize).not.toHaveBeenCalled();
  });
  it("toggleMaximize restores a maximized window", async () => {
    const w = fakeWin(true);
    ipc.win = w;
    await invoke("toggleMaximize");
    expect(w.unmaximize).toHaveBeenCalledOnce();
    expect(w.maximize).not.toHaveBeenCalled();
  });
  it("close calls only close", async () => {
    const w = fakeWin();
    ipc.win = w;
    await invoke("close");
    expect(w.close).toHaveBeenCalledOnce();
    expect([w.minimize, w.maximize, w.unmaximize].every((f) => f.mock.calls.length === 0)).toBe(true);
  });
});

describe("window gone", () => {
  it("rejects (does not crash) when the sender has no window", async () => {
    ipc.win = null;
    await expect(invoke("close")).rejects.toThrow("窗口不存在");
  });
  it("surfaces a destroyed window as a rejected invoke, not an uncaught error", async () => {
    const boom = () => { throw new TypeError("Object has been destroyed"); };
    ipc.win = { minimize: boom, maximize: boom, unmaximize: boom, close: boom, isMaximized: boom };
    for (const a of WINDOW_ACTIONS) await expect(invoke(a)).rejects.toThrow("Object has been destroyed");
  });
  it("watchMaximized does not send after webContents is destroyed", () => {
    const listeners: Record<string, () => void> = {};
    const send = vi.fn();
    let destroyed = false;
    const win = { on: (ev: string, fn: () => void) => void (listeners[ev] = fn), isMaximized: () => true, webContents: { isDestroyed: () => destroyed, send } };
    watchMaximized(win as never);
    listeners.maximize!();
    expect(send).toHaveBeenCalledWith(IPC.windowMaximized, true);
    destroyed = true;
    listeners.unmaximize!();
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("title bar options per platform", () => {
  it("macOS keeps native traffic lights inset and keeps the frame", () => {
    const o = titleBarOptions("darwin");
    expect(o.titleBarStyle).toBe("hiddenInset");
    expect(o.trafficLightPosition).toEqual({ x: 12, y: 11 });
    expect(o.frame).toBeUndefined();
  });
  it.each(["win32", "linux"] as const)("%s is frameless with no titleBarStyle", (p) => {
    expect(titleBarOptions(p)).toEqual({ frame: false });
  });
});
