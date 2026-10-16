import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS, migrate } from "@point/core";
import { FakeSender, invoke } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const settings = await import("../../src/main/settings.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
registerIpc();
registerTasksIpc();

import { mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const run = (body: unknown) => invoke(IPC.tasksRun, new FakeSender(), body);

beforeEach(() => {
  ws.openWorkspace(tmp("point-ws-"));
});

describe("migration 004", () => {
  it("adds nullable model and effort; idempotent; keeps existing rows", () => {
    const db = new Database(":memory:");
    migrate(db, MIGRATIONS.slice(0, 3));
    db.prepare("INSERT INTO docs VALUES ('d','t','md','p','t')").run();
    db.prepare("INSERT INTO conversations (id, title, doc_id, created_at, updated_at) VALUES ('c','t',NULL,'t','t')").run();
    migrate(db);
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    const cols = (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("model");
    expect(cols).toContain("effort");
    expect(db.prepare("SELECT model, effort FROM conversations WHERE id='c'").get()).toEqual({ model: null, effort: null });
  });
});

describe("settings rename + keys", () => {
  it("maps deepseek-chat → flash+off and deepseek-reasoner → flash+high; encKey survives", () => {
    const ud = app.getPath("userData");
    const path = join(ud, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        activeProvider: "deepseek",
        providers: { deepseek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", encKey: "YmFzZTY0LWtleQ==" } }
      })
    );
    const v = settings.view();
    expect(v.active.model).toBe("deepseek-flash");
    expect(JSON.parse(readFileSync(path, "utf8")).providers.deepseek.encKey).toBe("YmFzZTY0LWtleQ==");
    expect(JSON.parse(readFileSync(path, "utf8")).providers.deepseek.model).toBe("deepseek-flash");

    writeFileSync(
      path,
      JSON.stringify({
        activeProvider: "deepseek",
        providers: { deepseek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-reasoner", encKey: "YmFzZTY0LWtleQ==" } }
      })
    );
    expect(settings.view().active.model).toBe("deepseek-flash");
  });

  it("models:list returns only the current provider", async () => {
    settings.update({ id: "deepseek", model: "deepseek-flash", makeActive: true });
    const listed = (await invoke(IPC.modelsList, new FakeSender())) as { providerId: string; models: { id: string }[] };
    expect(listed.providerId).toBe("deepseek");
    expect(listed.models.every((m) => !m.id.startsWith("gpt-"))).toBe(true);
    expect(listed.models.some((m) => m.id === "deepseek-flash")).toBe(true);
  });
});

describe("tasks:run effort gate", () => {
  it("rejects unsupported effort before writing any message", async () => {
    const before = (ws.need().db.prepare("SELECT count(*) AS n FROM messages").get() as { n: number }).n;
    await expect(run({ kind: "ask", selection: "", question: "hi", effort: "nope" })).rejects.toThrow(/不支持思考等级/);
    expect((ws.need().db.prepare("SELECT count(*) AS n FROM messages").get() as { n: number }).n).toBe(before);
    expect((ws.need().db.prepare("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(0);
  });
});
