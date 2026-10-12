import type { ChatMessage, DocType, Mark, MarkAnchor, Note, NoteInput, NoteMeta, ParsedDoc, ProviderId, ProviderPreset, TaskKind } from "@point/core";

export interface ProviderSettings {
  id: ProviderId;
  baseURL: string;
  model: string;
  hasKey: boolean;
  /** Effective capabilities of the configured model (user override, else preset). */
  capabilities: { vision: boolean };
  /** True when the user set vision explicitly instead of relying on the preset list. */
  visionOverride?: boolean;
}

/** What the status bar shows: the model questions are sent to right now. */
export interface ActiveModel {
  providerName: string;
  model: string;
  vision: boolean;
}

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Only the sha of the stored PNG crosses IPC; main builds the path itself. */
export interface CaptureResult {
  sha: string;
  width: number;
  height: number;
}

export interface SettingsView {
  activeProvider: ProviderId;
  providers: ProviderSettings[];
  presets: ProviderPreset[];
  encryptionAvailable: boolean;
  active: ActiveModel;
}

export interface ProviderPatch {
  id: ProviderId;
  baseURL?: string;
  model?: string;
  /** true/false sets the vision capability explicitly; null clears it back to the preset default. */
  vision?: boolean | null;
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

export interface RecentItem {
  kind: "workspace" | "file";
  /** Absolute path on disk. */
  path: string;
  name: string;
  openedAt: string;
}

/** Result of opening something: the workspace now active, plus the document to show when a file was opened. */
export interface OpenResult {
  workspace: WorkspaceInfo;
  doc?: DocMeta;
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
  /** 「一起问」: ids of marks (in the user's selection order); main loads their text / images. */
  marks?: string[];
  /** sha256 of a region capture in `.point/captures/` to attach as an image. */
  image?: string;
  /** Re-run without storing a new user message (重新生成 / 重试). */
  regenerate?: boolean;
}

/** Stored on the user message of a task so the UI can show the quote card and re-run it. */
export interface MessageMeta {
  request: Omit<TaskRequest, "conversationId" | "regenerate">;
  /** Snapshot of the marks sent with 「一起问」, in order (validated anchors from the database). */
  marks?: MarkAnchor[];
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
  marks: {
    list(docId: string): Promise<Mark[]>;
    create(docId: string, anchor: MarkAnchor, note?: string): Promise<Mark>;
    updateNote(id: string, note: string): Promise<Mark>;
    remove(id: string): Promise<void>;
  };
  capture: {
    /** Captures `rect` (CSS px of this window) into the workspace; resolves with the sha only. */
    region(rect: CaptureRect): Promise<CaptureResult>;
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
  open: {
    /** Folder picker → becomes the workspace. */
    workspace(): Promise<OpenResult>;
    /** Single-file picker; without a workspace the file goes into a private scratch workspace. */
    file(): Promise<OpenResult>;
    /**
     * The recent entry at `index` in main's own list. `path` is only the menu's copy, used to detect a
     * stale menu: main opens its own stored path, and refuses when they no longer match.
     */
    recentAt(index: number, path: string): Promise<OpenResult>;
    recent(): Promise<RecentItem[]>;
    /** Fires when main opened something on its own, e.g. a file or folder dropped onto the window. */
    onOpened(cb: (r: OpenResult) => void): () => void;
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
  openWorkspace: "open:workspace",
  openFile: "open:file",
  openRecentAt: "open:recentAt",
  openOpened: "open:opened",
  openRecent: "open:recent",
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
  convExport: "conversations:export",
  captureRegion: "capture:region",
  marksList: "marks:list",
  marksCreate: "marks:create",
  marksUpdateNote: "marks:updateNote",
  marksRemove: "marks:remove"
} as const;
