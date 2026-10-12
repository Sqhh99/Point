export interface MermaidBlock {
  code: string;
  valid: boolean;
  error?: string;
}

const DIAGRAM_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "quadrantChart",
  "xychart-beta",
  "gitGraph"
];

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Cheap structural check; the renderer does the real parse with mermaid itself. */
export function validateMermaid(code: string): { valid: boolean; error?: string } {
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
  if (lines.length === 0) return { valid: false, error: "图表为空" };
  const head = lines[0].split(/\s+/)[0];
  if (!DIAGRAM_TYPES.includes(head)) return { valid: false, error: `未知的图表类型: ${head}` };
  if (lines.length < 2 && head !== "pie") return { valid: false, error: "图表没有内容" };
  const stack: string[] = [];
  for (const ch of code.replace(/"[^"\n]*"/g, "")) {
    if (PAIRS[ch]) stack.push(PAIRS[ch]);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return { valid: false, error: "括号不匹配" };
    }
  }
  if (stack.length) return { valid: false, error: "括号不匹配" };
  return { valid: true };
}

/** All ```mermaid fenced blocks in `text`, in order. */
export function extractMermaid(text: string): MermaidBlock[] {
  const out: MermaidBlock[] = [];
  const re = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
  for (const m of text.matchAll(re)) {
    const code = m[3].replace(/\s+$/, "");
    out.push({ code, ...validateMermaid(code) });
  }
  return out;
}
