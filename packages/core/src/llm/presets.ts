import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { FetchLike, LLMProvider } from "./types.js";

export type ProviderId = "deepseek" | "openai" | "glm";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseURL: string;
  defaultModel: string;
  models: string[];
  /** Preset models known to accept images; a user setting can override per provider. */
  visionModels: string[];
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"], visionModels: [] },
  { id: "openai", name: "OpenAI GPT", baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"], visionModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"] },
  { id: "glm", name: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash", models: ["glm-4-flash", "glm-4-plus", "glm-4-air", "glm-4v-flash", "glm-4v-plus"], visionModels: ["glm-4v-flash", "glm-4v-plus"] }
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export interface ModelCapabilities {
  vision: boolean;
}

/** An explicit user setting wins; otherwise the preset's list of vision models decides. */
export function modelCapabilities(id: string, model: string, override?: Partial<ModelCapabilities>): ModelCapabilities {
  if (typeof override?.vision === "boolean") return { vision: override.vision };
  return { vision: !!getPreset(id)?.visionModels.includes(model) };
}

export interface CreateProviderInput {
  id: ProviderId;
  apiKey: string;
  baseURL?: string;
  fetch?: FetchLike;
}

export function createProvider(input: CreateProviderInput): LLMProvider {
  const preset = getPreset(input.id);
  if (!preset) throw new Error(`未知的模型服务: ${input.id}`);
  return new OpenAICompatibleProvider({
    id: preset.id,
    baseURL: input.baseURL || preset.baseURL,
    apiKey: input.apiKey,
    fetch: input.fetch
  });
}
