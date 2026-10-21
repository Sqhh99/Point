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

/** Returned when the prompt contains MATH-PROBE: inline/display math in all four delimiter styles. */
export const FAKE_MATH_ANSWER =
  "## 有效声压：$p_e = \\dfrac{P}{\\sqrt{2}}$\n\n其中 $P$ 是峰值幅度，\\(\\sqrt{2}\\) 来自正弦均方根。\n\n\\[\nL = 20\\lg\\frac{p}{p_0}\n\\]\n\n$$\nI = \\frac{p^2}{\\rho c}\n$$\n\n结论：声压级按对数计算。\n";

/** Returned when the prompt contains FORMAT-PROBE: list items mixing bold, inline code and a link. */
export const FAKE_FORMAT_ANSWER =
  "格式探针：\n\n" +
  "- **粗体要点**：带 `inline_code` 与 [链接文字](https://example.com/docs/page) 的一项\n" +
  "- 第二项普通文字\n";

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
    const parts = last?.parts;
    const marksAnswer = parts
      ? `**模拟回答**：已收到 ${parts.filter((p) => p.type === "text" && p.text.startsWith("标记 ")).length} 个标记（图片 ${parts.filter((p) => p.type === "image").length} 张）。`
      : null;
    const answer = marksAnswer ?? (prompt.includes("XSS-PROBE") ? FAKE_XSS_ANSWER : prompt.includes("FORMAT-PROBE") ? FAKE_FORMAT_ANSWER : prompt.includes("MATH-PROBE") ? FAKE_MATH_ANSWER : last?.images?.length ? FAKE_IMAGE_ANSWER : FAKE_ANSWER);
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
