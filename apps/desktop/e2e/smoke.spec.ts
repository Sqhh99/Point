import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
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
    env
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
