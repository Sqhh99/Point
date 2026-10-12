import type { ChatMessage, DocType, ParsedDoc, ProviderId, ProviderPreset } from "@point/core";

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
  docsGet: "docs:get"
} as const;
