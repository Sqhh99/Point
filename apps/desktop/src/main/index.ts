import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { runSmoke } from "./smoke.js";
import { registerDocsIpc } from "./docs-ipc.js";
import { registerIpc } from "./ipc.js";
import { closeWorkspace, restoreWorkspace } from "./workspace.js";

// Packaging check: open a temp SQLite DB through the native module, report, exit.
if (process.env.POINT_SMOKE_OUT) runSmoke(process.env.POINT_SMOKE_OUT);

// Lets e2e tests isolate settings from the real profile.
if (process.env.POINT_USER_DATA) app.setPath("userData", process.env.POINT_USER_DATA);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc();
  registerDocsIpc();
  restoreWorkspace();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => closeWorkspace());
