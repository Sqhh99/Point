export type Role = "system" | "user" | "assistant";

/** An image attached to a message. Bytes are base64; built in main only (never crosses IPC). */
export interface ImageInput {
  mime: "image/png";
  base64: string;
}

/** Ordered content for multimodal messages (text and images interleaved). */
export type ContentPart = { type: "text"; text: string } | { type: "image"; image: ImageInput };

export interface ChatMessage {
  role: Role;
  /** Plain-text form; always set (used for history, export, and text-only providers). */
  content: string;
  /** When set, providers send these parts in order instead of `content` (+ `images`). */
  parts?: ContentPart[];
  /** Only sent to models whose provider config has `capabilities.vision`. */
  images?: ImageInput[];
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** When set, these dotted paths are merged into the request body (thinking / reasoning_effort / …). */
  effortWrites?: Readonly<Record<string, string | boolean | number | null>>;
  /** Omit temperature (thinking mode). */
  omitTemperature?: boolean;
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
