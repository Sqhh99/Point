import { LLMError, errorFromStatus } from "./errors.js";
import { sseData } from "./sse.js";
import type { ChatMessage, ChatOptions, Delta, FetchLike, LLMProvider } from "./types.js";

export interface OpenAICompatibleConfig {
  id: string;
  baseURL: string;
  apiKey: string;
  fetch?: FetchLike;
}

interface ChunkJSON {
  choices?: { delta?: { content?: string | null } }[];
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetch: FetchLike;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.url = cfg.baseURL.replace(/\/+$/, "") + "/chat/completions";
    this.apiKey = cfg.apiKey;
    this.fetch = cfg.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<Delta> {
    const body: Record<string, unknown> = { model: opts.model, messages, stream: true };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

    let res: Response;
    try {
      res = await this.fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: opts.signal
      });
    } catch (err) {
      if (isAbort(err) || opts.signal?.aborted) throw new LLMError("aborted", "请求已取消");
      throw new LLMError("network", `网络错误: ${(err as Error).message}`);
    }
    if (!res.ok) throw errorFromStatus(res.status, await res.text().catch(() => ""));
    if (!res.body) throw new LLMError("server", "响应没有内容");

    try {
      for await (const data of sseData(res.body)) {
        if (data === "[DONE]") return;
        let json: ChunkJSON;
        try {
          json = JSON.parse(data) as ChunkJSON;
        } catch {
          continue;
        }
        const text = json.choices?.[0]?.delta?.content;
        if (text) yield { text };
      }
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if (isAbort(err) || opts.signal?.aborted) throw new LLMError("aborted", "请求已取消");
      throw new LLMError("network", `读取流失败: ${(err as Error).message}`);
    }
  }
}
