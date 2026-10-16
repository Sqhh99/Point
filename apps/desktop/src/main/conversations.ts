import { randomUUID } from "node:crypto";
import { mainLeaf, pathTo, spanMatches, type BranchOrigin, type ChatMessage, type TaskKind } from "@point/core";
import type { ConversationMeta, MessageMeta, StoredMessage } from "../shared/ipc.js";
import { need } from "./workspace.js";

type ConvRow = { id: string; title: string; doc_id: string | null; created_at: string; updated_at: string; model: string | null; effort: string | null };
type MsgRow = { id: string; conversation_id: string; parent_id: string | null; role: "user" | "assistant"; content: string; kind: TaskKind | null; meta: string | null; created_at: string };

const conv = (r: ConvRow): ConversationMeta => ({ id: r.id, title: r.title, docId: r.doc_id ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at, model: r.model ?? null, effort: r.effort ?? null });
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
  parentId: r.parent_id,
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
  const row: ConvRow = { id: randomUUID(), title: title.slice(0, 80) || "新对话", doc_id: docId ?? null, created_at: now, updated_at: now, model: null, effort: null };
  need().db.prepare("INSERT INTO conversations (id, title, doc_id, created_at, updated_at) VALUES (@id, @title, @doc_id, @created_at, @updated_at)").run(row);
  return conv(row);
}

export function hasConversation(id: string): boolean {
  return !!need().db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(id);
}

export function getMessages(conversationId: string): StoredMessage[] {
  return (need().db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conversationId) as MsgRow[]).map(msg);
}

type OriginRow = { child_msg_id: string; source_msg_id: string; start: number; end: number; quote: string };
const origin = (r: OriginRow): BranchOrigin => ({ childId: r.child_msg_id, sourceId: r.source_msg_id, start: r.start, end: r.end, quote: r.quote });

export function getOrigins(conversationId: string): BranchOrigin[] {
  return (
    need()
      .db.prepare("SELECT o.* FROM branch_origin o JOIN messages m ON m.id = o.child_msg_id WHERE m.conversation_id = ?")
      .all(conversationId) as OriginRow[]
  ).map(origin);
}

/** Every message plus every branch origin, for the breadcrumb and branch tree. */
export function getTree(conversationId: string): { messages: StoredMessage[]; origins: BranchOrigin[] } {
  return { messages: getMessages(conversationId), origins: getOrigins(conversationId) };
}

/** Root → leaf messages of one thread. Without a leaf: the main thread. Sibling branches never appear. */
export function threadOf(conversationId: string, leafId?: string): StoredMessage[] {
  const all = getMessages(conversationId);
  const leaf = leafId ?? mainLeaf(all, getOrigins(conversationId))?.id;
  return leaf ? pathTo(all, leaf).filter((m) => m.conversationId === conversationId) : [];
}

export function historyFor(conversationId: string, dropTrailingTurn = false, leafId?: string): ChatMessage[] {
  const all = threadOf(conversationId, leafId);
  if (dropTrailingTurn) {
    // Regenerating: drop the last assistant answer(s) and the user turn being re-asked.
    while (all.at(-1)?.role === "assistant") all.pop();
    all.pop();
  }
  return all.map((m) => ({ role: m.role, content: m.content }));
}

/** Appends after `parentId`, as a new first message when `null`, or after the end of the main thread when omitted. */
/** Strictly increasing timestamps, so siblings created within one millisecond still sort by creation. */
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

export function addMessage(conversationId: string, role: "user" | "assistant", content: string, kind?: TaskKind, meta?: MessageMeta, parentId?: string | null): StoredMessage {
  const now = stamp();
  const parent = parentId === null ? null : (parentId ?? threadOf(conversationId).at(-1)?.id ?? null);
  if (parent && !belongs(parent, conversationId)) throw new Error("parent message is not in this conversation");
  const row: MsgRow = { id: randomUUID(), conversation_id: conversationId, parent_id: parent, role, content, kind: kind ?? null, meta: meta ? JSON.stringify(meta) : null, created_at: now };
  const db = need().db;
  db.transaction(() => {
    db.prepare("INSERT INTO messages (id, conversation_id, parent_id, role, content, kind, meta, created_at) VALUES (@id, @conversation_id, @parent_id, @role, @content, @kind, @meta, @created_at)").run(row);
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  })();
  return msg(row);
}

export function getMessage(id: string): StoredMessage | undefined {
  const r = need().db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
  return r ? msg(r) : undefined;
}

function belongs(messageId: string, conversationId: string): boolean {
  return !!need().db.prepare("SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?").get(messageId, conversationId);
}

/**
 * Forks a branch from span [start, end) (UTF-16, of the stored markdown) of an assistant answer:
 * stores the first user message of the branch and where it came from, atomically.
 */
export function createBranch(sourceId: string, span: { start: number; end: number; quote: string }, content: string, kind?: TaskKind, meta?: MessageMeta): StoredMessage {
  const db = need().db;
  const src = db.prepare("SELECT * FROM messages WHERE id = ?").get(sourceId) as MsgRow | undefined;
  if (!src || src.role !== "assistant") throw new Error("branches start from an assistant answer");
  if (!spanMatches(src.content, span.start, span.end, span.quote)) throw new Error("quote does not match the answer at that position");
  return db.transaction(() => {
    const child = addMessage(src.conversation_id, "user", content, kind, meta, sourceId);
    db.prepare("INSERT INTO branch_origin (child_msg_id, source_msg_id, start, end, quote) VALUES (?, ?, ?, ?, ?)").run(child.id, sourceId, span.start, span.end, span.quote);
    return child;
  })();
}

export function deleteConversation(id: string): void {
  need().db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function getOrigin(childId: string): BranchOrigin | undefined {
  const r = need().db.prepare("SELECT * FROM branch_origin WHERE child_msg_id = ?").get(childId) as OriginRow | undefined;
  return r ? origin(r) : undefined;
}

/**
 * A new question in the same place as `originalId` (from 「从这里分支」): same parent; if the original
 * opened a span branch, its branch_origin (source, start, end, quote) is copied verbatim so the new
 * question stays in that branch as a sibling. Atomic.
 */
export function addSibling(originalId: string, content: string, kind?: TaskKind, meta?: MessageMeta): StoredMessage {
  const db = need().db;
  const orig = getMessage(originalId);
  if (!orig || orig.role !== "user") throw new Error("只能改问用户的问题");
  const o = getOrigin(originalId);
  return db.transaction(() => {
    const child = addMessage(orig.conversationId, "user", content, kind, meta, orig.parentId);
    if (o) db.prepare("INSERT INTO branch_origin (child_msg_id, source_msg_id, start, end, quote) VALUES (?, ?, ?, ?, ?)").run(child.id, o.sourceId, o.start, o.end, o.quote);
    return child;
  })();
}

export function getConversationModel(id: string): { model: string | null; effort: string | null } {
  const r = need().db.prepare("SELECT model, effort FROM conversations WHERE id = ?").get(id) as { model: string | null; effort: string | null } | undefined;
  if (!r) throw new Error("对话不存在");
  return { model: r.model ?? null, effort: r.effort ?? null };
}

export function setConversationModel(id: string, model: string | null, effort: string | null): void {
  const info = need().db.prepare("UPDATE conversations SET model = ?, effort = ?, updated_at = ? WHERE id = ?").run(model, effort, new Date().toISOString(), id);
  if (info.changes === 0) throw new Error("对话不存在");
}
