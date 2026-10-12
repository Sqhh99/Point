import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { branchesFrom, breadcrumb, siblingsOf, type BranchOrigin, type ChatMessage } from "@point/core";
import { FakeSender, invoke, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const c = await import("../../src/main/conversations.js");
const { FakeProvider } = await import("../../src/main/fake-llm.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
registerIpc();
registerTasksIpc();

type Msg = { id: string; role: string; parentId: string | null; content: string; createdAt: string };
type Started = { requestId: string; conversationId: string; userMessage?: Msg };
type Ev = { type: string; message?: Msg };

const sent: ChatMessage[][] = [];
const chat = FakeProvider.prototype.chat;
vi.spyOn(FakeProvider.prototype, "chat").mockImplementation(function (this: InstanceType<typeof FakeProvider>, messages, opts) {
  sent.push(messages.map((m) => ({ ...m })));
  return chat.call(this, messages, opts);
});

async function ask(req: Record<string, unknown>) {
  const s = new FakeSender();
  const before = sent.length;
  const started = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", ...req })) as Started;
  await until(() => s.events.some((e) => ["done", "error"].includes((e.payload as Ev).type)));
  const done = s.events.map((e) => e.payload as Ev).find((p) => p.type === "done");
  if (!done) throw new Error("task did not finish");
  return { started, user: started.userMessage!, answer: done.message!, prompt: sent[before] };
}
const run = (req: Record<string, unknown>) => invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", ...req });
const tree = async (id: string) => (await invoke(IPC.convTree, new FakeSender(), id)) as { messages: Msg[]; origins: BranchOrigin[] };
const db = () => ws.need().db;
const counts = () => ({
  messages: (db().prepare("SELECT COUNT(*) n FROM messages").get() as { n: number }).n,
  origins: (db().prepare("SELECT COUNT(*) n FROM branch_origin").get() as { n: number }).n,
  conversations: (db().prepare("SELECT COUNT(*) n FROM conversations").get() as { n: number }).n
});
const originRow = (child: string) => db().prepare("SELECT source_msg_id, start, end, quote FROM branch_origin WHERE child_msg_id = ?").get(child);
/** A conversation with q → a and a span branch b (from a[0..2]) answered by ba. */
async function withSpan() {
  const q = await ask({ question: "源问" });
  const conv = q.started.conversationId;
  const quote = q.answer.content.slice(0, 2);
  const b = await ask({ question: "支问", conversationId: conv, branch: { sourceId: q.answer.id, start: 0, end: 2, quote } });
  return { conv, q, b, quote };
}

let root = "";
beforeAll(() => {
  process.env.POINT_FAKE_LLM = "1";
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "point-fork-sibling-")));
  ws.openWorkspace(root);
});
afterAll(() => {
  delete process.env.POINT_FAKE_LLM;
  ws.closeWorkspace();
});

