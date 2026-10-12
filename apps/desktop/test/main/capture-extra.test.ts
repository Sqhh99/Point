import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@point/core";
import { FakeSender, invoke, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC, WINDOW_ACTIONS } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const capture = await import("../../src/main/capture.js");
const vision = await import("../../src/main/vision.js");
const { FakeProvider } = await import("../../src/main/fake-llm.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { registerTasksIpc } = await import("../../src/main/tasks-ipc.js");
registerIpc();
registerTasksIpc();
capture.registerCaptureIpc();

const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const shaOf = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const GOOD = "0123456789abcdef".repeat(4);
const capDir = (root: string) => join(root, ".point", "captures");
const canSymlink = (() => {
  try {
    const d = tmp("point-ln-probe-");
    symlinkSync(join(d, "x"), join(d, "y"));
    return true;
  } catch {
    return false; // Windows without symlink privilege
  }
})();

afterAll(() => ws.closeWorkspace());

describe("isCaptureSha / assertCaptureSha edges", () => {
  it.each([["all digits", "0".repeat(64)], ["mixed hex", GOOD], ["real sha", shaOf(PNG)]])("accepts %s", (_n, v) => {
    expect(capture.isCaptureSha(v)).toBe(true);
    expect(capture.assertCaptureSha(v)).toBe(v);
  });

  it.each([
    ["63 chars", GOOD.slice(1)],
    ["65 chars", GOOD + "a"],
    ["one uppercase", GOOD.slice(0, 63) + "F"],
    ["all uppercase", GOOD.toUpperCase()],
    ["leading space", " " + GOOD.slice(1)],
    ["trailing space", GOOD + " "],
    ["trailing newline", GOOD + "\n"],
    ["trailing CRLF", GOOD + "\r\n"],
    ["leading newline", "\n" + GOOD],
    ["tab inside", GOOD.slice(0, 32) + "\t" + GOOD.slice(33)],
    ["../ prefix", "../" + GOOD.slice(3)],
    ["..\\ prefix", "..\\" + GOOD.slice(3)],
    ["/ inside", GOOD.slice(0, 32) + "/" + GOOD.slice(33)],
    ["backslash inside", GOOD.slice(0, 32) + "\\" + GOOD.slice(33)],
    ["absolute posix", "/" + GOOD.slice(1)],
    ["drive letter", "C:" + GOOD.slice(2)],
    ["NUL inside", GOOD.slice(0, 32) + "\0" + GOOD.slice(33)],
    ["NUL suffix", GOOD + "\0"],
    ["with .png", GOOD + ".png"],
    ["fullwidth digit", "０" + GOOD.slice(1)],
    ["Arabic-Indic digit", "٣" + GOOD.slice(1)],
    ["Cyrillic а", "а" + GOOD.slice(1)],
    ["combining mark", GOOD.slice(0, 63) + "a\u0301"],
    ["zero-width space", GOOD.slice(0, 63) + "\u200b"],
    ["emoji", "😀" + GOOD.slice(2)],
    ["0x prefix", "0x" + GOOD.slice(2)],
    ["empty", ""],
    ["number", 1234],
    ["bigint", 10n],
    ["NaN", NaN],
    ["true", true],
    ["undefined", undefined],
    ["null", null],
    ["String object", new String(GOOD)],
    ["object with toString", { toString: () => GOOD }],
    ["array", [GOOD]],
    ["Buffer", Buffer.from(GOOD)],
    ["symbol", Symbol(GOOD)]
  ])("rejects %s", (_n, v) => {
    expect(capture.isCaptureSha(v)).toBe(false);
    expect(() => capture.assertCaptureSha(v)).toThrow("无效的截图标识");
    expect(() => capture.capturePath("/ws", v)).toThrow("无效的截图标识");
    expect(() => capture.readCapture("/ws", v)).toThrow("无效的截图标识");
  });

  it("the regex has no global/sticky state (repeated calls agree)", () => {
    for (let i = 0; i < 5; i++) expect(capture.isCaptureSha(GOOD)).toBe(true);
  });
});

describe("capturePath / readCapture stay inside the workspace", () => {
  let root: string;
  beforeAll(() => {
    root = tmp("point-cap-x-");
  });

  it("capturePath is always <root>/.point/captures/<sha>.png", () => {
    expect(capture.capturePath(root, GOOD)).toBe(join(capDir(root), `${GOOD}.png`));
  });

  it("missing file → clear error", () => {
    expect(() => capture.readCapture(root, "f".repeat(64))).toThrow("截图不存在或已被删除");
  });

  it("a directory named <sha>.png is an error, not a crash or a read of something else", () => {
    mkdirSync(join(capDir(root), `${"d".repeat(64)}.png`), { recursive: true });
    expect(() => capture.readCapture(root, "d".repeat(64))).toThrow();
  });

  it("writeCapture onto a directory named <sha>.png fails instead of writing elsewhere", () => {
    const sha = shaOf(Buffer.from("dir-collision"));
    mkdirSync(join(capDir(root), `${sha}.png`), { recursive: true });
    // existsSync is true → treated as already stored; the sha comes back but nothing is written outside
    expect(capture.writeCapture(root, Buffer.from("dir-collision"))).toBe(sha);
    expect(readdirSync(root)).toEqual([".point"]);
  });

  // Was a bug (fixed in #36): readCapture followed a symlink placed in .point/captures (capture.ts readCapture → existsSync/readFileSync),
  // so any file on disk can be read and sent to the LLM as "the screenshot". It should refuse non-regular files
  // or files whose real path is outside <root>/.point/captures.
  it.runIf(canSymlink)("a capture that is a symlink pointing outside the workspace is refused", () => {
    const outside = join(tmp("point-secret-"), "secret.txt");
    writeFileSync(outside, "TOP SECRET");
    mkdirSync(capDir(root), { recursive: true });
    symlinkSync(outside, join(capDir(root), `${"e".repeat(64)}.png`));
    expect(() => capture.readCapture(root, "e".repeat(64))).toThrow();
  });

  // Was a bug (fixed in #36): same root cause for writes — if .point/captures is a symlink to another folder, writeCapture
  // (capture.ts writeCapture → mkdirSync/writeFileSync/renameSync) writes the PNG outside the workspace.
  it.runIf(canSymlink)("a .point/captures symlinked outside the workspace is not written through", () => {
    const r2 = tmp("point-cap-ln-");
    const elsewhere = tmp("point-elsewhere-");
    mkdirSync(join(r2, ".point"), { recursive: true });
    symlinkSync(elsewhere, capDir(r2), "dir");
    let threw = false;
    try {
      capture.writeCapture(r2, PNG);
    } catch {
      threw = true;
    }
    expect(threw || readdirSync(elsewhere).length === 0).toBe(true);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("capture:region with no workspace open is refused before capturing", async () => {
    ws.closeWorkspace();
    const s = Object.assign(new FakeSender(), { capturePage: vi.fn() });
    await expect(invoke(IPC.captureRegion, s as unknown as FakeSender, { x: 0, y: 0, width: 10, height: 10 })).rejects.toThrow();
    expect(s.capturePage).not.toHaveBeenCalled();
  });

  it("tasks:run with an image and no workspace open is refused", async () => {
    ws.closeWorkspace();
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: GOOD })).rejects.toThrow();
  });
});

