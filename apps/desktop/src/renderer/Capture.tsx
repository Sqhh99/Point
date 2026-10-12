import { useEffect, useRef, useState } from "react";
import type { CaptureResult } from "../shared/ipc";
import { dragRect, type Box } from "./layout";

interface Props {
  /** Area that can be captured (client px), usually the reader column. */
  bounds: Box;
  onDone(r: CaptureResult): void;
  onCancel(): void;
  onError(message: string): void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Crosshair overlay: drag a rectangle, release to capture it in main; Esc cancels. */
export function CaptureOverlay({ bounds, onDone, onCancel, onError }: Props) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Box | null>(null);
  const [shooting, setShooting] = useState(false);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const finish = async (r: Box) => {
    // Hide the overlay (dashed frame + dim) before main grabs the pixels.
    setShooting(true);
    await nextFrame();
    await nextFrame();
    try {
      onDone(await window.point.capture.region(r));
    } catch (e) {
      onError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };

  if (shooting) return null;
  return (
    <div
      className="capture-overlay"
      data-testid="capture-overlay"
      role="application"
      aria-label="框选区域截图，按 Esc 取消"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setStart({ x: e.clientX, y: e.clientY });
        setRect(null);
      }}
      onPointerMove={(e) => start && setRect(dragRect(start, { x: e.clientX, y: e.clientY }, bounds))}
      onPointerUp={(e) => {
        if (!start) return;
        const r = dragRect(start, { x: e.clientX, y: e.clientY }, bounds);
        setStart(null);
        if (r) void finish(r);
        else setRect(null);
      }}
    >
      {!rect && <div className="capture-hint">拖动鼠标框选区域 · Esc 取消</div>}
      {rect && (
        <div
          className="capture-rect"
          data-testid="capture-rect"
          style={{ left: rect.x - bounds.x, top: rect.y - bounds.y, width: rect.width, height: rect.height }}
        />
      )}
    </div>
  );
}
