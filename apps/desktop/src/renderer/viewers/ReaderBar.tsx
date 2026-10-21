import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconFitWidth, IconMore } from "../icons";

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
  /** Right-hand actions (e.g. 框选). They collapse to icons, then move into the ⋯ menu, before anything wraps. */
  actions?: BarAction[];
}

export interface BarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick(): void;
  disabled?: boolean;
  /** Tooltip; defaults to the label. */
  title?: string;
  pressed?: boolean;
  testId?: string;
}

/**
 * Narrowing order (UI design): 0 everything labelled → 1 right actions icon-only → 2 适合宽度 icon-only →
 * 3 适合宽度 into ⋯ → 4 the right actions into ⋯ as well. Page switcher and zoom % never collapse.
 */
export const COLLAPSE_LEVELS = 4;
export const collapseState = (level: number) => ({
  actionsIcon: level >= 1,
  fitIcon: level >= 2,
  fitInMenu: level >= 3,
  actionsInMenu: level >= 4
});

/** The one top bar every format shares: file name, page/sheet switcher, zoom (pdf.js viewer layout). */
export function ReaderBar({ title, switcher, zoom, onZoom, onFitWidth, loading, actions = [] }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [level, setLevel] = useState(0);
  const [menu, setMenu] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Anything that changes the content width restarts from the widest layout; the next effect then
  // steps down one level per render until nothing overflows (all before paint).
  const fingerprint = `${width}|${title}|${switcher?.label}|${zoom}|${actions.map((a) => a.label).join()}|${!!onFitWidth}`;
  useLayoutEffect(() => setLevel(0), [fingerprint]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && level < COLLAPSE_LEVELS && el.scrollWidth > el.clientWidth + 0.5) setLevel(level + 1);
  });
  const c = collapseState(level);
  const fit = onFitWidth ? { id: "fit-width", label: "适合宽度", icon: <IconFitWidth />, onClick: onFitWidth, disabled: loading, testId: "fit-width" } : null;
  const menuItems = [...(fit && c.fitInMenu ? [fit] : []), ...(c.actionsInMenu ? actions : [])];
  const button = (a: BarAction, iconOnly: boolean) => (
    // Disabled buttons swallow hover, so the tooltip lives on the wrapper too.
    <span key={a.id} className="tool-wrap" title={a.disabled ? (a.title ?? a.label) : undefined}>
      <button
        className={`tool-button${iconOnly ? " icon-only" : ""}`}
        data-testid={a.testId}
        onClick={a.onClick}
        disabled={a.disabled}
        title={a.title ?? a.label}
        aria-label={a.label}
        aria-pressed={a.pressed}
      >
        {a.icon}
        {!iconOnly && <span className="tool-label">{a.label}</span>}
      </button>
    </span>
  );
  return (
    <div ref={ref} className="reader-toolbar" role="toolbar" aria-label="阅读工具" aria-busy={loading || undefined} data-testid="reader-bar" data-collapse={level}>
      <span className="reader-title" title={title} data-testid="reader-title">
        {title}
      </span>
      {switcher && (
        <div className="bar-group" role="group" aria-label={`${switcher.unit}切换`}>
          <button className="tool-button icon-only" aria-label={`上一${switcher.unit === "页" ? "页" : "个工作表"}`} title={`上一${switcher.unit === "页" ? "页" : "个工作表"}`} disabled={loading || !switcher.canPrev} onClick={switcher.onPrev}>
            ‹
          </button>
          <span className="bar-label" data-testid="switcher-label" aria-live="polite">
            {switcher.label}
          </span>
          <button className="tool-button icon-only" aria-label={`下一${switcher.unit === "页" ? "页" : "个工作表"}`} title={`下一${switcher.unit === "页" ? "页" : "个工作表"}`} disabled={loading || !switcher.canNext} onClick={switcher.onNext}>
            ›
          </button>
        </div>
      )}
      <div className="bar-group" role="group" aria-label="缩放">
        <button className="tool-button icon-only" aria-label="缩小" title="缩小" disabled={loading || nextZoom(zoom, -1) === zoom} onClick={() => onZoom(nextZoom(zoom, -1))}>
          −
        </button>
        <button className="tool-button zoom-value" aria-label="恢复 100%" title="恢复 100%" disabled={loading || zoom === 100} onClick={() => onZoom(100)} data-testid="zoom-value">
          {zoom}%
        </button>
        <button className="tool-button icon-only" aria-label="放大" title="放大" disabled={loading || nextZoom(zoom, 1) === zoom} onClick={() => onZoom(nextZoom(zoom, 1))}>
          +
        </button>
        {fit && !c.fitInMenu && button(fit, c.fitIcon)}
      </div>
      <span className="bar-spacer" />
      {!c.actionsInMenu && actions.map((a) => button(a, c.actionsIcon))}
      {menuItems.length > 0 && (
        <div className="bar-more">
          <button className="tool-button icon-only" aria-label="更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={menu} data-testid="reader-more" onClick={() => setMenu((m) => !m)}>
            <IconMore />
          </button>
          {menu && (
            <div className="menu menu-right" role="menu" onMouseLeave={() => setMenu(false)}>
              {menuItems.map((a) => (
                <button
                  key={a.id}
                  role="menuitem"
                  data-testid={a.testId}
                  disabled={a.disabled}
                  title={a.title ?? a.label}
                  onClick={() => {
                    setMenu(false);
                    a.onClick();
                  }}
                >
                  {a.icon}
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
