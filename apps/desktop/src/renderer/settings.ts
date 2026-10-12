import type { ProviderId } from "@point/core";
import type { PointAPI, SettingsView } from "../shared/ipc";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function field(label: string, control: HTMLElement, hint?: HTMLElement): HTMLLabelElement {
  return el("label", { className: "field" }, label, control, ...(hint ? [hint] : []));
}

export async function renderSettings(root: HTMLElement, api: PointAPI): Promise<void> {
  let state: SettingsView = await api.settings.get();

  const provider = el("select");
  const baseURL = el("input", { type: "url", spellcheck: false });
  const model = el("input", { type: "text", spellcheck: false });
  const modelList = el("datalist", { id: "model-list" });
  model.setAttribute("list", "model-list");
  const key = el("input", { type: "password", autocomplete: "off", spellcheck: false });
  const keyHint = el("span", { className: "hint" });
  const save = el("button", { className: "primary", textContent: "保存" });
  const test = el("button", { textContent: "测试连接" });
  const status = el("span", { className: "status" });

  for (const p of state.presets) provider.append(el("option", { value: p.id, textContent: p.name }));

  const current = () => provider.value as ProviderId;
  const setStatus = (text: string, kind: "" | "ok" | "err" = "") => {
    status.textContent = text;
    status.className = `status ${kind}`;
  };

  function fill(): void {
    const id = current();
    const cfg = state.providers.find((p) => p.id === id)!;
    const preset = state.presets.find((p) => p.id === id)!;
    baseURL.value = cfg.baseURL;
    baseURL.placeholder = preset.baseURL;
    model.value = cfg.model;
    modelList.replaceChildren(...preset.models.map((m) => el("option", { value: m })));
    key.value = "";
    key.placeholder = cfg.hasKey ? "已保存（留空则不修改）" : "sk-...";
    keyHint.textContent = state.encryptionAvailable ? "API Key 只在本机用系统加密保存，不会再显示" : "系统加密不可用，暂时无法保存 API Key";
    test.disabled = !cfg.hasKey;
  }

  provider.value = state.activeProvider;
  fill();
  provider.addEventListener("change", () => {
    setStatus("");
    fill();
  });

  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const id = current();
      state = await api.settings.update({ id, baseURL: baseURL.value, model: model.value, makeActive: true });
      if (key.value) state = await api.settings.setKey(id, key.value);
      fill();
      setStatus("已保存", "ok");
    } catch (err) {
      setStatus((err as Error).message, "err");
    } finally {
      save.disabled = false;
    }
  });

  test.addEventListener("click", async () => {
    test.disabled = true;
    setStatus("连接中…");
    const r = await api.settings.testConnection(current());
    setStatus(r.ok ? "连接成功" : `失败（${r.code}）：${r.message}`, r.ok ? "ok" : "err");
    test.disabled = false;
  });

  root.replaceChildren(
    el(
      "section",
      { className: "settings" },
      el("h1", { textContent: "模型设置" }),
      field("模型服务", provider),
      field("Base URL", baseURL),
      field("模型", model),
      modelList,
      field("API Key", key, keyHint),
      el("div", { className: "actions" }, save, test, status)
    )
  );
}
