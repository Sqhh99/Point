import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSender, invoke } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const settings = await import("../../src/main/settings.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
const { until } = await import("./electron-mock.js");
registerIpc();
registerTasksIpc();

import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

/** Same scheme as the electron-mock safeStorage, so the provider sees a real (dummy) key. */
const encKey = Buffer.from("enc:" + Buffer.from("sk-dummy-test").reverse().toString("hex")).toString("base64");
const settingsPath = () => join(app.getPath("userData"), "settings.json");
const writeSettings = (activeProvider: string, cfg: Record<string, unknown>) =>
  writeFileSync(settingsPath(), JSON.stringify({ activeProvider, providers: { [activeProvider]: { encKey, ...cfg } } }));
type Listed = { notice?: string; defaultModel?: string; models: { id: string; vision: boolean; custom?: boolean }[] };
type Started = { requestId: string; conversationId: string };

/** Every request body the vendor would have received. */
let sent: Record<string, unknown>[] = [];
beforeEach(() => {
  ws.openWorkspace(realpathSync.native(mkdtempSync(join(tmpdir(), "point-ws-"))));
  sent = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(JSON.stringify({ error: { message: "stub" } }), { status: 401, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function ask(body: Record<string, unknown>) {
  const sender = new FakeSender();
  const started = (await invoke(IPC.tasksRun, sender, { kind: "ask", selection: "", question: "hi", ...body })) as Started;
  await until(() => sender.events.some((e) => ["done", "error"].includes((e.payload as { type?: string }).type ?? "")));
  const notices = sender.events.filter((e) => (e.payload as { type?: string }).type === "model-notice").map((e) => (e.payload as { message: string }).message);
  const row = ws.need().db.prepare("SELECT model FROM conversations WHERE id = ?").get(started.conversationId) as { model: string };
  return { started, notices, storedModel: row.model };
}

describe("preset provider + saved id outside the ModelSpec table", () => {
  it("deepseek: listModels notice, ask runs on defaultModel, the unknown id never reaches the vendor", async () => {
    writeSettings("deepseek", { baseURL: "https://api.deepseek.com/v1", model: "deepseek-gone-xyz" });
    const listed = (await invoke(IPC.modelsList, new FakeSender())) as Listed;
    expect(listed.notice).toBe("原模型已不可用，已改用 deepseek-flash");
    expect(listed.defaultModel).toBe("deepseek-flash");
    expect(listed.models.some((m) => m.id === "deepseek-gone-xyz" || m.custom)).toBe(false);
    expect(settings.view().active.model).toBe("deepseek-flash");
    expect(settings.askSpec("deepseek-gone-xyz")).toBeUndefined();

    const r = await ask({});
    expect(r.notices).toEqual(["原模型已不可用，已改用 deepseek-flash"]);
    expect(r.storedModel).toBe("deepseek-flash");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.model).toBe("deepseek-flash");
    expect(JSON.stringify(sent)).not.toContain("deepseek-gone-xyz");
  });

  it("the same id sent explicitly in the run body also falls back (resolveAsk)", async () => {
    writeSettings("deepseek", { baseURL: "https://api.deepseek.com/v1", model: "deepseek-flash" });
    const r = await ask({ model: "deepseek-gone-xyz" });
    expect(r.notices).toEqual(["原模型已不可用，已改用 deepseek-flash"]);
    expect(sent.map((b) => b.model)).toEqual(["deepseek-flash"]);
  });

  it("a conversation that remembered a removed model falls back with a notice", async () => {
    writeSettings("deepseek", { baseURL: "https://api.deepseek.com/v1", model: "deepseek-flash" });
    const first = await ask({});
    ws.need().db.prepare("UPDATE conversations SET model = 'deepseek-gone-xyz' WHERE id = ?").run(first.started.conversationId);
    sent = [];
    const again = await ask({ conversationId: first.started.conversationId });
    expect(again.notices).toEqual(["原模型已不可用，已改用 deepseek-flash"]);
    expect(sent.map((b) => b.model)).toEqual(["deepseek-flash"]);
  });

  it("the user's vision declaration is ignored on a preset path (glm: default text-only)", async () => {
    writeSettings("glm", { baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-vision-gone", vision: true });
    const listed = (await invoke(IPC.modelsList, new FakeSender())) as Listed;
    expect(listed.notice).toBe("原模型已不可用，已改用 glm-4-flash");
    expect(listed.models.some((m) => m.custom)).toBe(false);
    expect(listed.models.find((m) => m.id === "glm-4-flash")!.vision).toBe(false);
    expect(settings.view().active).toMatchObject({ model: "glm-4-flash", vision: false });
    expect(settings.askSpec("glm-vision-gone")).toBeUndefined();
  });

  it("Settings save with an unknown id on a preset endpoint stores defaultModel, not the id", async () => {
    writeSettings("deepseek", { baseURL: "https://api.deepseek.com/v1", model: "deepseek-flash" });
    const v = settings.update({ id: "deepseek", model: "my-free-form", vision: true, makeActive: true });
    expect(v.active).toMatchObject({ model: "deepseek-flash" });
    expect(JSON.parse(readFileSync(settingsPath(), "utf8")).providers.deepseek.model).toBe("deepseek-flash");
    expect(((await invoke(IPC.modelsList, new FakeSender())) as Listed).notice).toBeUndefined();
  });

  it("a trailing slash or case change of the preset Base URL is still the preset endpoint", async () => {
    writeSettings("deepseek", { baseURL: "https://API.deepseek.com/v1/", model: "deepseek-gone-xyz", vision: true });
    expect(settings.view().active.model).toBe("deepseek-flash");
  });
});

describe("preset legacy names still map", () => {
  it("deepseek-chat / deepseek-reasoner → deepseek-flash, with no notice, on load and on save", async () => {
    writeSettings("deepseek", { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" });
    const listed = (await invoke(IPC.modelsList, new FakeSender())) as Listed;
    expect(listed.notice).toBeUndefined();
    expect(listed.defaultModel).toBe("deepseek-flash");
    expect(JSON.parse(readFileSync(settingsPath(), "utf8")).providers.deepseek.model).toBe("deepseek-flash");
    expect(settings.update({ id: "deepseek", model: "deepseek-reasoner", makeActive: true }).active.model).toBe("deepseek-flash");
    const r = await ask({});
    expect(r.notices).toEqual([]);
    expect(sent.map((b) => b.model)).toEqual(["deepseek-flash"]);
  });
});

describe("custom OpenAI-compatible endpoint + unknown id", () => {
  it("is kept as a custom model and its declaration is honoured (list, view, ask)", async () => {
    writeSettings("openai", { baseURL: "https://llm.example.test/v1", model: "my-vl-1", vision: true });
    const listed = (await invoke(IPC.modelsList, new FakeSender())) as Listed;
    expect(listed.notice).toBeUndefined();
    expect(listed.models[0]).toMatchObject({ id: "my-vl-1", vision: true, custom: true });
    expect(listed.defaultModel).toBe("my-vl-1");
    expect(settings.view().active).toMatchObject({ model: "my-vl-1", vision: true });
    expect(settings.askSpec("my-vl-1")).toMatchObject({ id: "my-vl-1", vision: true, custom: true });
    const r = await ask({});
    expect(r.notices).toEqual([]);
    expect(r.storedModel).toBe("my-vl-1");
    expect(sent.map((b) => b.model)).toEqual(["my-vl-1"]);

    const v = settings.update({ id: "openai", baseURL: "https://llm.example.test/v1", model: "my-text-2", vision: false, makeActive: true });
    expect(v.active).toMatchObject({ model: "my-text-2", vision: false });
  });
});
