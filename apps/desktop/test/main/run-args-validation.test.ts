import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { branchCounts, branchesFrom, groupBySpan, siblingsOf, type BranchOrigin } from "@point/core";
import { FakeSender, invoke, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
registerIpc();
registerTasksIpc();

type Msg = { id: string; parentId: string | null; content: string };
type Started = { requestId: string; conversationId: string; userMessage?: Msg };
type Ev = { type: string; message?: Msg };

async function ask(req: Record<string, unknown>) {
  const s = new FakeSender();
  const started = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", ...req })) as Started;
  await until(() => s.events.some((e) => ["done", "error"].includes((e.payload as Ev).type)));
  const done = s.events.map((e) => e.payload as Ev).find((p) => p.type === "done");
  if (!done) throw new Error("task did not finish");
  return { started, user: started.userMessage!, answer: done.message! };
}
const run = (req: Record<string, unknown>) => invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "x", ...req });
const db = () => ws.need().db;
const n = (t: string) => (db().prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
const counts = () => ({ messages: n("messages"), origins: n("branch_origin"), conversations: n("conversations") });

const MALFORMED: [string, unknown][] = [
  ["number", 123],
  ["zero", 0],
  ["empty string", ""],
  ["false", false],
  ["true", true],
  ["object", {}],
  ["array", ["id"]],
  ["65 chars", "a".repeat(65)]
];

let conv = "";
let q: Msg;
let a: Msg;
beforeAll(async () => {
  process.env.POINT_FAKE_LLM = "1";
  ws.openWorkspace(realpathSync.native(mkdtempSync(join(tmpdir(), "point-run-args-"))));
  const r = await ask({ question: "基础" });
  conv = r.started.conversationId;
  q = r.user;
  a = r.answer;
});
afterAll(() => {
  delete process.env.POINT_FAKE_LLM;
  ws.closeWorkspace();
});

describe("parentId type validation (zero writes on reject)", () => {
  it.each(MALFORMED)("parentId %s is rejected without conversationId", async (_l, v) => {
    const before = counts();
    await expect(run({ parentId: v })).rejects.toThrow("无效的 parentId");
    expect(counts()).toEqual(before);
  });

  it.each(MALFORMED)("parentId %s is rejected with conversationId", async (_l, v) => {
    const before = counts();
    await expect(run({ conversationId: conv, parentId: v })).rejects.toThrow("无效的 parentId");
    expect(counts()).toEqual(before);
  });

  it("parentId null starts a new first question (sibling root); a valid id appends under it", async () => {
    const root = await ask({ question: "新首问", conversationId: conv, parentId: null });
    expect(root.user.parentId).toBeNull();
    const f = await ask({ question: "追问", conversationId: conv, parentId: a.id });
    expect(f.user.parentId).toBe(a.id);
    const fresh = await ask({ question: "无 parentId 字段" });
    expect(fresh.user.parentId).toBeNull();
  });

  it("explicit undefined parentId behaves like absent", async () => {
    const r = await ask({ question: "undef", parentId: undefined });
    expect(r.user.parentId).toBeNull();
  });
});

describe("siblingOf type validation (zero writes on reject)", () => {
  const BAD: [string, unknown][] = [["null", null], ...MALFORMED];
  it.each(BAD)("siblingOf %s is rejected without conversationId", async (_l, v) => {
    const before = counts();
    await expect(run({ siblingOf: v })).rejects.toThrow("无效的 siblingOf");
    expect(counts()).toEqual(before);
  });

  it.each(BAD)("siblingOf %s is rejected with conversationId", async (_l, v) => {
    const before = counts();
    await expect(run({ conversationId: conv, siblingOf: v })).rejects.toThrow("无效的 siblingOf");
    expect(counts()).toEqual(before);
  });

  it("well-formed siblingOf without a conversation is still refused (对话不存在), zero writes", async () => {
    const before = counts();
    await expect(run({ siblingOf: q.id })).rejects.toThrow("对话不存在");
    expect(counts()).toEqual(before);
  });

  it("valid siblingOf is accepted", async () => {
    const r = await ask({ question: "改问", conversationId: conv, siblingOf: q.id });
    expect(r.user.parentId).toBe(q.parentId);
  });
});

describe("groupBySpan via the public counts", () => {
  const o = (childId: string, sourceId: string, start: number, end: number, quote: string): BranchOrigin => ({ childId, sourceId, start, end, quote });

  it("re-asks collapse; branchCounts, branchesFrom and siblingsOf agree", () => {
    const origins = [o("c1", "a", 0, 2, "熵值"), o("c2", "a", 0, 2, "熵值"), o("c3", "a", 0, 2, "熵值"), o("c4", "a", 3, 5, "互信"), o("c5", "b", 0, 2, "熵值")];
    expect(branchCounts(origins).get("a")).toBe(2);
    expect(branchCounts(origins).get("b")).toBe(1);
    expect(branchesFrom(origins, "a")).toHaveLength(2);
    expect(branchesFrom(origins, "a")[0].origins.map((x) => x.childId)).toEqual(["c1", "c2", "c3"]);
    const nodes = ["c1", "c2", "c3", "c4", "c5"].map((id, i) => ({ id, parentId: "a", createdAt: `2026-10-12T00:00:0${i}Z` }));
    expect(siblingsOf(nodes, origins, "c2").map((x) => x.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("every key part separates groups: source, start, end, quote", () => {
    const base = o("c0", "a", 0, 1, "x");
    const origins = [base, o("c1", "b", 0, 1, "x"), o("c2", "a", 1, 1, "x"), o("c3", "a", 0, 2, "x"), o("c4", "a", 0, 1, "y")];
    expect(groupBySpan(origins)).toHaveLength(5);
  });

  it("keys cannot collide through separators or type coercion in ids/quotes", () => {
    const origins = [o("c1", 'a","0', 1, 2, "q"), o("c2", "a", 0, 1, '2","q'), o("c3", "a|0", 1, 2, "q"), o("c4", "a", 0, 12, "q"), o("c5", "a", 0, 1, "2q")];
    expect(groupBySpan(origins)).toHaveLength(5);
  });

  it("empty input and unknown source give zero", () => {
    expect(groupBySpan([])).toEqual([]);
    expect(branchesFrom([o("c", "a", 0, 1, "x")], "zz")).toEqual([]);
    expect(branchCounts([]).size).toBe(0);
  });
});
