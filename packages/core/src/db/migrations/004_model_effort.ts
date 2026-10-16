import type { MigratableDb } from "../migrate.js";

/** Per-conversation remembered model and thinking level. Null = workspace default. Idempotent. */
export default function migrateModelEffort(db: MigratableDb): void {
  const cols = new Set((db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("model")) db.exec("ALTER TABLE conversations ADD COLUMN model TEXT");
  if (!cols.has("effort")) db.exec("ALTER TABLE conversations ADD COLUMN effort TEXT");
}
