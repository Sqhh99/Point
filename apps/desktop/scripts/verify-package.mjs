#!/usr/bin/env node
// Verifies packaged builds in release/: for every unpacked app (and, on macOS, every dmg;
// on Windows, the native-arch Inno Setup installer, installed then uninstalled) check that better_sqlite3.node exists,
// is unpacked from the asar, matches the target arch, and that the loader deps are in the
// asar. Then launch every native-arch build with POINT_SMOKE_OUT to open a real DB.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, closeSync, statSync } from "node:fs";
import { Buffer } from "node:buffer";
import console from "node:console";
import { tmpdir } from "node:os";
import process from "node:process";
import { join } from "node:path";

const release = join(import.meta.dirname, "..", "release");
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`✗ ${msg}`);
};
const ok = (msg) => console.log(`✓ ${msg}`);

function readHead(file, len, pos = 0) {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, pos);
  closeSync(fd);
  return buf;
}

/** Arch of a native binary from its header (ELF / PE / Mach-O). */
function binaryArch(file) {
  const h = readHead(file, 4096);
  if (h.readUInt32BE(0) === 0x7f454c46) return { 0x3e: "x64", 0xb7: "arm64" }[h.readUInt16LE(18)] ?? "elf?";
  if (h.toString("latin1", 0, 2) === "MZ") {
    const pe = h.readUInt32LE(0x3c);
    return { 0x8664: "x64", 0xaa64: "arm64", 0x14c: "ia32" }[h.readUInt16LE(pe + 4)] ?? "pe?";
  }
  if (h.readUInt32LE(0) === 0xfeedfacf) return { 0x01000007: "x64", 0x0100000c: "arm64" }[h.readUInt32LE(4)] ?? "macho?";
  if (h.readUInt32BE(0) === 0xcafebabe) return "universal";
  return "unknown";
}

/** File list of an asar archive (header JSON only). */
function asarFiles(asar) {
  const size = readHead(asar, 16);
  const header = JSON.parse(readHead(asar, size.readUInt32LE(12), 16).toString("utf8"));
  const out = [];
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, p);
      else out.push(p);
    }
  };
  walk(header, "");
  return out;
}

function findFiles(dir, name, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) findFiles(p, name, acc);
    else if (e.name === name) acc.push(p);
  }
  return acc;
}

/** Checks one installed/unpacked app; returns its executable path. */
function checkApp(label, resources, exe, arch) {
  const nodes = findFiles(join(resources, "app.asar.unpacked"), "better_sqlite3.node");
  if (nodes.length === 0) return fail(`${label}: better_sqlite3.node not found in app.asar.unpacked`);
  for (const n of nodes) {
    const got = binaryArch(n);
    if (got === arch) ok(`${label}: ${n.slice(resources.length + 1)} is ${got}`);
    else fail(`${label}: ${n} is ${got}, expected ${arch}`);
  }
  const files = asarFiles(join(resources, "app.asar"));
  for (const dep of ["bindings", "file-uri-to-path", "better-sqlite3"]) {
    if (files.some((f) => f.startsWith(`node_modules/${dep}/`))) ok(`${label}: asar has node_modules/${dep}`);
    else fail(`${label}: asar is missing node_modules/${dep}`);
  }
  if (!existsSync(exe)) fail(`${label}: executable missing: ${exe}`);
  return exe;
}

function smoke(label, exe) {
  const out = join(mkdtempSync(join(tmpdir(), "point-verify-")), "smoke.json");
  const args = process.platform === "linux" ? ["--no-sandbox"] : [];
  const r = spawnSync(exe, args, { env: { ...process.env, POINT_SMOKE_OUT: out }, timeout: 90_000, stdio: "inherit" });
  if (!existsSync(out)) return fail(`${label}: smoke produced no report (exit ${r.status}, ${r.error ?? r.signal ?? ""})`);
  const report = JSON.parse(readFileSync(out, "utf8"));
  if (r.status === 0 && report.ok && report.arch === process.arch) ok(`${label}: launched, opened SQLite ${report.sqlite} on ${report.arch} (Electron ${report.electron})`);
  else fail(`${label}: smoke failed (exit ${r.status}): ${JSON.stringify(report)}`);
}

const archs = ["x64", "arm64"];
const archOf = (name) => (name.includes("arm64") ? "arm64" : "x64");
const entries = readdirSync(release);
console.log(`release/: ${entries.join(", ")}`);

