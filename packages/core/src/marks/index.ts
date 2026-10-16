import type { ChatMessage, ContentPart, ImageInput } from "../llm/types.js";

/** sha256 of a region capture: 64 lowercase hex chars, nothing else. */
const SHA = /^[0-9a-f]{64}$/;
export function isCaptureSha(v: unknown): v is string {
  return typeof v === "string" && SHA.test(v);
}

/** A run of selected text in a document. `blockId` lets the reader scroll back to it. */
/** A highlight rectangle in PDF page coordinates (CSS px at 100% zoom, top-left origin), one per text line. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextAnchor {
  kind: "text";
  text: string;
  blockId?: string;
  page?: number;
  context?: string;
  /** PDF: ~32 chars of extracted page text before / after the quote, to relocate it by fuzzy match. */
  prefix?: string;
  suffix?: string;
  /** PDF: where the quote was drawn on `page` (one rect per line). A hint; the quote itself is the anchor. */
  rects?: PageRect[];
}

/** A region screenshot, referenced only by the sha of its PNG in `.point/captures/`. */
export interface RegionAnchor {
  kind: "region";
  sha: string;
  width: number;
  height: number;
  blockId?: string;
  page?: number;
}

export type MarkAnchor = TextAnchor | RegionAnchor;

export interface Mark {
  id: string;
  docId: string;
  anchor: MarkAnchor;
  note?: string;
  createdAt: string;
}

export const MARK_LIMITS = { text: 6000, context: 3000, blockId: 128, note: 2000, batch: 20, affix: 200, rects: 64 } as const;

const fail = (): never => {
  throw new Error("无效的标记位置");
};
const optStr = (v: unknown, max: number): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) return fail();
  return v;
};
const optPage = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1_000_000 ? v : fail();
};
const dim = (v: unknown, min: number): number => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= 100_000 ? Math.round(v * 100) / 100 : fail());
function parseRects(v: unknown): PageRect[] {
  if (!Array.isArray(v) || v.length > MARK_LIMITS.rects) return fail();
  return v.map((r) => {
    if (!r || typeof r !== "object") return fail();
    const o = r as Record<string, unknown>;
    return { x: dim(o.x, 0), y: dim(o.y, 0), w: dim(o.w, 0.01), h: dim(o.h, 0.01) };
  });
}
const side = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10_000 ? v : fail());

/** Validates untrusted input into an anchor with only known fields. Throws 「无效的标记位置」. */
export function parseAnchor(raw: unknown): MarkAnchor {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const r = raw as Record<string, unknown>;
  if (r.kind === "text") {
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text || text.length > MARK_LIMITS.text) return fail();
    const a: TextAnchor = { kind: "text", text };
    const blockId = optStr(r.blockId, MARK_LIMITS.blockId);
    const page = optPage(r.page);
    const context = optStr(r.context, MARK_LIMITS.context);
    const prefix = optStr(r.prefix, MARK_LIMITS.affix);
    const suffix = optStr(r.suffix, MARK_LIMITS.affix);
    if (blockId) a.blockId = blockId;
    if (page) a.page = page;
    if (context) a.context = context;
    if (prefix) a.prefix = prefix;
    if (suffix) a.suffix = suffix;
    if (r.rects !== undefined && r.rects !== null) a.rects = parseRects(r.rects);
    return a;
  }
  if (r.kind === "region") {
    if (!isCaptureSha(r.sha)) return fail();
    const a: RegionAnchor = { kind: "region", sha: r.sha, width: side(r.width), height: side(r.height) };
    const blockId = optStr(r.blockId, MARK_LIMITS.blockId);
    const page = optPage(r.page);
    if (blockId) a.blockId = blockId;
    if (page) a.page = page;
    return a;
  }
  return fail();
}

/** Minimal better-sqlite3 surface so core stays free of the native module. */
export interface MarkDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

type Row = { id: string; doc_id: string; anchor_json: string; note: string | null; created_at: string };

