import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type ChatEvent, type OpenResult, type PointAPI, type TaskEvent } from "../shared/ipc.js";

const api: PointAPI = {
  platform: process.platform,
  window: {
    action: (a) => ipcRenderer.invoke(IPC.windowAction, a),
    onMaximized: (cb) => {
      const listener = (_e: IpcRendererEvent, m: boolean) => cb(m);
      ipcRenderer.on(IPC.windowMaximized, listener);
      return () => ipcRenderer.removeListener(IPC.windowMaximized, listener);
    }
  },
  marks: {
    list: (docId) => ipcRenderer.invoke(IPC.marksList, docId),
    create: (docId, anchor, note) => ipcRenderer.invoke(IPC.marksCreate, docId, anchor, note),
    updateNote: (id, note) => ipcRenderer.invoke(IPC.marksUpdateNote, id, note),
    remove: (id) => ipcRenderer.invoke(IPC.marksRemove, id)
  },
  capture: {
    region: (rect) => ipcRenderer.invoke(IPC.captureRegion, rect)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    setKey: (id, key) => ipcRenderer.invoke(IPC.settingsSetKey, id, key),
    testConnection: (id) => ipcRenderer.invoke(IPC.settingsTest, id),
    onChanged: (cb) => {
      const listener = () => cb();
      ipcRenderer.on(IPC.settingsChanged, listener);
      return () => ipcRenderer.removeListener(IPC.settingsChanged, listener);
    }
  },
  models: {
    list: () => ipcRenderer.invoke(IPC.modelsList)
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
  open: {
    workspace: () => ipcRenderer.invoke(IPC.openWorkspace),
    file: () => ipcRenderer.invoke(IPC.openFile),
    recentAt: (i, p) => ipcRenderer.invoke(IPC.openRecentAt, i, p),
    recent: () => ipcRenderer.invoke(IPC.openRecent),
    onOpened: (cb) => {
      const listener = (_e: IpcRendererEvent, r: OpenResult) => cb(r);
      ipcRenderer.on(IPC.openOpened, listener);
      return () => ipcRenderer.removeListener(IPC.openOpened, listener);
    }
  },
  docs: {
    list: () => ipcRenderer.invoke(IPC.docsList),
    import: () => ipcRenderer.invoke(IPC.docsImport),
    get: (id) => ipcRenderer.invoke(IPC.docsGet, id),
    view: (id) => ipcRenderer.invoke(IPC.docsView, id),
    openExternal: (id) => ipcRenderer.invoke(IPC.docsOpenExternal, id)
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
    tree: (id) => ipcRenderer.invoke(IPC.convTree, id),
    remove: (id) => ipcRenderer.invoke(IPC.convRemove, id),
    export: (id) => ipcRenderer.invoke(IPC.convExport, id),
    setModel: (id, model, effort) => ipcRenderer.invoke(IPC.conversationModel, id, model, effort)
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
