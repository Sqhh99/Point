import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { branchTree, breadcrumb, defaultLeaf, latestLeaf, siblingsOf, type BranchOrigin, type ChatMessage } from "@point/core";
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

async function ask(req: Record<string, unknown>): Promise<{ started: Started; answer: Msg; prompt: ChatMessage[] }> {
  const s = new FakeSender();
  const before = sent.length;
  const started = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", ...req })) as Started;
  await until(() => s.events.some((e) => ["done", "error"].includes((e.payload as Ev).type)));
  const done = s.events.map((e) => e.payload as Ev).find((p) => p.type === "done");
  if (!done) throw new Error("task did not finish");
  return { started, answer: done.message!, prompt: sent[before] };
}
const tree = async (id: string) => (await invoke(IPC.convTree, new FakeSender(), id)) as { messages: Msg[]; origins: BranchOrigin[] };
const text = (p: ChatMessage[]) => p.map((m) => m.content).join("\n");
/** What the renderer's 「‹ ›」 does (AIPanel stepSibling): neighbour or nothing at the ends. */
const step = (t: { messages: Msg[]; origins: BranchOrigin[] }, id: string, d: number) => {
  const s = siblingsOf(t.messages, t.origins, id);
  return s[s.findIndex((m) => m.id === id) + d];
};

let root = "";
beforeAll(() => {
  process.env.POINT_FAKE_LLM = "1";
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "point-branch-ui-extra-")));
  ws.openWorkspace(root);
});
afterAll(() => {
  delete process.env.POINT_FAKE_LLM;
  ws.closeWorkspace();
});
beforeEach(() => {
  sent.length = 0;
});

