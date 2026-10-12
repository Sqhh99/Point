import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type ChatEvent, type PointAPI, type TaskEvent } from "../shared/ipc.js";

const api: PointAPI = {
  platform: process.platform,
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    setKey: (id, key) => ipcRenderer.invoke(IPC.settingsSetKey, id, key),
    testConnection: (id) => ipcRenderer.invoke(IPC.settingsTest, id)
  },
  chat: {
    start: (messages, providerId) => ipcRenderer.invoke(IPC.chatStart, messages, providerId),
    cancel: (requestId) => ipcRenderer.invoke(IPC.chatCancel, requestId),
    onEvent: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: ChatEvent) => cb(ev);
      ipcRenderer.on(IPC.chatEvent, listener);
      return () => ipcRenderer.removeListener(IPC.chatEvent, listener);
    }
  },
  workspace: {
    get: () => ipcRenderer.invoke(IPC.workspaceGet),
    choose: () => ipcRenderer.invoke(IPC.workspaceChoose)
  },
  docs: {
    list: () => ipcRenderer.invoke(IPC.docsList),
    import: () => ipcRenderer.invoke(IPC.docsImport),
    get: (id) => ipcRenderer.invoke(IPC.docsGet, id)
  },
  tasks: {
    run: (req) => ipcRenderer.invoke(IPC.tasksRun, req),
    cancel: (requestId) => ipcRenderer.invoke(IPC.tasksCancel, requestId),
    onEvent: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: TaskEvent) => cb(ev);
      ipcRenderer.on(IPC.tasksEvent, listener);
      return () => ipcRenderer.removeListener(IPC.tasksEvent, listener);
    }
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.convList),
    messages: (id) => ipcRenderer.invoke(IPC.convMessages, id),
    remove: (id) => ipcRenderer.invoke(IPC.convRemove, id),
    export: (id) => ipcRenderer.invoke(IPC.convExport, id)
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    read: (id) => ipcRenderer.invoke(IPC.notesRead, id),
    create: (input) => ipcRenderer.invoke(IPC.notesCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.notesUpdate, id, patch),
    append: (id, text) => ipcRenderer.invoke(IPC.notesAppend, id, text),
    exportCurrent: (id) => ipcRenderer.invoke(IPC.notesExportCurrent, id),
    exportAll: () => ipcRenderer.invoke(IPC.notesExportAll)
  }
};

contextBridge.exposeInMainWorld("point", api);
