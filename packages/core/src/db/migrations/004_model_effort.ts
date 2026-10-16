/**
 * Per-conversation remembered model and thinking level. Null = use the workspace default.
 * Idempotent: ADD COLUMN is skipped when the column already exists (SQLite cannot IF NOT EXISTS on ADD COLUMN
 * in older versions, so the migrator runs this once via user_version).
 */
export default `
ALTER TABLE conversations ADD COLUMN model TEXT;
ALTER TABLE conversations ADD COLUMN effort TEXT;
`;