describe("context isolation: the provider only sees root → current path", () => {
  it("follow-up under answer 2/3 carries no 1/3, 3/3 or other-branch content", async () => {
    const conv = c.createConversation("iso");
    const q = c.addMessage(conv.id, "user", "Q-ROOT");
    const a1 = c.addMessage(conv.id, "assistant", "ANS-ONE-爱", undefined, undefined, q.id);
    const a2 = c.addMessage(conv.id, "assistant", "ANS-TWO-比", undefined, undefined, q.id);
    const a3 = c.addMessage(conv.id, "assistant", "ANS-THREE-西", undefined, undefined, q.id);
    c.addMessage(conv.id, "user", "FOLLOW-UNDER-ONE", undefined, undefined, a1.id);
    c.createBranch(a3.id, { start: 0, end: 3, quote: "ANS" }, "SPAN-BRANCH-OF-THREE");
    const t = await tree(conv.id);
    expect(siblingsOf(t.messages, t.origins, a2.id).map((m) => m.id)).toEqual([a1.id, a2.id, a3.id]);
    const r = await ask({ question: "NEXT-QUESTION", conversationId: conv.id, parentId: a2.id });
    const all = text(r.prompt);
    expect(all).toContain("Q-ROOT");
    expect(all).toContain("ANS-TWO-比");
    expect(all).toContain("NEXT-QUESTION");
    for (const bad of ["ANS-ONE", "ANS-THREE", "FOLLOW-UNDER-ONE", "SPAN-BRANCH-OF-THREE"]) expect(all).not.toContain(bad);
    expect(r.prompt.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(["ANS-TWO-比"]);
    expect(r.started.userMessage!.parentId).toBe(a2.id);
  });

  it("nested span branch: sees its source path, not the main thread after the source or sibling branches", async () => {
    const conv = c.createConversation("iso-nested");
    const q1 = c.addMessage(conv.id, "user", "Q1-MAIN");
    const a1 = c.addMessage(conv.id, "assistant", "A1-MAIN 熵与互信息", undefined, undefined, q1.id);
    const q2 = c.addMessage(conv.id, "user", "Q2-MAIN-LATER", undefined, undefined, a1.id);
    c.addMessage(conv.id, "assistant", "A2-MAIN-LATER", undefined, undefined, q2.id);
    const b1 = c.createBranch(a1.id, { start: 8, end: 9, quote: "熵" }, "B1-Q");
    const b1a = c.addMessage(conv.id, "assistant", "B1-A 互信息展开", undefined, undefined, b1.id);
    c.addMessage(conv.id, "assistant", "B1-A-SIBLING", undefined, undefined, b1.id);
    c.createBranch(a1.id, { start: 10, end: 13, quote: "互信息" }, "OTHER-BRANCH-Q");
    const r = await ask({ question: "DEEP-Q", conversationId: conv.id, parentId: b1a.id });
    const all = text(r.prompt);
    for (const good of ["Q1-MAIN", "A1-MAIN", "B1-Q", "B1-A 互信息展开", "DEEP-Q"]) expect(all).toContain(good);
    for (const bad of ["Q2-MAIN-LATER", "A2-MAIN-LATER", "B1-A-SIBLING", "OTHER-BRANCH-Q"]) expect(all).not.toContain(bad);
    // A span branch from inside the branch: context ends at the nested source.
    const quote = "互信息";
    const start = b1a.content.indexOf(quote);
    const n = await ask({ question: "NESTED-SPAN-Q", conversationId: conv.id, branch: { sourceId: b1a.id, start, end: start + quote.length, quote } });
    const nAll = text(n.prompt);
    for (const good of ["Q1-MAIN", "A1-MAIN", "B1-Q", "B1-A 互信息展开", "NESTED-SPAN-Q"]) expect(nAll).toContain(good);
    for (const bad of ["Q2-MAIN-LATER", "B1-A-SIBLING", "OTHER-BRANCH-Q", "DEEP-Q"]) expect(nAll).not.toContain(bad);
  });

  it("regenerate sends the path up to the question only, never earlier answers to it", async () => {
    const conv = c.createConversation("iso-regen");
    const q1 = c.addMessage(conv.id, "user", "R-Q1");
    const a1 = c.addMessage(conv.id, "assistant", "R-A1", undefined, undefined, q1.id);
    const q2 = c.addMessage(conv.id, "user", "R-Q2", undefined, undefined, a1.id);
    c.addMessage(conv.id, "assistant", "R-A2-OLD", undefined, undefined, q2.id);
    c.addMessage(conv.id, "assistant", "R-A1-SIBLING", undefined, undefined, q1.id);
    const r = await ask({ question: "R-Q2", conversationId: conv.id, regenerate: true, parentId: q2.id });
    const all = text(r.prompt);
    expect(all).toContain("R-A1");
    expect(all).not.toContain("R-A2-OLD");
    expect(all).not.toContain("R-A1-SIBLING");
    expect(r.answer.parentId).toBe(q2.id);
  });
});

describe("regenerate keeps branches and adds siblings", () => {
  it("three regenerations give 1/3..3/3 in creation order; old follow-ups and span branches survive", async () => {
    const first = await ask({ question: "什么是熵？" });
    const conv = first.started.conversationId;
    const q = first.started.userMessage!;
    const follow = await ask({ question: "继续", conversationId: conv, parentId: first.answer.id });
    const quote = first.answer.content.slice(0, 2);
    const br = await ask({ question: "展开", conversationId: conv, branch: { sourceId: first.answer.id, start: 0, end: 2, quote } });
    const r2 = await ask({ question: "什么是熵？", conversationId: conv, regenerate: true, parentId: q.id });
    const r3 = await ask({ question: "什么是熵？", conversationId: conv, regenerate: true, parentId: q.id });
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, r3.answer.id).map((m) => m.id)).toEqual([first.answer.id, r2.answer.id, r3.answer.id]);
    for (const id of [follow.started.userMessage!.id, follow.answer.id, br.started.userMessage!.id, br.answer.id]) expect(t.messages.some((m) => m.id === id)).toBe(true);
    expect(t.origins).toEqual([expect.objectContaining({ childId: br.started.userMessage!.id, sourceId: first.answer.id, start: 0, end: 2, quote })]);
    expect(t.messages.filter((m) => m.role === "user")).toHaveLength(3);
  });

  it("regenerate inside a span branch adds a sibling there and keeps the branch crumb", async () => {
    const a = await ask({ question: "母题" });
    const conv = a.started.conversationId;
    const quote = a.answer.content.slice(0, 3);
    const br = await ask({ question: "分支问", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 3, quote } });
    const r = await ask({ question: "分支问", conversationId: conv, regenerate: true, parentId: br.started.userMessage!.id });
    const t = await tree(conv);
    expect(r.answer.parentId).toBe(br.started.userMessage!.id);
    expect(siblingsOf(t.messages, t.origins, r.answer.id).map((m) => m.id)).toEqual([br.answer.id, r.answer.id]);
    expect(breadcrumb(t.messages, t.origins, r.answer.id)).toEqual([{}, { branchId: br.started.userMessage!.id, quote }]);
    expect(t.origins).toHaveLength(1);
  });

  it("siblings created back-to-back keep creation order (strictly increasing timestamps)", () => {
    const conv = c.createConversation("stamps");
    const q = c.addMessage(conv.id, "user", "q");
    const ids = Array.from({ length: 8 }, (_, i) => c.addMessage(conv.id, "assistant", `a${i}`, undefined, undefined, q.id).id);
    const all = c.getMessages(conv.id);
    expect(new Set(all.map((m) => m.createdAt)).size).toBe(all.length);
    expect(siblingsOf(all, [], ids[3]).map((m) => m.id)).toEqual(ids);
  });
});

