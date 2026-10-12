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

export type OpenShortcut = "workspace" | "file";

/** ⌘O / ⌘⇧O on macOS, Ctrl+O / Ctrl+Shift+O elsewhere; key repeat and the other platform's modifier are ignored. */
export function openShortcutOf(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat">,
  platform: string
): OpenShortcut | null {
  if (e.repeat || e.altKey || e.key.toLowerCase() !== "o") return null;
  const mod = platform === "darwin" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  return e.shiftKey ? "file" : "workspace";
}

/** ⌘⇧S on macOS, Ctrl+Shift+S elsewhere: enter region capture. Key repeat and the other platform's modifier are ignored. */
export function isCaptureKey(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat">,
  platform: string
): boolean {
  if (e.repeat || e.altKey || !e.shiftKey || e.key.toLowerCase() !== "s") return false;
  return platform === "darwin" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalised rectangle between two drag points, clipped to `bounds`; null when smaller than 4×4. */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }, bounds: Box): Box | null {
  const x1 = Math.max(Math.min(a.x, b.x), bounds.x);
  const y1 = Math.max(Math.min(a.y, b.y), bounds.y);
  const x2 = Math.min(Math.max(a.x, b.x), bounds.x + bounds.width);
  const y2 = Math.min(Math.max(a.y, b.y), bounds.y + bounds.height);
  const width = Math.round(x2 - x1);
  const height = Math.round(y2 - y1);
  if (width < 4 || height < 4) return null;
  return { x: Math.round(x1), y: Math.round(y1), width, height };
}
