// Extra coverage for branched conversation storage (#23). Complements branches.test.ts,
// migrate-fixture.test.ts and core tree.test.ts without repeating their cases.
import Database from "better-sqlite3";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { state } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const ws = await import("../../src/main/workspace.js");
const c = await import("../../src/main/conversations.js");

const FIXTURE = fileURLToPath(new URL("../fixtures/v0.1.0/", import.meta.url));

afterEach(() => ws.closeWorkspace());

const fresh = () => ws.openWorkspace(mkdtempSync(join(tmpdir(), "point-bx-")));
const ids = (ms: { id: string }[]) => ms.map((m) => m.id);
function stageFixture() {
  const dir = mkdtempSync(join(tmpdir(), "point-bx-fx-"));
  cpSync(FIXTURE, dir, { recursive: true });
  state.userData = join(dir, "userData");
  return { root: join(dir, "workspace"), db: join(dir, "workspace", ".point", "index.db") };
}
type Row = { id: string; conversation_id: string; role: string; content: string; created_at: string };
function readOld(file: string) {
  const d = new Database(file, { readonly: true });
  try {
    return {
      rows: d.prepare("SELECT id, conversation_id, role, content, created_at FROM messages ORDER BY conversation_id, created_at, rowid").all() as Row[],
      convs: d.prepare("SELECT * FROM conversations ORDER BY id").all(),
      docs: d.prepare("SELECT * FROM docs ORDER BY id").all()
    };
  } finally {
    d.close();
  }
}

describe("002 on the real v0.1.0 fixture", () => {
  it("keeps every message's content, conversations, docs, notes and settings", () => {
    const { root, db } = stageFixture();
    const before = readOld(db);
    const notesBefore = (() => {
      ws.openWorkspace(root);
      const n = ws.need().notes.list().map((x) => ({ title: x.title }));
      ws.closeWorkspace();
      return n;
    })();
    ws.openWorkspace(root);
    for (const conv of c.listConversations()) {
      const stored = c.getMessages(conv.id);
      const old = before.rows.filter((r) => r.conversation_id === conv.id);
      expect(stored.map((m) => [m.id, m.role, m.content])).toEqual(old.map((r) => [r.id, r.role, r.content]));
      // exactly one root per conversation, all rows reachable, no branch origins invented
      expect(stored.filter((m) => m.parentId === null)).toHaveLength(old.length ? 1 : 0);
      expect(c.getOrigins(conv.id)).toEqual([]);
    }
    expect(ws.need().notes.list().map((x) => ({ title: x.title }))).toEqual(notesBefore);
    ws.closeWorkspace();
    const after = readOld(db);
    expect(after.convs).toEqual(before.convs);
    expect(after.docs).toEqual(before.docs);
  });

  it("each chain is a single path: first message has no parent, every other row has exactly one child", () => {
    const { root } = stageFixture();
    ws.openWorkspace(root);
    for (const conv of c.listConversations()) {
      const stored = c.getMessages(conv.id);
      if (!stored.length) continue;
      const thread = c.threadOf(conv.id);
      expect(thread).toHaveLength(stored.length);
      expect(thread[0].parentId).toBeNull();
      for (let i = 1; i < thread.length; i++) expect(thread[i].parentId).toBe(thread[i - 1].id);
    }
  });

  it("migrated chain keeps the v0.1.0 display order (created_at, then rowid) when timestamps tie", () => {
    const { root, db } = stageFixture();
    const before = readOld(db);
    ws.openWorkspace(root);
    for (const conv of c.listConversations()) {
      const old = before.rows.filter((r) => r.conversation_id === conv.id);
      expect(ids(c.threadOf(conv.id))).toEqual(ids(old));
    }
  });
});

describe("deep and wide branching", () => {
  it("50 nested branches: context is root→leaf in order, siblings excluded at every level", () => {
    fresh();
    const conv = c.createConversation("deep");
    const u0 = c.addMessage(conv.id, "user", "q0");
    let ans = c.addMessage(conv.id, "assistant", "答0 互信息🙂");
    const expected = [u0.id, ans.id];
    const siblings: string[] = [];
    for (let i = 1; i <= 50; i++) {
      // a sibling branch from the same answer that must never leak into the deep path
      const sib = c.createBranch(ans.id, { start: 0, end: 1, quote: "答" }, `sib${i}`);
      siblings.push(sib.id, c.addMessage(conv.id, "assistant", `sib-a${i}`, undefined, undefined, sib.id).id);
      const s = ans.content.indexOf("互信息");
      const b = c.createBranch(ans.id, { start: s, end: s + 3, quote: "互信息" }, `q${i}`);
      ans = c.addMessage(conv.id, "assistant", `答${i} 互信息🙂`, undefined, undefined, b.id);
      expected.push(b.id, ans.id);
    }
    const path = c.threadOf(conv.id, ans.id);
    expect(ids(path)).toEqual(expected);
    expect(path.some((m) => siblings.includes(m.id))).toBe(false);
    expect(c.historyFor(conv.id, false, ans.id).map((m) => m.content)).toEqual(path.map((m) => m.content));
    // main thread is untouched by all branches
    expect(ids(c.threadOf(conv.id))).toEqual([u0.id, expected[1]]);
  });

  it("several branches from one answer with overlapping and identical spans are all kept, each with its own context", () => {
    fresh();
    const conv = c.createConversation("wide");
    const u = c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "香农熵衡量不确定性");
    const spans = [
      { start: 0, end: 3, quote: "香农熵" },
      { start: 2, end: 5, quote: "熵衡量" },
      { start: 0, end: 9, quote: "香农熵衡量不确定性" },
      { start: 0, end: 3, quote: "香农熵" }
    ];
    const kids = spans.map((s, i) => c.createBranch(a.id, s, `b${i}`));
    const origins = c.getOrigins(conv.id);
    expect(origins).toHaveLength(4);
    for (const [i, k] of kids.entries()) {
      expect(origins.find((o) => o.childId === k.id)).toEqual({ childId: k.id, sourceId: a.id, ...spans[i] });
      expect(ids(c.threadOf(conv.id, k.id))).toEqual([u.id, a.id, k.id]);
    }
  });
});