// 1) unpacked app dirs
const apps = [];
for (const d of entries) {
  const dir = join(release, d);
  if (!statSync(dir).isDirectory()) continue;
  if (/^mac(-arm64|-universal)?$/.test(d)) {
    const app = readdirSync(dir).find((f) => f.endsWith(".app"));
    if (app) apps.push({ label: d, arch: archOf(d), resources: join(dir, app, "Contents", "Resources"), exe: join(dir, app, "Contents", "MacOS", "Point") });
  } else if (/^win(-arm64|-ia32)?-unpacked$/.test(d)) {
    apps.push({ label: d, arch: archOf(d), resources: join(dir, "resources"), exe: join(dir, "Point.exe") });
  } else if (/^linux(-arm64)?-unpacked$/.test(d)) {
    apps.push({ label: d, arch: archOf(d), resources: join(dir, "resources"), exe: join(dir, "point") });
  }
}
if (apps.length === 0) fail("no unpacked apps in release/");
for (const a of apps) {
  checkApp(a.label, a.resources, a.exe, a.arch);
  if (a.arch === process.arch) smoke(a.label, a.exe);
}

// 2) macOS: mount each dmg and verify the app inside it
if (process.platform === "darwin") {
  const dmgs = entries.filter((f) => f.endsWith(".dmg"));
  if (dmgs.length === 0) fail("no .dmg in release/");
  for (const dmg of dmgs) {
    const mnt = mkdtempSync(join(tmpdir(), "point-dmg-"));
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mnt, join(release, dmg)], { stdio: "ignore" });
    try {
      const arch = archOf(dmg);
      const app = join(mnt, "Point.app");
      checkApp(dmg, join(app, "Contents", "Resources"), join(app, "Contents", "MacOS", "Point"), arch);
      if (arch === process.arch) smoke(dmg, join(app, "Contents", "MacOS", "Point"));
    } finally {
      execFileSync("hdiutil", ["detach", mnt, "-force"], { stdio: "ignore" });
    }
  }
}

// 3) Windows: Inno Setup installers. Both arches' unpacked dirs were checked above; here
//    silently install the native-arch installer, check + launch it, then silently uninstall.
if (process.platform === "win32") {
  const exes = entries.filter((f) => /-setup\.exe$/.test(f));
  if (exes.length !== archs.length) fail(`expected ${archs.length} Inno installers, found: ${exes.join(", ") || "none"}`);
  if (entries.some((f) => f.endsWith(".exe") && !f.endsWith("-setup.exe"))) fail("stray non-Inno .exe in release/");
  for (const inst of exes) {
    const exeArch = binaryArch(join(release, inst));
    if (exeArch === "ia32" || exeArch === "x64") ok(`${inst}: valid PE installer`);
    else fail(`${inst}: not a PE installer (${exeArch})`);
    if (archOf(inst) !== process.arch) continue; // cannot install a foreign-arch build here
    const dir = join(mkdtempSync(join(tmpdir(), "point-install-")), "Point");
    const r = spawnSync(join(release, inst), ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", `/DIR=${dir}`], { stdio: "inherit", timeout: 300_000 });
    if (r.status !== 0 || !existsSync(join(dir, "Point.exe"))) {
      fail(`${inst}: silent install failed (exit ${r.status})`);
      continue;
    }
    ok(`${inst}: silently installed to ${dir}`);
    checkApp(`${inst} (installed)`, join(dir, "resources"), join(dir, "Point.exe"), process.arch);
    smoke(`${inst} (installed)`, join(dir, "Point.exe"));
    const u = spawnSync(join(dir, "unins000.exe"), ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], { stdio: "inherit", timeout: 300_000 });
    // The uninstaller re-spawns itself from %TEMP%; wait for it to remove the files.
    const deadline = Date.now() + 120_000;
    while (existsSync(join(dir, "Point.exe")) && Date.now() < deadline) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
    if (u.status === 0 && !existsSync(join(dir, "Point.exe"))) ok(`${inst}: silently uninstalled`);
    else fail(`${inst}: uninstall failed (exit ${u.status}), Point.exe still present: ${existsSync(join(dir, "Point.exe"))}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} packaging check(s) failed`);
  process.exit(1);
}
console.log("\nall packaging checks passed");
