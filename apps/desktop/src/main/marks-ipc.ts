import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { MARK_LIMITS, MarkStore, buildBatchMessage, type LoadedMark, type Mark } from "@point/core";
import { IPC } from "../shared/ipc.js";
import { captureImage, readCapture } from "./capture.js";
import { need } from "./workspace.js";

export const marks = () => new MarkStore(need().db, randomUUID);

const ID = /^[0-9a-f-]{36}$/;
export function assertId(v: unknown, what = "标记"): string {
  if (typeof v !== "string" || !ID.test(v)) throw new Error(`无效的${what} id`);
  return v;
}

export function createMark(docId: unknown, anchor: unknown, note?: unknown): Mark {
  const ws = need();
  const doc = assertId(docId, "文档");
  const m = marks();
  // Validate before touching the disk; a region mark must point at a capture that really exists.
  const parsed = (anchor ?? {}) as { kind?: unknown; sha?: unknown };
  if (parsed.kind === "region") readCapture(ws.root, parsed.sha);
  return m.create(doc, anchor, note);
}

/**
 * Loads the marks picked for 「一起问」 in the given order. Every id must exist and belong to `docId`;
 * region images are read by main from the validated sha.
 */
export function loadBatch(ids: unknown, docId: string | undefined): { loaded: LoadedMark[]; marks: Mark[]; hasImage: boolean } {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("请先勾选标记");
  if (ids.length > MARK_LIMITS.batch) throw new Error(`一次最多一起问 ${MARK_LIMITS.batch} 个标记`);
  const unique = [...new Set(ids.map((v) => assertId(v)))];
  const store = marks();
  const root = need().root;
  const list = unique.map((id) => {
    const m = store.get(id);
    if (!m || (docId && m.docId !== docId)) throw new Error("标记不存在");
    return m;
  });
  return {
    marks: list,
    hasImage: list.some((m) => m.anchor.kind === "region"),
    loaded: list.map((m) => (m.anchor.kind === "region" ? { anchor: m.anchor, image: captureImage(root, m.anchor.sha) } : { anchor: m.anchor }))
  };
}

export { buildBatchMessage };

export function registerMarksIpc(): void {
  ipcMain.handle(IPC.marksList, (_e, docId: unknown) => marks().list(assertId(docId, "文档")));
  ipcMain.handle(IPC.marksCreate, (_e, docId: unknown, anchor: unknown, note?: unknown) => createMark(docId, anchor, note));
  ipcMain.handle(IPC.marksUpdateNote, (_e, id: unknown, note: unknown) => marks().updateNote(assertId(id), note));
  ipcMain.handle(IPC.marksRemove, (_e, id: unknown) => marks().remove(assertId(id)));
}