describe("‹ n/m › switching", () => {
  it("boundaries: ‹ at 1/m and › at m/m do nothing; switching shows that sibling's own subtree", () => {
    const conv = c.createConversation("switch");
    const q = c.addMessage(conv.id, "user", "q");
    const a1 = c.addMessage(conv.id, "assistant", "a1", undefined, undefined, q.id);
    const f1 = c.addMessage(conv.id, "user", "f1", undefined, undefined, a1.id);
    const a2 = c.addMessage(conv.id, "assistant", "a2", undefined, undefined, q.id);
    const a3 = c.addMessage(conv.id, "assistant", "a3", undefined, undefined, q.id);
    const t = c.getTree(conv.id) as unknown as { messages: Msg[]; origins: BranchOrigin[] };
    expect(step(t, a1.id, -1)).toBeUndefined();
    expect(step(t, a3.id, 1)).toBeUndefined();
    expect(step(t, a1.id, 1)?.id).toBe(a2.id);
    expect(step(t, a3.id, -1)?.id).toBe(a2.id);
    expect(defaultLeaf(t.messages, t.origins)?.id).toBe(a3.id);
    expect(latestLeaf(t.messages, t.origins, a1.id)?.id).toBe(f1.id);
    expect(latestLeaf(t.messages, t.origins, a2.id)?.id).toBe(a2.id);
    // A single message has no switcher (m = 1).
    expect(siblingsOf(t.messages, t.origins, f1.id)).toHaveLength(1);
  });

  it("a span-branch question is never counted as an alternative of plain follow-ups", () => {
    const conv = c.createConversation("switch-span");
    const q = c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "abc", undefined, undefined, q.id);
    const f = c.addMessage(conv.id, "user", "f", undefined, undefined, a.id);
    const b = c.createBranch(a.id, { start: 0, end: 1, quote: "a" }, "b");
    const t = c.getTree(conv.id);
    expect(siblingsOf(t.messages, t.origins, f.id).map((m) => m.id)).toEqual([f.id]);
    expect(siblingsOf(t.messages, t.origins, b.id).map((m) => m.id)).toEqual([b.id]);
  });

  it("selection is not persisted: after reload the conversation opens on the newest sibling", async () => {
    const a = await ask({ question: "持久化" });
    const conv = a.started.conversationId;
    const r = await ask({ question: "持久化", conversationId: conv, regenerate: true, parentId: a.started.userMessage!.id });
    const before = await tree(conv);
    ws.closeWorkspace();
    ws.openWorkspace(root);
    const after = await tree(conv);
    expect(after).toEqual(before);
    expect(defaultLeaf(after.messages, after.origins)?.id).toBe(r.answer.id);
    expect(siblingsOf(after.messages, after.origins, a.answer.id).map((m) => m.id)).toEqual([a.answer.id, r.answer.id]);
  });
});

