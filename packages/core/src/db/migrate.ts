import init from "./migrations/001_init.js";

/** The subset of better-sqlite3 the migrator needs, so core stays free of native deps. */
export interface MigratableDb {
  exec(sql: string): unknown;
  pragma(sql: string, opts?: { simple?: boolean }): unknown;
  prepare(sql: string): { all(): unknown[] };
  transaction(fn: () => number): () => number;
}

/** Ordered list; migration N (1-based) brings the schema to user_version N. Append only, never edit. */
export const MIGRATIONS: readonly string[] = [init];

export class DbTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(`数据库版本 ${found} 比当前应用支持的 ${supported} 新，请升级 Point。`);
    this.name = "DbTooNewError";
  }
}

const tableNames = (db: MigratableDb) =>
  new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));

/**
 * v0.1.0 never set user_version, so 0 means either a fresh file or a v0.1.0 database.
 * A v0.1.0 database has the docs table: adopt it as version 1, adding the `meta`
 * column that early v0.1.0 builds lacked.
 */
function adoptLegacy(db: MigratableDb): void {
  if (!tableNames(db).has("docs")) return;
  db.exec(init); // IF NOT EXISTS: only fills in tables a partial v0.1.0 db is missing
  const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "meta")) db.exec("ALTER TABLE messages ADD COLUMN meta TEXT");
  db.pragma("user_version = 1", { simple: true });
}

/** Runs every missing migration in one transaction. Throws (with nothing changed) on failure. */
export function migrate(db: MigratableDb, migrations: readonly string[] = MIGRATIONS): number {
  const run = db.transaction(() => {
    let version = Number(db.pragma("user_version", { simple: true }));
    if (version > migrations.length) throw new DbTooNewError(version, migrations.length);
    if (version === 0) {
      adoptLegacy(db);
      version = Number(db.pragma("user_version", { simple: true }));
    }
    for (let v = version; v < migrations.length; v++) {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`, { simple: true });
    }
    return migrations.length;
  });
  return run();
}
