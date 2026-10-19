import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSender, invoke, state, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const capture = await import("../../src/main/capture.js");
const vision = await import("../../src/main/vision.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");

registerIpc();
registerTasksIpc();
capture.registerCaptureIpc();

const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const shaOf = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const GOOD = "a".repeat(64);

afterAll(() => ws.closeWorkspace());

describe("isCaptureSha / capturePath", () => {
  it("accepts 64 lowercase hex", () => {
    expect(capture.isCaptureSha(GOOD)).toBe(true);
    expect(capture.isCaptureSha(shaOf(PNG))).toBe(true);
  });

  it.each([
    ["uppercase", "A".repeat(64)],
    ["63 chars", "a".repeat(63)],
    ["65 chars", "a".repeat(65)],
    ["traversal", "../" + "a".repeat(61)],
    ["traversal suffix", "a".repeat(64) + "/../x"],
    ["backslash", "a".repeat(63) + "\\"],
    ["non-hex", "g".repeat(64)],
    ["newline", "a".repeat(64) + "\n"],
    ["empty", ""],
    ["number", 123],
    ["null", null],
    ["object", { sha: GOOD }],
    ["array", [GOOD]]
  ])("rejects %s", (_n, v) => {
    expect(capture.isCaptureSha(v)).toBe(false);
    expect(() => capture.assertCaptureSha(v)).toThrow("无效的截图标识");
    expect(() => capture.capturePath("/ws", v)).toThrow("无效的截图标识");
  });

  it("builds <root>/.point/captures/<sha>.png", () => {
    expect(capture.capturePath("/ws", GOOD)).toBe(join("/ws", ".point", "captures", `${GOOD}.png`));
  });
});

describe("toCaptureRect", () => {
  it("rounds a valid rect", () => {
    expect(capture.toCaptureRect({ x: 1.4, y: 2.6, width: 100.2, height: 50 })).toEqual({ x: 1, y: 3, width: 100, height: 50 });
  });
  it.each([[null], [{}], [{ x: -1, y: 0, width: 10, height: 10 }], [{ x: 0, y: 0, width: 2, height: 10 }], [{ x: 0, y: 0, width: 10, height: 1e9 }], [{ x: "0", y: 0, width: 10, height: 10 }], [{ x: NaN, y: 0, width: 10, height: 10 }]])(
    "rejects %j",
    (r) => expect(() => capture.toCaptureRect(r)).toThrow("框选区域无效")
  );
});

describe("writeCapture / readCapture", () => {
  it("stores under the content sha, idempotent, round-trips", () => {
    const root = tmp("point-cap-");
    const sha = capture.writeCapture(root, PNG);
    expect(sha).toBe(shaOf(PNG));
    expect(readFileSync(join(root, ".point", "captures", `${sha}.png`))).toEqual(PNG);
    expect(capture.writeCapture(root, PNG)).toBe(sha);
    expect(readdirSync(join(root, ".point", "captures"))).toEqual([`${sha}.png`]);
    expect(capture.readCapture(root, sha)).toEqual(PNG);
    expect(capture.captureImage(root, sha)).toEqual({ mime: "image/png", base64: PNG.toString("base64") });
  });

  it("refuses empty images, missing and invalid shas", () => {
    const root = tmp("point-cap-");
    expect(() => capture.writeCapture(root, Buffer.alloc(0))).toThrow("截图为空");
    expect(() => capture.readCapture(root, GOOD)).toThrow("截图不存在");
    expect(() => capture.readCapture(root, "../index")).toThrow("无效的截图标识");
  });
});

describe("vision gating + request building", () => {
  it("assertVisionAllowed", () => {
    expect(() => vision.assertVisionAllowed(false, true)).toThrow(/当前模型不支持图片/);
    expect(() => vision.assertVisionAllowed(false, false)).not.toThrow();
    expect(() => vision.assertVisionAllowed(true, true)).not.toThrow();
  });

  it("withImage attaches to the last user message only", () => {
    const img = { mime: "image/png" as const, base64: "AAAA" };
    const msgs = vision.withImage(
      [
        { role: "system", content: "s" },
        { role: "user", content: "old" },
        { role: "assistant", content: "a" },
        { role: "user", content: "new" }
      ],
      img
    );
    expect(msgs[1].images).toBeUndefined();
    expect(msgs[3].images).toEqual([img]);
    expect(vision.withImage([{ role: "user", content: "x" }], undefined)[0].images).toBeUndefined();
  });
});