describe("branch from any message", () => {
  it("from an answer (main thread): parent_id = answer, no branch_origin", async () => {
    const a = await ask({ question: "一" });
    const conv = a.started.conversationId;
    await ask({ question: "二", conversationId: conv, parentId: a.answer.id });
    const f = await ask({ question: "二'", conversationId: conv, parentId: a.answer.id });
    const t = await tree(conv);
    expect(f.started.userMessage!.parentId).toBe(a.answer.id);
    expect(t.origins).toHaveLength(0);
    expect(siblingsOf(t.messages, t.origins, f.started.userMessage!.id)).toHaveLength(2);
  });

  it("from a question (main thread, not first): sibling question under the same answer", async () => {
    const a = await ask({ question: "一" });
    const conv = a.started.conversationId;
    const q2 = await ask({ question: "二", conversationId: conv, parentId: a.answer.id });
    const re = await ask({ question: "二（改）", conversationId: conv, parentId: q2.started.userMessage!.parentId });
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, re.started.userMessage!.id).map((m) => m.id)).toEqual([q2.started.userMessage!.id, re.started.userMessage!.id]);
  });

  it("inside a span branch from an answer: stays in the branch (crumb kept), no new origin", async () => {
    const a = await ask({ question: "源" });
    const conv = a.started.conversationId;
    const quote = a.answer.content.slice(0, 2);
    const br = await ask({ question: "支", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote } });
    const f = await ask({ question: "支内追问", conversationId: conv, parentId: br.answer.id });
    const t = await tree(conv);
    expect(f.started.userMessage!.parentId).toBe(br.answer.id);
    expect(t.origins).toHaveLength(1);
    expect(breadcrumb(t.messages, t.origins, f.answer.id).map((x) => x.branchId)).toEqual([undefined, br.started.userMessage!.id]);
  });

  it("nested span branch stores branch_origin against the inner answer and nests in the branch tree", async () => {
    const a = await ask({ question: "外" });
    const conv = a.started.conversationId;
    const q = a.answer.content.slice(0, 2);
    const b1 = await ask({ question: "内1", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote: q } });
    const q2 = b1.answer.content.slice(2, 4);
    const b2 = await ask({ question: "内2", conversationId: conv, branch: { sourceId: b1.answer.id, start: 2, end: 4, quote: q2 } });
    const t = await tree(conv);
    expect(b2.started.userMessage!.parentId).toBe(b1.answer.id);
    expect(t.origins).toContainEqual(expect.objectContaining({ childId: b2.started.userMessage!.id, sourceId: b1.answer.id, start: 2, end: 4, quote: q2 }));
    const bt = branchTree(t.messages, t.origins);
    expect(bt.map((x) => x.branchId)).toEqual([b1.started.userMessage!.id]);
    expect(bt[0].children.map((x) => x.branchId)).toEqual([b2.started.userMessage!.id]);
  });

  // Was it.fails (AIPanel.tsx:327 sent parentId = question.parentId, so a re-asked span-branch question
  // landed on the main thread). Fixed: 「从这里分支」 sends siblingOf and main keeps the branch origin.
  it("re-asking a span-branch question keeps it in the branch as a 2/2 sibling", async () => {
    const a = await ask({ question: "源问" });
    const conv = a.started.conversationId;
    const quote = a.answer.content.slice(0, 2);
    const br = await ask({ question: "分支原问", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote } });
    const bq = br.started.userMessage!;
    const re = await ask({ question: "分支改问", conversationId: conv, siblingOf: bq.id });
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, re.started.userMessage!.id).map((m) => m.id)).toEqual([bq.id, re.started.userMessage!.id]);
    expect(re.started.userMessage!.parentId).toBe(a.answer.id);
    expect(t.origins).toContainEqual({ childId: re.started.userMessage!.id, sourceId: a.answer.id, start: 0, end: 2, quote });
  });
});

