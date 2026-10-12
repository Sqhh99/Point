export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface Delta {
  text: string;
}

export interface LLMProvider {
  readonly id: string;
  chat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<Delta>;
}