export class MarkStore {
  constructor(
    private readonly db: MarkDb,
    private readonly newId: () => string
  ) {}

  private toMark(r: Row): Mark | null {
    try {
      const m: Mark = { id: r.id, docId: r.doc_id, anchor: parseAnchor(JSON.parse(r.anchor_json)), createdAt: r.created_at };
      if (r.note) m.note = r.note;
      return m;
    } catch {
      return null; // a hand-edited / corrupt row is skipped, never returned unvalidated
    }
  }

  create(docId: string, anchor: unknown, note?: unknown): Mark {
    const a = parseAnchor(anchor);
    if (!this.db.prepare("SELECT 1 FROM docs WHERE id = ?").get(docId)) throw new Error("文档不存在");
    const n = typeof note === "string" && note.trim() ? note.trim().slice(0, MARK_LIMITS.note) : null;
    const row: Row = { id: this.newId(), doc_id: docId, anchor_json: JSON.stringify(a), note: n, created_at: new Date().toISOString() };
    this.db.prepare("INSERT INTO marks (id, doc_id, anchor_json, note, created_at) VALUES (?, ?, ?, ?, ?)").run(row.id, row.doc_id, row.anchor_json, row.note, row.created_at);
    return this.toMark(row)!;
  }

  list(docId: string): Mark[] {
    const rows = this.db.prepare("SELECT * FROM marks WHERE doc_id = ? ORDER BY created_at, rowid").all(docId) as Row[];
    return rows.map((r) => this.toMark(r)).filter((m): m is Mark => !!m);
  }

  get(id: string): Mark | undefined {
    const r = this.db.prepare("SELECT * FROM marks WHERE id = ?").get(id) as Row | undefined;
    return (r && this.toMark(r)) || undefined;
  }

  updateNote(id: string, note: unknown): Mark {
    if (!this.get(id)) throw new Error("标记不存在");
    const n = typeof note === "string" && note.trim() ? note.trim().slice(0, MARK_LIMITS.note) : null;
    this.db.prepare("UPDATE marks SET note = ? WHERE id = ?").run(n, id);
    return this.get(id)!;
  }

  /** Removes the row only; capture files are shared by content hash and never deleted here. */
  remove(id: string): void {
    this.db.prepare("DELETE FROM marks WHERE id = ?").run(id);
  }
}

/** A mark with its image bytes already loaded (by main, from the validated sha). */
export type LoadedMark = { anchor: TextAnchor } | { anchor: RegionAnchor; image: ImageInput };

/**
 * One user message for 「一起问」: the question, then every mark in the order the user picked them —
 * text marks as text parts, region marks as image parts.
 */
export function buildBatchMessage(question: string, marks: LoadedMark[], docTitle?: string): ChatMessage {
  const q = question.trim();
  if (!q) throw new Error("请输入问题");
  if (marks.length === 0) throw new Error("请先勾选标记");
  if (marks.length > MARK_LIMITS.batch) throw new Error(`一次最多一起问 ${MARK_LIMITS.batch} 个标记`);
  const head = `${docTitle ? `文档：《${docTitle}》\n\n` : ""}下面是用户在文档里标记的 ${marks.length} 处内容（按勾选顺序），请结合它们回答问题。`;
  const parts: ContentPart[] = [{ type: "text", text: head }];
  marks.forEach((m, i) => {
    const where = m.anchor.page ? `（第 ${m.anchor.page} 页）` : "";
    if (m.anchor.kind === "text") parts.push({ type: "text", text: `标记 ${i + 1}${where}：\n"""\n${m.anchor.text}\n"""` });
    else {
      parts.push({ type: "text", text: `标记 ${i + 1}${where}：区域截图` });
      parts.push({ type: "image", image: (m as { image: ImageInput }).image });
    }
  });
  parts.push({ type: "text", text: `问题：${q}` });
  const content = parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("\n\n");
  return { role: "user", content, parts };
}