describe("capture IPC", () => {
  let root: string;
  beforeAll(() => {
    root = tmp("point-cap-ws-");
    ws.openWorkspace(root);
  });

  it("captures the rect via webContents.capturePage and returns only the sha", async () => {
    const s = Object.assign(new FakeSender(), {
      capturePage: vi.fn(async () => ({ toPNG: () => PNG, getSize: () => ({ width: 40, height: 20 }) }))
    });
    const r = await invoke(IPC.captureRegion, s as unknown as FakeSender, { x: 10, y: 20, width: 40, height: 20 });
    expect(s.capturePage).toHaveBeenCalledWith({ x: 10, y: 20, width: 40, height: 20 });
    expect(r).toEqual({ sha: shaOf(PNG), width: 40, height: 20 });
    expect(JSON.stringify(r)).not.toContain(root);
    expect(existsSync(capture.capturePath(root, shaOf(PNG)))).toBe(true);
  });

  it("rejects a bad rect before capturing", async () => {
    const s = Object.assign(new FakeSender(), { capturePage: vi.fn() });
    await expect(invoke(IPC.captureRegion, s as unknown as FakeSender, { x: 0, y: 0, width: 0, height: 0 })).rejects.toThrow("框选区域无效");
    expect(s.capturePage).not.toHaveBeenCalled();
  });
});

describe("tasks with an image (POINT_FAKE_LLM=1)", () => {
  let root: string;
  let sha: string;
  type Started = { requestId: string; conversationId: string; userMessage?: { meta?: { request: { image?: string } } } };
  beforeAll(() => {
    process.env.POINT_FAKE_LLM = "1";
    root = tmp("point-cap-task-");
    ws.openWorkspace(root);
    sha = capture.writeCapture(root, PNG);
  });
  beforeEach(() => delete process.env.POINT_FAKE_VISION);
  afterAll(() => {
    delete process.env.POINT_FAKE_LLM;
    delete process.env.POINT_FAKE_VISION;
  });

  it("vision model: answers and stores the sha on the user message", async () => {
    const s = new FakeSender();
    const r = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", question: "图里是什么？", image: sha })) as Started;
    expect(r.userMessage?.meta?.request.image).toBe(sha);
    await until(() => s.events.some((e) => (e.payload as { type: string }).type === "done"));
    const done = s.events.find((e) => (e.payload as { type: string }).type === "done")!.payload as { message: { content: string } };
    expect(done.message.content).toContain("已收到 1 张截图");
  });

  it("explain with only an image (no selected text) is allowed", async () => {
    const s = new FakeSender();
    await expect(invoke(IPC.tasksRun, s, { kind: "explain", selection: "", image: sha })).resolves.toBeTruthy();
  });

  it("text-only model: Chinese error, nothing stored", async () => {
    process.env.POINT_FAKE_VISION = "0";
    const before = ((await invoke(IPC.convList, new FakeSender())) as unknown[]).length;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: sha })).rejects.toThrow(/当前模型不支持图片/);
    expect(((await invoke(IPC.convList, new FakeSender())) as unknown[]).length).toBe(before);
  });

  it("vision follows the model picked for this run, not the Settings default (flash → v4-pro)", async () => {
    // Settings default deepseek-flash has vision; ModelBar picked deepseek-v4-pro (ModelSpec.vision=false).
    const before = ((await invoke(IPC.convList, new FakeSender())) as unknown[]).length;
    const msgs = (ws.need().db.prepare("SELECT count(*) AS n FROM messages").get() as { n: number }).n;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: sha, model: "deepseek-v4-pro" })).rejects.toThrow(/当前模型不支持图片/);
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "explain", selection: "", image: sha, model: "deepseek-v4-pro" })).rejects.toThrow(/当前模型不支持图片/);
    expect(((await invoke(IPC.convList, new FakeSender())) as unknown[]).length).toBe(before);
    expect((ws.need().db.prepare("SELECT count(*) AS n FROM messages").get() as { n: number }).n).toBe(msgs);
    const listed = (await invoke(IPC.modelsList, new FakeSender())) as { models: { id: string; vision: boolean }[] };
    expect(listed.models.find((m) => m.id === "deepseek-flash")?.vision).toBe(true);
    expect(listed.models.find((m) => m.id === "deepseek-v4-pro")?.vision).toBe(false);
    // And the other way round: a vision model picked for the run is allowed.
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: sha, model: "deepseek-flash" })).resolves.toBeTruthy();
  });

  it("a conversation remembered on a text-only model refuses an image even if Settings has vision", async () => {
    const s = new FakeSender();
    const r = (await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", question: "q", model: "deepseek-v4-pro" })) as Started;
    await until(() => s.events.some((e) => (e.payload as { type: string }).type === "done"));
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q2", image: sha, conversationId: r.conversationId })).rejects.toThrow(/当前模型不支持图片/);
  });

  it("text-only model still answers questions without an image", async () => {
    process.env.POINT_FAKE_VISION = "0";
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q" })).resolves.toBeTruthy();
  });

  it.each([["../../etc/passwd"], ["A".repeat(64)], ["a".repeat(63)], [42]])("rejects image %j", async (img) => {
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: img })).rejects.toThrow("无效的截图标识");
  });

  it("missing capture file is a clear error", async () => {
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: "b".repeat(64) })).rejects.toThrow("截图不存在");
  });
});

