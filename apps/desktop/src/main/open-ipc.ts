import { BrowserWindow, app, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_EXTENSIONS, docTypeOf } from "@point/core";
import { IPC, type OpenResult } from "../shared/ipc.js";
import { OPEN_ERROR } from "./open-errors.js";
import { addRecent, readRecent, removeRecent } from "./recent.js";
import { importFile, openWorkspace, workspacePath } from "./workspace.js";

/** Where single files go when no workspace is open: a private folder under userData. */
export const scratchRoot = () => join(app.getPath("userData"), "scratch");

const info = () => ({ path: workspacePath() });

export type OpenTarget = { kind: "workspace" | "file"; path: string };

const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/**
 * The one place an outside path is checked before Point reads it. Paths only ever come from a native
 * dialog, a drop that main intercepted, or main's own recent list — never from the renderer — but they
 * are still validated: absolute, no NUL, exists, symlinks resolved, not the scratch folder, and a file
 * must be a supported document type.
 */
export function resolveOpenTarget(p: unknown): OpenTarget {
  if (typeof p !== "string" || p.length === 0 || p.includes("\0") || !isAbsolute(p)) throw new Error("无效的路径");
  const abs = resolve(p);
  if (!existsSync(abs)) throw new Error(OPEN_ERROR.missing);
  const real = realpathSync(abs);
  const scratch = existsSync(scratchRoot()) ? realpathSync(scratchRoot()) : scratchRoot();
  if (inside(real, scratch)) throw new Error("无效的路径");
  if (statSync(real).isDirectory()) return { kind: "workspace", path: real };
  if (!docTypeOf(real)) throw new Error(`不支持的文件类型: ${basename(real)}`);
  if (statSync(real).size === 0) throw new Error(OPEN_ERROR.empty);
  return { kind: "file", path: real };
}

export async function openTarget(t: OpenTarget): Promise<OpenResult> {
  if (t.kind === "workspace") {
    const abs = openWorkspace(t.path);
    addRecent({ kind: "workspace", path: abs, name: basename(abs), openedAt: new Date().toISOString() });
    return { workspace: info() };
  }
  if (!workspacePath()) openWorkspace(scratchRoot());
  const doc = await importFile(t.path);
  addRecent({ kind: "file", path: t.path, name: basename(t.path), openedAt: new Date().toISOString() });
  return { workspace: info(), doc };
}

export const openPath = async (p: unknown) => openTarget(resolveOpenTarget(p));

async function pick(e: Electron.IpcMainInvokeEvent, opts: OpenDialogOptions): Promise<string | undefined> {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? undefined : r.filePaths[0];
}

/** Index into the same list `open:recent` returns; a stale menu (path moved under the index) is refused. */
export async function openRecentAt(i: unknown, expected: unknown): Promise<OpenResult> {
  if (typeof expected === "string" && readRecent().some((r) => r.path === expected) && !existsSync(expected)) {
    removeRecent(expected);
    throw new Error(OPEN_ERROR.missing);
  }
  const list = readRecent().filter((r) => existsSync(r.path));
  const item = typeof i === "number" && Number.isInteger(i) ? list[i] : undefined;
  if (!item || typeof expected !== "string" || item.path !== expected) throw new Error("无效的最近记录");
  return openPath(item.path);
}

export function registerOpenIpc(): void {
  ipcMain.handle(IPC.openWorkspace, async (e) => {
    const dir = await pick(e, { title: "打开工作区", properties: ["openDirectory", "createDirectory"] });
    return dir ? openTarget({ kind: "workspace", path: resolveOpenTarget(dir).path }) : { workspace: info() };
  });
  ipcMain.handle(IPC.openFile, async (e) => {
    const f = await pick(e, { title: "打开文件", properties: ["openFile"], filters: [{ name: "文档", extensions: Object.values(DOC_EXTENSIONS).flat() }] });
    return f ? openPath(f) : { workspace: info() };
  });
  ipcMain.handle(IPC.openRecentAt, (_e, i: unknown, expected: unknown) => openRecentAt(i, expected));
  ipcMain.handle(IPC.openRecent, () => readRecent().filter((r) => existsSync(r.path)));
}

/**
 * A file or folder dropped onto the window makes Chromium navigate to its file:// URL. Main cancels every
 * navigation away from the app and, for a file:// drop, opens that path itself and tells the renderer.
 */
export function interceptDrops(win: BrowserWindow): void {
  win.webContents.on("will-navigate", (e, url) => {
    e.preventDefault();
    if (!url.startsWith("file:")) return;
    let p: string;
    try {
      p = fileURLToPath(url);
    } catch {
      return;
    }
    openPath(p).then(
      (r) => !win.webContents.isDestroyed() && win.webContents.send(IPC.openOpened, r),
      (err: Error) => dialog.showErrorBox("无法打开", err.message)
    );
  });
}