describe("siblingOf (从这里分支 on a question)", () => {
  const counts = () => {
    const db = ws.need().db;
    return {
      m: (db.prepare("SELECT COUNT(*) n FROM messages").get() as { n: number }).n,
      o: (db.prepare("SELECT COUNT(*) n FROM branch_origin").get() as { n: number }).n,
      c: (db.prepare("SELECT COUNT(*) n FROM conversations").get() as { n: number }).n
    };
  };
  const run = (req: Record<string, unknown>) => invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "改问", ...req });

  it("a mainline question gets a plain sibling: same parent, no branch_origin row", async () => {
    const a = await ask({ question: "主1" });
    const conv = a.started.conversationId;
    const q2 = await ask({ question: "主2", conversationId: conv, parentId: a.answer.id });
    const before = counts().o;
    const re = await ask({ question: "主2改", conversationId: conv, siblingOf: q2.started.userMessage!.id });
    expect(re.started.userMessage!.parentId).toBe(a.answer.id);
    expect(counts().o).toBe(before);
    const t = await tree(conv);
    expect(siblingsOf(t.messages, t.origins, re.started.userMessage!.id)).toHaveLength(2);
  });

  it("the first question of a conversation gets a sibling root", async () => {
    const a = await ask({ question: "首" });
    const re = await ask({ question: "首改", conversationId: a.started.conversationId, siblingOf: a.started.userMessage!.id });
    expect(re.started.userMessage!.parentId).toBeNull();
  });

  it("rejections write nothing: with parentId / branch / regenerate, other conversation, nonexistent, assistant answer", async () => {
    const a = await ask({ question: "甲" });
    const other = await ask({ question: "乙" });
    const conv = a.started.conversationId;
    const q = a.started.userMessage!.id;
    const before = counts();
    await expect(run({ conversationId: conv, siblingOf: q, parentId: a.answer.id })).rejects.toThrow(/siblingOf 不能和/);
    await expect(run({ conversationId: conv, siblingOf: q, parentId: null })).rejects.toThrow(/siblingOf 不能和/);
    await expect(run({ conversationId: conv, siblingOf: q, branch: { sourceId: a.answer.id, start: 0, end: 1, quote: a.answer.content.slice(0, 1) } })).rejects.toThrow(/siblingOf 不能和/);
    await expect(run({ conversationId: conv, siblingOf: q, regenerate: true })).rejects.toThrow(/siblingOf 不能和/);
    await expect(run({ conversationId: conv, siblingOf: other.started.userMessage!.id })).rejects.toThrow("消息不在这个对话里");
    await expect(run({ conversationId: conv, siblingOf: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("消息不在这个对话里");
    await expect(run({ conversationId: conv, siblingOf: a.answer.id })).rejects.toThrow("只能改问用户的问题");
    await expect(run({ siblingOf: q })).rejects.toThrow("对话不存在");
    expect(counts()).toEqual(before);
  });
});

describe("deletion and edge cases", () => {
  it("deleting a conversation removes its messages and branch origins", async () => {
    const a = await ask({ question: "删" });
    const conv = a.started.conversationId;
    const quote = a.answer.content.slice(0, 2);
    await ask({ question: "支", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote } });
    await invoke(IPC.convRemove, new FakeSender(), conv);
    expect(await tree(conv)).toEqual({ messages: [], origins: [] });
    const db = ws.need().db;
    expect(db.prepare("SELECT COUNT(*) n FROM branch_origin o LEFT JOIN messages m ON m.id = o.child_msg_id WHERE m.id IS NULL").get()).toEqual({ n: 0 });
  });

  it("parentId / regenerate against a deleted conversation is refused, nothing stored", async () => {
    const a = await ask({ question: "旧" });
    const conv = a.started.conversationId;
    await invoke(IPC.convRemove, new FakeSender(), conv);
    const count = () => (ws.need().db.prepare("SELECT COUNT(*) n FROM messages").get() as { n: number }).n;
    const n = count();
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, parentId: a.answer.id })).rejects.toThrow("对话不存在");
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, regenerate: true, parentId: a.started.userMessage!.id })).rejects.toThrow("对话不存在");
    expect(count()).toBe(n);
  });

  it("regenerate pointing at an answer, or a non-ask span branch, is refused", async () => {
    const a = await ask({ question: "边" });
    const conv = a.started.conversationId;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, regenerate: true, parentId: a.answer.id })).rejects.toThrow("找不到要重新回答的问题");
    const quote = a.answer.content.slice(0, 2);
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "explain", selection: "x", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote } })).rejects.toThrow("追问分支只能和问题一起发送");
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, regenerate: true, branch: { sourceId: a.answer.id, start: 0, end: 2, quote } })).rejects.toThrow("追问分支只能和问题一起发送");
  });
});

