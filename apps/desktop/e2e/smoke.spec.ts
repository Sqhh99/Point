import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Requires `pnpm build` first: launches the built main entry (out/main/index.js).
let app: ElectronApplication;

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"
    )
  );
  // Linux CI/containers often run as root, where Chromium's sandbox can't start.
  const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await electron.launch({
    args: [...extra, join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-")) }
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("launches and opens the main window", async () => {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  expect(await win.title()).not.toBe("");
  await expect(win.locator("#app")).toBeAttached();
});

test("renderer is isolated from Node", async () => {
  const win = await app.firstWindow();
  const globals = await win.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    module: typeof (globalThis as Record<string, unknown>).module
  }));
  expect(globals).toEqual({ require: "undefined", process: "undefined", module: "undefined" });
});

test("preload exposes the typed window.point API", async () => {
  const win = await app.firstWindow();
  const shape = await win.evaluate(() => {
    const p = (window as unknown as { point?: Record<string, Record<string, unknown>> }).point;
    if (!p) return null;
    const fns = (o: Record<string, unknown>) => Object.keys(o).filter((k) => typeof o[k] === "function").sort();
    return { settings: fns(p.settings), chat: fns(p.chat) };
  });
  expect(shape).toEqual({
    settings: ["get", "setKey", "testConnection", "update"],
    chat: ["cancel", "onEvent", "start"]
  });
});

test("settings never return the plaintext API key", async () => {
  const win = await app.firstWindow();
  const dummy = "sk-e2e-DUMMY-should-never-leak-1234";
  const result = await win.evaluate(async (key) => {
    const api = (window as unknown as { point: import("../src/shared/ipc").PointAPI }).point;
    const encryptionAvailable = (await api.settings.get()).encryptionAvailable;
    if (!encryptionAvailable) return { encryptionAvailable };
    const afterSet = await api.settings.setKey("deepseek", key);
    const afterGet = await api.settings.get();
    return { encryptionAvailable, afterSet: JSON.stringify(afterSet), afterGet: JSON.stringify(afterGet), hasKey: afterGet.providers.find((p) => p.id === "deepseek")?.hasKey };
  }, dummy);
  test.skip(!result.encryptionAvailable, "safeStorage unavailable on this host");
  expect(result.hasKey).toBe(true);
  expect(result.afterSet).not.toContain(dummy);
  expect(result.afterGet).not.toContain(dummy);
});
