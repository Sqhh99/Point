import { BrowserWindow, dialog, ipcMain } from "electron";
import { DOC_EXTENSIONS } from "@point/core";
import { IPC, type WorkspaceInfo } from "../shared/ipc.js";
import { getDoc, importFile, listDocs, openWorkspace, workspacePath } from "./workspace.js";

const info = (): WorkspaceInfo => ({ path: workspacePath() });

export function registerDocsIpc(): void {
  ipcMain.handle(IPC.workspaceGet, () => info());

  ipcMain.handle(IPC.workspaceChoose, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: "选择工作区文件夹", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (!r.canceled && r.filePaths[0]) openWorkspace(r.filePaths[0]);
    return info();
  });

  ipcMain.handle(IPC.docsList, () => listDocs());

  ipcMain.handle(IPC.docsImport, async (e) => {
    if (!workspacePath()) throw new Error("请先选择工作区文件夹");
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: "导入文档",
      properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
      filters: [{ name: "文档", extensions: Object.values(DOC_EXTENSIONS).flat() }]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return [];
    const out = [];
    for (const p of r.filePaths) out.push(await importFile(p));
    return out;
  });

  ipcMain.handle(IPC.docsGet, (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("无效的文档 id");
    return getDoc(id);
  });
}
