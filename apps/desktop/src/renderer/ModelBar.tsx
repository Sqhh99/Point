import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelSpec } from "@point/core";

type Listed = ModelSpec & { configured: boolean };
type List = { providerId: string; providerName: string; configured: boolean; defaultModel?: string; notice?: string; models: Listed[] };

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

  if (!list) return null;
  // No key: main lists nothing. Read-only hint, no dropdown, no preset name.
  if (!list.configured || list.models.length === 0) {
    return (
      <div className="model-bar" data-testid="model-bar" role="group" aria-label="模型和思考">
        <span className="model-empty" data-testid="model-empty">
          未配置模型
        </span>
        <button type="button" className="link settings-link" data-testid="model-open-settings" onClick={onOpenSettings}>
          去设置
        </button>
      </div>
    );
  }
  const active = list.models.find((m) => m.id === model) ?? list.models.find((m) => m.id === list.models[0]?.id);
  const efforts = active?.efforts ?? [];
  const currentEffort = effort && efforts.some((e) => e.id === effort) ? effort : active?.defaultEffort ?? null;

  const pick = async (nextModel: string, nextEffort: string | null) => {
    onChange(nextModel, nextEffort);
    if (conversationId) {
      try {
        await window.point.conversations.setModel(conversationId, nextModel, nextEffort);
      } catch {
        /* ask still works; memory is best-effort */
      }
    }
  };

  return (
    <div className="model-bar" data-testid="model-bar" role="group" aria-label="模型和思考">
      <label className="model-pick">
        <span className="sr-only">模型</span>
        <select
          data-testid="model-select"
          value={active?.id ?? ""}
          onChange={(e) => {
            const m = list.models.find((x) => x.id === e.target.value);
            if (!m) return;
            void pick(m.id, m.defaultEffort);
          }}
        >
          {list.models.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.configured} title={m.configured ? undefined : "未配置密钥"}>
              {m.label}
              {m.vision ? " · 看图" : ""}
              {m.efforts.length ? " · 思考" : ""}
              {m.configured ? "" : "（未配置密钥）"}
            </option>
          ))}
        </select>
      </label>
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