describe("settings: capabilities.vision", () => {
  beforeEach(() => writeFileSync(join(state.userData, "settings.json"), JSON.stringify({ activeProvider: "deepseek", providers: {} })));
  type View = { active: { model: string; vision: boolean }; providers: { id: string; capabilities: { vision: boolean }; visionOverride?: boolean }[] };

  it("defaults from the preset list", async () => {
    const v = (await invoke(IPC.settingsGet, new FakeSender())) as View;
    expect(v.active).toMatchObject({ model: "deepseek-flash", vision: true });
    expect(v.providers.find((p) => p.id === "openai")!.capabilities.vision).toBe(true);
    expect(v.providers.find((p) => p.id === "glm")!.capabilities.vision).toBe(false);
  });

  it("explicit override wins; null clears it", async () => {
    let v = (await invoke(IPC.settingsUpdate, new FakeSender(), { id: "deepseek", vision: true, makeActive: true })) as View;
    expect(v.active.vision).toBe(true);
    expect(v.providers.find((p) => p.id === "deepseek")!.visionOverride).toBe(true);
    v = (await invoke(IPC.settingsUpdate, new FakeSender(), { id: "deepseek", vision: null })) as View;
    expect(v.active.vision).toBe(true); // preset: deepseek-flash has vision
    v = (await invoke(IPC.settingsUpdate, new FakeSender(), { id: "glm", model: "glm-4v-flash", makeActive: true })) as View;
    expect(v.active).toMatchObject({ model: "glm-4v-flash", vision: true });
  });

  it("chat:start drops any renderer-supplied images", async () => {
    process.env.POINT_FAKE_LLM = "1";
    try {
      const s = new FakeSender();
      await invoke(IPC.chatStart, s, [{ role: "user", content: "hi", images: [{ mime: "image/png", base64: "x" }] }]);
      await until(() => s.events.some((e) => (e.payload as { type: string }).type === "done"));
      const text = s.events.map((e) => (e.payload as { text?: string }).text ?? "").join("");
      expect(text).not.toContain("截图");
    } finally {
      delete process.env.POINT_FAKE_LLM;
    }
  });
});

