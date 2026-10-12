import { ipcMain } from "electron";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { ImageInput } from "@point/core";
import { IPC, type CaptureRect, type CaptureResult } from "../shared/ipc.js";
import { need } from "./workspace.js";

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

/**
 * Real path of `<root>/.point/captures`, refused when it leaves the workspace (e.g. the folder is a
 * symlink to somewhere else). Used by both read and write.
 */
function capturesDir(root: string, create: boolean): string {
  const dir = join(root, ".point", "captures");
  if (create) mkdirSync(dir, { recursive: true });
  const realRoot = fs.realpathSync.native(root);
  const realDir = fs.realpathSync.native(dir);
  const rel = relative(realRoot, realDir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("截图目录不在工作区内");
  return realDir;
}

const lstatOrNull = (p: string) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

/**
 * Stores PNG bytes under their sha256 (idempotent) and returns the sha. The temp file is created with
 * `wx` (never opens an existing path or link) under a random name inside the verified captures dir,
 * then renamed onto `<sha>.png`; rename replaces a symlink itself instead of writing through it.
 */
export function writeCapture(root: string, png: Buffer): string {
  if (png.byteLength === 0) throw new Error("截图为空");
  const sha = createHash("sha256").update(png).digest("hex");
  const dir = capturesDir(root, true);
  const file = join(dir, `${assertCaptureSha(sha)}.png`);
  const existing = lstatOrNull(file);
  if (existing && !existing.isSymbolicLink()) return sha; // already stored (a dir here is left alone, nothing written)
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, png, { flag: "wx" });
  try {
    renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return sha;
}

type FsDeps = Pick<typeof fs, "lstatSync" | "openSync" | "fstatSync" | "readFileSync" | "closeSync">;
const NOFOLLOW = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);

/**
 * Reads a regular file without following symlinks: lstat must say regular file, the open uses
 * O_NOFOLLOW (POSIX), and the opened fd must be the same inode (dev+ino) as the lstat — so a swap
 * between check and open is refused. `deps` exists only so tests can simulate that swap.
 */
export function readRegularFile(file: string, deps: FsDeps = fs): Buffer {
  const st = deps.lstatSync(file);
  if (!st.isFile()) throw new Error("不是普通文件");
  const fd = deps.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    const fst = deps.fstatSync(fd);
    if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev) throw new Error("文件在读取时被替换");
    return deps.readFileSync(fd);
  } finally {
    deps.closeSync(fd);
  }
}

/** Every refusal (bad sha, outside dir, symlink, dir, swapped, missing) looks like a missing capture. */
export function readCapture(root: string, sha: unknown): Buffer {
  assertCaptureSha(sha);
  try {
    // Any lstat/open/fstat failure (ENOENT, EISDIR, ELOOP, ENOTDIR, swapped inode, dir outside) = missing.
    return readRegularFile(join(capturesDir(root, false), `${sha as string}.png`));
  } catch {
    throw new Error("截图不存在或已被删除");
  }
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
