import type { PageRect } from "@point/core";

/** 1 PDF point = 4/3 CSS px at 100% (same as PdfView). */
export const PDF_CSS_BASE = 96 / 72;

export type OverlayMode = "pending" | "confirm";

/**
 * Single overlay for region/text page rects. `pending` = dashed after capture; `confirm` = solid
 * flash after jumping to a mark. Each rect is its own box; never receives pointer events.
 * `scale` is the page's current css/pdf scale (use `PDF_CSS_BASE` for 1:1 article coords).
 */
export function SelectionOverlay({
  rects,
  scale = PDF_CSS_BASE,
  mode
}: {
  rects: PageRect[];
  scale?: number;
  mode: OverlayMode;
}) {
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className={`selection-overlay selection-overlay-${mode}`}
          data-testid="selection-overlay"
          data-mode={mode}
          style={{
            left: (r.x * scale) / PDF_CSS_BASE,
            top: (r.y * scale) / PDF_CSS_BASE,
            width: (r.w * scale) / PDF_CSS_BASE,
            height: (r.h * scale) / PDF_CSS_BASE
          }}
        />
      ))}
    </>
  );
}

/** Confirm flash total duration (ms). Reduced-motion callers use 1200 only. */
export const CONFIRM_MS = { fade: 180, hold: 1200 } as const;
export const confirmDuration = (reduced: boolean) => (reduced ? CONFIRM_MS.hold : CONFIRM_MS.fade + CONFIRM_MS.hold + CONFIRM_MS.fade);
