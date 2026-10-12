#!/usr/bin/env node
// Packages one arch at a time. A single multi-arch electron-builder run reused the
// host-arch better_sqlite3.node for the cross arch on macOS (x64 dmg shipped an arm64
// binary), so each arch gets a clean native build with an explicit target arch.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));
const platformFlag = { darwin: "--mac", win32: "--win", linux: "--linux" }[process.platform];
const archs = process.platform === "linux" ? ["x64"] : ["x64", "arm64"];
const extra = process.argv.slice(2);
const bin = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";

for (const arch of archs) {
  rmSync(join(sqliteDir, "build"), { recursive: true, force: true });
  rmSync(join(sqliteDir, "prebuilds"), { recursive: true, force: true });
  execFileSync(bin, [platformFlag, `--${arch}`, ...extra], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_arch: arch, npm_config_target_arch: arch }
  });
}
