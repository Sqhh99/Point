import type { ChatMessage, ChatOptions, Delta, LLMProvider } from "@point/core";

/**
 * Deterministic provider for e2e tests. Only used when POINT_FAKE_LLM=1 is set in the
 * environment of the main process; nothing in the app sets it.
 */
export const FAKE_ANSWER =
  "**模拟回答**：这是 Point 测试用的固定输出。\n\n" +
  "- 要点一：选中内容已收到\n- 要点二：流式输出正常\n\n" +
  "```mermaid\nflowchart TD\n  A[选中内容] --> B[AI 解读]\n  B --> C[插入笔记]\n```\n";

export const fakeEnabled = () => process.env.POINT_FAKE_LLM === "1";

export class FakeProvider implements LLMProvider {
  readonly id = "fake";

  async *chat(_messages: ChatMessage[], opts: ChatOptions): AsyncIterable<Delta> {
    const chunks = FAKE_ANSWER.match(/[\s\S]{1,12}/g) ?? [];
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
