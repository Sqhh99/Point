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
  /** Continue this conversation; a new one is created when omitted. */
  conversationId?: string;
}

export interface TaskStarted {
  requestId: string;
  conversationId: string;
  userMessage: StoredMessage;
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
  role: "user" | "assistant";
  content: string;
  kind?: TaskKind;
  createdAt: string;
}

export interface PointAPI {
  platform: string;
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
  };
  notes: {
    list(): Promise<NoteMeta[]>;
    read(id: string): Promise<Note>;
    create(input: NoteInput): Promise<Note>;
    update(id: string, patch: { title?: string; body?: string; tags?: string[] }): Promise<Note>;
    append(id: string, text: string): Promise<Note>;
  };
}

export const IPC = {
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
  notesAppend: "notes:append"
} as const;
