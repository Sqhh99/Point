export const CHAT_MIN = 320;
export const CHAT_MAX = 640;
export const CHAT_DEFAULT = 400;

/** Plain decimal only: hex, binary and octal literals ("0x200") are treated as invalid. */
const DECIMAL = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** Clamp a chat panel width into [CHAT_MIN, CHAT_MAX]; anything non-numeric falls back to the default. */
export function clampChatWidth(v: unknown): number {
  const n = typeof v === "string" && DECIMAL.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return CHAT_DEFAULT;
  return Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, n)));
}

/** True only for ⌘\ on macOS or Ctrl+\ elsewhere; the other platform's modifier and key auto-repeat never toggle. */
export function isToggleLibraryKey(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat">,
  platform: string
): boolean {
  if (e.repeat || e.key !== "\\" || e.altKey || e.shiftKey) return false;
  return platform === "darwin" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
