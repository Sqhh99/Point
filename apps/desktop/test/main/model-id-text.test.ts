import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_CONFIGS } from "@point/core";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { NO_VISION_MESSAGE, VISION_EXAMPLE_IDS } = await import("../../src/shared/vision-text.js");
const { modelTooltip, settingsFormModel } = await import("../../src/shared/model-name.js");
const settings = await import("../../src/main/settings.js");
const { app } = await import("electron");

const write = (deepseek: Record<string, unknown>) =>
  writeFileSync(join(app.getPath("userData"), "settings.json"), JSON.stringify({ activeProvider: "deepseek", providers: { deepseek: { encKey: "eA==", ...deepseek } } }));

describe("no-vision message names models by the id the API is called with", () => {
  it("lists deepseek-flash、gpt-4o、glm-4v-flash, not the old labels", () => {
    expect(NO_VISION_MESSAGE).toContain("例如 deepseek-flash、gpt-4o、glm-4v-flash）");
    expect(NO_VISION_MESSAGE).not.toMatch(/DeepSeek Flash|GPT-4o|GLM-4V Flash/);
  });
  it("every example is a preset model id that reads images", () => {
    const all = PROVIDER_CONFIGS.flatMap((p) => p.models);
    for (const id of VISION_EXAMPLE_IDS) expect(all.find((m) => m.id === id)?.vision, id).toBe(true);
  });
});

describe("status-bar model tooltip", () => {
  it("preset endpoint: 「服务名 · id」; no service name: just the id", () => {
    expect(modelTooltip({ providerName: "OpenAI GPT", model: "gpt-4o" })).toBe("OpenAI GPT · gpt-4o");
    expect(modelTooltip({ providerName: "", model: "mock-math" })).toBe("mock-math");
  });
  it("StatusBar renders the tooltip through modelTooltip (no hard-coded `${providerName} · `)", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/renderer/StatusBar.tsx"), "utf8");
    expect(src).toContain("title={modelTooltip(model)}");
    expect(src).not.toContain("${model.providerName} · ");
  });
  it("custom endpoint: models:list and view() carry no DeepSeek name; the preset endpoint keeps it", () => {
    write({ baseURL: "http://127.0.0.1:9/v1", model: "mock-math" });
    expect(settings.listModels().providerName).toBe("");
    expect(settings.view().active).toMatchObject({ providerName: "", model: "mock-math" });
    expect(modelTooltip(settings.view().active)).toBe("mock-math");
    // A preset id picked on that custom endpoint is still not served by DeepSeek.
    write({ baseURL: "http://127.0.0.1:9/v1", model: "deepseek-flash" });
    expect(settings.view().active).toMatchObject({ providerName: "", model: "deepseek-flash" });
    write({ baseURL: "https://api.deepseek.com/v1", model: "deepseek-flash" });
    expect(settings.listModels().providerName).toBe("DeepSeek");
    expect(modelTooltip(settings.view().active)).toBe("DeepSeek · deepseek-flash");
  });
});

describe("Settings form without a key", () => {
  it("starts with an empty model field; with a key it shows the saved model", () => {
    expect(settingsFormModel({ hasKey: false, model: "deepseek-flash" })).toBe("");
    expect(settingsFormModel({ hasKey: true, model: "deepseek-v4-pro" })).toBe("deepseek-v4-pro");
  });
  it("Settings: empty field with a neutral placeholder, 看图 toggle off with a hint, Save disabled until a model id is typed", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/renderer/Settings.tsx"), "utf8");
    expect(src).toContain("setModel(settingsFormModel(cfg));");
    expect(src).not.toContain("setModel(cfg.model);");
    expect(src).toContain("setVision(cfg.hasKey && cfg.visionOverride === true);");
    expect(src).toMatch(/const unset = !cfg\.hasKey && !model\.trim\(\);/);
    expect(src).toContain('placeholder={cfg.hasKey ? undefined : "填写服务商的模型 id"}');
    expect(src).toContain("模型支持图片输入时再开启");
    expect(src).toContain('disabled={busy || unset} title={unset ? "请先填写模型 id" : undefined}');
    const css = readFileSync(join(import.meta.dirname, "../../src/renderer/style.css"), "utf8");
    expect(css).toContain(".model-id::placeholder { color: var(--text-disabled); }");
  });
});
