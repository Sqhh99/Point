import { app, dialog } from "electron";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { DbTooNewError, NoteStore, docTypeOf, migrate, parseDocument, type ParsedDoc } from "@point/core";
import type { DocMeta } from "../shared/ipc.js";

/**
 * A workspace is a plain folder:
 *   docs/      imported originals (copied, renamed to <id>.<ext>)
 *   notes/     markdown notes
 *   .point/index.db   SQLite index
 */
const stateFile = () => join(app.getPath("userData"), "workspace.json");

let current: { root: string; db: Database.Database; notes: NoteStore } | null = null;

function openDb(root: string): Database.Database {
  mkdirSync(join(root, ".point"), { recursive: true });
  const db = new Database(join(root, ".point", "index.db"));
  try {
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  // Only after the version check: a refused (too new) database must stay byte-for-byte untouched.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function openWorkspace(root: string): string {
  const abs = resolve(root);
  for (const d of ["docs", "notes"]) mkdirSync(join(abs, d), { recursive: true });
  let db: Database.Database;
  try {
    db = openDb(abs);
  } catch (err) {
    // Never keep running on a half-migrated or too-new database: the old workspace stays open.
    dialog.showErrorBox("无法打开工作区", err instanceof DbTooNewError ? err.message : `数据库升级失败，已回滚，未做任何修改。\n${String(err)}`);
    throw err;
  }
  current?.db.close();
  current = { root: abs, db, notes: new NoteStore(join(abs, "notes")) };
  writeFileSync(stateFile(), JSON.stringify({ path: abs }));
  return abs;
}

export function restoreWorkspace(): void {
  try {
    const { path } = JSON.parse(readFileSync(stateFile(), "utf8")) as { path?: string };
    if (path && existsSync(path)) openWorkspace(path);
  } catch {
    // no previous workspace
  }
}

export function workspacePath(): string | null {
  return current?.root ?? null;
}

export function closeWorkspace(): void {
  current?.db.close();
  current = null;
}

export function need() {
  if (!current) throw new Error("请先选择工作区文件夹");
  return current;
}

export function docTitle(id: string): string | undefined {
  return (current?.db.prepare("SELECT title FROM docs WHERE id = ?").get(id) as { title: string } | undefined)?.title;
}

type Row = { id: string; title: string; type: DocMeta["type"]; path: string; imported_at: string };
const toMeta = (r: Row): DocMeta => ({ id: r.id, title: r.title, type: r.type, path: r.path, importedAt: r.imported_at });

export function listDocs(): DocMeta[] {
  if (!current) return [];
  return (current.db.prepare("SELECT * FROM docs ORDER BY imported_at DESC, rowid DESC").all() as Row[]).map(toMeta);
}

export async function importFile(src: string): Promise<DocMeta> {
  const ws = need();
  const type = docTypeOf(src);
  if (!type) throw new Error(`不支持的文件类型: ${basename(src)}`);
  const id = randomUUID();
  const rel = `docs/${id}${extname(src).toLowerCase()}`;
  const dest = join(ws.root, rel);
  copyFileSync(src, dest);
  const fallback = basename(src, extname(src));
  let title = fallback;
  try {
    title = (await parseDocument(type, readFileSync(dest), fallback)).title;
  } catch {
    // keep file name; parse errors surface when opening the doc
  }
  const meta: DocMeta = { id, title, type, path: rel, importedAt: new Date().toISOString() };
  ws.db
    .prepare("INSERT INTO docs (id, title, type, path, imported_at) VALUES (@id, @title, @type, @path, @importedAt)")
    .run(meta);
  return meta;
}

export async function getDoc(id: string): Promise<ParsedDoc> {
  const ws = need();
  const row = ws.db.prepare("SELECT * FROM docs WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("文档不存在");
  const abs = resolve(ws.root, row.path);
  if (!abs.startsWith(join(ws.root, "docs") + sep)) throw new Error("文档路径无效");
  return parseDocument(row.type, readFileSync(abs), row.title);
}
