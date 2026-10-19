import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROVIDER_PRESETS, assertBaseUrl, getPreset, migrateSavedModel, modelCapabilities, modelSpec, providerConfig, type ModelSpec, type ProviderId } from "@point/core";
import { fakeEnabled, fakeVision } from "./fake-llm.js";
import type { ProviderPatch, SettingsView } from "../shared/ipc.js";

interface StoredProvider {
  baseURL: string;
  model: string;
  /** base64 of the safeStorage-encrypted API key */
  encKey?: string;
  /** Explicit `capabilities.vision`; absent = use the preset's list of vision models. */
  vision?: boolean;
}

interface StoredSettings {
  activeProvider: ProviderId;
  providers: Partial<Record<ProviderId, StoredProvider>>;
}

const file = () => join(app.getPath("userData"), "settings.json");

function load(): StoredSettings {
  let s: StoredSettings = { activeProvider: "deepseek", providers: {} };
  try {
    if (existsSync(file())) s = JSON.parse(readFileSync(file(), "utf8")) as StoredSettings;
  } catch {
    // corrupt file: fall back to defaults
  }
  let dirty = false;
  for (const id of Object.keys(s.providers) as ProviderId[]) {
    const cur = s.providers[id];
    if (!cur?.model) continue;
    const mapped = migrateSavedModel(id, cur.model);
    if (mapped && mapped.model !== cur.model) {
      cur.model = mapped.model;
      dirty = true;
    } else if (!mapped && !modelSpec(id, cur.model)) {
      // Unknown old name: fall back to provider default (ask must not fail); UI shows a notice via models:list.
      cur.model = providerConfig(id)?.defaultModel ?? cur.model;
      dirty = true;
    }
  }
  if (dirty) save(s);
  return s;
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

const visionOf = (id: ProviderId, cur: StoredProvider) => modelCapabilities(id, cur.model, { vision: cur.vision }).vision;

/** The active provider has a saved key (or the e2e fake LLM is on). Without it no model is usable. */
function configuredOf(s: StoredSettings): boolean {
  return fakeEnabled() || !!providerOf(s, s.activeProvider).encKey;
}

export function isConfigured(): boolean {
  return configuredOf(load());
}

/** Saved model id of the active provider (main-process only; may be a legacy name). */
export function activeModelId(): string {
  const s = load();
  return providerOf(s, s.activeProvider).model;
}

export function view(): SettingsView {
  const s = load();
  const act = providerOf(s, s.activeProvider);
  return {
    activeProvider: s.activeProvider,
    configured: configuredOf(s),
    active: fakeEnabled()
      ? { providerName: "测试模型", model: "fake", vision: fakeVision() }
      : { providerName: getPreset(s.activeProvider)!.name, model: act.model, vision: visionOf(s.activeProvider, act) },
    presets: [...PROVIDER_PRESETS],
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    providers: PROVIDER_PRESETS.map((p) => {
      const cur = providerOf(s, p.id);
      return {
        id: p.id,
        baseURL: cur.baseURL,
        model: cur.model,
        hasKey: !!cur.encKey,
        capabilities: { vision: visionOf(p.id, cur) },
        visionOverride: typeof cur.vision === "boolean" ? cur.vision : undefined
      };
    })
  };
}

export function update(patch: ProviderPatch): SettingsView {
  const s = load();
  const cur = providerOf(s, patch.id);
  const preset = getPreset(patch.id)!;
  if (patch.baseURL !== undefined) cur.baseURL = assertBaseUrl(patch.baseURL.trim() || preset.baseURL);
  if (patch.model !== undefined) {
    const raw = patch.model.trim() || preset.defaultModel;
    const mapped = migrateSavedModel(patch.id, raw);
    cur.model = mapped?.model ?? (modelSpec(patch.id, raw) ? raw : preset.defaultModel);
  }
  if (patch.vision === null) delete cur.vision;
  else if (typeof patch.vision === "boolean") cur.vision = patch.vision;
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
export function resolveProvider(id?: ProviderId): { id: ProviderId; baseURL: string; model: string; apiKey: string; vision: boolean } {
  const s = load();
  const pid = id ?? s.activeProvider;
  const cur = providerOf(s, pid);
  if (!cur.encKey) throw Object.assign(new Error("尚未设置 API Key"), { code: "auth" });
  const apiKey = safeStorage.decryptString(Buffer.from(cur.encKey, "base64"));
  return { id: pid, baseURL: cur.baseURL, model: cur.model, apiKey, vision: visionOf(pid, cur) };
}


/** Models of the *current* provider only, plus whether a key is configured. Keys never leave main. */
export function listModels(): { providerId: ProviderId; providerName: string; configured: boolean; models: (ModelSpec & { configured: boolean })[]; notice?: string } {
  const s = load();
  const p = providerConfig(s.activeProvider)!;
  const cur = providerOf(s, s.activeProvider);
  const configured = configuredOf(s);
  // No key → no usable model: list nothing (presets included) so the UI cannot default-select one.
  if (!configured) return { providerId: s.activeProvider, providerName: p.label, configured: false, models: [] };
  const notice = modelSpec(s.activeProvider, cur.model) ? undefined : `原模型已不可用，已改用 ${p.defaultModel}`;
  return {
    providerId: s.activeProvider,
    providerName: p.label,
    configured: true,
    notice,
    // vision is ModelSpec.vision, the same field tasks:run gates on (fake text-only seam narrows it).
    models: p.models.map((m) => ({ ...m, vision: m.vision && (!fakeEnabled() || fakeVision()), configured: true }))
  };
}
