import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ProviderId } from "@point/core";
import type { SettingsView } from "../shared/ipc";
import { settingsFormModel } from "../shared/model-name";

const api = window.point;

export function Settings({ onClose, onSaved }: { onClose(): void; onSaved?(): void }) {
  const [state, setState] = useState<SettingsView | null>(null);
  const [id, setId] = useState<ProviderId>("deepseek");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const modelRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");
  const [vision, setVision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });

  useEffect(() => {
    api.settings.get().then((s) => {
      setState(s);
      setId(s.activeProvider);
    });
  }, []);

  const cfg = state?.providers.find((p) => p.id === id);
  const preset = state?.presets.find((p) => p.id === id);

  useEffect(() => {
    if (!cfg) return;
    setBaseURL(cfg.baseURL);
    setModel(settingsFormModel(cfg));
    // No key: nothing is chosen yet, so the vision toggle starts off too.
    setVision(cfg.hasKey && cfg.visionOverride === true);
    setKey("");
  }, [id, state]);

  if (!state || !cfg || !preset) return <div className="placeholder">加载设置…</div>;
  // Preset model id → capability table (read-only). Only on a custom OpenAI-compatible endpoint (Base
  // URL changed) can another id be used, and then the user declares vision. On a preset endpoint an
  // unknown id is not kept: main falls back to defaultModel (same rule as settings.ts).
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const customEndpoint = norm(baseURL || preset.baseURL) !== norm(preset.baseURL);
  const typed = model.trim() || preset.defaultModel;
  const fallsBack = !customEndpoint && !preset.models.includes(typed);
  const modelId = fallsBack ? preset.defaultModel : typed;
  const isPreset = preset.models.includes(modelId);
  const presetVision = preset.visionModels.includes(modelId);
  // No key and no model typed: nothing is chosen. No model name anywhere, the 看图 toggle starts off, and
  // Save waits for a model id (Save also stores the API Key).
  const unset = !cfg.hasKey && !model.trim();
  // Suggestions: only this service's own preset ids, and only on its preset endpoint. A custom endpoint
  // (e.g. Qwen behind an OpenAI-compatible URL) gets none, so no list pops up. Nothing is preselected or
  // auto-filled; ↑↓ / Enter / Esc are the native list's (no <form>, so nothing submits).
  const suggestions = customEndpoint ? [] : preset.models;

  // Save while no model id: not saved (aria-disabled, still focusable); focus goes to the model field.
  const trySave = () => {
    if (unset) modelRef.current?.focus();
    else void save();
  };
  // Enter in a field does the same only while the model id is missing; otherwise Enter does nothing (as before).
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || !unset) return;
    if (!(e.target instanceof HTMLInputElement) || e.target.type === "checkbox") return;
    e.preventDefault();
    modelRef.current?.focus();
  };

  const save = async () => {
    setBusy(true);
    try {
      // Preset: no user flag (the table decides). Custom: store the declaration as given.
      let s = await api.settings.update({ id, baseURL, model, vision: isPreset ? null : vision, makeActive: true });
      if (key) s = await api.settings.setKey(id, key);
      setState(s);
      setStatus({ text: "已保存", kind: "ok" });
      onSaved?.();
    } catch (e) {
      setStatus({ text: (e as Error).message, kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setStatus({ text: "连接中…", kind: "" });
    const r = await api.settings.testConnection(id);
    setStatus(r.ok ? { text: "连接成功", kind: "ok" } : { text: `失败（${r.code}）：${r.message}`, kind: "err" });
    setBusy(false);
  };

  return (
    <section className="settings" onKeyDown={onEnter}>
      <div className="settings-head">
        <h1>模型设置</h1>
        <button className="link" onClick={onClose}>
          返回阅读
        </button>
      </div>
      <label className="field">
        模型服务
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value as ProviderId);
            setStatus({ text: "", kind: "" });
          }}
        >
          {state.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Base URL
        <input type="url" spellCheck={false} value={baseURL} placeholder={preset.baseURL} onChange={(e) => setBaseURL(e.target.value)} />
      </label>
      <label className="field">
        模型
        <input ref={modelRef} type="text" className="model-id" aria-label="模型" aria-describedby={unset ? "model-id-hint" : undefined} spellCheck={false} list={suggestions.length ? "model-list" : undefined} value={model} placeholder={cfg.hasKey ? undefined : "填写服务商的模型 id"} onChange={(e) => {
            setModel(e.target.value);
          }} />
        {suggestions.length > 0 && (
          <datalist id="model-list">
            {suggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}
        {unset && (
          <span className="hint model-id-hint" id="model-id-hint" data-testid="model-id-hint">
            请先填写模型 id
          </span>
        )}
      </label>
      {fallsBack && (
        <div className="field-readonly" data-testid="model-fallback-hint">
          预设服务只能用列表中的模型，保存后将改用 {preset.defaultModel}
        </div>
      )}
      {unset ? (
        <div className="check-field">
          <label className="check">
            <input type="checkbox" data-testid="vision-toggle" checked={vision} onChange={(e) => setVision(e.target.checked)} />
            支持看图
          </label>
          <span className="hint" data-testid="vision-unset-hint">
            模型支持图片输入时再开启
          </span>
        </div>
      ) : isPreset ? (
        <div className="field-readonly" data-testid="vision-readonly">
          看图：{presetVision ? "支持" : "不支持"}
        </div>
      ) : (
        <div className="check-field">
          <label className="check">
            <input type="checkbox" data-testid="vision-toggle" checked={vision} onChange={(e) => setVision(e.target.checked)} />
            声明此模型支持看图
          </label>
          <span className="hint">由你自行声明，应用会按此判断</span>
        </div>
      )}
      <label className="field">
        API Key
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          placeholder={cfg.hasKey ? "已保存（留空则不修改）" : "sk-..."}
          onChange={(e) => setKey(e.target.value)}
        />
        <span className="hint">{state.encryptionAvailable ? "API Key 只在本机用系统加密保存，不会再显示" : "系统加密不可用，暂时无法保存 API Key"}</span>
      </label>
      <div className="actions">
        <button className="primary" onClick={trySave} disabled={busy} aria-disabled={unset || undefined} aria-describedby={unset ? "model-id-hint" : undefined} title={unset ? "请先填写模型 id" : undefined}>
          保存
        </button>
        <button onClick={test} disabled={busy || !cfg.hasKey}>
          测试连接
        </button>
        <span className={`status ${status.kind}`}>{status.text}</span>
      </div>
    </section>
  );
}
