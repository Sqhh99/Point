import { describe, expect, it } from "vitest";
import { applyWrites, assertBaseUrl, buildOpenAIBody, effortOf, migrateSavedModel, modelSpec, PROVIDER_CONFIGS } from "../src/index";

describe("ModelSpec catalogue", () => {
  it("ships DeepSeek flash/pro with can-disable efforts; legacy names map", () => {
    const flash = modelSpec("deepseek", "deepseek-flash")!;
    expect(flash.vision).toBe(true);
    expect(flash.efforts.map((e) => e.id)).toEqual(["off", "low", "high", "max"]);
    expect(effortOf(flash, "off")!.thinking).toBe(false);
    expect(effortOf(flash, "high")!.writes).toMatchObject({ "thinking.type": "enabled", reasoning_effort: "high" });
    expect(migrateSavedModel("deepseek", "deepseek-chat")).toEqual({ model: "deepseek-flash", effort: "off" });
    expect(migrateSavedModel("deepseek", "deepseek-reasoner")).toEqual({ model: "deepseek-flash", effort: "high" });
    expect(migrateSavedModel("deepseek", "deepseek-unknown-xyz")).toBeNull();
  });

  it("GLM-5.3 cannot disable; GLM-5.2 can; unverified 4.x have empty efforts", () => {
    expect(modelSpec("glm", "glm-5.3")!.efforts.map((e) => e.id)).toEqual(["low", "high", "max"]);
    expect(modelSpec("glm", "glm-5.2")!.efforts.some((e) => e.id === "off")).toBe(true);
    expect(modelSpec("glm", "glm-4-flash")!.efforts).toEqual([]);
  });

  it("OpenAI gpt-6-astra has five levels and no none; gpt-4o efforts empty", () => {
    expect(modelSpec("openai", "gpt-6-astra")!.efforts.map((e) => e.id)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(modelSpec("openai", "gpt-4o")!.efforts).toEqual([]);
  });
});

describe("request body", () => {
  it("applyWrites nests dotted paths", () => {
    const b: Record<string, unknown> = {};
    applyWrites(b, { "thinking.type": "enabled", reasoning_effort: "high" });
    expect(b).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  });

  it("thinking on: effort writes applied, temperature omitted", () => {
    const body = buildOpenAIBody([{ role: "user", content: "hi" }], {
      model: "deepseek-flash",
      temperature: 0.7,
      omitTemperature: true,
      effortWrites: effortOf(modelSpec("deepseek", "deepseek-flash")!, "high")!.writes
    });
    expect(body.temperature).toBeUndefined();
    expect(body).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  });

  it("thinking off: temperature kept, thinking disabled", () => {
    const body = buildOpenAIBody([{ role: "user", content: "hi" }], {
      model: "deepseek-flash",
      temperature: 0.2,
      omitTemperature: false,
      effortWrites: effortOf(modelSpec("deepseek", "deepseek-flash")!, "off")!.writes
    });
    expect(body.temperature).toBe(0.2);
    expect(body).toMatchObject({ thinking: { type: "disabled" } });
  });
});

describe("assertBaseUrl", () => {
  it.each(["https://api.deepseek.com/v1", "https://example.com", "http://localhost:8080", "http://127.0.0.1/v1"])("allows %s", (u) => {
    expect(assertBaseUrl(u)).toMatch(/^https?:/);
  });
  it.each(["http://evil.test", "ftp://x", "not-a-url", ""])("rejects %s", (u) => {
    expect(() => assertBaseUrl(u)).toThrow();
  });
});

describe("PROVIDER_CONFIGS", () => {
  it("every model defaultEffort is in its efforts list (or null when empty)", () => {
    for (const p of PROVIDER_CONFIGS) {
      for (const m of p.models) {
        if (m.efforts.length === 0) expect(m.defaultEffort).toBeNull();
        else expect(m.efforts.some((e) => e.id === m.defaultEffort)).toBe(true);
      }
    }
  });
});
