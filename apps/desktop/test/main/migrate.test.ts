import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DbTooNewError, MIGRATIONS, migrate } from "@point/core";

const version = (db: Database.Database) => db.pragma("user_version", { simple: true });
const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe("migrate", () => {
  it("builds a fresh database from 001", () => {
    const db = new Database(":memory:");
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(["branch_origin", "conversations", "docs", "marks", "messages"]);
  });

  it("adopts a v0.1.0 database (user_version 0, no meta column) without touching its rows", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL, imported_at TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, doc_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, kind TEXT, created_at TEXT NOT NULL);
      INSERT INTO docs VALUES ('d1', '熵与信息', 'pdf', 'docs/d1.pdf', '2026-10-01');
      INSERT INTO conversations VALUES ('c1', '问熵', 'd1', 't', 't');
      INSERT INTO messages VALUES ('m1', 'c1', 'user', '什么是熵？🙂', NULL, 't');`);
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT title FROM docs").get()).toEqual({ title: "熵与信息" });
    expect(db.prepare("SELECT content, meta FROM messages").get()).toEqual({ content: "什么是熵？🙂", meta: null });
  });

  it("is idempotent", () => {
    const db = new Database(":memory:");
    migrate(db);
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
  });

  it("rolls back version and schema when a migration fails", () => {
    const db = new Database(":memory:");
    migrate(db);
    const before = tables(db);
    expect(() => migrate(db, [...MIGRATIONS, "CREATE TABLE zz_probe (id TEXT); SELECT nope FROM missing;"])).toThrow();
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(before);
  });

  it("refuses a database newer than the app and leaves it unchanged", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(DbTooNewError);
    expect(version(db)).toBe(MIGRATIONS.length + 1);
    expect(tables(db)).toEqual([]);
  });
});
