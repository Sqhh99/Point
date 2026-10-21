import type { CSSProperties } from "react";
import { CHAT_DEFAULT, CHAT_MAX, CHAT_MIN, LIBRARY_COLLAPSED_WIDTH, LIBRARY_WIDTH, READER_MIN, SPLITTER_WIDTH } from "../shared/layout-sizes";
export { CHAT_DEFAULT, CHAT_MAX, CHAT_MIN };

/** CSS variables for the desk grid (style.css): the chat pane gives way first, down to CHAT_MIN,
 *  so the reader keeps READER_MIN; above that the chat keeps the user's width. */
export const deskVars = (chatWidth: number) =>
  ({
    "--chat-width": `${chatWidth}px`,
    "--chat-min": `${CHAT_MIN}px`,
    "--reader-min": `${READER_MIN}px`,
    "--library-width": `${LIBRARY_WIDTH}px`,
    "--library-collapsed-width": `${LIBRARY_COLLAPSED_WIDTH}px`,
    "--splitter-width": `${SPLITTER_WIDTH}px`
  }) as CSSProperties;

/** Plain decimal only: hex, binary and octal literals ("0x200") are treated as invalid. */
const DECIMAL = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/**
 * Clamp a chat panel width into [CHAT_MIN, CHAT_MAX]; anything non-numeric falls back to the default.
 * With the desk width (and whether the library is open), the upper bound also leaves the reader
 * READER_MIN: the splitter can't squeeze the reader, and a window resize re-clamps the chat first.
 * CHAT_MIN wins if both can't hold (only below the window minimum, which main forbids).
 */
export function clampChatWidth(v: unknown, desk?: { width: number; libraryOpen: boolean }): number {
  const n = typeof v === "string" && DECIMAL.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  const base = Number.isFinite(n) ? n : CHAT_DEFAULT;
  const room = desk ? desk.width - (desk.libraryOpen ? LIBRARY_WIDTH : LIBRARY_COLLAPSED_WIDTH) - SPLITTER_WIDTH - READER_MIN : Infinity;
  return Math.round(Math.max(CHAT_MIN, Math.min(CHAT_MAX, room, base)));
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

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const BAR_GAP = 8;

/**
 * Where the floating bar goes, in the container's coordinates (add the container's scrollTop
 * when the bar lives in scrolled content). Above the selection with an 8px gap; below it when
 * there is not enough room above. Never overlaps the selection rectangle: the bar's vertical
 * span is entirely above `sel.top - gap` or entirely below `sel.bottom + gap`. Horizontally
 * centred on the selection and clamped inside the container (`left` is the bar's centre).
 */
export function placeBar(sel: Rect, container: Rect, bar: { width: number; height: number }, gap = BAR_GAP): { top: number; left: number; below: boolean } {
  const selTop = sel.top - container.top;
  const selBottom = selTop + sel.height;
  const below = selTop < bar.height + gap;
  const top = below ? selBottom + gap : selTop - gap - bar.height;
  const half = bar.width / 2 + 4;
  const centre = sel.left - container.left + sel.width / 2;
  const left = container.width <= 2 * half ? container.width / 2 : Math.min(Math.max(centre, half), container.width - half);
  return { top, left, below };
}
