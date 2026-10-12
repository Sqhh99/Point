import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

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

/** Makes the next native open dialog return `paths` without showing UI. */
async function stubOpenDialog(paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, paths);
}

test("imports documents into a workspace and renders them in the reader", async () => {
  const win = await app.firstWindow();
  const root = mkdtempSync(join(tmpdir(), "point-ws-"));
  const src = mkdtempSync(join(tmpdir(), "point-src-"));
  const md = join(src, "entropy.md");
  writeFileSync(md, "# 熵的定义\n\n熵是系统无序程度的度量。\n\n- 广延量\n");
  const pdf = join(src, "paper.pdf");
  writeFileSync(pdf, makePdf([["Entropy in PDF"], ["Second page line"]]));

  await stubOpenDialog([root]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await expect(win.locator(".workspace-name")).toHaveText(/point-ws-/);

  await stubOpenDialog([md]);
  await win.getByRole("button", { name: "导入文档" }).click();
  const list = win.getByTestId("doc-list");
  await expect(list.getByRole("button", { name: /熵的定义/ })).toBeVisible();
  const reader = win.getByTestId("reader");
  await expect(reader.locator("h1")).toHaveText("熵的定义");
  await expect(reader.locator("li")).toHaveText("广延量");

  await stubOpenDialog([pdf]);
  await win.getByRole("button", { name: "导入文档" }).click();
  await expect(list.getByRole("button", { name: /paper/ })).toBeVisible();
  await expect(reader).toContainText("Entropy in PDF");
  await expect(reader.locator('[data-page="2"]')).toHaveText("Second page line");

  const docs = await win.evaluate(() => window.point.docs.list());
  expect(docs.map((d) => [d.type, d.path.startsWith("docs/")])).toEqual([
    ["pdf", true],
    ["md", true]
  ]);
});

test("settings page is reachable from the library", async () => {
  const win = await app.firstWindow();
  await win.getByRole("button", { name: "设置" }).click();
  await expect(win.getByRole("heading", { name: "模型设置" })).toBeVisible();
  await win.getByRole("button", { name: "返回阅读" }).click();
});
