import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const ws = await import("../../src/main/workspace.js");
const c = await import("../../src/main/conversations.js");
const { breadcrumb, branchTree, migrate } = await import("@point/core");

afterAll(() => ws.closeWorkspace());

describe("branching conversations (SQLite)", () => {
  ws.openWorkspace(mkdtempSync(join(tmpdir(), "point-branch-")));

  it("main thread appends linearly; a branch from an answer gets its own context", () => {
    const conv = c.createConversation("熵");
    const u1 = c.addMessage(conv.id, "user", "什么是熵？");
    const a1 = c.addMessage(conv.id, "assistant", "**熵**衡量不确定性🙂，也和互信息有关。");
    c.addMessage(conv.id, "user", "举个例子");
    expect(u1.parentId).toBeNull();
    expect(a1.parentId).toBe(u1.id);

    const start = a1.content.indexOf("互信息");
    const b1 = c.createBranch(a1.id, { start, end: start + 3, quote: "互信息" }, "互信息是什么？");
    const b1a = c.addMessage(conv.id, "assistant", "互信息衡量两个变量共享的信息。", undefined, undefined, b1.id);

    // a plain append still goes to the main thread, not into the branch
    const u3 = c.addMessage(conv.id, "assistant", "比如抛硬币。");
    expect(c.threadOf(conv.id).map((m) => m.id)).toEqual([u1.id, a1.id, u3.parentId, u3.id]);
    expect(c.historyFor(conv.id, false, b1a.id).map((m) => m.content)).toEqual(["什么是熵？", a1.content, "互信息是什么？", b1a.content]);

    // sub-branch from the branch answer, offsets survive a round trip
    const s = b1a.content.indexOf("共享");
    const b2 = c.createBranch(b1a.id, { start: s, end: s + 2, quote: "共享" }, "共享指什么？");
    const { messages, origins } = c.getTree(conv.id);
    expect(origins.find((o) => o.childId === b2.id)).toEqual({ childId: b2.id, sourceId: b1a.id, start: s, end: s + 2, quote: "共享" });
    expect(breadcrumb(messages, origins, b2.id).map((x) => x.quote)).toEqual([undefined, "互信息", "共享"]);
    expect(branchTree(messages, origins)[0].children[0].branchId).toBe(b2.id);
  });

  it("rejects bad spans and non-answer sources", () => {
    const conv = c.createConversation("x");
    const u = c.addMessage(conv.id, "user", "问");
    const a = c.addMessage(conv.id, "assistant", "答🙂");
    expect(() => c.createBranch(u.id, { start: 0, end: 1, quote: "问" }, "q")).toThrow();
    expect(() => c.createBranch(a.id, { start: 1, end: 2, quote: "🙂" }, "q")).toThrow();
    expect(() => c.createBranch(a.id, { start: 0, end: 1, quote: "错" }, "q")).toThrow();
    expect(c.getOrigins(conv.id)).toEqual([]);
    const other = c.createConversation("y");
    expect(() => c.addMessage(other.id, "user", "q", undefined, undefined, a.id)).toThrow();
  });

  it("deleting a conversation removes its branches", () => {
    const conv = c.createConversation("del");
    c.addMessage(conv.id, "user", "q");
    const a = c.addMessage(conv.id, "assistant", "abc");
    c.createBranch(a.id, { start: 0, end: 1, quote: "a" }, "q2");
    c.deleteConversation(conv.id);
    expect(c.getTree(conv.id)).toEqual({ messages: [], origins: [] });
  });
});

describe("002 migration of v0.1.0 conversations", () => {
  it("chains old messages per conversation by created_at, then rowid (insertion order)", () => {
    const db = new Database(":memory:");
    migrate(db, []); // nothing
    db.exec(`CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL, imported_at TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, doc_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, kind TEXT, created_at TEXT NOT NULL);
      INSERT INTO conversations VALUES ('c1','a',NULL,'t','t'), ('c2','b',NULL,'t','t');
      INSERT INTO messages VALUES ('m2','c1','assistant','答','',  '2026-10-01T00:00:01Z'),
                                  ('m1','c1','user','问','',       '2026-10-01T00:00:00Z'),
                                  ('m3b','c1','user','同时b','',   '2026-10-01T00:00:02Z'),
                                  ('m3a','c1','user','同时a','',   '2026-10-01T00:00:02Z'),
                                  ('n1','c2','user','另一段','',   '2026-10-01T00:00:00Z');`);
    migrate(db);
    const parents = Object.fromEntries((db.prepare("SELECT id, parent_id FROM messages").all() as { id: string; parent_id: string | null }[]).map((r) => [r.id, r.parent_id]));
    expect(parents).toEqual({ m1: null, m2: "m1", m3b: "m2", m3a: "m3b", n1: null });
    expect(db.prepare("SELECT content FROM messages WHERE id='m1'").get()).toEqual({ content: "问" });
  });
});
