import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from "electron";
import { IPC, isWindowAction, type WindowAction } from "../shared/ipc.js";

/** Custom title bar: keep the macOS traffic lights inset, drop the native frame on Windows/Linux. */
export function titleBarOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  return platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 11 } } : { frame: false };
}

export function applyWindowAction(win: Pick<BrowserWindow, "minimize" | "maximize" | "unmaximize" | "isMaximized" | "close">, action: unknown): void {
  if (!isWindowAction(action)) throw new Error("不支持的窗口操作");
  const run: Record<WindowAction, () => void> = {
    minimize: () => win.minimize(),
    toggleMaximize: () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
    close: () => win.close()
  };
  run[action]();
}

export function registerWindowIpc(): void {
  ipcMain.handle(IPC.windowAction, (e, action: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) throw new Error("窗口不存在");
    applyWindowAction(win, action);
  });
}

export function watchMaximized(win: BrowserWindow): void {
  const send = () => {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.windowMaximized, win.isMaximized());
  };
  win.on("maximize", send);
  win.on("unmaximize", send);
}
