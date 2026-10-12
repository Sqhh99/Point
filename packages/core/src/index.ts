export type { ChatMessage, ChatOptions, Delta, FetchLike, LLMProvider, Role } from "./llm/types.js";
export { LLMError, type LLMErrorCode } from "./llm/errors.js";
export { OpenAICompatibleProvider, type OpenAICompatibleConfig } from "./llm/openai-compatible.js";
export {
  PROVIDER_PRESETS,
  createProvider,
  getPreset,
  type CreateProviderInput,
  type ProviderId,
  type ProviderPreset
} from "./llm/presets.js";
export const VERSION = "0.1.0";
export {
  DOC_EXTENSIONS,
  docTypeOf,
  parseDocument,
  parseDocx,
  parseMarkdown,
  parsePdf,
  type Block,
  type DocType,
  type OutlineItem,
  type ParsedDoc
} from "./docs/index.js";
