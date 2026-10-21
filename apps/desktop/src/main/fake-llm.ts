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

/** Returned when the prompt contains TYPO-PROBE: headings with math, prices, inline/display \dfrac, \bigg, an error. */
export const FAKE_TYPO_ANSWER =
  "# 标题里的公式 $\\dfrac{a}{b}$\n\n## 二级标题\n\n价格 $5 和 $10 都行。\n\n普通一行文字，作为行高基准。\n\n行内分式 $\\dfrac{P}{\\sqrt{2}}$ 在这一行。\n\n括号 $\\bigg( x \\bigg)$ 用到 Size 字体。\n\n$$\n\\dfrac{P}{\\sqrt{2}}\n$$\n\n$$\nS = \\sum_{i=1}^{n} \\left( a_i b_i + c_i d_i + e_i f_i + g_i h_i + p_i q_i + r_i s_i + t_i u_i + v_i w_i + x_i y_i \\right)\n$$\n\n错误公式 $\\frac{1}{$ 在这里。\n";

/** Returned when the prompt contains FORMAT-PROBE: list items mixing bold, inline code and a link. */
export const FAKE_FORMAT_ANSWER =
  "格式探针：\n\n" +
  "- **粗体要点**：带 `inline_code` 与 [链接文字](https://example.com/docs/page) 的一项\n" +
  "- 第二项普通文字\n";

/** Returned when the prompt contains H3-PROBE: an answer that opens with an h3, then a second h3 mid-answer. */
export const FAKE_H3_ANSWER = "### 开头的三级标题\n\n第一段正文，标题下方 4px。\n\n### 中间的三级标题\n\n第二段正文，标题上方 12px。\n";

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
    const answer = marksAnswer ?? (prompt.includes("XSS-PROBE") ? FAKE_XSS_ANSWER : prompt.includes("FORMAT-PROBE") ? FAKE_FORMAT_ANSWER : prompt.includes("MATH-PROBE") ? FAKE_MATH_ANSWER : prompt.includes("TYPO-PROBE") ? FAKE_TYPO_ANSWER : prompt.includes("H3-PROBE") ? FAKE_H3_ANSWER : last?.images?.length ? FAKE_IMAGE_ANSWER : FAKE_ANSWER);
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
