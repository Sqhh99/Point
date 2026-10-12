import type { ChatMessage } from "../llm/types.js";
import { extractMermaid, type MermaidBlock } from "./mermaid.js";

export type TaskKind = "explain" | "note" | "diagram" | "ask" | "summarize";

export const TASK_LABELS: Record<TaskKind, string> = {
  explain: "解读概念",
  note: "记笔记",
  diagram: "画图表",
  ask: "问 AI",
  summarize: "归纳到文档"
};

export interface TaskInput {
  kind: TaskKind;
  selection: string;
  docTitle?: string;
  /** Text around the selection (previous / following blocks). */
  context?: string;
  /** Required for `ask`; optional extra instruction for the others. */
  question?: string;
  /** Earlier turns of the same conversation (ask only). */
  history?: ChatMessage[];
}

export interface TaskOutput {
  markdown: string;
  mermaid: MermaidBlock[];
}

export const LIMITS = { selection: 6000, context: 3000, historyTurns: 10 } as const;

const SYSTEM =
  "你是 Point 的学习助手，帮助用户阅读文献、理解概念、整理笔记。" +
  "默认使用简体中文回答（如果用户用其他语言提问则跟随用户），输出 Markdown。" +
  "只依据给出的材料和公认的知识作答；不确定时明确说明，不要编造引用。";

const INSTRUCTIONS: Record<TaskKind, string> = {
  explain:
    "请解读选中内容里的核心概念：\n1. 一句话定义；\n2. 用通俗的话解释它是什么、为什么重要；\n3. 结合上下文说明它在本文中的含义；\n4. 列出 2–3 个相关概念。\n使用小标题，简洁。",
  note:
    "请把选中内容整理成一条学习笔记（Markdown）：以 `## ` 开头给出标题，随后用要点列出关键信息、定义、论证或数据，最后一行写“来源：<文档标题>”。不要添加材料里没有的事实。",
  diagram:
    "请用 Mermaid 画一张图，表达选中内容中的结构、流程或概念关系。\n要求：只输出一个 ```mermaid 代码块，前面可以有一句说明；优先使用 flowchart TD 或 mindmap；节点文字简短，含特殊字符时用双引号包裹。",
  ask: "请结合选中内容和上下文回答用户的问题。",
  summarize:
    "请把选中内容归纳成一份结构化的 Markdown 文档：一级标题为主题，包含“概述”“要点”“关键术语”“待思考的问题”几个二级标题。"
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…（已截断）` : s);

export function buildTaskMessages(input: TaskInput): ChatMessage[] {
  const selection = input.selection.trim();
  if (!selection && input.kind !== "ask") throw new Error("请先选中一段文字");
  if (input.kind === "ask" && !input.question?.trim()) throw new Error("请输入问题");

  const parts: string[] = [];
  if (input.docTitle) parts.push(`文档：《${input.docTitle}》`);
  if (input.context?.trim()) parts.push(`上下文：\n"""\n${clip(input.context.trim(), LIMITS.context)}\n"""`);
  if (selection) parts.push(`选中内容：\n"""\n${clip(selection, LIMITS.selection)}\n"""`);
  parts.push(`任务：${INSTRUCTIONS[input.kind]}`);
  if (input.question?.trim()) parts.push(`${input.kind === "ask" ? "问题" : "补充要求"}：${input.question.trim()}`);

  const history = input.kind === "ask" ? (input.history ?? []).slice(-LIMITS.historyTurns * 2) : [];
  return [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: parts.join("\n\n") }];
}

/** Short user-facing text for the conversation log. */
export function describeTask(input: Pick<TaskInput, "kind" | "selection" | "question">): string {
  const sel = input.selection.trim().replace(/\s+/g, " ");
  const quote = sel ? `> ${sel.length > 120 ? `${sel.slice(0, 120)}…` : sel}\n\n` : "";
  return `${quote}**${TASK_LABELS[input.kind]}**${input.question?.trim() ? `：${input.question.trim()}` : ""}`;
}

export function parseTaskOutput(kind: TaskKind, text: string): TaskOutput {
  let markdown = text.trim();
  const mermaid = extractMermaid(markdown);
  if (kind === "diagram" && mermaid.length === 0) {
    // Some models skip the fence; accept a bare diagram.
    const bare = extractMermaid("```mermaid\n" + markdown + "\n```");
    if (bare[0]?.valid) {
      markdown = "```mermaid\n" + markdown + "\n```";
      return { markdown, mermaid: bare };
    }
  }
  return { markdown, mermaid };
}

export { extractMermaid, validateMermaid, type MermaidBlock } from "./mermaid.js";
