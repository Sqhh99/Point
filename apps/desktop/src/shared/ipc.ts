import type { ChatMessage, DocType, Note, NoteInput, NoteMeta, ParsedDoc, ProviderId, ProviderPreset, TaskKind } from "@point/core";

export interface ProviderSettings {
  id: ProviderId;
  baseURL: string;
  model: string;
  hasKey: boolean;
}

export interface SettingsView {
  activeProvider: ProviderId;
  providers: ProviderSettings[];
  presets: ProviderPreset[];
  encryptionAvailable: boolean;
}

export interface ProviderPatch {
  id: ProviderId;
  baseURL?: string;
  model?: string;
  makeActive?: boolean;
}

export type TestResult = { ok: true; sample: string } | { ok: false; code: string; message: string };

export type ChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "done" }
  | { requestId: string; type: "error"; code: string; message: string };

export interface DocMeta {
  id: string;
  title: string;
  type: DocType;
  /** Path relative to the workspace root, e.g. `docs/<id>.pdf`. */
  path: string;
  importedAt: string;
}

export interface WorkspaceInfo {
  path: string | null;
}

export interface TaskRequest {
  kind: TaskKind;
  selection: string;
  context?: string;
  question?: string;
  docId?: string;
  /** 1-based page of the selection (PDF). */
  page?: number;
  /** Continue this conversation; a new one is created when omitted. */
  conversationId?: string;
  /** Re-run without storing a new user message (重新生成 / 重试). */
  regenerate?: boolean;
}

/** Stored on the user message of a task so the UI can show the quote card and re-run it. */
export interface MessageMeta {
  request: Omit<TaskRequest, "conversationId" | "regenerate">;
  docTitle?: string;
}

export interface TaskStarted {
  requestId: string;
  conversationId: string;
  userMessage?: StoredMessage;
}

export type TaskEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "done"; message: StoredMessage }
  | { requestId: string; type: "error"; code: string; message: string; partial?: StoredMessage };

export interface ConversationMeta {
  id: string;
  title: string;
  docId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  /** Previous message in this thread; null for the first message. */
  parentId: string | null;
  role: "user" | "assistant";
  content: string;
  kind?: TaskKind;
  meta?: MessageMeta;
  createdAt: string;
}

export type ExportResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled?: false; message: string };

/** The only window actions the renderer may request; anything else is rejected in main. */
export const WINDOW_ACTIONS = ["minimize", "toggleMaximize", "close"] as const;
export type WindowAction = (typeof WINDOW_ACTIONS)[number];
export function isWindowAction(a: unknown): a is WindowAction {
  return typeof a === "string" && (WINDOW_ACTIONS as readonly string[]).includes(a);
}

export interface PointAPI {
  platform: string;
  window: {
    action(a: WindowAction): Promise<void>;
    /** Fires with the new maximized state; returns an unsubscribe. */
    onMaximized(cb: (maximized: boolean) => void): () => void;
  };
  settings: {
    get(): Promise<SettingsView>;
    update(patch: ProviderPatch): Promise<SettingsView>;
    setKey(id: ProviderId, key: string): Promise<SettingsView>;
    testConnection(id: ProviderId): Promise<TestResult>;
  };
  chat: {
    start(messages: ChatMessage[], providerId?: ProviderId): Promise<string>;
    cancel(requestId: string): Promise<void>;
    onEvent(cb: (e: ChatEvent) => void): () => void;
  };
  workspace: {
    get(): Promise<WorkspaceInfo>;
    /** Opens a folder picker; resolves to the (possibly unchanged) workspace. */
    choose(): Promise<WorkspaceInfo>;
  };
  docs: {
    list(): Promise<DocMeta[]>;
    /** Opens a file picker (pdf/docx/md) and copies the picks into the workspace. */
    import(): Promise<DocMeta[]>;
    get(id: string): Promise<ParsedDoc>;
  };
  tasks: {
    run(req: TaskRequest): Promise<TaskStarted>;
    cancel(requestId: string): Promise<void>;
    onEvent(cb: (e: TaskEvent) => void): () => void;
  };
  conversations: {
    list(): Promise<ConversationMeta[]>;
    messages(conversationId: string): Promise<StoredMessage[]>;
    remove(conversationId: string): Promise<void>;
    /** System save dialog → one .md of the conversation. */
    export(conversationId: string): Promise<ExportResult>;
  };
  notes: {
    list(): Promise<NoteMeta[]>;
    read(id: string): Promise<Note>;
    create(input: NoteInput): Promise<Note>;
    update(id: string, patch: { title?: string; body?: string; tags?: string[] }): Promise<Note>;
    append(id: string, text: string): Promise<Note>;
    /** System save dialog → one .md with export frontmatter. */
    exportCurrent(id: string): Promise<ExportResult>;
    /** System save dialog → zip of every note in the workspace. */
    exportAll(): Promise<ExportResult>;
  };
}

export const IPC = {
  windowAction: "window:action",
  windowMaximized: "window:maximized",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsSetKey: "settings:setKey",
  settingsTest: "settings:test",
  chatStart: "chat:start",
  chatCancel: "chat:cancel",
  chatEvent: "chat:event",
  workspaceGet: "workspace:get",
  workspaceChoose: "workspace:choose",
  docsList: "docs:list",
  docsImport: "docs:import",
  docsGet: "docs:get",
  tasksRun: "tasks:run",
  tasksCancel: "tasks:cancel",
  tasksEvent: "tasks:event",
  convList: "conversations:list",
  convMessages: "conversations:messages",
  convRemove: "conversations:remove",
  notesList: "notes:list",
  notesRead: "notes:read",
  notesCreate: "notes:create",
  notesUpdate: "notes:update",
  notesAppend: "notes:append",
  notesExportCurrent: "notes:exportCurrent",
  notesExportAll: "notes:exportAll",
  convExport: "conversations:export"
} as const;
