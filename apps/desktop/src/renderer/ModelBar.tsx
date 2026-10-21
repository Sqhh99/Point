import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ModelSpec } from "@point/core";
import { modelDisplayName } from "../shared/model-name.js";

type Listed = ModelSpec & { configured: boolean };
type List = { providerId: string; providerName: string; configured: boolean; defaultModel?: string; notice?: string; models: Listed[] };

/** Small eye mark for models that accept images — kept next to the id, same mute colour as other chrome icons. */
function VisionIcon() {
  return (
    <svg className="model-cap-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 3C4.5 3 1.7 5.1 1 8c.7 2.9 3.5 5 7 5s6.3-2.1 7-5c-.7-2.9-3.5-5-7-5Zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4Zm0-1.6A1.6 1.6 0 1 0 8 6.4a1.6 1.6 0 0 0 0 3.2Z"
      />
    </svg>
  );
}

/**
 * One row above the input: current-provider model dropdown (left) and thinking-level control (right).
 * Provider switching stays in Settings; this list is only that provider's models.
 * Re-fetches on mount and whenever main broadcasts `settings:changed` (not only on conversationId).
 */
export function ModelBar({
  conversationId,
  model,
  effort,
  onChange,
  onOpenSettings
}: {
  conversationId: string | null;
  model: string | null;
  effort: string | null;
  onChange(model: string, effort: string | null): void;
  onOpenSettings(): void;
}) {
  const [list, setList] = useState<List | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const refresh = useCallback(() => {
    window.point.models.list().then(setList, () => setList(null));
  }, []);

  useEffect(() => {
    refresh();
    return window.point.settings.onChanged(refresh);
  }, [refresh]);

  // When the selected model disappears after a settings change, fall back to the Settings model.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!list?.models.length) return;
    if (model && list.models.some((m) => m.id === model && m.configured)) return;
    const def = list.models.find((m) => m.id === list.defaultModel) ?? list.models[0];
    if (def) onChangeRef.current(def.id, def.defaultEffort);
  }, [list, model]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keep the highlighted row in view while moving with the keyboard.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.focus();
    listRef.current.querySelector<HTMLElement>(`[data-active="true"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  if (!list) return null;
  // No key: main lists nothing. Read-only hint, no dropdown, no preset name.
  if (!list.configured || list.models.length === 0) {
    return (
      <div className="model-bar" data-testid="model-bar" role="group" aria-label="模型和思考">
        <span className="model-empty" data-testid="model-empty">
          未配置模型
        </span>
        <button type="button" className="model-settings-btn" data-testid="model-open-settings" onClick={onOpenSettings}>
          去设置
        </button>
      </div>
    );
  }
  const models = list.models;
  const active = models.find((m) => m.id === model) ?? models[0];
  const efforts = active?.efforts ?? [];
  const currentEffort = effort && efforts.some((e) => e.id === effort) ? effort : active?.defaultEffort ?? null;

  const pick = async (nextModel: string, nextEffort: string | null) => {
    onChange(nextModel, nextEffort);
    setOpen(false);
    if (conversationId) {
      try {
        await window.point.conversations.setModel(conversationId, nextModel, nextEffort);
      } catch {
        /* ask still works; memory is best-effort */
      }
    }
  };

  const openMenu = () => {
    const i = Math.max(0, models.findIndex((m) => m.id === active?.id));
    setActiveIdx(i);
    setOpen(true);
  };

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      else if (e.key === "Enter" || e.key === " ") {
        const m = models[activeIdx];
        if (m?.configured) void pick(m.id, m.defaultEffort);
      } else if (e.key === "ArrowDown") setActiveIdx((i) => Math.min(models.length - 1, i + 1));
      else if (e.key === "ArrowUp") setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(models.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const m = models[activeIdx];
      if (m?.configured) void pick(m.id, m.defaultEffort);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(models.length - 1);
    }
  };

  return (
    <div className="model-bar" data-testid="model-bar" role="group" aria-label="模型和思考">
      <div className="model-pick" ref={wrapRef}>
        <button
          type="button"
          className="model-trigger"
          data-testid="model-select"
          data-value={active?.id ?? ""}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onTriggerKey}
        >
          <span className="model-trigger-label">
            {active ? modelDisplayName(active) : "选择模型"}
            {active?.vision ? <VisionIcon /> : null}
          </span>
          <span className="model-trigger-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && (
          <div
            className="model-popover"
            data-testid="model-select-list"
            id={listId}
            role="listbox"
            aria-label="模型"
            tabIndex={-1}
            ref={listRef}
            onKeyDown={onListKey}
          >
            <div className="model-popover-scroll">
              {models.map((m, i) => {
                const selected = m.id === active?.id;
                const disabled = !m.configured;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    data-value={m.id}
                    data-active={i === activeIdx ? "true" : undefined}
                    aria-selected={selected}
                    disabled={disabled}
                    title={disabled ? "未配置密钥" : undefined}
                    className={`model-option${selected ? " selected" : ""}${i === activeIdx ? " active" : ""}`}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => !disabled && void pick(m.id, m.defaultEffort)}
                  >
                    <span className="model-option-label">
                      {modelDisplayName(m)}
                      {disabled ? "（未配置密钥）" : ""}
                      {m.vision ? <VisionIcon /> : null}
                    </span>
                    {selected ? (
                      <span className="model-option-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="model-popover-footer">
              <button
                type="button"
                className="model-settings-btn"
                data-testid="model-open-settings"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
              >
                去设置
              </button>
            </div>
          </div>
        )}
      </div>
      {efforts.length > 0 && (
        <div className="effort-seg" data-testid="effort-control" role="group" aria-label="思考等级">
          {efforts.map((e) => (
            <button
              key={e.id}
              type="button"
              className={currentEffort === e.id ? "active" : undefined}
              aria-pressed={currentEffort === e.id}
              data-testid={`effort-${e.id}`}
              onClick={() => active && void pick(active.id, e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
