import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first: launches the built main entry (out/main/index.js).
let app: ElectronApplication;

// Every test shares one Electron app and builds on the state the previous ones left
// (workspace, imported docs, the note from 插入笔记). Run them as one serial group so a
// failure skips the rest instead of cascading into 30s timeouts, and a CI retry relaunches
// the app and replays the whole file rather than one test against an empty workspace.
test.describe.configure({ mode: "serial" });

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

test("custom title bar replaces the native frame", async () => {
  const win = await app.firstWindow();
  const bar = win.getByTestId("titlebar");
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())?.height).toBe(36);
  if (process.platform !== "darwin") {
    await expect(bar.getByRole("button", { name: "最小化" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "关闭" })).toBeVisible();
  }
  await win.screenshot({ path: join(import.meta.dirname, "..", "test-results", "titlebar.png") });
  await expect(win.evaluate(() => window.point.window.action("setBounds" as never))).rejects.toThrow();
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

/** Makes the next native save dialog return `filePath` without showing UI. */
async function stubSaveDialog(filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, filePath);
}

test("empty state offers 打开工作区 and 打开文件", async () => {
  const win = await app.firstWindow();
  const empty = win.getByTestId("empty-state");
  await expect(empty.getByRole("button", { name: /打开工作区/ })).toBeVisible();
  await expect(empty.getByRole("button", { name: /打开文件/ })).toBeVisible();
  await win.screenshot({ path: join(import.meta.dirname, "..", "test-results", "empty-state.png") });
});

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

  // CSV goes through the same SheetJS path as .xlsx (the real-xlsx cases live in core's xlsx.test.ts).
  const sheet = join(src, "scores.csv");
  writeFileSync(sheet, "姓名,分数\n张三,90\n");
  await stubOpenDialog([sheet]);
  await win.getByRole("button", { name: "导入文档" }).click();
  await win.getByRole("button", { name: "Excel scores" }).click();
  await expect(reader.locator("td").filter({ hasText: "张三" })).toBeVisible();
  await win.screenshot({ path: join(import.meta.dirname, "..", "test-results", "xlsx.png") });

  const docs = await win.evaluate(() => window.point.docs.list());
  expect(docs.map((d) => [d.type, d.path.startsWith("docs/")])).toEqual([
    ["xlsx", true],
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

  // Esc dismisses the toolbar.
  await selectInReader(win, "熵是系统无序程度的度量");
  const toolbar = win.getByRole("toolbar", { name: "选区操作" });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button")).toHaveText(["解读概念", "记笔记", "画图表", "问 AI"]);
  await win.keyboard.press("Escape");
  await expect(toolbar).toBeHidden();

  await selectInReader(win, "熵是系统无序程度的度量");
  await toolbar.getByRole("button", { name: "解读概念" }).click();
  await expect(toolbar).toBeHidden();

  const log = win.getByTestId("chat-log");
  await expect(log.getByTestId("quote-card").last()).toContainText("熵是系统无序程度的度量");
  await expect(log.getByTestId("quote-card").last()).toContainText("《熵的定义》");
  await expect(log.locator('[data-role="user"]').last()).toHaveText("解读概念");
  const answer = log.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("这是 Point 测试用的固定输出");
  // Completed answers render mermaid fences as SVG inside a card with a 图/源码 toggle.
  const card = answer.locator(".mermaid-card");
  await expect(card.locator(".mermaid-figure svg")).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "源码" }).click();
  await expect(card.locator("pre")).toContainText("flowchart TD");
  await card.getByRole("button", { name: "图" }).click();
  await expect(card.locator(".mermaid-figure svg")).toBeVisible();

  await answer.hover();
  await answer.getByRole("button", { name: "插入笔记" }).click();
  await expect(win.getByRole("tab", { name: "笔记" })).toHaveAttribute("aria-selected", "true");
  await expect(win.getByTestId("note-flash")).toContainText("这是 Point 测试用的固定输出");
  const files = readdirSync(join(ws, "notes")).filter((f) => f.endsWith(".md"));
  expect(files).toHaveLength(1);
  const raw = readFileSync(join(ws, "notes", files[0]), "utf8");
  const docId = (await win.evaluate(() => window.point.docs.list())).find((d) => d.type === "md")!.id;
  // Note ids are 8 hex chars; ~3% are all digits (or digits+e), which YAML quotes to keep
  // them strings, e.g. `id: "37259515"`. Both forms are valid.
  expect(raw, raw).toMatch(/^---\nid: (?:[\w-]+|"[\w-]+")\ntitle: 熵的定义 · 笔记\nsourceDocId: /);
  expect(raw).toContain(`sourceDocId: ${docId}`);
  expect(raw).toMatch(/createdAt: .+\nupdatedAt: .+\ntags: \[\]\n---\n/);
  expect(raw).toContain("这是 Point 测试用的固定输出");
  await expect(win.getByTestId("note-editor").locator(".note-title")).toHaveValue("熵的定义 · 笔记");
  await expect(win.getByTestId("note-flash")).toBeHidden({ timeout: 5_000 });

  await selectInReader(win, "广延量");
  await toolbar.getByRole("button", { name: "画图表" }).click();
  await expect(win.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
  await expect(log.locator('[data-role="user"]').last()).toHaveText("画图表");
  await expect(log.locator('[data-role="assistant"]').last().locator(".mermaid-figure svg")).toBeVisible({ timeout: 20_000 });

  const conversations = await win.evaluate(() => window.point.conversations.list());
  expect(conversations).toHaveLength(2);
});