describe("readCapture never follows links or swapped files", () => {
  const canSymlink = process.platform !== "win32";

  it.runIf(canSymlink)("a .point/captures symlinked outside the workspace is not read", () => {
    const root = tmp("point-cap-rl-");
    const elsewhere = tmp("point-cap-out-");
    writeFileSync(join(elsewhere, `${shaOf(PNG)}.png`), PNG);
    mkdirSync(join(root, ".point"), { recursive: true });
    symlinkSync(elsewhere, join(root, ".point", "captures"), "dir");
    expect(() => capture.readCapture(root, shaOf(PNG))).toThrow("截图不存在或已被删除");
  });

  it("refuses when the opened fd is a different inode than the lstat (swap between check and open)", () => {
    const root = tmp("point-cap-ino-");
    const sha = capture.writeCapture(root, PNG);
    const file = capture.capturePath(root, sha);
    const real = fs.fstatSync.bind(fs);
    const closeSpy = vi.fn(fs.closeSync);
    const deps = { ...fs, closeSync: closeSpy, fstatSync: ((fd: number) => Object.assign(real(fd), { ino: 999999999 })) as typeof fs.fstatSync };
    expect(() => capture.readRegularFile(file, deps)).toThrow("文件在读取时被替换");
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(capture.readRegularFile(file)).toEqual(PNG);
  });

  it.runIf(canSymlink)("opens with O_NOFOLLOW on POSIX", () => {
    const root = tmp("point-cap-nf-");
    const sha = capture.writeCapture(root, PNG);
    const openSpy = vi.fn(fs.openSync);
    capture.readRegularFile(capture.capturePath(root, sha), { ...fs, openSync: openSpy as typeof fs.openSync });
    expect((openSpy.mock.calls[0][1] as number) & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
  });

  it("a directory or a symlink file is refused like a missing capture", () => {
    const root = tmp("point-cap-dir-");
    mkdirSync(join(root, ".point", "captures", `${"d".repeat(64)}.png`), { recursive: true });
    expect(() => capture.readCapture(root, "d".repeat(64))).toThrow("截图不存在或已被删除");
  });
});

describe("writeCapture stays inside the verified captures dir", () => {
  const canSymlink = process.platform !== "win32";

  it("temp files are created inside captures and cleaned up by the rename", () => {
    const root = tmp("point-cap-w-");
    const sha = capture.writeCapture(root, PNG);
    expect(readdirSync(join(root, ".point", "captures"))).toEqual([`${sha}.png`]);
  });

  it.runIf(canSymlink)("a <sha>.png symlink is replaced, never written through", () => {
    const root = tmp("point-cap-wl-");
    const outside = join(tmp("point-cap-target-"), "victim.png");
    writeFileSync(outside, "ORIGINAL");
    mkdirSync(join(root, ".point", "captures"), { recursive: true });
    const file = join(root, ".point", "captures", `${shaOf(PNG)}.png`);
    symlinkSync(outside, file);
    expect(capture.writeCapture(root, PNG)).toBe(shaOf(PNG));
    expect(readFileSync(outside, "utf8")).toBe("ORIGINAL");
    expect(fs.lstatSync(file).isFile()).toBe(true);
    expect(capture.readCapture(root, shaOf(PNG))).toEqual(PNG);
  });

  it.runIf(canSymlink)("a captures dir symlinked outside is refused for writes", () => {
    const root = tmp("point-cap-wd-");
    const elsewhere = tmp("point-cap-wd-out-");
    mkdirSync(join(root, ".point"), { recursive: true });
    symlinkSync(elsewhere, join(root, ".point", "captures"), "dir");
    expect(() => capture.writeCapture(root, PNG)).toThrow("截图目录不在工作区内");
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it.runIf(canSymlink)("ELOOP / ENOTDIR read as missing", () => {
    const root = tmp("point-cap-loop-");
    const dir = join(root, ".point", "captures");
    mkdirSync(dir, { recursive: true });
    const a = join(dir, `${"1".repeat(64)}.png`);
    symlinkSync(a, a);
    expect(() => capture.readCapture(root, "1".repeat(64))).toThrow("截图不存在或已被删除");
    const r2 = tmp("point-cap-nd-");
    mkdirSync(join(r2, ".point"), { recursive: true });
    writeFileSync(join(r2, ".point", "captures"), "not a dir");
    expect(() => capture.readCapture(r2, "1".repeat(64))).toThrow("截图不存在或已被删除");
  });
});