describe("siblingOf validation: rejected with zero writes", () => {
  it("combined with parentId (incl. null), branch or regenerate", async () => {
    const { conv, q, b, quote } = await withSpan();
    const n = counts();
    const sib = b.user.id;
    await expect(run({ conversationId: conv, siblingOf: sib, parentId: q.answer.id })).rejects.toThrow("siblingOf 不能和");
    await expect(run({ conversationId: conv, siblingOf: sib, parentId: null })).rejects.toThrow("siblingOf 不能和");
    await expect(run({ conversationId: conv, siblingOf: sib, branch: { sourceId: q.answer.id, start: 0, end: 2, quote } })).rejects.toThrow("siblingOf 不能和");
    await expect(run({ conversationId: conv, siblingOf: sib, regenerate: true })).rejects.toThrow("siblingOf 不能和");
    expect(counts()).toEqual(n);
  });

  it("pointing at an assistant message, another conversation, a nonexistent id, or malformed values", async () => {
    const { conv, q } = await withSpan();
    const other = await ask({ question: "他处" });
    const n = counts();
    await expect(run({ conversationId: conv, siblingOf: q.answer.id })).rejects.toThrow("只能改问用户的问题");
    await expect(run({ conversationId: conv, siblingOf: other.user.id })).rejects.toThrow("消息不在这个对话里");
    await expect(run({ conversationId: conv, siblingOf: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("消息不在这个对话里");
    for (const bad of [123, "", {}, ["x"], true]) await expect(run({ conversationId: conv, siblingOf: bad })).rejects.toThrow();
    await expect(run({ siblingOf: q.user.id })).rejects.toThrow("对话不存在");
    expect(counts()).toEqual(n);
  });

  // tasks-ipc.ts:49 maps a non-string siblingOf to "", and placement() (tasks-ipc.ts:72) only checks
  // `req.siblingOf` for truthiness when there is no conversation, so a malformed siblingOf without a
  // conversationId is silently ignored: a new conversation and message are written.
  it.fails("malformed siblingOf without a conversation is rejected too, nothing written", async () => {
    const n = counts();
    await expect(run({ siblingOf: 123 })).rejects.toThrow();
    expect(counts()).toEqual(n);
  });
});

describe("siblingOf re-ask", () => {
  it("side-question first question: same parent, origin copied verbatim, 2/2 then 3/3", async () => {
    const { conv, q, b, quote } = await withSpan();
    const r1 = await ask({ question: "支问改1", conversationId: conv, siblingOf: b.user.id });
    expect(r1.user.parentId).toBe(q.answer.id);
    expect(originRow(r1.user.id)).toEqual(originRow(b.user.id));
    expect(originRow(r1.user.id)).toEqual({ source_msg_id: q.answer.id, start: 0, end: 2, quote });
    let t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, r1.user.id).map((m) => m.id)).toEqual([b.user.id, r1.user.id]);
    const r2 = await ask({ question: "支问改2", conversationId: conv, siblingOf: r1.user.id });
    t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, b.user.id).map((m) => m.id)).toEqual([b.user.id, r1.user.id, r2.user.id]);
    expect(breadcrumb(t.messages, t.origins, r2.answer.id)).toEqual([{}, { branchId: r2.user.id, quote }]);
  });

  it("message and origin are written in one transaction: an origin insert failure leaves no message", async () => {
    const { conv, b } = await withSpan();
    db().exec("CREATE TRIGGER zz_fail BEFORE INSERT ON branch_origin BEGIN SELECT RAISE(ABORT, 'probe'); END;");
    const n = counts();
    try {
      await expect(run({ conversationId: conv, siblingOf: b.user.id })).rejects.toThrow("probe");
      expect(counts()).toEqual(n);
    } finally {
      db().exec("DROP TRIGGER zz_fail");
    }
  });

  it("main-thread question re-ask writes no branch_origin row", async () => {
    const a = await ask({ question: "主一" });
    const conv = a.started.conversationId;
    const q2 = await ask({ question: "主二", conversationId: conv, parentId: a.answer.id });
    const n = counts();
    const re = await ask({ question: "主二改", conversationId: conv, siblingOf: q2.user.id });
    expect(re.user.parentId).toBe(a.answer.id);
    expect(originRow(re.user.id)).toBeUndefined();
    expect(counts().origins).toBe(n.origins);
    const first = await ask({ question: "主一改", conversationId: conv, siblingOf: a.user.id });
    expect(first.user.parentId).toBeNull();
    expect(originRow(first.user.id)).toBeUndefined();
  });

  it("nested side question re-ask copies the inner origin and stays nested", async () => {
    const { conv, b } = await withSpan();
    const quote = b.answer.content.slice(2, 4);
    const inner = await ask({ question: "内问", conversationId: conv, branch: { sourceId: b.answer.id, start: 2, end: 4, quote } });
    const re = await ask({ question: "内问改", conversationId: conv, siblingOf: inner.user.id });
    expect(re.user.parentId).toBe(b.answer.id);
    expect(originRow(re.user.id)).toEqual({ source_msg_id: b.answer.id, start: 2, end: 4, quote });
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, re.user.id).map((m) => m.id)).toEqual([inner.user.id, re.user.id]);
    expect(breadcrumb(t.messages, t.origins, re.answer.id).map((x) => x.branchId)).toEqual([undefined, b.user.id, re.user.id]);
  });

  it("context isolation: provider sees root → new question only, not the original question or its answers", async () => {
    const conv = c.createConversation("iso");
    const q = c.addMessage(conv.id, "user", "ROOT-Q");
    const a = c.addMessage(conv.id, "assistant", "ROOT-A 熵", undefined, undefined, q.id);
    const bq = c.createBranch(a.id, { start: 7, end: 8, quote: "熵" }, "ORIG-BRANCH-Q");
    c.addMessage(conv.id, "assistant", "ORIG-BRANCH-A1", undefined, undefined, bq.id);
    c.addMessage(conv.id, "assistant", "ORIG-BRANCH-A2", undefined, undefined, bq.id);
    const f = c.addMessage(conv.id, "user", "MAIN-FOLLOW", undefined, undefined, a.id);
    const r = await ask({ question: "NEW-BRANCH-Q", conversationId: conv.id, siblingOf: bq.id });
    const all = r.prompt.map((m) => m.content).join("\n");
    for (const good of ["ROOT-Q", "ROOT-A", "NEW-BRANCH-Q"]) expect(all).toContain(good);
    for (const bad of ["ORIG-BRANCH-Q", "ORIG-BRANCH-A1", "ORIG-BRANCH-A2", "MAIN-FOLLOW"]) expect(all).not.toContain(bad);
    const m = await ask({ question: "MAIN-FOLLOW-NEW", conversationId: conv.id, siblingOf: f.id });
    const mAll = m.prompt.map((x) => x.content).join("\n");
    for (const bad of ["ORIG-BRANCH", "NEW-BRANCH-Q"]) expect(mAll).not.toContain(bad);
    expect(m.prompt.filter((x) => x.role === "user").map((x) => x.content).some((t) => t === "MAIN-FOLLOW")).toBe(false);
  });

  it("reload from disk preserves siblings and copied origins", async () => {
    const { conv, b } = await withSpan();
    const re = await ask({ question: "重载改问", conversationId: conv, siblingOf: b.user.id });
    const before = await tree(conv);
    ws.closeWorkspace();
    ws.openWorkspace(root);
    const after = await tree(conv);
    expect(after).toEqual(before);
    expect(siblingsOf(after.messages, after.origins, re.user.id).map((m) => m.id)).toEqual([b.user.id, re.user.id]);
  });
});