describe("writeCapture is atomic (temp + rename)", () => {
  it("leaves only <sha>.png behind (no .tmp files)", () => {
    const root = tmp("point-cap-atomic-");
    const sha = capture.writeCapture(root, PNG);
    expect(readdirSync(capDir(root))).toEqual([`${sha}.png`]);
    expect(capture.readCapture(root, sha).equals(PNG)).toBe(true);
  });

  it("a second write of the same bytes is a no-op and leaves exactly one file", () => {
    const root = tmp("point-cap-idem-");
    const a = capture.writeCapture(root, PNG);
    const b = capture.writeCapture(root, Buffer.from(PNG));
    expect(a).toBe(b);
    expect(readdirSync(capDir(root))).toEqual([`${a}.png`]);
  });

  it("a stale .tmp from a crashed write does not block or corrupt the next write", () => {
    const root = tmp("point-cap-stale-");
    const sha = shaOf(PNG);
    mkdirSync(capDir(root), { recursive: true });
    writeFileSync(join(capDir(root), `${sha}.png.${process.pid}.tmp`), "half");
    expect(capture.writeCapture(root, PNG)).toBe(sha);
    expect(capture.readCapture(root, sha).equals(PNG)).toBe(true);
  });

  it("different bytes → different files", () => {
    const root = tmp("point-cap-diff-");
    const a = capture.writeCapture(root, PNG);
    const b = capture.writeCapture(root, Buffer.concat([PNG, Buffer.from([0])]));
    expect(a).not.toBe(b);
    expect(readdirSync(capDir(root)).sort()).toEqual([`${a}.png`, `${b}.png`].sort());
  });
});

