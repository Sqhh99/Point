import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type ChatEvent, type PointAPI } from "../shared/ipc.js";

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
  }
};

contextBridge.exposeInMainWorld("point", api);
