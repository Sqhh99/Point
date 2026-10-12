import { app } from "electron";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Used by CI on packaged builds (`POINT_SMOKE_OUT=<file> Point`): proves the bundled
 * better-sqlite3 .node loads for this arch. Writes a JSON report and exits.
 */
export function runSmoke(outFile: string): never {
  const report: Record<string, unknown> = { arch: process.arch, platform: process.platform, electron: process.versions.electron };
  let code = 0;
  const dir = mkdtempSync(join(tmpdir(), "point-smoke-"));
  try {
    const db = new Database(join(dir, "smoke.db"));
    db.exec("CREATE TABLE t (v TEXT)");
    db.prepare("INSERT INTO t VALUES (?)").run("ok");
    report.row = (db.prepare("SELECT v FROM t").get() as { v: string }).v;
    report.sqlite = (db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
    db.close();
    report.ok = report.row === "ok";
    if (!report.ok) code = 1;
  } catch (err) {
    report.ok = false;
    report.error = String((err as Error).stack ?? err);
    code = 1;
  }
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(outFile, JSON.stringify(report));
  app.exit(code);
  process.exit(code);
}
