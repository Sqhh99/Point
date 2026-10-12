import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, dialog: {}, shell: {} }));
const { checkForUpdate, isNewer } = await import("../../src/main/update-check.js");

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
const url = "https://github.com/Sqhh99/Point/releases/tag/v0.2.0";

describe("update check", () => {
  it("compares versions numerically", () => {
    expect(isNewer("v0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
    expect(isNewer("v1.0", "0.9.9")).toBe(true);
  });

  it("reports a newer published release", async () => {
    expect(await checkForUpdate("0.1.0", reply({ tag_name: "v0.2.0", html_url: url }))).toEqual({ version: "0.2.0", url });
  });

  it("stays quiet when up to date, on errors, drafts, or foreign links", async () => {
    expect(await checkForUpdate("0.2.0", reply({ tag_name: "v0.2.0", html_url: url }))).toBeNull();
    expect(await checkForUpdate("0.1.0", reply({}, false))).toBeNull();
    expect(await checkForUpdate("0.1.0", reply({ tag_name: "v0.2.0", html_url: url, prerelease: true }))).toBeNull();
    expect(await checkForUpdate("0.1.0", reply({ tag_name: "v0.2.0", html_url: "https://evil.example/x" }))).toBeNull();
    const boom = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", boom)).toBeNull();
  });
});