describe("toCaptureRect bounds", () => {
  it.each([
    [{ x: 0, y: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }],
    [{ x: 0, y: 0, width: 10_000, height: 10_000 }, { x: 0, y: 0, width: 10_000, height: 10_000 }],
    [{ x: 0, y: 0, width: 3.5, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }],
    [{ x: -0.4, y: 0, width: 4, height: 4 }, { x: -0, y: 0, width: 4, height: 4 }],
    [{ x: 0, y: 0, width: 10_000.4, height: 4 }, { x: 0, y: 0, width: 10_000, height: 4 }],
    [{ x: 1, y: 2, width: 30, height: 40, extra: "ignored" }, { x: 1, y: 2, width: 30, height: 40 }]
  ])("accepts case %#", (raw, out) => {
    expect(capture.toCaptureRect(raw)).toEqual(out);
  });

  it.each([
    [{ x: 0, y: 0, width: 3, height: 4 }], [{ x: 0, y: 0, width: 4, height: 3 }], [{ x: 0, y: 0, width: 3.49, height: 4 }],
    [{ x: 0, y: 0, width: 10_001, height: 4 }], [{ x: 0, y: 0, width: 10_000.5, height: 4 }], [{ x: 0, y: 0, width: 4, height: 10_001 }],
    [{ x: -1, y: 0, width: 4, height: 4 }], [{ x: 0, y: -0.6, width: 4, height: 4 }], [{ x: 0, y: 0, width: -10, height: 4 }],
    [{ x: Infinity, y: 0, width: 4, height: 4 }], [{ x: 0, y: 0, width: Infinity, height: 4 }], [{ x: 0, y: 0, width: 4 }],
    [{ x: 0, y: 0, width: "10", height: 4 }], [{ x: 0, y: 0, width: 10n, height: 4 }], [{ x: true, y: 0, width: 4, height: 4 }],
    [[0, 0, 10, 10]], ["0,0,10,10"], [42], [undefined]
  ])("rejects case %#", (raw) => {
    expect(() => capture.toCaptureRect(raw)).toThrow("框选区域无效");
  });
});

describe("chat:start only forwards role + content", () => {
  afterEach(() => {
    delete process.env.POINT_FAKE_LLM;
    vi.restoreAllMocks();
  });
  async function sent(messages: unknown): Promise<ChatMessage[]> {
    process.env.POINT_FAKE_LLM = "1";
    let got: ChatMessage[] = [];
    const orig = FakeProvider.prototype.chat;
    vi.spyOn(FakeProvider.prototype, "chat").mockImplementation(function (this: InstanceType<typeof FakeProvider>, m, o) {
      got = structuredClone(m);
      return orig.call(this, m, o);
    });
    const s = new FakeSender();
    await invoke(IPC.chatStart, s, messages);
    await until(() => s.events.some((e) => ["done", "error"].includes((e.payload as { type: string }).type)));
    return got;
  }

  it("extra fields and images are dropped; only role/content survive", async () => {
    const got = await sent([
      { role: "system", content: "s", name: "x", images: [{ mime: "image/png", base64: "AAAA" }] },
      { role: "user", content: "u", images: [{ mime: "image/png", base64: "AAAA" }], tool_calls: [{}], __proto__: { polluted: 1 } },
      { role: "assistant", content: "a", image_url: "data:image/png;base64,AAAA" }
    ]);
    expect(got).toEqual([{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: "a" }]);
    for (const m of got) expect(Object.keys(m).sort()).toEqual(["content", "role"]);
  });

  it("OpenAI-style content parts (with image_url) are not passed through as parts", async () => {
    const got = await sent([{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }]);
    expect(got).toHaveLength(1);
    expect(typeof got[0]!.content).toBe("string");
    expect(got[0]!.images).toBeUndefined();
  });

  it.each([["tool"], ["function"], ["SYSTEM"], [""], [undefined], [42]])("unknown role %j becomes user", async (role) => {
    const got = await sent([{ role, content: "x" }]);
    expect(got).toEqual([{ role: "user", content: "x" }]);
  });

  it("null / non-object entries become empty user messages instead of crashing", async () => {
    const got = await sent([null, 1, "str", { role: "user", content: "ok" }]);
    expect(got.map((m) => m.role)).toEqual(["user", "user", "user", "user"]);
    expect(got.at(-1)).toEqual({ role: "user", content: "ok" });
  });

  it.each([[null], [{}], ["[]"], [undefined]])("non-array %j is rejected", async (m) => {
    await expect(invoke(IPC.chatStart, new FakeSender(), m)).rejects.toThrow("无效的消息");
  });
});

