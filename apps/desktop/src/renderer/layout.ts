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
 * Clamp a chat panel width; anything non-numeric falls back to the default.
 * With the desk width (and whether the library is open): chat ≥ CHAT_MIN and reader ≥ READER_MIN, used
 * on drag, on window resize / library toggle, and when reading the persisted point.chatWidth.
 * CHAT_MIN wins if both can't hold (only below the window minimum, which main forbids).
 */
export function clampChatWidth(v: unknown, desk?: { width: number; libraryOpen: boolean }): number {
  const n = typeof v === "string" && DECIMAL.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  const base = Number.isFinite(n) ? n : CHAT_DEFAULT;
  // With a desk the only upper bound is the room left after the reader's minimum (no fixed maximum);
  // without one (no layout yet) the stored value is kept within [CHAT_MIN, CHAT_MAX].
  const upper = desk ? desk.width - (desk.libraryOpen ? LIBRARY_WIDTH : LIBRARY_COLLAPSED_WIDTH) - SPLITTER_WIDTH - READER_MIN : CHAT_MAX;
  return Math.round(Math.max(CHAT_MIN, Math.min(upper, base)));
}

/** The stored preference as a number (≥ CHAT_MIN, no maximum; the window decides what is shown). */
export const readChatPref = (v: unknown): number => clampChatWidth(v, { width: Infinity, libraryOpen: true });

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

/** True when two rectangles overlap on both axes. Touching edges does not count. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.top < b.top + b.height && a.top + a.height > b.top && a.left < b.left + b.width && a.left + a.width > b.left;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the floating bar goes, in the container's coordinates (add the container's scrollTop
 * when the bar lives in scrolled content). Above the selection with an 8px gap; below it when
 * there is not enough room above, or when sitting above would overlap `obstacles` (unselected
 * body line boxes, tested by 2D intersection). If the below slot still overlaps an obstacle
 * or would leave the container, the bar slides from the below candidate toward the selection
 * until it misses unselected text and stays in the reading area (overlapping the highlight
 * if needed). If no such slot exists, it stays in the reading area at the position with the
 * least overlap area against obstacles. Without obstacles the previous placement is unchanged,
 * including not clamping a below slot that overflows. Never overlaps the selection rectangle
 * when either slot is clear: the bar's vertical span is entirely above `sel.top - gap` or
 * entirely below `sel.bottom + gap`. Horizontally centred on the selection and clamped inside
 * the container (`left` is the bar's centre).
 */
export function placeBar(
  sel: Rect,
  container: Rect,
  bar: { width: number; height: number },
  extra?: { gap?: number; obstacles?: readonly Rect[] }
): { top: number; left: number; below: boolean } {
  const gap = extra?.gap ?? BAR_GAP;
  const obstacles = extra?.obstacles ?? [];
  const selTop = sel.top - container.top;
  const selBottom = selTop + sel.height;
  const aboveTop = selTop - gap - bar.height;
  const belowTop = selBottom + gap;
  const half = bar.width / 2 + 4;
  const centre = sel.left - container.left + sel.width / 2;
  const left = container.width <= 2 * half ? container.width / 2 : Math.min(Math.max(centre, half), container.width - half);

  // Region capture and any caller without obstacles keep the original placement.
  if (obstacles.length === 0) {
    const below = selTop < bar.height + gap;
    return { top: below ? belowTop : aboveTop, left, below };
  }

  const at = (top: number): Rect => ({
    top: top + container.top,
    left: container.left + left - bar.width / 2,
    width: bar.width,
    height: bar.height
  });
  const intersects = (top: number) => obstacles.some((o) => rectsOverlap(at(top), o));
  const inView = (top: number) => top >= 0 && top + bar.height <= container.height;
  const areaOf = (top: number) => obstacles.reduce((sum, o) => sum + overlapArea(at(top), o), 0);

  if (inView(aboveTop) && !intersects(aboveTop)) return { top: aboveTop, left, below: false };
  if (inView(belowTop) && !intersects(belowTop)) return { top: belowTop, left, below: true };

  const maxTop = Math.max(0, container.height - bar.height);
  const clamp = (t: number) => Math.min(Math.max(t, 0), maxTop);
  let top = clamp(belowTop);
  if (intersects(top)) {
    const box = at(top);
    const up = obstacles.filter((o) => rectsOverlap(box, o)).map((o) => o.top - container.top - bar.height);
    if (up.length) top = clamp(Math.min(...up));
  }
  if (intersects(top)) {
    let best = top;
    let bestArea = areaOf(top);
    let bestDist = Math.abs(best - belowTop);
    const consider = (t: number) => {
      const c = clamp(t);
      const a = areaOf(c);
      const d = Math.abs(c - belowTop);
      if (a < bestArea || (a === bestArea && d < bestDist)) {
        best = c;
        bestArea = a;
        bestDist = d;
      }
    };
    consider(0);
    consider(maxTop);
    for (const o of obstacles) {
      consider(o.top - container.top - bar.height);
      consider(o.top + o.height - container.top);
    }
    top = best;
  }
  return { top, left, below: true };
}

/** Candidate body boxes that sit entirely above or below `sel` (not the selected lines themselves).
 *  `slack` must exceed the few-pixel overlap between consecutive `.pdf-line` boxes (line-height vs step). */
export function outsideBodyRects(sel: Rect, candidates: readonly Rect[], slack = 8): Rect[] {
  return candidates.filter((r) => r.top + r.height <= sel.top + slack || r.top >= sel.top + sel.height - slack);
}
