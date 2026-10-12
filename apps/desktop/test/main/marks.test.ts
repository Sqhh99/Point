import Database from "better-sqlite3";

import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS, MarkStore, buildBatchMessage, buildOpenAIBody, migrate, parseAnchor } from "@point/core";
import { FakeSender, invoke, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const capture = await import("../../src/main/capture.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
const { registerMarksIpc } = await import("../../src/main/marks-ipc.js");
registerIpc();
registerTasksIpc();
registerMarksIpc();

const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const DOC = "11111111-1111-4111-8111-111111111111";

function memDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  db.prepare("INSERT INTO docs VALUES (?, '熵', 'md', 'docs/x.md', 't')").run(DOC);
  return db;
}
const memRaw = (s: MarkStore, id: string) => ((s as unknown as { db: Database.Database }).db.prepare("SELECT anchor_json FROM marks WHERE id = ?").get(id) as { anchor_json: string }).anchor_json;
let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("migration 003 (marks)", () => {
  it("runs after 001/002 and is idempotent", () => {
    const db = new Database(":memory:");
    expect(MIGRATIONS).toHaveLength(3);
    migrate(db);
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    const cols = (db.prepare("PRAGMA table_info(marks)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["id", "doc_id", "anchor_json", "note", "created_at"]);
  });

  it("upgrades a version-2 database without touching existing rows", () => {
    const db = new Database(":memory:");
    migrate(db, MIGRATIONS.slice(0, 2));
    db.prepare("INSERT INTO docs VALUES ('d', 't', 'md', 'p', 't')").run();
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    expect(db.prepare("SELECT id FROM docs").all()).toEqual([{ id: "d" }]);
  });

  it("deleting a doc cascades to its marks (foreign_keys ON)", () => {
    const db = memDb();
    const s = new MarkStore(db, ids);
    s.create(DOC, { kind: "text", text: "熵" });
    db.prepare("DELETE FROM docs WHERE id = ?").run(DOC);
    expect(db.prepare("SELECT COUNT(*) AS c FROM marks").get()).toEqual({ c: 0 });
  });

  it("refuses a mark for a doc that does not exist", () => {
    const s = new MarkStore(memDb(), ids);
    expect(() => s.create("22222222-2222-4222-8222-222222222222", { kind: "text", text: "x" })).toThrow("文档不存在");
  });
});

describe("workspace connections", () => {
  it("every open turns foreign_keys on", () => {
    const root = tmp("point-marks-fk-");
    ws.openWorkspace(root);
    expect(ws.need().db.pragma("foreign_keys", { simple: true })).toBe(1);
    ws.openWorkspace(root);
    expect(ws.need().db.pragma("foreign_keys", { simple: true })).toBe(1);
    ws.closeWorkspace();
  });
});

describe("anchors", () => {
  it("round-trips text and region anchors, dropping unknown fields", () => {
    const s = new MarkStore(memDb(), ids);
    const sha = "a".repeat(64);
    const t = s.create(DOC, { kind: "text", text: "  熵是无序度 ", blockId: "b3", page: 2, context: "ctx", extra: "x" });
    const r = s.create(DOC, { kind: "region", sha, page: 1, rect: { x: 10, y: 300, width: 40, height: 20 }, path: "/etc/passwd", imagePath: "/tmp/x.png", blockId: "b1" });
    expect(s.get(t.id)!.anchor).toEqual({ kind: "text", text: "熵是无序度", blockId: "b3", page: 2, context: "ctx" });
    // Only sha, page and rect are kept: never a path, no other fields.
    expect(s.get(r.id)!.anchor).toEqual({ kind: "region", sha, page: 1, rect: { x: 10, y: 300, width: 40, height: 20 } });
    const raw = (memRaw(s, r.id));
    expect(raw).not.toMatch(/path|blockId/i);
    expect(s.list(DOC).map((m) => m.id)).toEqual([t.id, r.id]);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["unknown kind", { kind: "file", text: "x" }],
    ["empty text", { kind: "text", text: "   " }],
    ["huge text", { kind: "text", text: "x".repeat(6001) }],
    ["bad page", { kind: "text", text: "x", page: 0 }],
    ["float page", { kind: "text", text: "x", page: 1.5 }],
    ["uppercase sha", { kind: "region", sha: "A".repeat(64), rect: { x: 0, y: 0, width: 1, height: 1 } }],
    ["traversal sha", { kind: "region", sha: "../" + "a".repeat(61), rect: { x: 0, y: 0, width: 1, height: 1 } }],
    ["short sha", { kind: "region", sha: "a".repeat(63), rect: { x: 0, y: 0, width: 1, height: 1 } }],
    ["no rect", { kind: "region", sha: "a".repeat(64) }],
    ["old width/height shape", { kind: "region", sha: "a".repeat(64), width: 4, height: 4 }],
    ["negative size", { kind: "region", sha: "a".repeat(64), rect: { x: 0, y: 0, width: -1, height: 5 } }],
    ["negative coord", { kind: "region", sha: "a".repeat(64), rect: { x: -1, y: 0, width: 1, height: 5 } }],
    ["float coord", { kind: "region", sha: "a".repeat(64), rect: { x: 0.5, y: 0, width: 1, height: 5 } }],
    ["blockId not string", { kind: "text", text: "x", blockId: 3 }]
  ])("rejects %s", (_n, a) => {
    expect(() => parseAnchor(a)).toThrow("无效的标记位置");
  });

  it("a corrupt row is skipped, never returned unvalidated", () => {
    const db = memDb();
    db.prepare("INSERT INTO marks VALUES ('bad', ?, '{\"kind\":\"region\",\"sha\":\"../x\"}', NULL, 't')").run(DOC);
    expect(new MarkStore(db, ids).list(DOC)).toEqual([]);
  });
});

describe("batch message", () => {
  const img = { mime: "image/png" as const, base64: "QUJD" };
  it("one user message, parts in selection order, images as image parts", () => {
    const m = buildBatchMessage("比较一下", [
      { anchor: { kind: "region", sha: "a".repeat(64), page: 3, rect: { x: 0, y: 0, width: 1, height: 1 } }, image: img },
      { anchor: { kind: "text", text: "第二个" } },
      { anchor: { kind: "text", text: "第三个" } }
    ]);
    expect(m.role).toBe("user");
    const kinds = m.parts!.map((p) => (p.type === "text" ? p.text.split("\n")[0] : "IMG"));
    expect(kinds).toEqual([expect.stringContaining("3 处"), "标记 1（第 3 页）：区域截图", "IMG", "标记 2：", "标记 3：", "问题：比较一下"]);
    const body = buildOpenAIBody([m], { model: "gpt-4o" }) as { messages: { content: { type: string }[] }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content.map((c) => c.type)).toEqual(["text", "text", "image_url", "text", "text", "text"]);
  });
  it("needs a question and at least one mark", () => {
    expect(() => buildBatchMessage(" ", [{ anchor: { kind: "text", text: "x" } }])).toThrow("请输入问题");
    expect(() => buildBatchMessage("q", [])).toThrow("请先勾选标记");
  });
});

describe("marks IPC + 一起问 (POINT_FAKE_LLM=1)", () => {
  let root: string;
  let docId: string;
  let shaA: string;
  type M = { id: string };
  beforeAll(() => {
    process.env.POINT_FAKE_LLM = "1";
    root = tmp("point-marks-ws-");
    ws.openWorkspace(root);
    docId = DOC;
    ws.need().db.prepare("INSERT INTO docs VALUES (?, '熵', 'md', 'docs/x.md', 't')").run(docId);
    shaA = capture.writeCapture(root, PNG);
  });
  beforeEach(() => delete process.env.POINT_FAKE_VISION);
  afterAll(() => {
    delete process.env.POINT_FAKE_LLM;
    ws.closeWorkspace();
  });
  const s = () => new FakeSender();

  it("create / list / remove; ids and anchors validated", async () => {
    const t = (await invoke(IPC.marksCreate, s(), docId, { kind: "text", text: "熵" })) as M;
    expect(((await invoke(IPC.marksList, s(), docId)) as M[]).map((m) => m.id)).toContain(t.id);
    await expect(invoke(IPC.marksCreate, s(), "../docs", { kind: "text", text: "x" })).rejects.toThrow("无效的文档 id");
    await expect(invoke(IPC.marksCreate, s(), docId, { kind: "text", text: "" })).rejects.toThrow("无效的标记位置");
    await expect(invoke(IPC.marksRemove, s(), "x; DROP TABLE marks")).rejects.toThrow("无效的标记 id");
    await invoke(IPC.marksRemove, s(), t.id);
    expect(((await invoke(IPC.marksList, s(), docId)) as M[]).map((m) => m.id)).not.toContain(t.id);
  });

  it("a region mark needs an existing capture; deleting the mark keeps the file", async () => {
    await expect(invoke(IPC.marksCreate, s(), docId, { kind: "region", sha: "b".repeat(64), rect: { x: 0, y: 0, width: 4, height: 4 } })).rejects.toThrow("截图不存在");
    const r = (await invoke(IPC.marksCreate, s(), docId, { kind: "region", sha: shaA, rect: { x: 0, y: 0, width: 4, height: 4 } })) as M;
    await invoke(IPC.marksRemove, s(), r.id);
    expect(existsSync(capture.capturePath(root, shaA))).toBe(true);
  });

  it("一起问: one message, marks in order, answer counts text + images", async () => {
    const a = (await invoke(IPC.marksCreate, s(), docId, { kind: "text", text: "甲" })) as M;
    const b = (await invoke(IPC.marksCreate, s(), docId, { kind: "region", sha: shaA, rect: { x: 0, y: 0, width: 4, height: 4 } })) as M;
    const sender = s();
    const r = (await invoke(IPC.tasksRun, sender, { kind: "ask", selection: "", question: "有什么关系？", docId, marks: [b.id, a.id] })) as {
      userMessage: { meta: { request: { marks: string[] }; marks: { kind: string }[] } };
    };
    expect(r.userMessage.meta.request.marks).toEqual([b.id, a.id]);
    expect(r.userMessage.meta.marks.map((m) => m.kind)).toEqual(["region", "text"]);
    await until(() => sender.events.some((e) => (e.payload as { type: string }).type === "done"));
    const done = sender.events.find((e) => (e.payload as { type: string }).type === "done")!.payload as { message: { content: string } };
    expect(done.message.content).toContain("已收到 2 个标记（图片 1 张）");
  });

  it("一起问 with a region mark on a text-only model: no_vision, nothing stored", async () => {
    process.env.POINT_FAKE_VISION = "0";
    const b = (await invoke(IPC.marksCreate, s(), docId, { kind: "region", sha: shaA, rect: { x: 0, y: 0, width: 4, height: 4 } })) as M;
    const before = ((await invoke(IPC.convList, s())) as unknown[]).length;
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId, marks: [b.id] })).rejects.toThrow(/当前模型不支持图片/);
    expect(((await invoke(IPC.convList, s())) as unknown[]).length).toBe(before);
  });

  it("text-only marks work without vision", async () => {
    process.env.POINT_FAKE_VISION = "0";
    const a = (await invoke(IPC.marksCreate, s(), docId, { kind: "text", text: "乙" })) as M;
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId, marks: [a.id] })).resolves.toBeTruthy();
  });

  it("一起问 requires a docId, and every mark must belong to it", async () => {
    const a = (await invoke(IPC.marksCreate, s(), docId, { kind: "text", text: "丁" })) as M;
    for (const bad of [undefined, null, ""]) {
      await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId: bad, marks: [a.id] })).rejects.toThrow("一起问需要指定文档");
    }
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId: "../x", marks: [a.id] })).rejects.toThrow("无效的文档 id");
    const other = "55555555-5555-4555-8555-555555555555";
    ws.need().db.prepare("INSERT INTO docs VALUES (?, '别的', 'md', 'docs/y.md', 't')").run(other);
    const b = (await invoke(IPC.marksCreate, s(), other, { kind: "text", text: "戊" })) as M;
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId, marks: [a.id, b.id] })).rejects.toThrow("标记不存在");
  });

  it("rejects unknown / foreign / malformed mark ids and non-ask kinds", async () => {
    const a = (await invoke(IPC.marksCreate, s(), docId, { kind: "text", text: "丙" })) as M;
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId, marks: ["33333333-3333-4333-8333-333333333333"] })).rejects.toThrow("标记不存在");
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId: "44444444-4444-4444-8444-444444444444", marks: [a.id] })).rejects.toThrow("标记不存在");
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId, marks: ["../x"] })).rejects.toThrow("无效的标记 id");
    await expect(invoke(IPC.tasksRun, s(), { kind: "ask", selection: "", question: "q", docId, marks: [] })).rejects.toThrow("请先勾选标记");
    await expect(invoke(IPC.tasksRun, s(), { kind: "explain", selection: "x", docId, marks: [a.id] })).rejects.toThrow("一起问");
  });
});