describe("capabilities.vision gate", () => {
  let root: string;
  beforeAll(() => {
    root = tmp("point-cap-vis-");
  });
  afterEach(() => {
    delete process.env.POINT_FAKE_LLM;
    delete process.env.POINT_FAKE_VISION;
  });

  it("assertVisionAllowed truth table", () => {
    expect(() => vision.assertVisionAllowed(true, true)).not.toThrow();
    expect(() => vision.assertVisionAllowed(true, false)).not.toThrow();
    expect(() => vision.assertVisionAllowed(false, false)).not.toThrow();
    let err: unknown;
    try {
      vision.assertVisionAllowed(false, true);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "no_vision", message: vision.NO_VISION_MESSAGE });
  });

  it("vision=false: the image is never read (even a missing capture gives the vision error, not 'not found')", async () => {
    process.env.POINT_FAKE_LLM = "1";
    process.env.POINT_FAKE_VISION = "0";
    ws.openWorkspace(root);
    // "c"*64 does not exist: if the file were read first this would be 截图不存在
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "ask", selection: "", question: "q", image: "c".repeat(64) })).rejects.toThrow(/当前模型不支持图片/);
  });

  it("vision=false: nothing is sent to the provider and no conversation is created", async () => {
    process.env.POINT_FAKE_LLM = "1";
    process.env.POINT_FAKE_VISION = "0";
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const chat = vi.spyOn(FakeProvider.prototype, "chat");
    const before = ((await invoke(IPC.convList, new FakeSender())) as unknown[]).length;
    await expect(invoke(IPC.tasksRun, new FakeSender(), { kind: "explain", selection: "", image: sha })).rejects.toThrow(/当前模型不支持图片/);
    expect(chat).not.toHaveBeenCalled();
    expect(((await invoke(IPC.convList, new FakeSender())) as unknown[]).length).toBe(before);
    chat.mockRestore();
  });

  it("vision=true: the image is attached only to the last user message", async () => {
    process.env.POINT_FAKE_LLM = "1";
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    let got: ChatMessage[] = [];
    const orig = FakeProvider.prototype.chat;
    const spy = vi.spyOn(FakeProvider.prototype, "chat").mockImplementation(function (this: InstanceType<typeof FakeProvider>, m, o) {
      got = structuredClone(m);
      return orig.call(this, m, o);
    });
    const s = new FakeSender();
    await invoke(IPC.tasksRun, s, { kind: "ask", selection: "", question: "q", image: sha });
    await until(() => s.events.some((e) => (e.payload as { type: string }).type === "done"));
    const withImg = got.filter((m) => m.images?.length);
    expect(withImg).toHaveLength(1);
    expect(withImg[0]).toBe(got.filter((m) => m.role === "user").at(-1));
    expect(withImg[0]!.images).toEqual([{ mime: "image/png", base64: PNG.toString("base64") }]);
    spy.mockRestore();
  });
});

describe("window:* whitelist unchanged by #36", () => {
  it("still exactly minimize / toggleMaximize / close", () => {
    expect([...WINDOW_ACTIONS].sort()).toEqual(["close", "minimize", "toggleMaximize"]);
  });
  it("capture did not add any window:* channel", () => {
    const ch = Object.values(IPC).filter((c) => c.startsWith("window:"));
    expect(ch.sort()).toEqual(["window:action", "window:maximized"]);
  });
});
