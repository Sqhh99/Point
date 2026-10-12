import { BrowserWindow, dialog } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatConversationMarkdown, formatExportedNote, noteFileName, zipExportedNotes, type ConversationExportMessage } from "@point/core";
import { getMessages } from "./conversations.js";
import { need } from "./workspace.js";

export type ExportResult = { ok: true; path: string } | { ok: false; canceled: true } | { ok: false; canceled?: false; message: string };

function winOf(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender);
}

function sourceOf(sourceDocId?: string): string | undefined {
  if (!sourceDocId) return undefined;
  const row = need().db.prepare("SELECT title FROM docs WHERE id = ?").get(sourceDocId) as { title: string } | undefined;
  return row ? `《${row.title}》` : undefined;
}

async function saveDialog(sender: Electron.WebContents, opts: Electron.SaveDialogOptions): Promise<string | null> {
  const win = winOf(sender);
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  return r.canceled || !r.filePath ? null : r.filePath;
}

export async function exportNote(sender: Electron.WebContents, noteId: string): Promise<ExportResult> {
  try {
    const note = need().notes.read(noteId);
    const path = await saveDialog(sender, {
      title: "另存为笔记",
      defaultPath: noteFileName(note.title, note.id),
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (!path) return { ok: false, canceled: true };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, formatExportedNote(note, { source: sourceOf(note.sourceDocId) }), "utf8");
    return { ok: true, path };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function exportAllNotes(sender: Electron.WebContents): Promise<ExportResult> {
  try {
    const ws = need();
    const notes = ws.notes.list().map((m) => ws.notes.read(m.id));
    if (notes.length === 0) return { ok: false, message: "工作区里还没有笔记" };
    const path = await saveDialog(sender, {
      title: "打包导出笔记",
      defaultPath: "point-notes.zip",
      filters: [{ name: "ZIP", extensions: ["zip"] }]
    });
    if (!path) return { ok: false, canceled: true };
    const exportedAt = new Date().toISOString();
    const buf = await zipExportedNotes(
      notes.map((n) => ({
        fileName: noteFileName(n.title, n.id),
        markdown: formatExportedNote(n, { source: sourceOf(n.sourceDocId), exportedAt })
      }))
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function exportConversation(sender: Electron.WebContents, conversationId: string): Promise<ExportResult> {
  try {
    const ws = need();
    const conv = ws.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as
      | { id: string; title: string }
      | undefined;
    if (!conv) throw new Error("对话不存在");
    const turns: ConversationExportMessage[] = getMessages(conversationId).map((m) => ({
      role: m.role,
      content: m.content,
      quote: m.meta?.request.selection,
      source: m.meta?.docTitle ? `《${m.meta.docTitle}》` : undefined
    }));
    const path = await saveDialog(sender, {
      title: "导出对话",
      defaultPath: noteFileName(conv.title, conv.id),
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (!path) return { ok: false, canceled: true };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, formatConversationMarkdown(conv.title, turns), "utf8");
    return { ok: true, path };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
