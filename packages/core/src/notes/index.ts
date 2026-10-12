import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

export interface NoteMeta {
  id: string;
  title: string;
  sourceDocId?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface Note extends NoteMeta {
  body: string;
}

export interface NoteInput {
  title: string;
  body?: string;
  sourceDocId?: string;
  tags?: string[];
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function serializeNote(n: Note): string {
  const fm: Record<string, unknown> = { id: n.id, title: n.title };
  if (n.sourceDocId) fm.sourceDocId = n.sourceDocId;
  Object.assign(fm, { createdAt: n.createdAt, updatedAt: n.updatedAt, tags: n.tags });
  return `---\n${stringify(fm).trimEnd()}\n---\n\n${n.body.replace(/^\n+/, "")}`;
}

export function parseNote(text: string, fallbackId: string): Note {
  const m = FM.exec(text);
  const fm = (m ? (parse(m[1]) as Record<string, unknown> | null) : null) ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : v instanceof Date ? v.toISOString() : undefined);
  const now = new Date(0).toISOString();
  return {
    id: str(fm.id) ?? fallbackId,
    title: str(fm.title) ?? fallbackId,
    sourceDocId: str(fm.sourceDocId),
    createdAt: str(fm.createdAt) ?? now,
    updatedAt: str(fm.updatedAt) ?? str(fm.createdAt) ?? now,
    tags: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [],
    body: (m ? text.slice(m[0].length) : text).replace(/^\n+/, "")
  };
}

export interface NoteStoreOptions {
  now?: () => Date;
  newId?: () => string;
}

/** Notes live as `<dir>/<id>.md` with YAML frontmatter. */
export class NoteStore {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    readonly dir: string,
    opts: NoteStoreOptions = {}
  ) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomUUID().slice(0, 8));
    mkdirSync(dir, { recursive: true });
  }

  private file(id: string): string {
    if (!ID.test(id)) throw new Error(`无效的笔记 id: ${id}`);
    return join(this.dir, `${id}.md`);
  }

  private write(n: Note): void {
    const f = this.file(n.id);
    writeFileSync(`${f}.tmp`, serializeNote(n), "utf8");
    renameSync(`${f}.tmp`, f);
  }

  create(input: NoteInput): Note {
    const ts = this.now().toISOString();
    let id = this.newId();
    while (existsSync(this.file(id))) id = this.newId();
    const note: Note = {
      id,
      title: input.title.trim() || "未命名笔记",
      sourceDocId: input.sourceDocId,
      createdAt: ts,
      updatedAt: ts,
      tags: input.tags ?? [],
      body: input.body ?? ""
    };
    this.write(note);
    return note;
  }

  list(): NoteMeta[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".md") && ID.test(f.slice(0, -3)))
      .map((f) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { body, ...meta } = parseNote(readFileSync(join(this.dir, f), "utf8"), f.slice(0, -3));
        return meta;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  read(id: string): Note {
    const f = this.file(id);
    if (!existsSync(f)) throw new Error("笔记不存在");
    return parseNote(readFileSync(f, "utf8"), id);
  }

  update(id: string, patch: Partial<Pick<Note, "title" | "body" | "tags">>): Note {
    const cur = this.read(id);
    const next: Note = {
      ...cur,
      ...(patch.title !== undefined ? { title: patch.title.trim() || cur.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      id: cur.id,
      updatedAt: this.now().toISOString()
    };
    this.write(next);
    return next;
  }

  append(id: string, text: string): Note {
    const cur = this.read(id);
    const body = cur.body.trimEnd();
    return this.update(id, { body: `${body ? `${body}\n\n` : ""}${text.trim()}\n` });
  }
}
