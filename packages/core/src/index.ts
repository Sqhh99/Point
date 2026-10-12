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
  parseXlsx,
  XLSX_MAX_ROWS,
  decodeCsv,
  type Block,
  type DocType,
  type OutlineItem,
  type ParsedDoc
} from "./docs/index.js";
export {
  LIMITS,
  TASK_LABELS,
  buildTaskMessages,
  describeTask,
  extractMermaid,
  parseTaskOutput,
  validateMermaid,
  type MermaidBlock,
  type TaskInput,
  type TaskKind,
  type TaskOutput
} from "./tasks/index.js";
export { NoteStore, parseNote, serializeNote, type Note, type NoteInput, type NoteMeta } from "./notes/index.js";
export {
  formatConversationMarkdown,
  formatExportedNote,
  noteFileName,
  zipExportedNotes,
  type ConversationExportMessage,
  type ExportFrontmatter,
  type FormatExportOptions,
  type NoteExportEntry
} from "./notes/export.js";
export { DbTooNewError, MIGRATIONS, migrate, type MigratableDb } from "./db/migrate.js";
export * from "./conversations/tree.js";
