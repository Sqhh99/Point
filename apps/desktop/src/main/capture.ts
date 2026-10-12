import { ipcMain, protocol, type WebContents } from "electron";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageInput } from "@point/core";
import { IPC, type CaptureRect, type CaptureResult } from "../shared/ipc.js";
import { need, workspacePath } from "./workspace.js";

/** Captures are stored by content hash; the renderer only ever names one by this sha. */
const SHA = /^[0-9a-f]{64}$/;

/** True only for a 64-char lowercase hex sha256. Rejects uppercase, `../`, separators, other lengths and non-strings. */
export function isCaptureSha(v: unknown): v is string {
  return typeof v === "string" && SHA.test(v);
}

export function assertCaptureSha(v: unknown): string {
  if (!isCaptureSha(v)) throw new Error("无效的截图标识");
  return v;
}

/** The only way a capture path is built: `<root>/.point/captures/<sha>.png`, sha validated first. */
export function capturePath(root: string, sha: unknown): string {
  return join(root, ".point", "captures", `${assertCaptureSha(sha)}.png`);
}

const MAX_SIDE = 10_000;

/** Validates a renderer-supplied rectangle (CSS px of the window) and rounds it to whole pixels. */
export function toCaptureRect(raw: unknown): CaptureRect {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const x = Math.round(num(r.x));
  const y = Math.round(num(r.y));
  const width = Math.round(num(r.width));
  const height = Math.round(num(r.height));
  if ([x, y, width, height].some(Number.isNaN) || x < 0 || y < 0 || width < 4 || height < 4 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error("框选区域无效");
  }
  return { x, y, width, height };
}

/** Stores PNG bytes under their sha256 (idempotent) and returns the sha. */
export function writeCapture(root: string, png: Buffer): string {
  if (png.byteLength === 0) throw new Error("截图为空");
  const sha = createHash("sha256").update(png).digest("hex");
  const file = capturePath(root, sha);
  if (!existsSync(file)) {
    mkdirSync(join(root, ".point", "captures"), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, png);
    renameSync(tmp, file);
  }
  return sha;
}

export function readCapture(root: string, sha: unknown): Buffer {
  const file = capturePath(root, sha);
  if (!existsSync(file)) throw new Error("截图不存在或已被删除");
  return readFileSync(file);
}

/** Base64 image for an LLM request; built in main only. */
export function captureImage(root: string, sha: unknown): ImageInput {
  return { mime: "image/png", base64: readCapture(root, sha).toString("base64") };
}

export function registerCaptureIpc(): void {
  ipcMain.handle(IPC.captureRegion, async (e, raw: unknown): Promise<CaptureResult> => {
    const ws = need();
    const rect = toCaptureRect(raw);
    const img = await e.sender.capturePage(rect);
    const size = img.getSize();
    const sha = writeCapture(ws.root, img.toPNG());
    return { sha, width: size.width, height: size.height };
  });
}

/** Read-only thumbnails: `point-capture://<sha>` serves `<workspace>/.point/captures/<sha>.png`. */
export const CAPTURE_SCHEME = "point-capture";

/** Must run before app `ready`. Only standard + secure: no fetch, CORS or CSP bypass. */
export function registerCaptureScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: CAPTURE_SCHEME, privileges: { standard: true, secure: true } }]);
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });

/** Captures are content-addressed, so a URL never changes meaning. */
export const CAPTURE_HEADERS = { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } as const;

/**
 * Resolves `point-capture://<sha>` against a workspace root. The sha is the URL hostname, validated by
 * assertCaptureSha; the raw URL must also be exactly the canonical `point-capture://<sha>/`,
 * because the standard-scheme parser lowercases hosts and decodes some escapes. Any path, query,
 * hash, bad sha, missing file, symlink, directory or missing workspace is a 404.
 */
export function captureResponse(root: string | null, rawUrl: string): Response {
  if (!root) return notFound();
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return notFound();
  }
  if (u.protocol !== `${CAPTURE_SCHEME}:`) return notFound();
  // Standard scheme: Chromium hands us `point-capture://<sha>/`, so the path is exactly "/".
  if (u.pathname !== "/" || u.search !== "" || u.hash !== "" || u.username || u.password || u.port) return notFound();
  let sha: string;
  try {
    sha = assertCaptureSha(u.hostname);
  } catch {
    return notFound();
  }
  if (rawUrl !== `${CAPTURE_SCHEME}://${sha}/`) return notFound();
  try {
    const file = capturePath(root, sha);
    if (!lstatSync(file).isFile()) return notFound(); // lstat: a symlink is not a file
    return new Response(readFileSync(file), { status: 200, headers: CAPTURE_HEADERS });
  } catch {
    return notFound();
  }
}

/**
 * Which workspace a webContents may read captures from. Today there is one global workspace, bound
 * to every window registered via bindCaptureProtocol; unbound or destroyed webContents get null.
 */
const bound = new Set<WebContents>();
export function workspaceForWebContents(wc: WebContents | null | undefined): string | null {
  if (!wc || wc.isDestroyed() || !bound.has(wc)) return null;
  return workspacePath();
}

/** After app `ready`: serve captures on the window's own session, scoped to that window's workspace. */
export function bindCaptureProtocol(wc: WebContents): void {
  bound.add(wc);
  wc.once("destroyed", () => bound.delete(wc));
  const ses = wc.session;
  if (ses.protocol.isProtocolHandled(CAPTURE_SCHEME)) return;
  ses.protocol.handle(CAPTURE_SCHEME, (req) => {
    // The request carries no webContents; resolve via the live window bound to this session.
    const owner = [...bound].find((w) => !w.isDestroyed() && w.session === ses);
    return req.method === "GET" ? captureResponse(workspaceForWebContents(owner), req.url) : notFound();
  });
}
