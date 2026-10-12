import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSender, invoke, state, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const settings = await import("../../src/main/settings.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerDocsIpc } = await import("../../src/main/docs-ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");

registerIpc();
registerDocsIpc();
registerTasksIpc();

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sender = () => new FakeSender();

afterAll(() => ws.closeWorkspace());

describe("settings + safeStorage (mocked)", () => {
  beforeEach(() => {
    state.encryption = true;
    writeFileSync(join(state.userData, "settings.json"), "{ corrupt");
  });

  it("falls back to defaults on a corrupt settings.json", async () => {
    const v = (await invoke(IPC.settingsGet, sender())) as ReturnType<typeof settings.view>;
    expect(v.activeProvider).toBe("deepseek");
    expect(v.providers.every((p) => !p.hasKey)).toBe(true);
  });

  it("stores the key encrypted, never returns it over IPC, decrypts in main", async () => {
    const v = (await invoke(IPC.settingsSetKey, sender(), "glm", "  sk-secret-123 ")) as ReturnType<typeof settings.view>;
    expect(v.providers.find((p) => p.id === "glm")?.hasKey).toBe(true);
    expect(JSON.stringify(v)).not.toContain("sk-secret");
    const raw = readFileSync(join(state.userData, "settings.json"), "utf8");
    expect(raw).not.toContain("sk-secret");
    expect(settings.resolveProvider("glm").apiKey).toBe("sk-secret-123");
  });

  it("clears the key with an empty string", async () => {
    await invoke(IPC.settingsSetKey, sender(), "openai", "k");
    await invoke(IPC.settingsSetKey, sender(), "openai", "  ");
    expect(() => settings.resolveProvider("openai")).toThrow(/API Key/);
  });

  it("refuses to save when encryption is unavailable", async () => {
    state.encryption = false;
    await expect(invoke(IPC.settingsSetKey, sender(), "deepseek", "k")).rejects.toThrow(/加密不可用/);
  });

  it("update: blank baseURL/model fall back to preset; makeActive switches provider", async () => {
    const v = (await invoke(IPC.settingsUpdate, sender(), { id: "glm", baseURL: " ", model: "", makeActive: true })) as ReturnType<typeof settings.view>;
    expect(v.activeProvider).toBe("glm");
    const glm = v.providers.find((p) => p.id === "glm")!;
    expect(glm.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(glm.model).toBe("glm-4-flash");
  });

  it("rejects unknown provider ids and non-string keys", async () => {
    await expect(invoke(IPC.settingsUpdate, sender(), { id: "evil" })).rejects.toThrow(/无效的模型服务/);
    await expect(invoke(IPC.settingsSetKey, sender(), "glm", 42)).rejects.toThrow(/无效的 API Key/);
  });

  it("settings:test without a key reports auth error instead of throwing", async () => {
    const r = await invoke(IPC.settingsTest, sender(), "deepseek");
    expect(r).toMatchObject({ ok: false, code: "auth" });
  });
});

describe("workspace + SQLite + docs IPC", () => {
  let root: string;
  beforeAll(() => {
    root = tmp("point-ws-");
    ws.openWorkspace(root);
  });

  it("requires a workspace before importing", async () => {
    ws.closeWorkspace();
    await expect(invoke(IPC.docsImport, sender())).rejects.toThrow(/工作区/);
    expect(await invoke(IPC.docsList, sender())).toEqual([]);
    ws.openWorkspace(root);
  });

  it("creates the folder layout and index db", () => {
    for (const p of ["docs", "notes", ".point/index.db"]) expect(existsSync(join(root, p))).toBe(true);
    expect(JSON.parse(readFileSync(join(state.userData, "workspace.json"), "utf8")).path).toBe(ws.workspacePath());
  });

  it("imports md via the dialog, lists it, and parses it back", async () => {
    const src = join(tmp("point-src-"), "笔记 Notes.MD");
    writeFileSync(src, "# 量子纠缠\n\n正文段落。\n");
    state.openResult = { canceled: false, filePaths: [src] };
    const [meta] = (await invoke(IPC.docsImport, sender())) as { id: string; title: string; path: string; type: string }[];
    expect(meta).toMatchObject({ title: "量子纠缠", type: "md" });
    expect(meta.path).toBe(`docs/${meta.id}.md`);
    const list = (await invoke(IPC.docsList, sender())) as { id: string }[];
    expect(list.map((d) => d.id)).toContain(meta.id);
    const doc = (await invoke(IPC.docsGet, sender(), meta.id)) as { blocks: { text?: string }[] };
    expect(doc.blocks.map((b) => b.text)).toContain("正文段落。");
  });

  it("keeps the file name as title when a doc is corrupt", async () => {
    const src = join(tmp("point-src-"), "broken.pdf");
    writeFileSync(src, "not a pdf");
    const meta = await ws.importFile(src);
    expect(meta.title).toBe("broken");
    await expect(ws.getDoc(meta.id)).rejects.toThrow();
  });

  it("rejects unsupported types, unknown ids and bad id types", async () => {
    const src = join(tmp("point-src-"), "a.txt");
    writeFileSync(src, "x");
    await expect(ws.importFile(src)).rejects.toThrow(/不支持/);
    await expect(invoke(IPC.docsGet, sender(), "nope")).rejects.toThrow(/不存在/);
    await expect(invoke(IPC.docsGet, sender(), 1)).rejects.toThrow(/无效/);
  });

  it("refuses a doc row whose path escapes docs/", async () => {
    ws.need().db.prepare("INSERT INTO docs VALUES ('evil','e','md','../outside.md','2020')").run();
    await expect(ws.getDoc("evil")).rejects.toThrow(/路径无效/);
  });

  it("restoreWorkspace reopens the last workspace", () => {
    ws.closeWorkspace();
    expect(ws.workspacePath()).toBeNull();
    ws.restoreWorkspace();
    expect(ws.workspacePath()).toBe(ws.need().root);
  });

  it("canceled workspace picker leaves the workspace unchanged", async () => {
    const before = ws.workspacePath();
    state.openResult = { canceled: true, filePaths: [] };
    expect(await invoke(IPC.workspaceChoose, sender())).toEqual({ path: before });
    expect(await invoke(IPC.docsImport, sender())).toEqual([]);
  });
});

describe("tasks IPC with POINT_FAKE_LLM=1 (conversations in SQLite)", () => {
  beforeAll(() => {
    process.env.POINT_FAKE_LLM = "1";
    ws.openWorkspace(tmp("point-ws-"));
  });
  afterAll(() => delete process.env.POINT_FAKE_LLM);

  type Started = { requestId: string; conversationId: string; userMessage?: { content: string } };
  const doneOf = (s: FakeSender, id: string) =>
    s.events.find((e) => (e.payload as { requestId: string; type: string }).requestId === id && ["done", "error"].includes((e.payload as { type: string }).type));

  it("runs a task, streams deltas, persists user + assistant messages", async () => {
    const s = sender();
    const r = (await invoke(IPC.tasksRun, s, { kind: "explain", selection: "熵" })) as Started;
    expect(r.userMessage?.content).toBe("解读概念");
    await until(() => !!doneOf(s, r.requestId));
    expect(s.events.filter((e) => (e.payload as { type: string }).type === "delta").length).toBeGreaterThan(1);
    expect(doneOf(s, r.requestId)?.payload).toMatchObject({ type: "done" });
    const msgs = (await invoke(IPC.convMessages, s, r.conversationId)) as { role: string; meta?: { request: { selection: string } } }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0].meta?.request.selection).toBe("熵");
    const convs = (await invoke(IPC.convList, s)) as { id: string; title: string }[];
    expect(convs.find((c) => c.id === r.conversationId)?.title).toBe("解读概念：熵");
  });

  it("regenerate replaces the trailing answer instead of appending", async () => {
    const s = sender();
    const a = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", question: "为什么？" })) as Started;
    await until(() => !!doneOf(s, a.requestId));
    const b = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", question: "为什么？", conversationId: a.conversationId, regenerate: true })) as Started;
    expect(b.userMessage).toBeUndefined();
    await until(() => !!doneOf(s, b.requestId));
    const msgs = (await invoke(IPC.convMessages, s, a.conversationId)) as { role: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("cancel aborts and keeps the partial answer", async () => {
    const s = sender();
    const r = (await invoke(IPC.tasksRun, s, { kind: "note", selection: "长文" })) as Started;
    await until(() => s.events.some((e) => (e.payload as { type: string }).type === "delta"));
    await invoke(IPC.tasksCancel, s, r.requestId);
    await until(() => !!doneOf(s, r.requestId));
    const end = doneOf(s, r.requestId)!.payload as { type: string; code: string; partial?: { content: string } };
    expect(end).toMatchObject({ type: "error", code: "aborted" });
    expect(end.partial?.content.length).toBeGreaterThan(0);
  });

  it("provider errors (429) are mapped and reported as events", async () => {
    const s = sender();
    const r = (await invoke(IPC.tasksRun, s, { kind: "explain", selection: "RATE-LIMIT-PROBE" })) as Started;
    await until(() => !!doneOf(s, r.requestId));
    expect(doneOf(s, r.requestId)!.payload).toMatchObject({ type: "error", code: "rate_limit" });
  });

  it("invalid input fails before anything is stored", async () => {
    const before = ((await invoke(IPC.convList, sender())) as unknown[]).length;
    await expect(invoke(IPC.tasksRun, sender(), { kind: "hack", selection: "x" })).rejects.toThrow(/任务类型/);
    await expect(invoke(IPC.tasksRun, sender(), { kind: "explain", selection: "  " })).rejects.toThrow(/选中/);
    await expect(invoke(IPC.tasksRun, sender(), { kind: "ask", selection: "x" })).rejects.toThrow(/问题/);
    expect(((await invoke(IPC.convList, sender())) as unknown[]).length).toBe(before);
  });

  it("deleting a conversation cascades to messages", async () => {
    const s = sender();
    const r = (await invoke(IPC.tasksRun, s, { kind: "explain", selection: "删除" })) as Started;
    await until(() => !!doneOf(s, r.requestId));
    await invoke(IPC.convRemove, s, r.conversationId);
    expect(await invoke(IPC.convMessages, s, r.conversationId)).toEqual([]);
    const n = ws.need().db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?").get(r.conversationId) as { n: number };
    expect(n.n).toBe(0);
  });

  it("chat:start streams via the fake provider", async () => {
    const s = sender();
    const id = (await invoke(IPC.chatStart, s, [{ role: "user", content: "hi" }])) as string;
    await until(() => s.events.some((e) => (e.payload as { requestId: string; type: string }).requestId === id && (e.payload as { type: string }).type === "done"));
    await expect(invoke(IPC.chatStart, s, "nope")).rejects.toThrow(/无效的消息/);
  });
});

describe("notes + export IPC (real files, zip unpacked)", () => {
  let root: string;
  beforeAll(() => {
    root = tmp("point-ws-");
    ws.openWorkspace(root);
  });

  it("notes CRUD over IPC, sanitizes input, rejects path-traversal ids", async () => {
    const s = sender();
    const n = (await invoke(IPC.notesCreate, s, { title: "量子 笔记", body: "正文", tags: ["物理", 3, "中文"] })) as { id: string; tags: string[] };
    expect(n.tags).toEqual(["物理", "中文"]);
    await invoke(IPC.notesAppend, s, n.id, "  追加 ");
    const read = (await invoke(IPC.notesRead, s, n.id)) as { body: string };
    expect(read.body).toBe("正文\n\n追加\n");
    await invoke(IPC.notesUpdate, s, n.id, { title: "新标题" });
    expect(((await invoke(IPC.notesList, s)) as { title: string }[])[0].title).toBe("新标题");
    await expect(invoke(IPC.notesRead, s, "../../etc/passwd")).rejects.toThrow(/无效的笔记 id/);
    await expect(invoke(IPC.notesRead, s, 5)).rejects.toThrow(/无效的笔记 id/);
  });

  it("exports the current note as .md with frontmatter + source title", async () => {
    const s = sender();
    const src = join(tmp("point-src-"), "doc.md");
    writeFileSync(src, "# 源文档\n");
    const doc = await ws.importFile(src);
    const n = (await invoke(IPC.notesCreate, s, { title: "导出", body: "原样\n", sourceDocId: doc.id, tags: ["t"] })) as { id: string };
    const out = join(tmp("point-out-"), "sub", "x.md");
    state.saveResult = { canceled: false, filePath: out };
    expect(await invoke(IPC.notesExportCurrent, s, n.id)).toEqual({ ok: true, path: out });
    const text = readFileSync(out, "utf8");
    expect(text).toMatch(/^---\ntitle: 导出\ntags:\n {2}- t\nsource: 《源文档》\nexported_at: /);
    expect(text.endsWith("---\n\n原样\n")).toBe(true);
  });

  it("export-all writes a zip; unpacked entries match notes (dup titles deduped)", async () => {
    const s = sender();
    await invoke(IPC.notesCreate, s, { title: "导出", body: "第二条" });
    const out = join(tmp("point-out-"), "all.zip");
    state.saveResult = { canceled: false, filePath: out };
    expect(await invoke(IPC.notesExportAll, s)).toMatchObject({ ok: true });
    const zip = await JSZip.loadAsync(readFileSync(out));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["导出-2.md", "导出.md", "新标题.md"].sort());
    const bodies = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
    expect(bodies.every((b) => b.startsWith("---\ntitle: "))).toBe(true);
    expect(bodies.some((b) => b.includes("第二条"))).toBe(true);
  });

  it("canceled save dialog returns canceled and writes nothing", async () => {
    state.saveResult = { canceled: true, filePath: undefined };
    const n = ((await invoke(IPC.notesList, sender())) as { id: string }[])[0];
    expect(await invoke(IPC.notesExportCurrent, sender(), n.id)).toEqual({ ok: false, canceled: true });
  });

  it("export errors are returned, not thrown", async () => {
    expect(await invoke(IPC.notesExportCurrent, sender(), "missing")).toMatchObject({ ok: false, message: "笔记不存在" });
    expect(await invoke(IPC.convExport, sender(), "missing")).toMatchObject({ ok: false, message: "对话不存在" });
    ws.openWorkspace(tmp("point-ws-"));
    expect(await invoke(IPC.notesExportAll, sender())).toMatchObject({ ok: false, message: "工作区里还没有笔记" });
  });

  it("exports a conversation with quote card and source", async () => {
    process.env.POINT_FAKE_LLM = "1";
    const s = sender();
    const src = join(tmp("point-src-"), "d.md");
    writeFileSync(src, "# 论文\n");
    const doc = await ws.importFile(src);
    const r = (await invoke(IPC.tasksRun, s, { kind: "explain", selection: "第一行\n第二行", docId: doc.id })) as { requestId: string; conversationId: string };
    await until(() => s.events.some((e) => (e.payload as { type: string }).type === "done"));
    delete process.env.POINT_FAKE_LLM;
    const out = join(tmp("point-out-"), "c.md");
    state.saveResult = { canceled: false, filePath: out };
    expect(await invoke(IPC.convExport, s, r.conversationId)).toMatchObject({ ok: true });
    const text = readFileSync(out, "utf8");
    expect(text).toContain("type: conversation");
    expect(text).toContain("> 第一行\n> 第二行\n>\n> — 《论文》");
    expect(text).toContain("### AI");
  });
});
