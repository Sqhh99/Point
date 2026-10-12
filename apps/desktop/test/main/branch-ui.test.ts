import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { siblingsOf, type BranchOrigin } from "@point/core";
import { FakeSender, invoke, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
registerIpc();
registerTasksIpc();

type Msg = { id: string; role: string; parentId: string | null; content: string; createdAt: string };
type Started = { requestId: string; conversationId: string; userMessage?: Msg };
type Done = { type: string; message?: Msg };

async function ask(req: Record<string, unknown>): Promise<{ started: Started; answer: Msg }> {
  const s = new FakeSender();
  const started = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", ...req })) as Started;
  await until(() => s.events.some((e) => ["done", "error"].includes((e.payload as Done).type)));
  const done = s.events.map((e) => e.payload as Done).find((p) => p.type === "done")!;
  return { started, answer: done.message! };
}
const tree = async (id: string) => (await invoke(IPC.convTree, new FakeSender(), id)) as { messages: Msg[]; origins: BranchOrigin[] };

describe("branch UI storage paths (⑥)", () => {
  beforeAll(() => {
    process.env.POINT_FAKE_LLM = "1";
    ws.openWorkspace(mkdtempSync(join(tmpdir(), "point-branch-ui-")));
  });
  afterAll(() => {
    delete process.env.POINT_FAKE_LLM;
    ws.closeWorkspace();
  });

  it("regenerate with parentId answers that question again as a sibling, keeping its branches", async () => {
    const first = await ask({ question: "什么是熵？" });
    const conv = first.started.conversationId;
    const q = first.started.userMessage!;
    const quote = first.answer.content.slice(0, 4);
    const br = await ask({ question: "展开", conversationId: conv, branch: { sourceId: first.answer.id, start: 0, end: 4, quote } });
    expect(br.started.userMessage!.parentId).toBe(first.answer.id);
    const regen = await ask({ question: "什么是熵？", conversationId: conv, regenerate: true, parentId: q.id });
    expect(regen.started.userMessage).toBeUndefined();
    expect(regen.answer.parentId).toBe(q.id);
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, regen.answer.id).map((m) => m.id)).toEqual([first.answer.id, regen.answer.id]);
    expect(t.origins).toHaveLength(1);
    expect(t.messages.some((m) => m.id === br.started.userMessage!.id)).toBe(true);
  });

  it("parentId puts a follow-up under the shown leaf; null re-asks the first question as a sibling root", async () => {
    const a = await ask({ question: "一" });
    const conv = a.started.conversationId;
    const b = await ask({ question: "二", conversationId: conv, parentId: a.answer.id });
    expect(b.started.userMessage!.parentId).toBe(a.answer.id);
    // Follow-up under the *first* answer even though another answer came later: a new sibling of q2.
    const c = await ask({ question: "二（改）", conversationId: conv, parentId: a.answer.id });
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, c.started.userMessage!.id)).toHaveLength(2);
    const root = await ask({ question: "一（改）", conversationId: conv, parentId: null });
    expect(root.started.userMessage!.parentId).toBeNull();
    const t2 = await tree(conv);
    expect(siblingsOf(t2.messages, t2.origins, root.started.userMessage!.id)).toHaveLength(2);
  });

  it("rejects ids from another conversation, branches from questions and mismatched quotes", async () => {
    const a = await ask({ question: "甲" });
    const other = await ask({ question: "乙" });
    const conv = a.started.conversationId;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, parentId: other.answer.id })).rejects.toThrow("消息不在这个对话里");
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, regenerate: true, parentId: a.answer.id })).rejects.toThrow("找不到要重新回答的问题");
    await expect(
      invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, branch: { sourceId: a.started.userMessage!.id, start: 0, end: 1, quote: "甲" } })
    ).rejects.toThrow("分支只能从 AI 回答派生");
    await expect(
      invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote: "不对" } })
    ).rejects.toThrow();
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, branch: { sourceId: a.answer.id, start: -1, end: 2, quote: "x" } })).rejects.toThrow("无效的分支位置");
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", parentId: a.answer.id })).rejects.toThrow("对话不存在");
  });
});
