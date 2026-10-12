import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());
const capture = await import("../../src/main/capture.js");
const ws = await import("../../src/main/workspace.js");

const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), "point-proto-x-")));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const url = (sha: string) => `point-capture://${sha}/`;
const canSymlink = (() => {
  try {
    const d = tmp();
    symlinkSync(join(d, "x"), join(d, "y"));
    return true;
  } catch {
    return false; // Windows without symlink privilege
  }
})();

function setup() {
  const root = tmp();
  const sha = capture.writeCapture(root, PNG);
  return { root, sha, dir: join(root, ".point", "captures") };
}

describe("point-capture:// 200 response", () => {
  it("exact bytes, image/png, immutable cache, nothing else leaks", async () => {
    const { root, sha } = setup();
    const r = capture.captureResponse(root, url(sha));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Cache-Control")).toMatch(/\bimmutable\b/);
    expect(r.headers.get("Cache-Control")).toMatch(/\bprivate\b/);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(Buffer.from(await r.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("404 bodies never contain the workspace path or the sha file path", async () => {
    const { root } = setup();
    const r = capture.captureResponse(root, url("b".repeat(64)));
    expect(r.status).toBe(404);
    const body = await r.text();
    expect(body).not.toContain(root);
    expect(body).not.toContain(".point");
  });
});

describe("point-capture:// 404 cases", () => {
  const S = "0123456789abcdef".repeat(4);
  it.each([
    ["uppercase host", `point-capture://${S.toUpperCase()}/`],
    ["mixed-case host", `point-capture://${S.slice(0, 63)}F/`],
    ["uppercase scheme", `POINT-CAPTURE://${S}/`],
    ["no trailing slash (non-canonical)", `point-capture://${S}`],
    ["percent-encoded host char", `point-capture://%30${S.slice(1)}/`],
    ["encoded slash in path", `point-capture://${S}/%2F`],
    ["encoded backslash", `point-capture://${S}/%5C..%5Cindex.db`],
    ["encoded dot-dot", `point-capture://${S}/%2e%2e/`],
    ["dot-dot in path", `point-capture://${S}/../${S}/`],
    ["backslash path", `point-capture://${S}\\..\\x`],
    ["search", `point-capture://${S}/?v=1`],
    ["hash", `point-capture://${S}/#a`],
    ["port", `point-capture://${S}:443/`],
    ["userinfo", `point-capture://user:pw@${S}/`],
    ["username only", `point-capture://u@${S}/`],
    ["trailing dot host", `point-capture://${S}./`],
    ["IPv4-like host", `point-capture://127.0.0.1/`],
    ["localhost", `point-capture://localhost/`],
    ["opaque form", `point-capture:${S}`],
    ["triple slash", `point-capture:///${S}`],
    ["whitespace around", ` point-capture://${S}/ `],
    ["tab inside", `point-capture://${S.slice(0, 10)}\t${S.slice(10)}/`],
    ["NUL encoded", `point-capture://${S}/%00`],
    ["not a URL", "::::"],
    ["empty string", ""],
    ["http with sha host", `http://${S}/`],
    ["file scheme", `file:///${S}.png`]
  ])("%s", (_n, u) => {
    const root = tmp();
    capture.writeCapture(root, PNG); // something servable exists
    const r = capture.captureResponse(root, u);
    expect(r.status).toBe(404);
    expect(r.headers.get("Content-Type")).not.toBe("image/png");
  });

  it("missing file / missing captures dir / directory named <sha>.png", () => {
    const root = tmp();
    expect(capture.captureResponse(root, url("e".repeat(64))).status).toBe(404);
    mkdirSync(join(root, ".point", "captures", `${"d".repeat(64)}.png`), { recursive: true });
    expect(capture.captureResponse(root, url("d".repeat(64))).status).toBe(404);
  });

  it("no workspace (null / empty string)", () => {
    const { sha } = setup();
    expect(capture.captureResponse(null, url(sha)).status).toBe(404);
    expect(capture.captureResponse("", url(sha)).status).toBe(404);
  });

  it.runIf(canSymlink)("symlinked capture file → 404 (any platform that can symlink)", () => {
    const { root, dir } = setup();
    const outside = join(tmp(), "o.png");
    writeFileSync(outside, PNG);
    symlinkSync(outside, join(dir, `${"c".repeat(64)}.png`));
    expect(capture.captureResponse(root, url("c".repeat(64))).status).toBe(404);
  });

  // Bug: only the final file is lstat'ed (capture.ts captureResponse → lstatSync(file)). If `.point/captures`
  // (or `.point`) is itself a symlink to another folder, a regular file there is served.
  it.runIf(canSymlink).fails("captures directory symlinked outside the workspace → 404", () => {
    const root = tmp();
    const elsewhere = tmp();
    const sha = capture.writeCapture(elsewhere, PNG); // real file at elsewhere/.point/captures/<sha>.png
    mkdirSync(join(root, ".point"), { recursive: true });
    symlinkSync(join(elsewhere, ".point", "captures"), join(root, ".point", "captures"), "dir");
    expect(capture.captureResponse(root, url(sha)).status).toBe(404);
  });
});

describe("protocol handler: methods and per-webContents workspace", () => {
  afterEach(() => ws.closeWorkspace());

  function fakeSession() {
    const handlers = new Map<string, (r: Request) => Response>();
    return { handlers, protocol: { isProtocolHandled: (s: string) => handlers.has(s), handle: vi.fn((s: string, fn: (r: Request) => Response) => void handlers.set(s, fn)) } };
  }
  function fakeWc(session: ReturnType<typeof fakeSession>) {
    let destroyed = false;
    const listeners: (() => void)[] = [];
    return {
      session,
      isDestroyed: () => destroyed,
      once: (_e: string, fn: () => void) => void listeners.push(fn),
      destroy: () => {
        destroyed = true;
        listeners.forEach((f) => f());
      }
    };
  }

  it.each([["HEAD"], ["POST"], ["PUT"], ["DELETE"], ["OPTIONS"], ["PATCH"]])("%s → 404", (method) => {
    const root = tmp();
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const ses = fakeSession();
    const wc = fakeWc(ses);
    capture.bindCaptureProtocol(wc as never);
    const h = ses.handlers.get("point-capture")!;
    const init: RequestInit = { method };
    if (method !== "HEAD" && method !== "OPTIONS") init.body = "x";
    expect(h(new Request(url(sha), init)).status).toBe(404);
    expect(h(new Request(url(sha))).status).toBe(200);
    wc.destroy();
  });

  // Chromium lowercases standard-scheme hosts before the handler sees them, so this is only reachable
  // in a unit test; it guards the handler itself against an uppercase sha.
  it("handler: uppercase sha in a constructed Request → 404", () => {
    const root = tmp();
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const ses = fakeSession();
    const wc = fakeWc(ses);
    capture.bindCaptureProtocol(wc as never);
    const h = ses.handlers.get("point-capture")!;
    const req = new Request(url(sha.toUpperCase()));
    expect(req.url).toBe(url(sha.toUpperCase()));
    expect(h(req).status).toBe(404);
    expect(h(new Request(url(sha))).status).toBe(200);
    wc.destroy();
  });

  it("binding two windows on one session registers the handler once", () => {
    const ses = fakeSession();
    const a = fakeWc(ses);
    const b = fakeWc(ses);
    capture.bindCaptureProtocol(a as never);
    capture.bindCaptureProtocol(b as never);
    expect(ses.protocol.handle).toHaveBeenCalledTimes(1);
    a.destroy();
    b.destroy();
  });

  it("closing the workspace stops serving immediately", () => {
    const root = tmp();
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const ses = fakeSession();
    const wc = fakeWc(ses);
    capture.bindCaptureProtocol(wc as never);
    const h = ses.handlers.get("point-capture")!;
    expect(h(new Request(url(sha))).status).toBe(200);
    ws.closeWorkspace();
    expect(h(new Request(url(sha))).status).toBe(404);
    wc.destroy();
  });

  it("switching workspace serves only the new workspace's captures", () => {
    const a = tmp();
    const b = tmp();
    const shaA = capture.writeCapture(a, PNG);
    const shaB = capture.writeCapture(b, Buffer.concat([PNG, Buffer.from([1])]));
    ws.openWorkspace(a);
    const ses = fakeSession();
    const wc = fakeWc(ses);
    capture.bindCaptureProtocol(wc as never);
    const h = ses.handlers.get("point-capture")!;
    expect(h(new Request(url(shaA))).status).toBe(200);
    ws.openWorkspace(b);
    expect(h(new Request(url(shaA))).status).toBe(404);
    expect(h(new Request(url(shaB))).status).toBe(200);
    wc.destroy();
  });

  it("window B on its own session: unbound → 404 even while window A is bound", () => {
    const root = tmp();
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const sesA = fakeSession();
    const sesB = fakeSession();
    const a = fakeWc(sesA);
    capture.bindCaptureProtocol(a as never);
    expect(sesA.handlers.get("point-capture")!(new Request(url(sha))).status).toBe(200);
    // B never bound: its session has no handler, and workspaceForWebContents(B) is null
    expect(sesB.handlers.has("point-capture")).toBe(false);
    expect(capture.workspaceForWebContents(fakeWc(sesB) as never)).toBeNull();
    a.destroy();
  });

  it("after window A is destroyed, window B on the same session still works; after both, 404", () => {
    const root = tmp();
    ws.openWorkspace(root);
    const sha = capture.writeCapture(root, PNG);
    const ses = fakeSession();
    const a = fakeWc(ses);
    const b = fakeWc(ses);
    capture.bindCaptureProtocol(a as never);
    capture.bindCaptureProtocol(b as never);
    const h = ses.handlers.get("point-capture")!;
    a.destroy();
    expect(h(new Request(url(sha))).status).toBe(200);
    b.destroy();
    expect(h(new Request(url(sha))).status).toBe(404);
  });

  it.each([[null], [undefined]])("workspaceForWebContents(%s) is null", (wc) => {
    expect(capture.workspaceForWebContents(wc)).toBeNull();
  });
});

describe("CSP (renderer index.html)", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "..", "src", "renderer", "index.html"), "utf8");
  const metas = html.match(/http-equiv="Content-Security-Policy"/g) ?? [];
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!;
  const dirs = new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0]!, d.split(/\s+/).slice(1)] as const));

  it("exactly one CSP meta tag", () => expect(metas).toHaveLength(1));
  it("img-src includes point-capture: and 'self' only", () => {
    expect(dirs.get("img-src")).toEqual(["'self'", "point-capture:"]);
  });
  it.each([["data:"], ["file:"], ["blob:"], ["*"], ["http:"], ["https:"], ["'unsafe-eval'"]])("no %s in any directive", (src) => {
    for (const [, vals] of dirs) expect(vals).not.toContain(src);
  });
  it("point-capture: is allowed only for images (fetch/connect/frames fall back to default-src 'self')", () => {
    for (const [name, vals] of dirs) if (name !== "img-src") expect(vals).not.toContain("point-capture:");
    expect(dirs.get("default-src")).toEqual(["'self'"]);
    expect(dirs.has("connect-src")).toBe(false);
  });
  it("scheme privileges grant no CORS/fetch/CSP bypass", async () => {
    const { protocol } = await import("electron");
    capture.registerCaptureScheme();
    const [[arg]] = vi.mocked(protocol.registerSchemesAsPrivileged).mock.calls.slice(-1) as unknown as [[{ privileges: Record<string, boolean> }[]]];
    const p = arg[0]!.privileges;
    for (const k of ["bypassCSP", "supportFetchAPI", "corsEnabled", "allowServiceWorkers", "stream"]) expect(p[k]).toBeFalsy();
  });
});
