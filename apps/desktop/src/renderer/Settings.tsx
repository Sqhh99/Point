import { useEffect, useState } from "react";
import type { ProviderId } from "@point/core";
import type { SettingsView } from "../shared/ipc";

const api = window.point;

export function Settings({ onClose, onSaved }: { onClose(): void; onSaved?(): void }) {
  const [state, setState] = useState<SettingsView | null>(null);
  const [id, setId] = useState<ProviderId>("deepseek");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
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
    setModel(cfg.model);
    setVision(cfg.visionOverride === true);
    setKey("");
  }, [id, state]);

  if (!state || !cfg || !preset) return <div className="placeholder">加载设置…</div>;
  // Preset model id → capability table (read-only); any other id is custom and the user declares vision.
  const modelId = model.trim() || preset.defaultModel;
  const isPreset = preset.models.includes(modelId);
  const presetVision = preset.visionModels.includes(modelId);

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
    <section className="settings">
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
        <input type="text" spellCheck={false} list="model-list" value={model} onChange={(e) => {
            setModel(e.target.value);
          }} />
        <datalist id="model-list">
          {preset.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      {isPreset ? (
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
        <button className="primary" onClick={save} disabled={busy}>
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