describe("rejected branches write nothing", () => {
  it.each([
    ["quote mismatch", { start: 0, end: 2, quote: "XX" }],
    ["end past text", { start: 3, end: 99, quote: "🙂尾" }],
    ["negative start", { start: -1, end: 1, quote: "a" }],
    ["start == end", { start: 1, end: 1, quote: "" }],
    ["start > end", { start: 2, end: 1, quote: "" }],
    ["non-integer", { start: 0.5, end: 1, quote: "a" }],
    ["NaN", { start: Number.NaN, end: 1, quote: "a" }]
  ])("%s", (_n, span) => {
    fresh();
    const conv = c.createConversation("r");
    c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "ab🙂尾");
    const before = c.getTree(conv.id);
    expect(() => c.createBranch(a.id, span, "x")).toThrow();
    expect(c.getTree(conv.id)).toEqual(before);
  });

  it.each([
    ["starts inside 🙂", { start: 3, end: 5 }],
    ["ends inside 🙂", { start: 1, end: 3 }]
  ])("surrogate-pair split rejected: %s", (_n, r) => {
    fresh();
    const conv = c.createConversation("s");
    c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "ab🙂尾"); // 🙂 = UTF-16 [2,4)
    const before = c.getTree(conv.id);
    expect(() => c.createBranch(a.id, { ...r, quote: a.content.slice(r.start, r.end) }, "x")).toThrow();
    expect(c.getTree(conv.id)).toEqual(before);
  });

  it("branch from a user message (or unknown id) is rejected and nothing written, even with a matching quote", () => {
    fresh();
    const conv = c.createConversation("u");
    const u = c.addMessage(conv.id, "user", "用户问题");
    c.addMessage(conv.id, "assistant", "答");
    const before = c.getTree(conv.id);
    expect(() => c.createBranch(u.id, { start: 0, end: 2, quote: "用户" }, "x")).toThrow(/assistant/);
    expect(() => c.createBranch("nope", { start: 0, end: 1, quote: "a" }, "x")).toThrow();
    expect(c.getTree(conv.id)).toEqual(before);
  });
});

describe("persistence", () => {
  it("tree, origins and paths survive closing and reopening the workspace", () => {
    const root = fresh();
    const conv = c.createConversation("persist");
    c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "熵🙂互信息");
    const b = c.createBranch(a.id, { start: 3, end: 6, quote: "互信息" }, "b", "explain", { docTitle: "熵 🧠" } as never);
    const ba = c.addMessage(conv.id, "assistant", "ba", undefined, undefined, b.id);
    c.addMessage(conv.id, "user", "main-next");
    const tree = c.getTree(conv.id);
    const branchPath = c.threadOf(conv.id, ba.id);
    const mainPath = c.threadOf(conv.id);
    ws.closeWorkspace();
    ws.openWorkspace(root);
    expect(c.getTree(conv.id)).toEqual(tree);
    expect(c.threadOf(conv.id, ba.id)).toEqual(branchPath);
    expect(c.threadOf(conv.id)).toEqual(mainPath);
    const d = new Database(join(root, ".point", "index.db"), { readonly: true });
    expect(d.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    d.close();
  });
});

describe("regenerate", () => {
  // Known limitation of #23: regenerating an answer deletes (ON DELETE CASCADE) every branch
  // derived from it. To be fixed in ⑥; flip to a plain it() then.
  it.fails("regenerating an answer keeps branches derived from it", () => {
    fresh();
    const conv = c.createConversation("regen");
    c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "互信息");
    const b = c.createBranch(a.id, { start: 0, end: 3, quote: "互信息" }, "b");
    c.dropTrailingAssistant(conv.id);
    expect(c.getMessages(conv.id).some((m) => m.id === b.id)).toBe(true);
    expect(c.getOrigins(conv.id)).toHaveLength(1);
  });
});
