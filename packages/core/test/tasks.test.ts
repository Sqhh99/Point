import { describe, expect, it } from "vitest";
import { LIMITS, buildTaskMessages, describeTask, extractMermaid, parseTaskOutput, validateMermaid, type TaskKind } from "../src/index.js";

const base = { selection: "熵是系统无序程度的度量。", docTitle: "热力学导论", context: "第二定律指出孤立系统熵不减。" };

describe("buildTaskMessages", () => {
  it.each<TaskKind>(["explain", "note", "diagram", "summarize"])("%s includes title, context, selection and instruction", (kind) => {
    const msgs = buildTaskMessages({ kind, ...base });
    expect(msgs[0].role).toBe("system");
    const user = msgs.at(-1)!;
    expect(user.role).toBe("user");
    expect(user.content).toContain("《热力学导论》");
    expect(user.content).toContain(base.selection);
    expect(user.content).toContain(base.context);
    expect(user.content).toContain("任务：");
  });

  it("diagram asks for a mermaid block", () => {
    expect(buildTaskMessages({ kind: "diagram", ...base }).at(-1)!.content).toContain("```mermaid");
  });

  it("ask requires a question and carries history", () => {
    expect(() => buildTaskMessages({ kind: "ask", ...base })).toThrow("请输入问题");
    const history = [
      { role: "user" as const, content: "之前的问题" },
      { role: "assistant" as const, content: "之前的回答" }
    ];
    const msgs = buildTaskMessages({ kind: "ask", ...base, question: "熵和信息有什么关系？", history });
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs.at(-1)!.content).toContain("问题：熵和信息有什么关系？");
  });

  it("ask works without a selection; others do not", () => {
    expect(buildTaskMessages({ kind: "ask", selection: "", question: "你好" }).at(-1)!.content).toContain("问题：你好");
    expect(() => buildTaskMessages({ kind: "explain", selection: "  " })).toThrow();
  });

  it("history is ignored for non-ask tasks and capped for ask", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    expect(buildTaskMessages({ kind: "explain", ...base, history })).toHaveLength(2);
    expect(buildTaskMessages({ kind: "ask", ...base, question: "q", history })).toHaveLength(LIMITS.historyTurns * 2 + 2);
  });

  it("clips very long selections", () => {
    const content = buildTaskMessages({ kind: "explain", selection: "字".repeat(LIMITS.selection + 500) }).at(-1)!.content;
    expect(content).toContain("（已截断）");
    expect(content.length).toBeLessThan(LIMITS.selection + 1000);
  });

  it("describeTask names the task or shows the question", () => {
    expect(describeTask({ kind: "explain" })).toBe("解读概念");
    expect(describeTask({ kind: "note", question: "简短些" })).toBe("记笔记：简短些");
    expect(describeTask({ kind: "ask", question: "为什么？" })).toBe("为什么？");
  });
});

describe("mermaid", () => {
  it("extracts fenced blocks and validates them", () => {
    const text = "说明\n\n```mermaid\nflowchart TD\n  A[熵] --> B(无序)\n```\n\n~~~mermaid\nnot a diagram\n~~~\n";
    const blocks = extractMermaid(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ code: "flowchart TD\n  A[熵] --> B(无序)", valid: true });
    expect(blocks[1].valid).toBe(false);
  });

  it("rejects unbalanced brackets and empty diagrams", () => {
    expect(validateMermaid("flowchart TD\n  A[熵 --> B").valid).toBe(false);
    expect(validateMermaid("").valid).toBe(false);
    expect(validateMermaid('flowchart TD\n  A["含 ] 的文字"] --> B').valid).toBe(true);
  });

  it("parseTaskOutput wraps a bare diagram for the diagram task", () => {
    const out = parseTaskOutput("diagram", "mindmap\n  root((熵))\n    无序");
    expect(out.mermaid[0].valid).toBe(true);
    expect(out.markdown.startsWith("```mermaid\n")).toBe(true);
    expect(parseTaskOutput("explain", "普通回答").mermaid).toEqual([]);
  });
});
