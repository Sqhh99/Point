import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROVIDER_PRESETS, getPreset, type ProviderId } from "@point/core";
import type { ProviderPatch, SettingsView } from "../shared/ipc.js";

interface StoredProvider {
  baseURL: string;
  model: string;
  /** base64 of the safeStorage-encrypted API key */
  encKey?: string;
}

interface StoredSettings {
  activeProvider: ProviderId;
  providers: Partial<Record<ProviderId, StoredProvider>>;
}

const file = () => join(app.getPath("userData"), "settings.json");

function load(): StoredSettings {
  try {
    if (existsSync(file())) return JSON.parse(readFileSync(file(), "utf8")) as StoredSettings;
  } catch {
    // corrupt file: fall back to defaults
  }
  return { activeProvider: "deepseek", providers: {} };
}

function save(s: StoredSettings): void {
  mkdirSync(dirname(file()), { recursive: true });
  const tmp = file() + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}

function providerOf(s: StoredSettings, id: ProviderId): StoredProvider {
  const preset = getPreset(id);
  if (!preset) throw new Error(`未知的模型服务: ${id}`);
  return s.providers[id] ?? { baseURL: preset.baseURL, model: preset.defaultModel };
}

export function view(): SettingsView {
  const s = load();
  return {
    activeProvider: s.activeProvider,
    presets: [...PROVIDER_PRESETS],
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    providers: PROVIDER_PRESETS.map((p) => {
      const cur = providerOf(s, p.id);
      return { id: p.id, baseURL: cur.baseURL, model: cur.model, hasKey: !!cur.encKey };
    })
  };
}

export function update(patch: ProviderPatch): SettingsView {
  const s = load();
  const cur = providerOf(s, patch.id);
  const preset = getPreset(patch.id)!;
  if (patch.baseURL !== undefined) cur.baseURL = patch.baseURL.trim() || preset.baseURL;
  if (patch.model !== undefined) cur.model = patch.model.trim() || preset.defaultModel;
  s.providers[patch.id] = cur;
  if (patch.makeActive) s.activeProvider = patch.id;
  save(s);
  return view();
}

export function setKey(id: ProviderId, key: string): SettingsView {
  const s = load();
  const cur = providerOf(s, id);
  if (key.trim() === "") {
    delete cur.encKey;
  } else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统加密不可用，无法安全保存 API Key");
    cur.encKey = safeStorage.encryptString(key.trim()).toString("base64");
  }
  s.providers[id] = cur;
  save(s);
  return view();
}

/** Main-process only: the decrypted key must never cross IPC. */
export function resolveProvider(id?: ProviderId): { id: ProviderId; baseURL: string; model: string; apiKey: string } {
  const s = load();
  const pid = id ?? s.activeProvider;
  const cur = providerOf(s, pid);
  if (!cur.encKey) throw Object.assign(new Error("尚未设置 API Key"), { code: "auth" });
  const apiKey = safeStorage.decryptString(Buffer.from(cur.encKey, "base64"));
  return { id: pid, baseURL: cur.baseURL, model: cur.model, apiKey };
}
