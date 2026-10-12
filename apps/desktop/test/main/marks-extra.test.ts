import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@point/core";
import { MARK_LIMITS, MIGRATIONS, MarkStore, buildBatchMessage, migrate, parseAnchor, type ChatMessage } from "@point/core";
import { FakeSender, invoke, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const capture = await import("../../src/main/capture.js");
const { FakeProvider } = await import("../../src/main/fake-llm.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
const { registerMarksIpc, loadBatch } = await import("../../src/main/marks-ipc.js");
registerIpc();
registerTasksIpc();
registerMarksIpc();

// .native: Windows runners give 8.3 short temp paths; macOS tmpdir is under /private/var.
const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG2 = Buffer.concat([PNG, Buffer.from([1])]);
const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S = "0123456789abcdef".repeat(4);
let n = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function memDb(fk = true) {
  const db = new Database(":memory:");
  db.pragma(`foreign_keys = ${fk ? "ON" : "OFF"}`); // better-sqlite3 defaults to ON; be explicit
  migrate(db);
  for (const d of [DOC_A, DOC_B]) db.prepare("INSERT INTO docs VALUES (?, 't', 'md', 'docs/x.md', 't')").run(d);
  return db;
}
const marksTable = (db: Database.Database) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='marks'").get();

describe("migration 003", () => {
  it("is the third migration and creates marks + its index", () => {
    expect(MIGRATIONS).toHaveLength(3);
    expect(MIGRATIONS[2]).toMatch(/CREATE TABLE IF NOT EXISTS marks/);
    const db = new Database(":memory:");
    migrate(db);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='marks'").all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain("marks_by_doc");
  });

  it("applies in order: v1 has no marks, v2 has no marks, v3 has marks", () => {
    const db = new Database(":memory:");
    migrate(db, MIGRATIONS.slice(0, 1));
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    expect(marksTable(db)).toBe(false);
    migrate(db, MIGRATIONS.slice(0, 2));
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    expect(marksTable(db)).toBe(false);
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    expect(marksTable(db)).toBe(true);
  });

  it("idempotent: running again (and re-executing the SQL) changes nothing and keeps rows", () => {
    const db = memDb();
    const s = new MarkStore(db, nextId);
    const m = s.create(DOC_A, { kind: "text", text: "保留" });
    expect(migrate(db)).toBe(3);
    db.exec(MIGRATIONS[2]!); // IF NOT EXISTS everywhere
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    expect(s.get(m.id)?.anchor).toEqual({ kind: "text", text: "保留" });
  });

  it("a v2 file on disk upgrades to v3 via openWorkspace and keeps docs", () => {
    const root = tmp("point-mx-v2-");
    ws.openWorkspace(root);
    ws.closeWorkspace();
    // rebuild as a v2 database
    const file = join(root, ".point", "index.db");
    const db = new Database(file);
    db.exec("DROP TABLE marks");
    db.pragma("user_version = 2");
    db.prepare("INSERT INTO docs VALUES (?, 'old', 'md', 'docs/o.md', 't')").run(DOC_A);
    db.close();
    ws.openWorkspace(root);
    expect(ws.need().db.pragma("user_version", { simple: true })).toBe(3);
    expect(ws.need().db.prepare("SELECT title FROM docs WHERE id = ?").get(DOC_A)).toEqual({ title: "old" });
    ws.closeWorkspace();
  });
});

describe("foreign keys + cascade", () => {
  afterEach(() => ws.closeWorkspace());

  it("foreign_keys is ON on every workspace connection, including after switching and reopening", () => {
    const a = tmp("point-mx-fk-a-");
    const b = tmp("point-mx-fk-b-");
    for (const r of [a, b, a]) {
      ws.openWorkspace(r);
      expect(ws.need().db.pragma("foreign_keys", { simple: true })).toBe(1);
    }
  });

  it("without foreign_keys the cascade would NOT happen (proves the pragma matters)", () => {
    const db = memDb(false);
    new MarkStore(db, nextId).create(DOC_A, { kind: "text", text: "x" });
    db.prepare("DELETE FROM docs WHERE id = ?").run(DOC_A);
    expect(db.prepare("SELECT COUNT(*) c FROM marks").get()).toEqual({ c: 1 });
  });

  it("deleting a doc in a real workspace removes only its marks; capture files stay", () => {
    const root = tmp("point-mx-cascade-");
    ws.openWorkspace(root);
    const db = ws.need().db;
    for (const d of [DOC_A, DOC_B]) db.prepare("INSERT INTO docs VALUES (?, 't', 'md', 'docs/x.md', 't')").run(d);
    const sha = capture.writeCapture(root, PNG);
    const s = new MarkStore(db, nextId);
    s.create(DOC_A, { kind: "region", sha, width: 4, height: 4 });
    s.create(DOC_A, { kind: "text", text: "a" });
    const keep = s.create(DOC_B, { kind: "region", sha, width: 4, height: 4 });
    db.prepare("DELETE FROM docs WHERE id = ?").run(DOC_A);
    expect(s.list(DOC_A)).toEqual([]);
    expect(s.list(DOC_B).map((m) => m.id)).toEqual([keep.id]);
    expect(existsSync(capture.capturePath(root, sha))).toBe(true);
  });

  it("a mark cannot be inserted for a missing doc even with raw SQL", () => {
    const db = memDb();
    expect(() => db.prepare("INSERT INTO marks VALUES ('m', 'nope', '{}', NULL, 't')").run()).toThrow(/FOREIGN KEY/);
  });

  it("removing marks (one shared sha, several marks) never deletes capture files", async () => {
    const root = tmp("point-mx-rm-");
    ws.openWorkspace(root);
    ws.need().db.prepare("INSERT INTO docs VALUES (?, 't', 'md', 'docs/x.md', 't')").run(DOC_A);
    const sha = capture.writeCapture(root, PNG);
    const sha2 = capture.writeCapture(root, PNG2);
    const ms = [] as { id: string }[];
    for (const h of [sha, sha, sha2]) ms.push((await invoke(IPC.marksCreate, new FakeSender(), DOC_A, { kind: "region", sha: h, width: 4, height: 4 })) as { id: string });
    for (const m of ms) await invoke(IPC.marksRemove, new FakeSender(), m.id);
    expect(readdirSync(join(root, ".point", "captures")).sort()).toEqual([`${sha}.png`, `${sha2}.png`].sort());
  });
});

describe("anchor validation", () => {
  it.each([
    [{ kind: "text", text: "a" }],
    [{ kind: "text", text: "x".repeat(MARK_LIMITS.text), blockId: "b".repeat(MARK_LIMITS.blockId), page: 999_999, context: "c".repeat(MARK_LIMITS.context) }]
  ])("valid anchor round-trips through the store unchanged (%#)", (a) => {
    const db = memDb();
    const s = new MarkStore(db, nextId);
    const m = s.create(DOC_A, a);
    expect(m.anchor).toEqual(a);
    expect(s.get(m.id)!.anchor).toEqual(a);
    expect(JSON.parse((db.prepare("SELECT anchor_json j FROM marks WHERE id = ?").get(m.id) as { j: string }).j)).toEqual(a);
  });

  // Region assertions stay on sha + page (+ size) only, so they survive fix/marks-followup reshaping the rect.
  it("region anchor round-trips sha and page", () => {
    const db = memDb();
    const s = new MarkStore(db, nextId);
    const m = s.create(DOC_A, { kind: "region", sha: S, width: 40, height: 30, page: 2 });
    for (const a of [m.anchor, s.get(m.id)!.anchor, JSON.parse((db.prepare("SELECT anchor_json j FROM marks WHERE id = ?").get(m.id) as { j: string }).j)]) {
      expect(a).toMatchObject({ kind: "region", sha: S, page: 2 });
    }
  });

  it("stored region anchor_json has no path / imagePath (main derives it from the sha)", () => {
    const db = memDb();
    const s = new MarkStore(db, nextId);
    const m = s.create(DOC_A, { kind: "region", sha: S, width: 4, height: 4, path: "/etc/passwd", imagePath: "../x.png" });
    const stored = JSON.parse((db.prepare("SELECT anchor_json j FROM marks WHERE id = ?").get(m.id) as { j: string }).j) as Record<string, unknown>;
    for (const k of ["path", "imagePath", "file", "url"]) expect(stored).not.toHaveProperty(k);
    expect(JSON.stringify(stored)).not.toMatch(/[\\/]/);
  });

  it("text is trimmed; unknown fields dropped; null optionals dropped", () => {
    expect(parseAnchor({ kind: "text", text: "  t  ", evil: 1, blockId: null, page: null })).toEqual({ kind: "text", text: "t" });
    expect(parseAnchor({ kind: "region", sha: S, width: 4, height: 4, context: "no context on region", __proto__: { x: 1 } })).toEqual({ kind: "region", sha: S, width: 4, height: 4 });
  });

  it.each([
    ["null", null], ["array", [{ kind: "text", text: "a" }]], ["string", "text"], ["no kind", { text: "a" }], ["bad kind", { kind: "TEXT", text: "a" }],
    ["empty text", { kind: "text", text: "" }], ["whitespace text", { kind: "text", text: " \n\t" }], ["text too long", { kind: "text", text: "x".repeat(MARK_LIMITS.text + 1) }],
    ["text not string", { kind: "text", text: 5 }], ["blockId too long", { kind: "text", text: "a", blockId: "b".repeat(MARK_LIMITS.blockId + 1) }],
    ["blockId number", { kind: "text", text: "a", blockId: 1 }], ["context too long", { kind: "text", text: "a", context: "c".repeat(MARK_LIMITS.context + 1) }],
    ["page 0", { kind: "text", text: "a", page: 0 }], ["page -1", { kind: "text", text: "a", page: -1 }], ["page 1.5", { kind: "text", text: "a", page: 1.5 }],
    ["page 1e6", { kind: "text", text: "a", page: 1_000_000 }], ["page string", { kind: "text", text: "a", page: "1" }],
    ["region uppercase sha", { kind: "region", sha: S.toUpperCase(), width: 4, height: 4 }], ["region short sha", { kind: "region", sha: S.slice(1), width: 4, height: 4 }],
    ["region ../ sha", { kind: "region", sha: "../" + S.slice(3), width: 4, height: 4 }], ["region no sha", { kind: "region", width: 4, height: 4 }],
    ["region width 0", { kind: "region", sha: S, width: 0, height: 4 }], ["region width 10001", { kind: "region", sha: S, width: 10_001, height: 4 }],
    ["region width 1.5", { kind: "region", sha: S, width: 1.5, height: 4 }], ["region height string", { kind: "region", sha: S, width: 4, height: "4" }],
    ["region NaN", { kind: "region", sha: S, width: NaN, height: 4 }]
  ])("rejects %s", (_n, a) => {
    expect(() => parseAnchor(a)).toThrow("无效的标记位置");
    expect(() => new MarkStore(memDb(), nextId).create(DOC_A, a)).toThrow("无效的标记位置");
  });

  it.each([["not json", "{"], ["json null", "null"], ["bad region", JSON.stringify({ kind: "region", sha: "../x", width: 4, height: 4 })], ["unknown kind", '{"kind":"html","html":"<script>"}']])(
    "a stored row with invalid anchor_json (%s) is skipped by list/get",
    (_n, json) => {
      const db = memDb();
      const s = new MarkStore(db, nextId);
      const ok = s.create(DOC_A, { kind: "text", text: "ok" });
      db.prepare("INSERT INTO marks VALUES ('bad', ?, ?, NULL, 'z')").run(DOC_A, json);
      expect(s.list(DOC_A).map((m) => m.id)).toEqual([ok.id]);
      expect(s.get("bad")).toBeUndefined();
      expect(() => s.updateNote("bad", "x")).toThrow("标记不存在");
    }
  );
});

describe("isCaptureSha: core and main agree", () => {
  it("main re-exports the same function as core", () => {
    expect(capture.isCaptureSha).toBe(core.isCaptureSha);
  });
  it.each([[S], [S.toUpperCase()], [S.slice(1)], [S + "0"], ["../" + S.slice(3)], [S + "\n"], [""], [null], [42], [[S]], [new String(S)]])("same answer for %#", (v) => {
    expect(capture.isCaptureSha(v)).toBe(core.isCaptureSha(v));
  });
});

describe("一起问 (ask together)", () => {
  let root: string;
  let shaA: string;
  type M = { id: string };
  let captured: ChatMessage[] = [];
  beforeAll(() => {
    process.env.POINT_FAKE_LLM = "1";
    root = tmp("point-mx-ask-");
    ws.openWorkspace(root);
    for (const d of [DOC_A, DOC_B]) ws.need().db.prepare("INSERT INTO docs VALUES (?, 't', 'md', 'docs/x.md', 't')").run(d);
    shaA = capture.writeCapture(root, PNG);
    const orig = FakeProvider.prototype.chat;
    vi.spyOn(FakeProvider.prototype, "chat").mockImplementation(function (this: InstanceType<typeof FakeProvider>, m, o) {
      captured = structuredClone(m);
      return orig.call(this, m, o);
    });
  });
  beforeEach(() => {
    delete process.env.POINT_FAKE_VISION;
    captured = [];
  });
  afterAll(() => {
    delete process.env.POINT_FAKE_LLM;
    vi.restoreAllMocks();
    ws.closeWorkspace();
  });
  const mk = async (doc: string, a: unknown) => (await invoke(IPC.marksCreate, new FakeSender(), doc, a)) as M;
  const run = async (req: Record<string, unknown>) => {
    const sender = new FakeSender();
    const r = await invoke(IPC.tasksRun, sender, { kind: "ask", selection: "", question: "q", ...req });
    await until(() => sender.events.some((e) => ["done", "error"].includes((e.payload as { type: string }).type)));
    return r;
  };

  it("parts follow selection order (not creation order), images in place", async () => {
    const t1 = await mk(DOC_A, { kind: "text", text: "一" });
    const r1 = await mk(DOC_A, { kind: "region", sha: shaA, width: 4, height: 4, page: 3 });
    const t2 = await mk(DOC_A, { kind: "text", text: "二" });
    await run({ docId: DOC_A, marks: [t2.id, r1.id, t1.id] });
    const last = captured.at(-1)!;
    const seq = last.parts!.map((p) => (p.type === "image" ? "IMG" : p.text.split("\n")[0]));
    expect(seq).toEqual([expect.stringContaining("文档："), "标记 1：", "标记 2（第 3 页）：区域截图", "IMG", "标记 3：", "问题：q"]);
    const texts = last.parts!.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("|");
    expect(texts).toContain("3 处内容");
    expect(texts.indexOf("二")).toBeLessThan(texts.indexOf("一"));
    expect(captured.filter((m) => m.parts).length).toBe(1);
  });

  it("duplicate ids are de-duplicated, keeping first position", async () => {
    const a = await mk(DOC_A, { kind: "text", text: "甲" });
    const b = await mk(DOC_A, { kind: "text", text: "乙" });
    const r = (await run({ docId: DOC_A, marks: [b.id, a.id, b.id] })) as { userMessage: { meta: { request: { marks: string[] } } } };
    expect(r.userMessage.meta.request.marks).toEqual([b.id, a.id]);
  });

  it("exactly 20 marks is allowed; 21 is rejected before anything is stored", async () => {
    const ms: M[] = [];
    for (let i = 0; i < 21; i++) ms.push(await mk(DOC_A, { kind: "text", text: `m${i}` }));
    await expect(run({ docId: DOC_A, marks: ms.slice(0, 20).map((m) => m.id) })).resolves.toBeTruthy();
    const before = ((await invoke(IPC.convList, new FakeSender())) as unknown[]).length;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: ms.map((m) => m.id) })).rejects.toThrow("一次最多一起问 20 个标记");
    expect(((await invoke(IPC.convList, new FakeSender())) as unknown[]).length).toBe(before);
  });

  it("buildBatchMessage itself enforces the 20 limit and needs a question", () => {
    const m = { anchor: { kind: "text" as const, text: "x" } };
    expect(() => buildBatchMessage("q", Array(21).fill(m))).toThrow("一次最多一起问 20 个标记");
    expect(buildBatchMessage("q", Array(20).fill(m)).parts!.filter((p) => p.type === "text" && p.text.startsWith("标记 "))).toHaveLength(20);
    expect(() => buildBatchMessage("  ", [m])).toThrow("请输入问题");
  });

  it("a mark from another doc is rejected (with docId given)", async () => {
    const b = await mk(DOC_B, { kind: "text", text: "别的文档" });
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: [b.id] })).rejects.toThrow("标记不存在");
  });

  it("mixing marks from two docs is rejected", async () => {
    const a = await mk(DOC_A, { kind: "text", text: "A" });
    const b = await mk(DOC_B, { kind: "text", text: "B" });
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: [a.id, b.id] })).rejects.toThrow("标记不存在");
  });

  // Bug: apps/desktop/src/main/marks-ipc.ts loadBatch checks ownership only `if (docId && …)`, and
  // tasks-ipc.ts validate() passes docId through as-is, so an empty or missing docId lets marks from any
  // document (or several) into one question.
  it.fails.each([[""], [undefined]])("docId %j: marks are still checked against a single document", async (docId) => {
    const a = await mk(DOC_A, { kind: "text", text: "A" });
    const b = await mk(DOC_B, { kind: "text", text: "B" });
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId, marks: [a.id, b.id] })).rejects.toThrow();
  });

  it("loadBatch directly: empty docId currently returns marks from other docs (documents the bug)", async () => {
    const b = await mk(DOC_B, { kind: "text", text: "B" });
    expect(loadBatch([b.id], "").marks.map((m) => m.docId)).toEqual([DOC_B]);
  });

  it("region mark whose capture file was deleted afterwards → clear error, nothing stored", async () => {
    const sha = capture.writeCapture(root, Buffer.from("gone-later"));
    const r = await mk(DOC_A, { kind: "region", sha, width: 4, height: 4 });
    const { rmSync } = await import("node:fs");
    rmSync(capture.capturePath(root, sha));
    const before = ((await invoke(IPC.convList, new FakeSender())) as unknown[]).length;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: [r.id] })).rejects.toThrow("截图不存在");
    expect(((await invoke(IPC.convList, new FakeSender())) as unknown[]).length).toBe(before);
  });

  it("a stored region mark with a tampered sha is never loaded (row skipped → 标记不存在)", async () => {
    const r = await mk(DOC_A, { kind: "region", sha: shaA, width: 4, height: 4 });
    ws.need().db.prepare("UPDATE marks SET anchor_json = ? WHERE id = ?").run(JSON.stringify({ kind: "region", sha: "../../index.db", width: 4, height: 4 }), r.id);
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: [r.id] })).rejects.toThrow("标记不存在");
  });

  it("creating a region mark with a bad or missing sha is rejected", async () => {
    await expect(mk(DOC_A, { kind: "region", sha: "../x", width: 4, height: 4 })).rejects.toThrow("无效的截图标识");
    await expect(mk(DOC_A, { kind: "region", sha: S.toUpperCase(), width: 4, height: 4 })).rejects.toThrow("无效的截图标识");
    await expect(mk(DOC_A, { kind: "region", sha: "f".repeat(64), width: 4, height: 4 })).rejects.toThrow("截图不存在");
  });

  it("vision off + region mark → code no_vision, provider not called, nothing stored", async () => {
    process.env.POINT_FAKE_VISION = "0";
    const r = await mk(DOC_A, { kind: "region", sha: shaA, width: 4, height: 4 });
    const t = await mk(DOC_A, { kind: "text", text: "t" });
    const before = ((await invoke(IPC.convList, new FakeSender())) as unknown[]).length;
    let err: unknown;
    try {
      await invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: [t.id, r.id] });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "no_vision" });
    expect(captured).toEqual([]);
    expect(((await invoke(IPC.convList, new FakeSender())) as unknown[]).length).toBe(before);
  });

  it("marks + image together, or with a non-ask kind, are refused", async () => {
    const t = await mk(DOC_A, { kind: "text", text: "t" });
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks: [t.id], image: shaA })).rejects.toThrow("一起问");
    for (const kind of ["explain", "note", "diagram"]) await expect(invoke(IPC.tasksRun, new FakeSender(), { kind, selection: "x", docId: DOC_A, marks: [t.id] })).rejects.toThrow("一起问");
  });

  it.each([[["x"]], [[1, 2]], [["../" + "a".repeat(33)]], [[null]]])("malformed mark ids %j are rejected", async (marks) => {
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", docId: DOC_A, marks })).rejects.toThrow();
  });
});