test("AI output is treated as untrusted: raw HTML and hostile mermaid do not execute", async () => {
  const win = await app.firstWindow();
  await win.getByRole("tab", { name: "对话" }).click();
  const input = win.locator(".composer textarea");
  await input.fill("XSS-PROBE 请回答");
  await input.press("Enter");

  const log = win.getByTestId("chat-log");
  const answer = log.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("探针回答");
  // Raw HTML is rendered as literal text, not as elements.
  await expect(answer).toContainText("<img src=x onerror=");
  await expect(answer).toContainText("<script>");
  await expect(answer.locator(".mermaid-figure svg, pre.mermaid-error").first()).toBeAttached({ timeout: 20_000 });
  await win.waitForTimeout(500);

  expect(await answer.locator("img, script, iframe").count()).toBe(0);
  expect(await answer.locator('[onerror], [onclick], a[href^="javascript:"]').count()).toBe(0);
  expect(await win.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
  // Clicking the diagram nodes must not run anything either.
  for (const node of await answer.locator(".mermaid-figure svg .node").all()) await node.click({ force: true });
  expect(await win.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
});

test("model errors show inline with a reason and 重试", async () => {
  const win = await app.firstWindow();
  await win.getByRole("tab", { name: "对话" }).click();
  const input = win.locator(".composer textarea");
  await input.fill("RATE-LIMIT-PROBE");
  await win.getByRole("button", { name: "发送" }).click();
  const err = win.getByTestId("chat-error");
  await expect(err).toContainText("被模型服务限流");
  await expect(err.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(win.getByRole("dialog")).toHaveCount(0);
});

test("exports the current note as md and all notes as a zip", async () => {
  const win = await app.firstWindow();
  const out = mkdtempSync(join(tmpdir(), "point-export-"));
  const single = join(out, "entropy-note.md");
  const zipPath = join(out, "notes.zip");

  // Open the note created by the earlier "插入笔记" flow (shared Electron app).
  await win.getByRole("tab", { name: "笔记" }).click();
  const editor = win.getByTestId("note-editor");
  if (!(await editor.isVisible())) {
    await win.getByTestId("note-list").getByRole("button").first().click();
  }
  await expect(editor.locator(".note-title")).toHaveValue(/笔记/);

  await stubSaveDialog(single);
  await win.getByTestId("export-menu").click();
  await win.getByRole("menuitem", { name: "另存为…" }).click();
  await expect(win.getByTestId("export-toast")).toHaveText("已导出");
  await expect.poll(() => existsSync(single)).toBe(true);
  const raw = readFileSync(single, "utf8");
  expect(raw).toMatch(/^---\ntitle: .+\ntags: \[\]\nsource: 《熵的定义》\nexported_at: /);
  expect(raw).toContain("这是 Point 测试用的固定输出");
  expect(raw).not.toContain("\nid: ");
  expect(raw).not.toContain("sourceDocId:");
  await expect(win.getByTestId("export-toast")).toBeHidden({ timeout: 5_000 });

  // Create a second note so the zip has more than one file.
  await win.getByRole("button", { name: "‹ 全部笔记" }).click();
  await win.getByRole("button", { name: "新建笔记" }).click();
  await editor.locator(".note-title").fill("补充笔记");
  await editor.locator(".note-body").fill("第二条笔记正文");
  await win.getByRole("button", { name: "保存" }).click();

  await stubSaveDialog(zipPath);
  await win.getByTestId("export-menu").click();
  await win.getByRole("menuitem", { name: "打包导出…" }).click();
  await expect(win.getByTestId("export-toast")).toHaveText("已导出");
  await expect.poll(() => existsSync(zipPath)).toBe(true);

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  expect(names.length).toBeGreaterThanOrEqual(2);
  const joined = (await Promise.all(names.map(async (n) => zip.file(n)!.async("string")))).join("\n");
  expect(joined).toContain("exported_at:");
  expect(joined).toContain("这是 Point 测试用的固定输出");
  expect(joined).toContain("第二条笔记正文");

  // Conversation export (secondary hover action).
  await win.getByRole("tab", { name: "对话" }).click();
  const answer = win.getByTestId("chat-log").locator('[data-role="assistant"]').last();
  await answer.hover();
  const convOut = join(out, "conversation.md");
  await stubSaveDialog(convOut);
  await answer.getByRole("button", { name: "导出对话为 md" }).click();
  await expect(answer.getByRole("button", { name: "已导出" })).toBeVisible();
  const conv = readFileSync(convOut, "utf8");
  expect(conv).toContain("type: conversation");
  expect(conv).toContain("### AI");
});
