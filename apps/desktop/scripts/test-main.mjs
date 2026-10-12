// Runs the main-process integration tests under Electron-as-Node so the
// Electron-ABI build of better-sqlite3 loads. Extra args go to vitest.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const electron = require("electron");
const vitest = require.resolve("vitest/vitest.mjs");
const r = spawnSync(electron, [vitest, "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
});
process.exit(r.status ?? 1);