describe("⑂ n 个分支 count (designer: distinct source passages)", () => {
  it("two different passages count as 2", async () => {
    const { conv, q } = await withSpan();
    const quote2 = q.answer.content.slice(3, 5);
    await ask({ question: "另一段", conversationId: conv, branch: { sourceId: q.answer.id, start: 3, end: 5, quote: quote2 } });
    const t = await tree(conv);
    expect(branchesFrom(t.origins, q.answer.id)).toHaveLength(2);
  });

  it("same quote at a different start/end counts separately (and is not a sibling)", () => {
    const conv = c.createConversation("same-quote");
    const q = c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "熵和熵", undefined, undefined, q.id);
    const b1 = c.createBranch(a.id, { start: 0, end: 1, quote: "熵" }, "b1");
    const b2 = c.createBranch(a.id, { start: 2, end: 3, quote: "熵" }, "b2");
    const t = c.getTree(conv.id);
    expect(branchesFrom(t.origins, a.id)).toHaveLength(2);
    expect(siblingsOf(t.messages, t.origins, b1.id).map((m) => m.id)).toEqual([b1.id]);
    expect(siblingsOf(t.messages, t.origins, b2.id).map((m) => m.id)).toEqual([b2.id]);
  });

  it("same range on a different source answer counts separately, per answer", () => {
    const conv = c.createConversation("same-range");
    const q = c.addMessage(conv.id, "user", "q");
    const a1 = c.addMessage(conv.id, "assistant", "熵甲", undefined, undefined, q.id);
    const a2 = c.addMessage(conv.id, "assistant", "熵乙", undefined, undefined, q.id);
    const b1 = c.createBranch(a1.id, { start: 0, end: 1, quote: "熵" }, "b1");
    c.createBranch(a2.id, { start: 0, end: 1, quote: "熵" }, "b2");
    const t = c.getTree(conv.id);
    expect(branchesFrom(t.origins, a1.id)).toHaveLength(1);
    expect(branchesFrom(t.origins, a2.id)).toHaveLength(1);
    expect(siblingsOf(t.messages, t.origins, b1.id).map((m) => m.id)).toEqual([b1.id]);
  });

  // Observable count = what AIPanel.tsx:582 renders: branchesFrom(origins, answer).length (tree.ts:177
  // returns one origin per question). Spec: group by source answer id + start + end + quote (the
  // siblingsOf key), so a passage re-asked several times counts once.
  it.fails("passage A asked 3x (original + 2 re-asks) plus passage B shows 「⑂ 2 个分支」", async () => {
    const { conv, q, b } = await withSpan();
    const r1 = await ask({ question: "同段改问1", conversationId: conv, siblingOf: b.user.id });
    await ask({ question: "同段改问2", conversationId: conv, siblingOf: r1.user.id });
    const quote2 = q.answer.content.slice(3, 5);
    await ask({ question: "另一段", conversationId: conv, branch: { sourceId: q.answer.id, start: 3, end: 5, quote: quote2 } });
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, b.user.id)).toHaveLength(3);
    expect(branchesFrom(t.origins, q.answer.id).length).toBe(2);
  });
});
