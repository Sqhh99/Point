import { describe, expect, it } from "vitest";
import { LLMError, OpenAICompatibleProvider, createProvider, type FetchLike } from "../src/index.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    }
  });
}

const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

type Call = { url: string; init: RequestInit };

function fakeFetch(res: () => Response, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return res();
  };
}

async function collect(it: AsyncIterable<{ text: string }>): Promise<string> {
  let out = "";
  for await (const d of it) out += d.text;
  return out;
}

const msgs = [{ role: "user" as const, content: "什么是熵？" }];
const make = (fetch: FetchLike) => new OpenAICompatibleProvider({ id: "x", baseURL: "http://x", apiKey: "k", fetch });

describe("OpenAICompatibleProvider", () => {
  it("sends OpenAI chat/completions body with bearer auth", async () => {
    const calls: Call[] = [];
    const p = createProvider({ id: "deepseek", apiKey: "sk-test", fetch: fakeFetch(() => new Response(streamOf(["data: [DONE]\n\n"])), calls) });
    await collect(p.chat(msgs, { model: "deepseek-chat", temperature: 0.2 }));
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ model: "deepseek-chat", messages: msgs, stream: true, temperature: 0.2 });
  });

  it("respects custom baseURL with trailing slash", async () => {
    const calls: Call[] = [];
    const p = createProvider({ id: "glm", apiKey: "k", baseURL: "https://proxy.example.com/v4/", fetch: fakeFetch(() => new Response(streamOf([])), calls) });
    await collect(p.chat(msgs, { model: "glm-4-flash" }));
    expect(calls[0].url).toBe("https://proxy.example.com/v4/chat/completions");
  });

  it("streams deltas across split chunks and stops at [DONE]", async () => {
    const raw = sse("熵是") + ": keep-alive\n\n" + sse("无序度") + "data: [DONE]\n\n" + sse("不应出现");
    const cut = [raw.slice(0, 7), raw.slice(7, 30), raw.slice(30, 31), raw.slice(31)];
    expect(await collect(make(fakeFetch(() => new Response(streamOf(cut)))).chat(msgs, { model: "m" }))).toBe("熵是无序度");
  });

  it("handles CRLF line endings and multibyte split", async () => {
    const bytes = new TextEncoder().encode(sse("中文").replace(/\n/g, "\r\n"));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 40));
        c.enqueue(bytes.slice(40));
        c.close();
      }
    });
    expect(await collect(make(fakeFetch(() => new Response(body))).chat(msgs, { model: "m" }))).toBe("中文");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [500, "server"],
    [503, "server"],
    [400, "bad_request"]
  ])("maps HTTP %i to %s", async (status, code) => {
    const err = await collect(make(fakeFetch(() => new Response("oops", { status }))).chat(msgs, { model: "m" })).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it("maps fetch failure to network error", async () => {
    const p = make(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await collect(p.chat(msgs, { model: "m" })).catch((e) => e);
    expect(err.code).toBe("network");
  });

  it("aborts mid-stream", async () => {
    const ctrl = new AbortController();
    const p = make(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse("a")));
          init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        }
      });
      return new Response(body);
    });
    const got: string[] = [];
    const err = await (async () => {
      for await (const d of p.chat(msgs, { model: "m", signal: ctrl.signal })) {
        got.push(d.text);
        ctrl.abort();
      }
    })().catch((e) => e);
    expect(got).toEqual(["a"]);
    expect(err.code).toBe("aborted");
  });

  it("maps abort before response to aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = make(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const err = await collect(p.chat(msgs, { model: "m", signal: ctrl.signal })).catch((e) => e);
    expect(err.code).toBe("aborted");
  });

  it("rejects unknown provider id", () => {
    expect(() => createProvider({ id: "nope" as "glm", apiKey: "k" })).toThrow();
  });
});
