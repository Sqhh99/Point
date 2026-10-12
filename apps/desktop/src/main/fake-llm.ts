import { LLMError, type ChatMessage, type ChatOptions, type Delta, type LLMProvider } from "@point/core";

/**
 * Deterministic provider for e2e tests. Only used when POINT_FAKE_LLM=1 is set in the
 * environment of the main process; nothing in the app sets it.
 */
export const FAKE_ANSWER =
  "**模拟回答**：这是 Point 测试用的固定输出。\n\n" +
  "- 要点一：选中内容已收到\n- 要点二：流式输出正常\n\n" +
  "```mermaid\nflowchart TD\n  A[选中内容] --> B[AI 解读]\n  B --> C[插入笔记]\n```\n";

/** Returned when the prompt contains XSS-PROBE: untrusted HTML + a hostile mermaid block. */
export const FAKE_XSS_ANSWER =
  "探针回答\n\n<img src=x onerror=\"window.__pwned='img'\">\n\n<script>window.__pwned='script'</script>\n\n" +
  "行内 <img src=y onerror=\"window.__pwned='inline'\"> 结束\n\n" +
  "```mermaid\nflowchart TD\n  A[\"<img src=z onerror=window.__pwned='mermaid'>\"] --> B[终点]\n" +
  "  click A call window.alert(1)\n  click B \"javascript:window.__pwned='click'\"\n```\n";

export const fakeEnabled = () => process.env.POINT_FAKE_LLM === "1";
/** The fake model accepts images unless POINT_FAKE_VISION=0 (lets e2e cover the "no vision" path). */
export const fakeVision = () => process.env.POINT_FAKE_VISION !== "0";

export const FAKE_IMAGE_ANSWER = "**模拟回答**：已收到 1 张截图。";

export class FakeProvider implements LLMProvider {
  readonly id = "fake";

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<Delta> {
    const last = messages.at(-1);
    const prompt = last?.content ?? "";
    if (prompt.includes("RATE-LIMIT-PROBE")) throw new LLMError("rate_limit", "请求过于频繁 (429): fake", 429);
    const answer = prompt.includes("XSS-PROBE") ? FAKE_XSS_ANSWER : last?.images?.length ? FAKE_IMAGE_ANSWER : FAKE_ANSWER;
    const chunks = answer.match(/[\s\S]{1,12}/g) ?? [];
    for (const text of chunks) {
      if (opts.signal?.aborted) {
        const e = new Error("请求已取消");
        (e as Error & { code: string }).code = "aborted";
        throw e;
      }
      await new Promise((r) => setTimeout(r, 15));
      yield { text };
    }
  }
}
