import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());
const capture = await import("../../src/main/capture.js");

const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), "point-proto-")));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const raw = (s: string) => `point-capture://${s}`;
/** Canonical form Chromium passes for a standard scheme: path "/". */
const url = (sha: string) => raw(sha) + "/";

function setup() {
  const root = tmp();
  const sha = capture.writeCapture(root, PNG);
  return { root, sha, dir: join(root, ".point", "captures") };
}

describe("point-capture:// handler", () => {
  it("serves a capture as image/png", async () => {
    const { root, sha } = setup();
    const r = capture.captureResponse(root, url(sha));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(PNG);
    expect(new URL(url(sha)).pathname).toBe("/");
  });

  it.each([
    ["uppercase", "A".repeat(64)],
    ["short", "a".repeat(63)],
    ["traversal", "../index.db"],
    ["encoded traversal", "%2e%2e%2findex.db"],
    ["nested", "a".repeat(64) + "/../x"],
    ["query", "a".repeat(64) + "?x=1"],
    ["empty (listing)", ""],
    ["slash only", "/"],
    ["path", "a".repeat(64) + "/x.png"],
    ["encoded slash", "a".repeat(64) + "%2Findex.db"],
    ["dotdot path", "a".repeat(64) + "/.."],
    ["hash", "a".repeat(64) + "#x"],
    ["empty query", "a".repeat(64) + "?"],
    ["port", "a".repeat(64) + ":80"],
    ["userinfo", "u@" + "a".repeat(64)],
    ["png suffix", "a".repeat(64) + ".png"],
    ["query after slash", "a".repeat(64) + "/?x"],
    ["hash after slash", "a".repeat(64) + "/#x"],
    ["double slash path", "a".repeat(64) + "//"]
  ])("404 for %s", (_n, s) => {
    const { root } = setup();
    const r = capture.captureResponse(root, raw(s));
    expect(r.status).toBe(404);
    expect(r.headers.get("Content-Type")).not.toBe("image/png");
  });

  it("404 for a missing file", () => {
    const { root } = setup();
    expect(capture.captureResponse(root, url("b".repeat(64))).status).toBe(404);
  });

  it("404 for another scheme", () => {
    const { root, sha } = setup();
    expect(capture.captureResponse(root, `file://${sha}`).status).toBe(404);
  });

  it("404 when no workspace is open", () => {
    const { sha } = setup();
    expect(capture.captureResponse(null, url(sha)).status).toBe(404);
  });

  it("only the current workspace's captures", () => {
    const a = setup();
    const b = tmp();
    expect(capture.captureResponse(b, url(a.sha)).status).toBe(404);
  });

  it.skipIf(process.platform === "win32")("404 for a symlink, even to a real png", () => {
    const { root, sha, dir } = setup();
    const outside = join(tmp(), "secret.png");
    writeFileSync(outside, PNG);
    const link = "c".repeat(64);
    symlinkSync(outside, join(dir, `${link}.png`));
    expect(capture.captureResponse(root, url(link)).status).toBe(404);
    expect(capture.captureResponse(root, url(sha)).status).toBe(200);
  });

  it("404 for a directory named like a capture", () => {
    const { root, dir } = setup();
    const d = "d".repeat(64);
    mkdirSync(join(dir, `${d}.png`));
    expect(capture.captureResponse(root, url(d)).status).toBe(404);
  });
});

describe("scheme registration + per-webContents workspace", () => {
  it("privileges are standard + secure only", async () => {
    const { protocol } = await import("electron");
    capture.registerCaptureScheme();
    expect(vi.mocked(protocol.registerSchemesAsPrivileged)).toHaveBeenLastCalledWith([{ scheme: "point-capture", privileges: { standard: true, secure: true } }]);
  });

  function fakeWc() {
    const handlers = new Map<string, (r: Request) => Response>();
    const ses = { protocol: { isProtocolHandled: (s: string) => handlers.has(s), handle: (s: string, fn: (r: Request) => Response) => void handlers.set(s, fn) } };
    let destroyed = false;
    const listeners: (() => void)[] = [];
    const wc = { session: ses, isDestroyed: () => destroyed, once: (_e: string, fn: () => void) => listeners.push(fn), destroy: () => { destroyed = true; listeners.forEach((f) => f()); } };
    return { wc, handlers };
  }

  it("unbound or destroyed webContents resolve to no workspace", async () => {
    const ws = await import("../../src/main/workspace.js");
    const root = tmp();
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const { wc, handlers } = fakeWc();
    expect(capture.workspaceForWebContents(wc as never)).toBeNull();
    capture.bindCaptureProtocol(wc as never);
    expect(capture.workspaceForWebContents(wc as never)).toBe(root);
    const h = handlers.get("point-capture")!;
    expect(h(new Request(url(sha))).status).toBe(200);
    expect(h(new Request(url(sha), { method: "POST", body: "x" })).status).toBe(404);
    wc.destroy();
    expect(capture.workspaceForWebContents(wc as never)).toBeNull();
    expect(h(new Request(url(sha))).status).toBe(404);
    ws.closeWorkspace();
  });
});

describe("CSP", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "..", "src", "renderer", "index.html"), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1];
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " "));

  it("img-src allows only self and point-capture:", () => {
    expect(directive("img-src")).toBe("img-src 'self' point-capture:");
  });
  it("no data:, file: or blob: anywhere", () => {
    expect(csp).not.toMatch(/data:|file:|blob:|\*/);
    expect(directive("script-src")).toBe("script-src 'self'");
  });
  it("main sets no CSP header that could override the meta tag", () => {
    const src = ["index.ts", "capture.ts", "open-ipc.ts"].map((f) => readFileSync(join(import.meta.dirname, "..", "..", "src", "main", f), "utf8")).join("\n");
    expect(src).not.toMatch(/onHeadersReceived|Content-Security-Policy/);
  });
});
