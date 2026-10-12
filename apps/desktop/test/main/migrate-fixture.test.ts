// Migration tests against real databases written by old Point builds (see test/fixtures/README.md).
// migrate.test.ts covers the same paths on synthetic in-memory schemas; these use the real files.
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { state } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const electron = await import("electron");
const ws = await import("../../src/main/workspace.js");
const settings = await import("../../src/main/settings.js");
const conv = await import("../../src/main/conversations.js");
const { DbTooNewError, MIGRATIONS, migrate } = await import("@point/core");

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const LATEST = MIGRATIONS.length;
const TABLES = ["docs", "conversations", "messages"] as const;

/** Copy a fixture to a temp dir; point userData at its settings.json when it has one. */
function stage(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `point-fx-${name}-`));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const root = join(dir, "workspace");
  const ud = join(dir, "userData");
  if (existsSync(ud)) state.userData = ud;
  return { root, db: join(root, ".point", "index.db"), ud };
}

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
function treeHashes(dir: string, skip?: (rel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const rel = relative(dir, p).split("\\").join("/");
      if (skip?.(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else out[rel] = sha(p);
    }
  };
  walk(dir);
  return out;
}

/** Every column of every row, as hex, so the comparison is byte-exact (no text decoding). */
function rowsHex(db: Database.Database, table: string, cols?: string[]) {
  const names = cols ?? (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const sel = names.map((n) => `quote(typeof(${n})) || ':' || coalesce(hex(${n}), 'NULL') AS ${n}`).join(", ");
  return db.prepare(`SELECT rowid AS _rowid, ${sel} FROM ${table} ORDER BY rowid`).all();
}
const colsOf = (db: Database.Database, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const master = (db: Database.Database) =>
  db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();
/** Schema shape independent of the CREATE statement's whitespace. */
function shape(db: Database.Database) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  return Object.fromEntries(
    tables.map((t) => [
      t,
      {
        cols: db.prepare(`PRAGMA table_info(${t})`).all(),
        fks: db.prepare(`PRAGMA foreign_key_list(${t})`).all(),
        idx: (db.prepare(`PRAGMA index_list(${t})`).all() as { name: string; unique: number }[]).map((i) => ({
          unique: i.unique,
          cols: (db.prepare(`PRAGMA index_info('${i.name}')`).all() as { name: string }[]).map((c) => c.name)
        }))
      }
    ])
  );
}
const ver = (db: Database.Database) => Number(db.pragma("user_version", { simple: true }));
function withDb<T>(file: string, fn: (db: Database.Database) => T): T {
  const db = new Database(file);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function freshShape() {
  const db = new Database(":memory:");
  migrate(db);
  const s = shape(db);
  db.close();
  return s;
}

afterEach(() => {
  ws.closeWorkspace();
  vi.mocked(electron.dialog.showErrorBox).mockClear();
});

describe("real v0.1.0 workspace fixture", () => {
  it("fixture really is an unversioned v0.1.0 database", () => {
    const { db } = stage("v0.1.0");
    withDb(db, (d) => {
      expect(ver(d)).toBe(0);
      expect(colsOf(d, "messages")).toContain("meta");
      expect(d.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 7 });
    });
  });

  it("openWorkspace upgrades it: every row byte-identical, files untouched, user_version latest", () => {
    const { root, db, ud } = stage("v0.1.0");
    const before = withDb(db, (d) => Object.fromEntries(TABLES.map((t) => [t, rowsHex(d, t)])));
    const cols = withDb(db, (d) => Object.fromEntries(TABLES.map((t) => [t, colsOf(d, t)])));
    const files = treeHashes(root, (rel) => rel.startsWith(".point"));
    const settingsBefore = sha(join(ud, "settings.json"));

    ws.openWorkspace(root);

    // Readable through the real services, not just present on disk.
    expect(ws.listDocs().map((d) => d.title).sort()).toEqual(["🚀🌏✨", "深度学习综述", "熵与信息 🧠"].sort());
    const notes = ws.need().notes.list();
    expect(notes.map((n) => n.title).sort()).toEqual(["待读：深度学习", "未命名笔记", "熵的直觉 🔥"].sort());
    const asked = conv.listConversations().find((c) => c.title === "问熵 🤔")!;
    const msgs = conv.getMessages(asked.id);
    expect(msgs.map((m) => m.content)[0]).toBe("什么是熵？🙂");
    expect(msgs).toHaveLength(6);
    expect(msgs[2]).toMatchObject({ kind: "explain", meta: { selection: "香农熵 H(X)" } });
    expect(settings.view().activeProvider).toBe("glm");
    expect(settings.resolveProvider("glm").apiKey).toBe("sk-fixture-不是真的-key");
    ws.closeWorkspace();

    withDb(db, (d) => {
      expect(ver(d)).toBe(LATEST);
      for (const t of TABLES) expect(rowsHex(d, t, cols[t]), t).toEqual(before[t]);
      expect(shape(d)).toEqual(freshShape());
    });
    expect(treeHashes(root, (rel) => rel.startsWith(".point"))).toEqual(files);
    expect(sha(join(ud, "settings.json"))).toBe(settingsBefore);
  });

  it("reopening the upgraded workspace twice changes nothing", () => {
    const { root, db } = stage("v0.1.0");
    ws.openWorkspace(root);
    ws.closeWorkspace();
    const snap = () => withDb(db, (d) => ({ v: ver(d), m: master(d), rows: TABLES.map((t) => rowsHex(d, t)) }));
    const first = snap();
    ws.openWorkspace(root);
    ws.closeWorkspace();
    ws.openWorkspace(root);
    ws.closeWorkspace();
    expect(snap()).toEqual(first);
  });

  it("each pending migration runs exactly once across reopenings", () => {
    const { db } = stage("v0.1.0");
    const counted = [...MIGRATIONS, "CREATE TABLE runs (n INTEGER); INSERT INTO runs VALUES (1);"];
    for (let i = 0; i < 3; i++) withDb(db, (d) => migrate(d, counted));
    withDb(db, (d) => {
      expect(ver(d)).toBe(counted.length);
      expect(d.prepare("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 1 });
    });
  });

  it.each([
    ["unversioned v0.1.0", 0],
    ["already adopted (v1)", 1]
  ])("a failing later migration on the %s file rolls back user_version, schema and rows", (_n, startAt) => {
    const { db } = stage("v0.1.0");
    if (startAt) withDb(db, (d) => migrate(d));
    const snap = (d: Database.Database) => ({ v: ver(d), m: master(d), rows: TABLES.map((t) => rowsHex(d, t)) });
    const before = withDb(db, snap);
    const broken = [
      ...MIGRATIONS,
      // Realistic 002: DDL + data rewrite, then a failure part-way through.
      "CREATE TABLE marks (id TEXT PRIMARY KEY); ALTER TABLE messages ADD COLUMN parent_id TEXT; UPDATE messages SET content = 'x';",
      "SELECT nope FROM missing;"
    ];
    withDb(db, (d) => expect(() => migrate(d, broken)).toThrow(/missing/));
    withDb(db, (d) => expect(snap(d)).toEqual(before));
  });
});

describe("other on-disk starting points", () => {
  it("earliest docs-only workspace (8be18b1) is adopted and gets the full schema", () => {
    const { root, db } = stage("v0.0-docs-only");
    const docs = withDb(db, (d) => rowsHex(d, "docs"));
    ws.openWorkspace(root);
    expect(ws.listDocs().map((d) => d.title)).toEqual(["早期文档 🌱"]);
    expect(conv.listConversations()).toEqual([]);
    ws.closeWorkspace();
    withDb(db, (d) => {
      expect(ver(d)).toBe(LATEST);
      expect(rowsHex(d, "docs")).toEqual(docs);
      expect(shape(d)).toEqual(freshShape());
    });
  });

  it("an empty folder gets a new on-disk database with the full schema", () => {
    const root = mkdtempSync(join(tmpdir(), "point-empty-"));
    ws.openWorkspace(root);
    const c = conv.createConversation("新的 ✨");
    conv.addMessage(c.id, "user", "你好 👋");
    ws.closeWorkspace();
    withDb(join(root, ".point", "index.db"), (d) => {
      expect(ver(d)).toBe(LATEST);
      expect(shape(d)).toEqual(freshShape());
      expect(Object.keys(shape(d)).sort()).toEqual(["conversations", "docs", "messages"]);
    });
  });

  it("a database newer than the app is refused, the file is byte-identical, the old workspace stays open", () => {
    const keep = mkdtempSync(join(tmpdir(), "point-keep-"));
    ws.openWorkspace(keep);
    const wsFile = join(state.userData, "workspace.json");
    const wsJson = readFileSync(wsFile, "utf8");

    const { root, db } = stage("v0.1.0");
    withDb(db, (d) => {
      migrate(d);
      d.pragma(`user_version = ${LATEST + 1}`);
    });
    const hash = sha(db);
    const dir = treeHashes(join(root, ".point"));

    expect(() => ws.openWorkspace(root)).toThrow(DbTooNewError);
    expect(electron.dialog.showErrorBox).toHaveBeenCalledWith("无法打开工作区", expect.stringContaining("请升级 Point"));
    expect(sha(db)).toBe(hash);
    expect(treeHashes(join(root, ".point"))).toEqual(dir); // no -wal / -shm left behind
    expect(ws.workspacePath()).toBe(keep);
    expect(readFileSync(wsFile, "utf8")).toBe(wsJson);
    expect(existsSync(join(state.userData, "workspace.json"))).toBe(false);
    expect(ws.listDocs()).toEqual([]); // old workspace still usable
  });

  // KNOWN BUG (see PR body): openDb() sets journal_mode = WAL before migrate() checks the
  // version, so a too-new database in rollback-journal mode gets its header rewritten
  // (bytes 18-19: 1 -> 2) even though it is refused. Real Point files are already WAL.
  it.fails("a too-new rollback-journal database is not rewritten either (known bug)", () => {
    const root = mkdtempSync(join(tmpdir(), "point-toonew-delete-"));
    const db = join(root, ".point", "index.db");
    mkdirSync(join(root, ".point"));
    withDb(db, (d) => {
      migrate(d);
      d.pragma(`user_version = ${LATEST + 1}`);
    });
    const hash = sha(db);
    expect(() => ws.openWorkspace(root)).toThrow(DbTooNewError);
    expect(sha(db)).toBe(hash);
  });
});