describe("#42 IPC additions", () => {
  it("parentId, regenerate parentId and branch sourceId from another conversation are refused, nothing stored", async () => {
    const a = await ask({ question: "本" });
    const o = await ask({ question: "他" });
    const conv = a.started.conversationId;
    const count = () => (ws.need().db.prepare("SELECT COUNT(*) n FROM messages").get() as { n: number }).n;
    const n = count();
    const run = (extra: Record<string, unknown>) => invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", conversationId: conv, ...extra });
    await expect(run({ parentId: o.answer.id })).rejects.toThrow("消息不在这个对话里");
    await expect(run({ regenerate: true, parentId: o.started.userMessage!.id })).rejects.toThrow("消息不在这个对话里");
    const quote = o.answer.content.slice(0, 2);
    await expect(run({ branch: { sourceId: o.answer.id, start: 0, end: 2, quote } })).rejects.toThrow("消息不在这个对话里");
    await expect(run({ parentId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("消息不在这个对话里");
    expect(count()).toBe(n);
  });

  it("conversations:tree returns messages + origins of that conversation only, and writes nothing", async () => {
    const a = await ask({ question: "树" });
    const conv = a.started.conversationId;
    const quote = a.answer.content.slice(0, 2);
    const br = await ask({ question: "枝", conversationId: conv, branch: { sourceId: a.answer.id, start: 0, end: 2, quote } });
    await ask({ question: "别处" });
    const db = ws.need().db;
    const snap = () => JSON.stringify([db.prepare("SELECT * FROM messages ORDER BY rowid").all(), db.prepare("SELECT * FROM branch_origin ORDER BY rowid").all(), db.prepare("SELECT * FROM conversations ORDER BY rowid").all()]);
    const before = snap();
    const t1 = await tree(conv);
    const t2 = await tree(conv);
    expect(snap()).toBe(before);
    expect(t2).toEqual(t1);
    expect(t1.messages.map((m) => m.id)).toEqual([a.started.userMessage!.id, a.answer.id, br.started.userMessage!.id, br.answer.id]);
    expect(t1.messages.every((m) => (m as Msg & { conversationId: string }).conversationId === conv)).toBe(true);
    expect(t1.origins).toEqual([{ childId: br.started.userMessage!.id, sourceId: a.answer.id, start: 0, end: 2, quote }]);
    for (const bad of [undefined, 42, { id: conv }, "no-such-id"]) expect(await invoke(IPC.convTree, new FakeSender(), bad)).toEqual({ messages: [], origins: [] });
    expect(snap()).toBe(before);
  });

  it("same-millisecond messages (frozen clock) get strictly increasing timestamps and stable sibling order across reload", async () => {
    const conv = c.createConversation("same-ms");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    let ids: string[];
    try {
      const q = c.addMessage(conv.id, "user", "q");
      ids = Array.from({ length: 5 }, (_, i) => c.addMessage(conv.id, "assistant", `s${i}`, undefined, undefined, q.id).id);
    } finally {
      vi.useRealTimers();
    }
    const stamps = c.getMessages(conv.id).map((m) => m.createdAt);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(stamps.length);
    ws.closeWorkspace();
    ws.openWorkspace(root);
    const t = await tree(conv.id);
    expect(siblingsOf(t.messages, t.origins, ids[0]).map((m) => m.id)).toEqual(ids);
  });
});
