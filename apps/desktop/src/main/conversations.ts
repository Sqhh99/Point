import { randomUUID } from "node:crypto";
import type { ChatMessage, TaskKind } from "@point/core";
import type { ConversationMeta, MessageMeta, StoredMessage } from "../shared/ipc.js";
import { need } from "./workspace.js";

type ConvRow = { id: string; title: string; doc_id: string | null; created_at: string; updated_at: string };
type MsgRow = { id: string; conversation_id: string; role: "user" | "assistant"; content: string; kind: TaskKind | null; meta: string | null; created_at: string };

const conv = (r: ConvRow): ConversationMeta => ({ id: r.id, title: r.title, docId: r.doc_id ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at });
function parseMeta(raw: string | null): MessageMeta | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as MessageMeta;
  } catch {
    return undefined;
  }
}

const msg = (r: MsgRow): StoredMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  kind: r.kind ?? undefined,
  meta: parseMeta(r.meta),
  createdAt: r.created_at
});

export function listConversations(): ConversationMeta[] {
  return (need().db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as ConvRow[]).map(conv);
}

export function createConversation(title: string, docId?: string): ConversationMeta {
  const now = new Date().toISOString();
  const row: ConvRow = { id: randomUUID(), title: title.slice(0, 80) || "新对话", doc_id: docId ?? null, created_at: now, updated_at: now };
  need().db.prepare("INSERT INTO conversations VALUES (@id, @title, @doc_id, @created_at, @updated_at)").run(row);
  return conv(row);
}

export function hasConversation(id: string): boolean {
  return !!need().db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(id);
}

export function getMessages(conversationId: string): StoredMessage[] {
  return (need().db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conversationId) as MsgRow[]).map(msg);
}

export function historyFor(conversationId: string, dropTrailingTurn = false): ChatMessage[] {
  const all = getMessages(conversationId);
  if (dropTrailingTurn) {
    // Regenerating: drop the last assistant answer(s) and the user turn being re-asked.
    while (all.at(-1)?.role === "assistant") all.pop();
    all.pop();
  }
  return all.map((m) => ({ role: m.role, content: m.content }));
}

export function addMessage(conversationId: string, role: "user" | "assistant", content: string, kind?: TaskKind, meta?: MessageMeta): StoredMessage {
  const now = new Date().toISOString();
  const row: MsgRow = { id: randomUUID(), conversation_id: conversationId, role, content, kind: kind ?? null, meta: meta ? JSON.stringify(meta) : null, created_at: now };
  const db = need().db;
  db.transaction(() => {
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, kind, meta, created_at) VALUES (@id, @conversation_id, @role, @content, @kind, @meta, @created_at)").run(row);
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  })();
  return msg(row);
}

export function deleteConversation(id: string): void {
  need().db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

/** Deletes the answer(s) after the last user turn, so 重新生成 / 重试 replaces rather than appends. */
export function dropTrailingAssistant(conversationId: string): void {
  const all = getMessages(conversationId);
  const stmt = need().db.prepare("DELETE FROM messages WHERE id = ?");
  for (let m = all.pop(); m?.role === "assistant"; m = all.pop()) stmt.run(m.id);
}
