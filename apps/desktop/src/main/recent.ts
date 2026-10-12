import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RecentItem } from "../shared/ipc.js";

export const RECENT_MAX = 5;
const file = () => join(app.getPath("userData"), "recent.json");

/** Newest first, de-duplicated by kind + path, capped at RECENT_MAX. */
export function pushRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => !(r.kind === item.kind && r.path === item.path))].slice(0, RECENT_MAX);
}

export function readRecent(): RecentItem[] {
  try {
    const v: unknown = JSON.parse(readFileSync(file(), "utf8"));
    if (!Array.isArray(v)) return [];
    return v
      .filter((r): r is RecentItem => !!r && (r.kind === "workspace" || r.kind === "file") && typeof r.path === "string" && typeof r.name === "string")
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function addRecent(item: RecentItem): RecentItem[] {
  const next = pushRecent(readRecent(), item);
  writeFileSync(file(), JSON.stringify(next));
  return next;
}

export function removeRecent(path: string): RecentItem[] {
  const next = readRecent().filter((r) => r.path !== path);
  writeFileSync(file(), JSON.stringify(next));
  return next;
}
