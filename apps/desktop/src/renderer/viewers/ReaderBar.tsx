import type { ReactNode } from "react";

export const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400] as const;
export const nextZoom = (z: number, dir: 1 | -1): number => (dir === 1 ? ZOOM_STEPS.find((s) => s > z) : [...ZOOM_STEPS].reverse().find((s) => s < z)) ?? z;

export interface Switcher {
  /** What sits between the arrows, e.g. "3 / 12" or a sheet name. */
  label: string;
  unit: "页" | "工作表";
  canPrev: boolean;
  canNext: boolean;
  onPrev(): void;
  onNext(): void;
}

interface Props {
  title: string;
  switcher?: Switcher;
  zoom: number;
  onZoom(z: number): void;
  /** PDF only: fit the page width to the column. */
  onFitWidth?(): void;
  /** Disables the controls while the document is still opening. */
  loading?: boolean;
  children?: ReactNode;
}

/** The one top bar every format shares: file name, page/sheet switcher, zoom (pdf.js viewer layout). */
export function ReaderBar({ title, switcher, zoom, onZoom, onFitWidth, loading, children }: Props) {
  return (
    <div className="reader-toolbar" role="toolbar" aria-label="阅读工具" aria-busy={loading || undefined} data-testid="reader-bar">
      <span className="reader-title" title={title} data-testid="reader-title">
        {title}
      </span>
      {switcher && (
        <div className="bar-group" role="group" aria-label={`${switcher.unit}切换`}>
          <button className="tool-button icon-only" aria-label={`上一${switcher.unit === "页" ? "页" : "个工作表"}`} disabled={loading || !switcher.canPrev} onClick={switcher.onPrev}>
            ‹
          </button>
          <span className="bar-label" data-testid="switcher-label" aria-live="polite">
            {switcher.label}
          </span>
          <button className="tool-button icon-only" aria-label={`下一${switcher.unit === "页" ? "页" : "个工作表"}`} disabled={loading || !switcher.canNext} onClick={switcher.onNext}>
            ›
          </button>
        </div>
      )}
      <div className="bar-group" role="group" aria-label="缩放">
        <button className="tool-button icon-only" aria-label="缩小" disabled={loading || nextZoom(zoom, -1) === zoom} onClick={() => onZoom(nextZoom(zoom, -1))}>
          −
        </button>
        <button className="tool-button zoom-value" aria-label="恢复 100%" title="恢复 100%" disabled={loading || zoom === 100} onClick={() => onZoom(100)} data-testid="zoom-value">
          {zoom}%
        </button>
        <button className="tool-button icon-only" aria-label="放大" disabled={loading || nextZoom(zoom, 1) === zoom} onClick={() => onZoom(nextZoom(zoom, 1))}>
          +
        </button>
        {onFitWidth && (
          <button className="tool-button" disabled={loading} onClick={onFitWidth} data-testid="fit-width">
            适合宽度
          </button>
        )}
      </div>
      <span className="bar-spacer" />
      {children}
    </div>
  );
}
