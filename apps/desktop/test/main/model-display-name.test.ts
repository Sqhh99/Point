import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_CONFIGS } from "@point/core";
import { modelDisplayName } from "../../src/shared/model-name.js";

describe("model display name", () => {
  it("is exactly the model id for every preset model (no label, no 看图/思考)", () => {
    for (const p of PROVIDER_CONFIGS) for (const m of p.models) {
      expect(modelDisplayName(m)).toBe(m.id);
      expect(modelDisplayName(m)).not.toMatch(/看图|思考|·/);
    }
  });
  it("ModelBar renders options through modelDisplayName and no longer appends feature tags", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/renderer/ModelBar.tsx"), "utf8");
    expect(src).toContain("{modelDisplayName(m)}");
    expect(src).not.toMatch(/" · 看图"|" · 思考"|\{m\.label\}/);
  });
});
