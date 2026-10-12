import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-")), POINT_FAKE_LLM: "1" }
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

/** Selects the text of the reader paragraph containing `needle` and fires mouseup like a user drag. */
async function selectInReader(win: Awaited<ReturnType<ElectronApplication["firstWindow"]>>, needle: string): Promise<void> {
  await win.getByTestId("reader").evaluate((article, text) => {
    const el = [...article.querySelectorAll("p, li, h1, h2")].find((e) => e.textContent?.includes(text));
    if (!el?.firstChild) throw new Error(`no block with ${text}`);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    article.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, needle);
}

test("selection task streams an answer, inserts it into a note, and draws a diagram", async () => {
  const win = await app.firstWindow();
  const ws = (await win.evaluate(() => window.point.workspace.get())).path!;
  await win.getByTestId("doc-list").getByRole("button", { name: /熵的定义/ }).click();
  await expect(win.getByTestId("reader").locator("h1")).toHaveText("熵的定义");

  await selectInReader(win, "熵是系统无序程度的度量");
  const toolbar = win.getByRole("toolbar", { name: "选区操作" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "解读概念" }).click();

  const log = win.getByTestId("chat-log");
  await expect(log.locator('[data-role="user"]')).toContainText("熵是系统无序程度的度量");
  const answer = log.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("这是 Point 测试用的固定输出");
  // Completed answers render mermaid fences as SVG.
  await expect(answer.locator(".mermaid-figure svg")).toBeVisible({ timeout: 20_000 });

  await answer.getByRole("button", { name: "插入笔记" }).click();
  await expect(answer.getByRole("button", { name: "已插入笔记" })).toBeVisible();
  const files = readdirSync(join(ws, "notes")).filter((f) => f.endsWith(".md"));
  expect(files).toHaveLength(1);
  const raw = readFileSync(join(ws, "notes", files[0]), "utf8");
  const docId = (await win.evaluate(() => window.point.docs.list())).find((d) => d.type === "md")!.id;
  expect(raw).toMatch(/^---\nid: [\w-]+\ntitle: 熵的定义 · 笔记\nsourceDocId: /);
  expect(raw).toContain(`sourceDocId: ${docId}`);
  expect(raw).toMatch(/createdAt: .+\nupdatedAt: .+\ntags: \[\]\n---\n/);
  expect(raw).toContain("这是 Point 测试用的固定输出");

  await win.getByRole("tab", { name: "笔记" }).click();
  await expect(win.getByTestId("note-editor").locator(".note-title")).toHaveValue("熵的定义 · 笔记");

  await selectInReader(win, "广延量");
  await toolbar.getByRole("button", { name: "画图表" }).click();
  await expect(win.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
  await expect(log.locator('[data-role="user"]').last()).toContainText("画图表");
  await expect(log.locator('[data-role="assistant"]').last().locator(".mermaid-figure svg")).toBeVisible({ timeout: 20_000 });

  const conversations = await win.evaluate(() => window.point.conversations.list());
  expect(conversations).toHaveLength(2);
});
