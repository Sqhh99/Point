export type Role = "system" | "user" | "assistant";

/** An image attached to a message. Bytes are base64; built in main only (never crosses IPC). */
export interface ImageInput {
  mime: "image/png";
  base64: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Only sent to models whose provider config has `capabilities.vision`. */
  images?: ImageInput[];
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Delta {
  text: string;
}

export interface LLMProvider {
  readonly id: string;
  chat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<Delta>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
