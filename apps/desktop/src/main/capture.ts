import { ipcMain } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
