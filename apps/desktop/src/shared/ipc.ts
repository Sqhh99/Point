import type { ChatMessage, ProviderId, ProviderPreset } from "@point/core";

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
}

export const IPC = {
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsSetKey: "settings:setKey",
  settingsTest: "settings:test",
  chatStart: "chat:start",
  chatCancel: "chat:cancel",
  chatEvent: "chat:event"
} as const;
