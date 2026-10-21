import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROVIDER_PRESETS, assertBaseUrl, getPreset, migrateSavedModel, modelSpec, providerConfig, type ModelSpec, type ProviderId } from "@point/core";
import { fakeEnabled, fakeVision } from "./fake-llm.js";
import type { ProviderPatch, SettingsView } from "../shared/ipc.js";

interface StoredProvider {
  baseURL: string;
  model: string;
  /** base64 of the safeStorage-encrypted API key */
  encKey?: string;
  /**
   * User declaration of `capabilities.vision`. Only read for a custom model id on a custom
   * OpenAI-compatible endpoint; preset paths always use ModelSpec.vision.
   */
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
    }
    // Any other unknown name stays on disk: on a custom endpoint it is the user's model; on a preset
    // endpoint modelOf() falls back to the provider default and listModels reports it (notice).
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

const normUrl = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

/**
 * Custom OpenAI-compatible endpoint = the provider's Base URL was changed from the preset's. Only there
 * can a model id outside the ModelSpec table be used (with the user's capability declaration).
 */
function customEndpoint(id: ProviderId, cur: StoredProvider): boolean {
  const preset = getPreset(id)!;
  return normUrl(cur.baseURL || preset.baseURL) !== normUrl(preset.baseURL);
}

/** Name shown for the active service: the preset's, or "" on a custom endpoint (not that vendor's API). */
const providerNameOf = (id: ProviderId, cur: StoredProvider, name: string) => (customEndpoint(id, cur) ? "" : name);

/** Saved id is not usable on this path: preset endpoint and not in the ModelSpec table. */
function unavailable(id: ProviderId, cur: StoredProvider): boolean {
  return !modelSpec(id, cur.model) && !customEndpoint(id, cur);
}

/** The model id this provider actually runs with: preset path + unknown id → the provider's defaultModel. */
function modelOf(id: ProviderId, cur: StoredProvider): string {
  return unavailable(id, cur) ? providerConfig(id)!.defaultModel : cur.model;
}

export const modelFallbackNotice = (id: ProviderId) => `原模型已不可用，已改用 ${providerConfig(id)!.defaultModel}`;

/**
 * The spec a model id runs with. Preset id → the capability table (ModelSpec), user flag ignored.
 * On a custom endpoint, the provider's saved custom model id → a spec built from the user's declaration
 * (vision only when ticked). Anything else (a removed/unknown id on a preset endpoint, any other id)
 * → undefined; callers fall back to defaultModel. The declaration is never read on a preset endpoint.
 */
function specOf(id: ProviderId, cur: StoredProvider, modelId: string): (ModelSpec & { custom: boolean }) | undefined {
  const preset = modelSpec(id, modelId);
  if (preset) return { ...preset, custom: false };
  if (!customEndpoint(id, cur) || modelId !== cur.model) return undefined;
  return { id: modelId, label: modelId, vision: cur.vision === true, efforts: [], defaultEffort: null, custom: true };
}

/** Main-process only: resolve a model id of the active provider (see specOf). */
export function askSpec(modelId: string): (ModelSpec & { custom: boolean }) | undefined {
  const s = load();
  return specOf(s.activeProvider, providerOf(s, s.activeProvider), modelId);
}

const visionOf = (id: ProviderId, cur: StoredProvider) => !!specOf(id, cur, modelOf(id, cur))?.vision;

/** The active provider has a saved key (or the e2e fake LLM is on). Without it no model is usable. */
function configuredOf(s: StoredSettings): boolean {
  return fakeEnabled() || !!providerOf(s, s.activeProvider).encKey;
}

export function isConfigured(): boolean {
  return configuredOf(load());
}

/** Saved model id of the active provider (main-process only). resolveAsk resolves it through askSpec,
 *  so an id outside the table on a preset endpoint falls back there, with the model-notice. */
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
      : { providerName: providerNameOf(s.activeProvider, act, getPreset(s.activeProvider)!.name), model: modelOf(s.activeProvider, act), vision: visionOf(s.activeProvider, act) },
    presets: [...PROVIDER_PRESETS],
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    providers: PROVIDER_PRESETS.map((p) => {
      const cur = providerOf(s, p.id);
      return {
        id: p.id,
        baseURL: cur.baseURL,
        model: modelOf(p.id, cur),
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
    // Unknown ids are kept only on a custom OpenAI-compatible endpoint; a preset endpoint falls back.
    cur.model = mapped?.model ?? raw;
    if (unavailable(patch.id, cur)) cur.model = preset.defaultModel;
  }
  if (patch.vision === null) delete cur.vision;
  else if (typeof patch.vision === "boolean") cur.vision = patch.vision;
  // A stored flag is never applied on a preset path (specOf reads it only for a custom-endpoint model).
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
  return { id: pid, baseURL: cur.baseURL, model: modelOf(pid, cur), apiKey, vision: visionOf(pid, cur) };
}


/** Models of the *current* provider only, plus whether a key is configured. Keys never leave main. */
export function listModels(): { providerId: ProviderId; providerName: string; configured: boolean; models: (ModelSpec & { configured: boolean; custom?: boolean })[]; defaultModel?: string; notice?: string } {
  const s = load();
  const p = providerConfig(s.activeProvider)!;
  const cur = providerOf(s, s.activeProvider);
  const configured = configuredOf(s);
  const providerName = providerNameOf(s.activeProvider, cur, p.label);
  // No key → no usable model: list nothing (presets included) so the UI cannot default-select one.
  if (!configured) return { providerId: s.activeProvider, providerName, configured: false, models: [] };
  // Preset endpoint + unknown saved id: fell back to defaultModel; say so (as before).
  const notice = unavailable(s.activeProvider, cur) ? modelFallbackNotice(s.activeProvider) : undefined;
  // A saved custom model (custom endpoint only) is listed first; presets follow.
  const custom = specOf(s.activeProvider, cur, cur.model);
  const specs: (ModelSpec & { custom?: boolean })[] = custom?.custom ? [{ id: custom.id, label: custom.label, vision: custom.vision, efforts: [], defaultEffort: null, custom: true }, ...p.models] : [...p.models];
  return {
    providerId: s.activeProvider,
    providerName,
    configured: true,
    notice,
    // ModelBar's default pick: the model saved in Settings when it is listed.
    defaultModel: specs.some((m) => m.id === modelOf(s.activeProvider, cur)) ? modelOf(s.activeProvider, cur) : p.defaultModel,
    // vision is the same field tasks:run gates on (fake text-only seam can only narrow it).
    models: specs.map((m) => ({ ...m, vision: m.vision && (!fakeEnabled() || fakeVision()), configured: true }))
  };
}
