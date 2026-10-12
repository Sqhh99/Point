export const CHAT_MIN = 320;
export const CHAT_MAX = 640;
export const CHAT_DEFAULT = 400;

/** Clamp a chat panel width into [CHAT_MIN, CHAT_MAX]; anything non-numeric falls back to the default. */
export function clampChatWidth(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return CHAT_DEFAULT;
  return Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, n)));
}

/** True for ⌘\ (mac) or Ctrl+\ (elsewhere), the shortcut that toggles the left column. */
export function isToggleLibraryKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  return e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}
