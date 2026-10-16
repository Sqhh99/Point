import { PROVIDER_CONFIGS, modelSpec, providerConfig, type ModelSpec } from "./models.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { FetchLike, LLMProvider } from "./types.js";

export type ProviderId = "deepseek" | "openai" | "glm";

/** @deprecated Prefer ProviderConfig / ModelSpec; kept so settings UI and tests keep compiling during the migration. */
export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseURL: string;
  defaultModel: string;
  models: string[];
  visionModels: string[];
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = PROVIDER_CONFIGS.filter((p): p is typeof p & { id: ProviderId } =>
  p.id === "deepseek" || p.id === "openai" || p.id === "glm"
).map((p) => ({
  id: p.id as ProviderId,
  name: p.label,
  baseURL: p.baseUrl,
  defaultModel: p.defaultModel,
  models: p.models.map((m) => m.id),
  visionModels: p.models.filter((m) => m.vision).map((m) => m.id)
}));

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export interface ModelCapabilities {
  vision: boolean;
}

export function modelCapabilities(id: string, model: string, override?: Partial<ModelCapabilities>): ModelCapabilities {
  if (typeof override?.vision === "boolean") return { vision: override.vision };
  return { vision: !!modelSpec(id, model)?.vision };
}

export interface CreateProviderInput {
  id: ProviderId;
  apiKey: string;
  baseURL?: string;
  fetch?: FetchLike;
}

export function createProvider(input: CreateProviderInput): LLMProvider {
  const preset = providerConfig(input.id);
  if (!preset) throw new Error(`未知的模型服务: ${input.id}`);
  return new OpenAICompatibleProvider({
    id: preset.id,
    baseURL: input.baseURL || preset.baseUrl,
    apiKey: input.apiKey,
    fetch: input.fetch
  });
}

export type { ModelSpec };
