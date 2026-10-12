#!/usr/bin/env node
// Packages one arch at a time. A single multi-arch electron-builder run reused the
// host-arch better_sqlite3.node for the cross arch on macOS (x64 dmg shipped an arm64
// binary), so each arch gets a clean native build with an explicit target arch.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import console from "node:console";
import process from "node:process";

const require = createRequire(import.meta.url);
const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));
const platformFlag = { darwin: "--mac", win32: "--win", linux: "--linux" }[process.platform];
const archs = process.platform === "linux" ? ["x64"] : ["x64", "arm64"];
const extra = process.argv.slice(2);
const release = join(import.meta.dirname, "..", "release");
const feeds = join(release, ".feeds");
rmSync(feeds, { recursive: true, force: true });
const bin = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";

for (const arch of archs) {
  rmSync(join(sqliteDir, "build"), { recursive: true, force: true });
  rmSync(join(sqliteDir, "prebuilds"), { recursive: true, force: true });
  execFileSync(bin, [platformFlag, `--${arch}`, ...extra], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_arch: arch, npm_config_target_arch: arch }
  });
  // Each run rewrites latest*.yml with only its own arch; keep a copy per arch.
  mkdirSync(join(feeds, arch), { recursive: true });
  for (const f of readdirSync(release).filter((n) => /^latest.*\.yml$/.test(n))) {
    cpSync(join(release, f), join(feeds, arch, f));
  }
}

// Merge the per-arch update feeds so latest*.yml lists every arch's installer.
const merged = new Map();
for (const arch of archs) {
  const dir = join(feeds, arch);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    const doc = yaml.load(readFileSync(join(dir, f), "utf8"));
    const prev = merged.get(f);
    if (!prev) {
      merged.set(f, doc);
      continue;
    }
    const urls = new Set(prev.files.map((x) => x.url));
    prev.files.push(...doc.files.filter((x) => !urls.has(x.url)));
  }
}
for (const [f, doc] of merged) {
  writeFileSync(join(release, f), yaml.dump(doc, { lineWidth: -1 }));
  console.log(`merged ${f}: ${doc.files.map((x) => x.url).join(", ")}`);
}
