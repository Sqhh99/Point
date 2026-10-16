/**
 * Data-driven model catalogue and request-body effort patches (Cherry Studio style).
 * Adapters never branch on vendor for thinking: they apply `EffortLevel.writes` and,
 * when `thinking` is true, omit temperature.
 */

/** Nested path writes, e.g. `"thinking.type" → "enabled"`, `"reasoning_effort" → "high"`. */
export type FieldWrites = Readonly<Record<string, string | boolean | number | null>>;

export interface EffortLevel {
  /** Stable id stored on the conversation (`off` | `low` | …). */
  id: string;
  /** UI label (关 / 低 / 中 / 高 / …). */
  label: string;
  /** Patches merged into the chat/completions JSON body. */
  writes: FieldWrites;
  /** When true the request must not send `temperature`. */
  thinking: boolean;
}

export interface ModelSpec {
  /** Wire name sent as `model`. */
  id: string;
  label: string;
  vision: boolean;
  /**
   * Declared thinking levels for this model. Empty = control hidden.
   * No universal "off": a level that disables thinking is just another entry (or absent when the model cannot disable).
   */
  efforts: readonly EffortLevel[];
  /** Default effort id when the conversation has none; null if efforts is empty. */
  defaultEffort: string | null;
}

export interface ProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  /** Key lookup in main's safeStorage; never the key itself. */
  apiKeyRef: string;
  models: readonly ModelSpec[];
  defaultModel: string;
}

/** Apply dotted paths onto a plain object (mutates `body`). */
export function applyWrites(body: Record<string, unknown>, writes: FieldWrites): void {
  for (const [path, value] of Object.entries(writes)) {
    const parts = path.split(".");
    let cur: Record<string, unknown> = body;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]!;
      const next = cur[k];
      if (!next || typeof next !== "object" || Array.isArray(next)) cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
  }
}

export function effortOf(model: ModelSpec, id: string | null | undefined): EffortLevel | undefined {
  if (!id) return model.efforts.find((e) => e.id === model.defaultEffort) ?? model.efforts[0];
  return model.efforts.find((e) => e.id === id);
}

/** DeepSeek thinking levels (https://api-docs.deepseek.com/guides/thinking_mode). Can disable. */
const DEEPSEEK_EFFORTS: readonly EffortLevel[] = [
  { id: "off", label: "关", writes: { "thinking.type": "disabled" }, thinking: false },
  { id: "low", label: "低", writes: { "thinking.type": "enabled", reasoning_effort: "low" }, thinking: true },
  { id: "high", label: "高", writes: { "thinking.type": "enabled", reasoning_effort: "high" }, thinking: true },
  { id: "max", label: "最大", writes: { "thinking.type": "enabled", reasoning_effort: "max" }, thinking: true }
];

/** GLM-5.3 family: cannot disable (https://docs.bigmodel.cn/cn/guide/capabilities/thinking). */
const GLM53_EFFORTS: readonly EffortLevel[] = [
  { id: "low", label: "低", writes: { "thinking.type": "enabled", reasoning_effort: "low" }, thinking: true },
  { id: "high", label: "高", writes: { "thinking.type": "enabled", reasoning_effort: "high" }, thinking: true },
  { id: "max", label: "最大", writes: { "thinking.type": "enabled", reasoning_effort: "max" }, thinking: true }
];

/** GLM-5.2: off / high / max. */
const GLM52_EFFORTS: readonly EffortLevel[] = [
  { id: "off", label: "关", writes: { "thinking.type": "disabled" }, thinking: false },
  { id: "high", label: "高", writes: { "thinking.type": "enabled", reasoning_effort: "high" }, thinking: true },
  { id: "max", label: "最大", writes: { "thinking.type": "enabled", reasoning_effort: "max" }, thinking: true }
];

/** GLM-5.1 / 5 / 5-Turbo / 4.6 / 4.5: on/off only. */
const GLM_ON_OFF: readonly EffortLevel[] = [
  { id: "off", label: "关", writes: { "thinking.type": "disabled" }, thinking: false },
  { id: "on", label: "开", writes: { "thinking.type": "enabled" }, thinking: true }
];

/** OpenAI GPT-6 Astra (Chat Completions `reasoning_effort`): no `none`. */
const GPT6_ASTRA: readonly EffortLevel[] = [
  { id: "low", label: "低", writes: { reasoning_effort: "low" }, thinking: true },
  { id: "medium", label: "中", writes: { reasoning_effort: "medium" }, thinking: true },
  { id: "high", label: "高", writes: { reasoning_effort: "high" }, thinking: true },
  { id: "xhigh", label: "极高", writes: { reasoning_effort: "xhigh" }, thinking: true },
  { id: "max", label: "最大", writes: { reasoning_effort: "max" }, thinking: true }
];

