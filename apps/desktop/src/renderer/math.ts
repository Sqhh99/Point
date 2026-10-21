import katex from "katex";
import { mathSpans, type MathSpan } from "@point/core/rendered-map";

// Private-use code points: never in model output in practice (and stripped from the input), never touched
// by marked or DOMPurify, so a formula survives both as an opaque token.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const TOKEN = /\uE000(\d+)\uE001/g;
/** Render-time macros for inline (displayMode: false) math only. */
export const INLINE_MACROS: Readonly<Record<string, string>> = { "\\dfrac": "\\frac" };

/**
 * Replace every formula of the answer with a token before markdown parsing. The formulas come from
 * the same mdast (remark-math) as the branch map, so what renders as math is exactly what the map skips.
 */
export function withMathTokens(text: string): { src: string; spans: MathSpan[] } {
  const clean = text.replace(/[\uE000\uE001]/g, "");
  const spans = mathSpans(clean);
  let src = clean;
  for (let i = spans.length - 1; i >= 0; i--) src = src.slice(0, spans[i]!.start) + OPEN + i + CLOSE + src.slice(spans[i]!.end);
  return { src, spans };
}

/**
 * Swap tokens in the *sanitized* HTML for KaTeX output. KaTeX runs with `trust: false` (no \href,
 * \includegraphics or \html* commands), so its output carries no links, scripts or raw HTML; its
 * inline `style` attributes are layout only. A formula that fails to parse shows its TeX source.
 */
export function fillMath(html: string, spans: MathSpan[]): string {
  return html.replace(TOKEN, (m, i: string) => {
    const s = spans[Number(i)];
    if (!s) return "";
    return katex.renderToString(s.tex, {
      displayMode: s.display,
      // Inline only: \dfrac would make the line tall; render it as \frac. Display math keeps \dfrac. The
      // TeX source (message text, MathML annotation, branch anchors) is unchanged.
      macros: s.display ? {} : { ...INLINE_MACROS },
      throwOnError: false,
      trust: false,
      strict: "ignore",
      output: "htmlAndMathml",
      errorColor: "var(--danger)"
    });
  });
}