/** OpenAI GPT-6.1 Sol: same five, default medium. */
const GPT61_SOL: readonly EffortLevel[] = GPT6_ASTRA;

/**
 * Built-in provider configs. Custom OpenAI-compatible endpoints are extra configs of the same
 * adapter shape (`id/label/baseUrl/apiKeyRef/models`), not a second adapter type.
 */
export const PROVIDER_CONFIGS: readonly ProviderConfig[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyRef: "deepseek",
    defaultModel: "deepseek-flash",
    models: [
      { id: "deepseek-flash", label: "DeepSeek Flash", vision: true, efforts: DEEPSEEK_EFFORTS, defaultEffort: "high" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false, efforts: DEEPSEEK_EFFORTS, defaultEffort: "high" }
    ]
  },
  {
    id: "openai",
    label: "OpenAI GPT",
    baseUrl: "https://api.openai.com/v1",
    apiKeyRef: "openai",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", vision: true, efforts: [], defaultEffort: null },
      { id: "gpt-4o", label: "GPT-4o", vision: true, efforts: [], defaultEffort: null },
      { id: "gpt-4.1", label: "GPT-4.1", vision: true, efforts: [], defaultEffort: null },
      { id: "gpt-6-astra", label: "GPT-6 Astra", vision: true, efforts: GPT6_ASTRA, defaultEffort: "medium" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", vision: true, efforts: GPT61_SOL, defaultEffort: "medium" }
    ]
  },
  {
    id: "glm",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyRef: "glm",
    defaultModel: "glm-4-flash",
    models: [
      // Legacy presets kept so saved settings still resolve; thinking unverified / forced → empty.
      { id: "glm-4-flash", label: "GLM-4 Flash", vision: false, efforts: [], defaultEffort: null },
      { id: "glm-4-plus", label: "GLM-4 Plus", vision: false, efforts: [], defaultEffort: null },
      { id: "glm-4-air", label: "GLM-4 Air", vision: false, efforts: [], defaultEffort: null },
      { id: "glm-4v-flash", label: "GLM-4V Flash", vision: true, efforts: [], defaultEffort: null },
      { id: "glm-4v-plus", label: "GLM-4V Plus", vision: true, efforts: [], defaultEffort: null },
      { id: "glm-4.5", label: "GLM-4.5", vision: false, efforts: GLM_ON_OFF, defaultEffort: "on" },
      { id: "glm-4.6", label: "GLM-4.6", vision: false, efforts: GLM_ON_OFF, defaultEffort: "on" },
      { id: "glm-5", label: "GLM-5", vision: false, efforts: GLM_ON_OFF, defaultEffort: "on" },
      { id: "glm-5-turbo", label: "GLM-5 Turbo", vision: false, efforts: GLM_ON_OFF, defaultEffort: "on" },
      { id: "glm-5.1", label: "GLM-5.1", vision: false, efforts: GLM_ON_OFF, defaultEffort: "on" },
      { id: "glm-5.2", label: "GLM-5.2", vision: false, efforts: GLM52_EFFORTS, defaultEffort: "max" },
      { id: "glm-5.3", label: "GLM-5.3", vision: false, efforts: GLM53_EFFORTS, defaultEffort: "max" },
      { id: "glm-5.3-flash", label: "GLM-5.3 Flash", vision: false, efforts: GLM53_EFFORTS, defaultEffort: "max" }
    ]
  }
];

export function providerConfig(id: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS.find((p) => p.id === id);
}

export function modelSpec(providerId: string, modelId: string): ModelSpec | undefined {
  return providerConfig(providerId)?.models.find((m) => m.id === modelId);
}

/**
 * Map a saved model name from before the V4 rename onto a current ModelSpec + effort.
 * Unknown names return null (caller falls back to the provider default and shows a notice).
 */
export function migrateSavedModel(
  providerId: string,
  saved: string
): { model: string; effort: string | null } | null {
  const p = providerConfig(providerId);
  if (!p) return null;
  if (p.models.some((m) => m.id === saved)) {
    const m = p.models.find((x) => x.id === saved)!;
    return { model: saved, effort: m.defaultEffort };
  }
  if (providerId === "deepseek") {
    if (saved === "deepseek-chat") return { model: "deepseek-flash", effort: "off" };
    if (saved === "deepseek-reasoner") return { model: "deepseek-flash", effort: "high" };
  }
  return null;
}

/** https only; http allowed solely for localhost / 127.0.0.1. */
export function assertBaseUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("Base URL 无效");
  }
  const host = u.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (u.protocol === "https:") return u.toString().replace(/\/+$/, "");
  if (u.protocol === "http:" && local) return u.toString().replace(/\/+$/, "");
  throw new Error("Base URL 仅支持 https（localhost 可用 http）");
}
