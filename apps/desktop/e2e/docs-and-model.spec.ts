import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { makeDocx } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first. Assertions are user-visible text and roles only (no tags or class
// names), so they survive a change of the document renderer.
// SheetJS lives in packages/core (not a dependency of this app): load it from there, typed minimally.
const XLSX = createRequire(import.meta.url)("../../../packages/core/node_modules/xlsx/xlsx.js") as {
  utils: { book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, name: string): void; aoa_to_sheet(rows: unknown[][]): unknown };
  write(wb: unknown, o: { type: "array"; bookType: "xlsx" }): ArrayBuffer;
};
const results = join(import.meta.dirname, "..", "test-results");
const launchEnv = (extra: Record<string, string>, drop: string[] = []) => ({
  ...(Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL" && !drop.includes(e[0]))) as Record<string, string>),
  ...extra
});
// Local Linux only: POINT_E2E_KEYRING=1 routes safeStorage to a gnome-keyring the caller started
// (see keystore-preload.cjs). CI (win/mac) never sets it.
const keyring = process.platform === "linux" && process.env.POINT_E2E_KEYRING === "1" ? ["-r", join(import.meta.dirname, "keystore-preload.cjs")] : [];
const launch = (env: Record<string, string>) =>
  electron.launch({ args: [...keyring, ...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")], env });
/**
 * Key-save cases need OS encryption. On CI (win DPAPI, mac keychain) it must be there, so a missing
 * store turns the test red; only a local run without a keyring may skip.
 */
async function requireEncryption(win: Win): Promise<void> {
  const encryption = await win.evaluate(async () => (await window.point.settings.get()).encryptionAvailable);
  if (process.env.CI) expect(encryption, "safeStorage must be available on CI").toBe(true);
  else test.skip(!encryption, "local run without an OS keyring (set POINT_E2E_KEYRING=1 under gnome-keyring)");
}
const stub = (app: ElectronApplication, paths: string[]) =>
  app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, paths);
type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
/** Last branch: its source anchor (offsets + slice) and the selection text the branch question carries. */
const lastBranch = (win: Win) =>
  win.evaluate(async () => {
    const [c] = await window.point.conversations.list();
    const tree = await window.point.conversations.tree(c!.id);
    const o = tree.origins.at(-1)!;
    const src = tree.messages.find((m) => m.id === o.sourceId)!;
    const child = tree.messages.find((m) => m.id === o.childId)!;
    return { quote: o.quote, slice: src.content.slice(o.start, o.end), selection: child.meta?.request.selection ?? null };
  });
async function openWorkspace(app: ElectronApplication, win: Win): Promise<void> {
  await stub(app, [mkdtempSync(join(tmpdir(), "point-ws-"))]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await expect(win.locator(".workspace-name")).toHaveText(/point-ws-/);
}

test.describe("real .docx and .xlsx in the reader", () => {
  test.describe.configure({ mode: "serial" });
  let app: ElectronApplication;
  test.beforeAll(async () => {
    app = await launch(launchEnv({ POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-")), POINT_FAKE_LLM: "1" }));
  });
  test.afterAll(async () => {
    await app?.close();
  });

  test("a .docx shows its heading and paragraphs", async () => {
    const win = await app.firstWindow();
    await openWorkspace(app, win);
    const src = mkdtempSync(join(tmpdir(), "point-src-"));
    const docx = join(src, "report.docx");
    writeFileSync(docx, await makeDocx([{ style: "Heading1", text: "季度报告" }, { text: "收入同比增长百分之十二。" }, { style: "Heading2", text: "风险" }, { text: "汇率波动是主要风险。" }]));
    await stub(app, [docx]);
    await win.getByRole("button", { name: "导入文档" }).click();
    const reader = win.getByTestId("reader");
    await expect(reader.getByText("季度报告", { exact: true })).toBeVisible();
    await expect(reader.getByText("收入同比增长百分之十二。")).toBeVisible();
    await expect(reader.getByText("汇率波动是主要风险。")).toBeVisible();
    await expect(win.getByTestId("doc-list").getByRole("button", { name: /季度报告/ })).toBeVisible();
    await win.screenshot({ path: join(results, "docs-docx.png") });
  });

  test("a two-sheet .xlsx shows each sheet's cell values", async () => {
    const win = await app.firstWindow();
    const src = mkdtempSync(join(tmpdir(), "point-src-"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["姓名", "分数"], ["张三", 90], ["李四", 85]]), "成绩");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["城市", "人口"], ["北京", 2189], ["上海", 2487]]), "城市");
    const file = join(src, "book.xlsx");
    writeFileSync(file, new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    await stub(app, [file]);
    await win.getByRole("button", { name: "导入文档" }).click();
    await win.getByTestId("doc-list").getByRole("button", { name: /book/ }).click();
    const reader = win.getByTestId("reader");
    for (const v of ["姓名", "张三", "90", "李四", "85"]) await expect(reader.getByText(v, { exact: true })).toBeVisible();
    // Switching sheets: today every sheet is listed one under another, so there is no switch control.
    // If the viewer gains sheet tabs, click them; either way the other sheet's values must be reachable.
    const tab = win.getByRole("tab", { name: "城市" }).or(win.getByRole("button", { name: "城市", exact: true }));
    const hasSwitcher = (await tab.count()) > 0;
    test.info().annotations.push({ type: "sheet-switcher", description: hasSwitcher ? "sheet tab clicked" : "no switcher in the viewer: all sheets are shown in one scroll" });
    if (hasSwitcher) await tab.first().click();
    for (const v of ["城市", "北京", "2189", "上海", "2487"]) await expect(reader.getByText(v, { exact: true }).first()).toBeVisible();
    await win.screenshot({ path: join(results, "docs-xlsx.png") });
    const types = (await win.evaluate(() => window.point.docs.list())).map((d) => d.type).sort();
    expect(types).toEqual(["docx", "xlsx"]);
  });
});

test.describe("model settings (real settings path, no fake LLM)", () => {
  test.describe.configure({ mode: "serial" });
  const userData = mkdtempSync(join(tmpdir(), "point-e2e-model-"));
  let app: ElectronApplication;
  // Runs without POINT_FAKE_LLM so the real settings path (keys, configured) is used. Nothing here
  // calls a model: only settings are saved and displayed.
  const start = async () => {
    app = await launch(launchEnv({ POINT_USER_DATA: userData }, ["POINT_FAKE_LLM", "POINT_FAKE_VISION"]));
    const win = await app.firstWindow();
    return win;
  };
  test.afterAll(async () => {
    await app?.close();
  });

  // Each provider needs its own (dummy) key: without one nothing is configured and the status bar
  // shows 未配置. No request is ever sent with it.
  const save = async (win: Win, provider: string, model: string) => {
    await win.getByLabel("模型服务").selectOption({ label: provider });
    await win.getByLabel("模型", { exact: true }).fill(model);
    await win.getByLabel("API Key").fill("sk-e2e-dummy-000");
    await win.getByRole("button", { name: "保存" }).click();
    await expect(win.getByText("已保存", { exact: true })).toBeVisible();
  };

  /** The status bar re-reads the active model when settings are left (App.tsx:97), so check it there. */
  const leaveAndReopen = async (win: Win) => {
    await win.getByRole("button", { name: "返回阅读" }).click();
    await expect(win.getByRole("heading", { name: "模型设置" })).toBeHidden();
  };

  test("no key: no selectable model, no DeepSeek default, asking is blocked with a clear reason", async () => {
    const win = await start();
    await openWorkspace(app, win);
    const list = await win.evaluate(() => window.point.models.list());
    expect(list.configured).toBe(false);
    expect(list.models).toEqual([]);
    const bar = win.getByTestId("model-bar");
    await expect(bar.getByTestId("model-empty")).toHaveText("未配置模型");
    await expect(bar.getByTestId("model-select")).toHaveCount(0);
    await expect(bar.getByTestId("effort-control")).toHaveCount(0);
    await expect(bar).not.toContainText(/deepseek/i);
    await expect(win.getByTestId("status-unconfigured")).toHaveText("未配置");
    await expect(win.getByTestId("status-model")).toHaveCount(0);
    await expect(win.getByTestId("status-vision")).toHaveCount(0);
    await expect(win.locator(".statusbar")).not.toContainText(/deepseek/i);
    await win.screenshot({ path: join(results, "unconfigured-modelbar.png") });

    // Send is disabled up front; main still refuses before any write (called over IPC directly).
    await win.getByPlaceholder(/问点什么/).fill("没有模型时提问");
    await expect(win.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
    const refused = await win.evaluate(async () => {
      const n0 = (await window.point.conversations.list()).length;
      const e = await window.point.tasks.run({ kind: "ask", selection: "", question: "x" }).then(
        () => null,
        (x: Error) => String(x.message)
      );
      return { e, n0, n1: (await window.point.conversations.list()).length };
    });
    expect(refused.e).toMatch(/尚未配置模型/);
    expect(refused.n0).toBe(0);
    expect(refused.n1).toBe(0);

    await bar.getByTestId("model-open-settings").click();
    await expect(win.getByRole("heading", { name: "模型设置" })).toBeVisible();
    await expect(win.getByTestId("status-unconfigured")).toHaveText("未配置");
    // No key: the form chooses nothing for the user (UI设计员 empty-state spec): empty model field with a
    // neutral placeholder, 看图 toggle off with a hint, Save disabled until a model id is typed.
    const modelField = win.getByLabel("模型", { exact: true });
    const saveBtn = win.getByRole("button", { name: "保存" });
    const emptyState = async () => {
      await expect(modelField).toHaveValue("");
      await expect(modelField).toHaveAttribute("placeholder", "填写服务商的模型 id");
      await expect(win.getByTestId("vision-readonly")).toHaveCount(0);
      await expect(win.getByTestId("vision-toggle")).not.toBeChecked();
      await expect(win.getByTestId("vision-unset-hint")).toHaveText("模型支持图片输入时再开启");
      await expect(saveBtn).toBeDisabled();
      await expect(saveBtn).toHaveAttribute("title", "请先填写模型 id");
      await expect(win.locator(".settings")).not.toContainText(/deepseek-|gpt-|glm-/i);
    };
    await emptyState();
    // Chromium's getComputedStyle has no ::placeholder: check the loaded rule instead (a token, no literal colour).
    await expect(modelField).toHaveClass(/\bmodel-id\b/);
    const placeholderRule = await win.evaluate(() =>
      [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === ".model-id::placeholder").map((r) => r.style.color)
    );
    expect(placeholderRule).toEqual(["var(--text-disabled)"]);
    await win.getByLabel("模型服务").selectOption({ label: "OpenAI GPT" });
    await emptyState();
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
    await emptyState();
    for (const scheme of ["light", "dark"] as const) {
      await win.emulateMedia({ colorScheme: scheme });
      await win.locator(".settings").screenshot({ path: join(results, "screenshots", `unconfigured-form-${scheme}.png`) });
    }
    await win.emulateMedia({ colorScheme: "light" });
    // Typing a model id enables Save and shows that model's 看图 line.
    await modelField.fill("deepseek-flash");
    await expect(win.getByTestId("vision-readonly")).toHaveText("看图：支持");
    await expect(saveBtn).toBeEnabled();
    await modelField.fill("");
    await expect(saveBtn).toBeDisabled();
    await win.screenshot({ path: join(results, "unconfigured-settings.png") });
  });

  test("saving a key shows that API's models immediately (settings:changed)", async () => {
    const win = await app.firstWindow();
    await requireEncryption(win);
    await save(win, "DeepSeek", "deepseek-flash");
    // Without leaving settings: the status bar follows the broadcast.
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-flash", { timeout: 2000 });
    await expect(win.getByTestId("status-unconfigured")).toHaveCount(0);
    await win.screenshot({ path: join(results, "configured-settings.png") });
    await leaveAndReopen(win);
    const select = win.getByTestId("model-bar").getByTestId("model-select");
    await expect(select.locator('option[value="deepseek-flash"]')).toHaveCount(1);
    await expect(win.getByTestId("model-empty")).toHaveCount(0);
    await expect(win.getByText("尚未配置模型：请先在设置里填写 API Key")).toHaveCount(0);
    const list = await win.evaluate(() => window.point.models.list());
    expect(list.configured).toBe(true);
    expect(list.models.map((m) => m.id)).toContain("deepseek-flash");
    await expect(select).toHaveValue(list.models[0]!.id);
    // The draft typed while unconfigured is still there; send is now enabled.
    await expect(win.getByPlaceholder(/问点什么/)).toHaveValue("没有模型时提问");
    await expect(win.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await win.screenshot({ path: join(results, "configured-modelbar.png") });
  });

  test("changing provider and model updates the status bar", async () => {
    const win = await app.firstWindow();
    await requireEncryption(win);
    await win.getByRole("button", { name: "设置" }).click();
    await expect(win.getByRole("heading", { name: "模型设置" })).toBeVisible();
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-flash");
    await expect(win.getByTestId("status-vision")).toHaveText("支持看图");

    await save(win, "OpenAI GPT", "gpt-4o");
    await leaveAndReopen(win);
    await expect(win.getByTestId("status-model")).toHaveText("gpt-4o");
    await expect(win.getByTestId("status-model")).toHaveAttribute("title", "OpenAI GPT · gpt-4o");
    await expect(win.getByTestId("status-vision")).toHaveText("支持看图");
    await win.screenshot({ path: join(results, "settings-openai.png") });

    await win.getByRole("button", { name: "设置" }).click();
    await save(win, "智谱 GLM", "glm-4-plus");
    await leaveAndReopen(win);
    await expect(win.getByTestId("status-model")).toHaveText("glm-4-plus");
    await expect(win.getByTestId("status-vision")).toHaveText("不支持看图");

    await win.getByRole("button", { name: "设置" }).click();
    await save(win, "DeepSeek", "deepseek-flash");
    await leaveAndReopen(win);
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-flash");
  });

  // Fixed in feat/multi-model: onSaved refreshes the status bar without leaving settings.
  test("status bar follows a save immediately, without leaving settings", async () => {
    const win = await app.firstWindow();
    await requireEncryption(win);
    await win.getByRole("button", { name: "设置" }).click();
    try {
      await save(win, "OpenAI GPT", "gpt-4.1");
      await expect(win.getByTestId("status-model")).toHaveText("gpt-4.1", { timeout: 2000 });
    } finally {
      await save(win, "DeepSeek", "deepseek-flash");
    }
  });

  test("custom endpoint: the status-bar tooltip has no DeepSeek prefix, only the model id", async () => {
    const win = await app.firstWindow();
    await requireEncryption(win);
    await win.getByRole("button", { name: "设置" }).click();
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
    const baseInput = win.getByLabel("Base URL");
    const modelInput = win.getByLabel("模型", { exact: true });
    // Mock endpoint (never called here): only the settings are saved and displayed.
    await baseInput.fill("http://127.0.0.1:9/v1");
    await modelInput.fill("mock-math");
    await win.getByRole("button", { name: "保存" }).click();
    await expect(win.getByText("已保存", { exact: true })).toBeVisible();
    await leaveAndReopen(win);
    // The status bar shows the model picked in ModelBar (the tester's repro picks it there).
    const select = win.getByTestId("model-bar").getByTestId("model-select");
    await expect(select.locator('option[value="mock-math"]')).toHaveCount(1);
    await select.selectOption("mock-math");
    const status = win.getByTestId("status-model");
    await expect(status).toHaveText("mock-math");
    await expect(status).toHaveAttribute("title", "mock-math");
    // Evidence: the native tooltip is not capturable, so the test temporarily prints the item's title
    // attribute (as read from the DOM) in the status bar, light and dark, then removes it.
    const statusbar = win.getByTestId("statusbar");
    await status.evaluate((el) => {
      const probe = document.createElement("span");
      probe.className = "statusbar-item";
      probe.dataset.e2eProbe = "";
      probe.textContent = `悬停提示（title）：${el.getAttribute("title")}`;
      el.parentElement!.prepend(probe);
    });
    for (const scheme of ["light", "dark"] as const) {
      await win.emulateMedia({ colorScheme: scheme });
      await statusbar.screenshot({ path: join(results, "screenshots", `status-tooltip-custom-${scheme}.png`) });
    }
    await win.emulateMedia({ colorScheme: "light" });
    await statusbar.evaluate((el) => el.querySelector("[data-e2e-probe]")!.remove());
    // Back to the preset endpoint: the service name returns.
    await win.getByRole("button", { name: "设置" }).click();
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
    await baseInput.fill("");
    await modelInput.fill("deepseek-flash");
    await win.getByRole("button", { name: "保存" }).click();
    await expect(win.getByText("已保存", { exact: true })).toBeVisible();
    await leaveAndReopen(win);
    await select.selectOption("deepseek-flash");
    await expect(status).toHaveText("deepseek-flash");
    await expect(status).toHaveAttribute("title", "DeepSeek · deepseek-flash");
  });

  test("the choice survives a restart, and the form shows it", async () => {
    await app.close();
    const win = await start();
    await requireEncryption(win);
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-flash");
    await win.getByRole("button", { name: "设置" }).click();
    await expect(win.getByLabel("模型服务")).toHaveValue("deepseek");
    await expect(win.getByLabel("模型", { exact: true })).toHaveValue("deepseek-flash");
    // Other providers keep their own last model.
    await win.getByLabel("模型服务").selectOption({ label: "OpenAI GPT" });
    await expect(win.getByLabel("模型", { exact: true })).toHaveValue("gpt-4.1");
  });

  test("API key: saved encrypted when the OS allows it, otherwise refused with a visible reason", async () => {
    const win = await app.firstWindow();
    const encryption = await win.evaluate(async () => (await window.point.settings.get()).encryptionAvailable);
    test.info().annotations.push({ type: "safeStorage", description: encryption ? "available: key saved and checked" : "UNAVAILABLE on this machine: asserting the refusal instead of saving a key" });
    const heading = win.getByRole("heading", { name: "模型设置" });
    if (!(await heading.isVisible())) await win.getByRole("button", { name: "设置", exact: true }).click();
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
    // Without a saved key (no OS encryption locally) Save needs a model id first.
    await win.getByLabel("模型", { exact: true }).fill("deepseek-flash");
    await win.getByLabel("API Key").fill("sk-e2e-secret-123");
    await win.getByRole("button", { name: "保存" }).click();
    if (encryption) {
      await expect(win.getByText("已保存", { exact: true })).toBeVisible();
      await expect(win.getByLabel("API Key")).toHaveValue("");
      await expect(win.getByLabel("API Key")).toHaveAttribute("placeholder", /已保存/);
      await expect(win.getByRole("button", { name: "测试连接" })).toBeEnabled();
      const files = readdirSync(userData).filter((f) => f.endsWith(".json"));
      for (const f of files) expect(readFileSync(join(userData, f), "utf8")).not.toContain("sk-e2e-secret-123");
    } else {
      await expect(win.getByText("系统加密不可用，暂时无法保存 API Key")).toBeVisible();
      await expect(win.getByText("无法安全保存 API Key")).toBeVisible();
      await expect(win.getByRole("button", { name: "测试连接" })).toBeDisabled();
    }
  });
  test("看图 row: preset models show a read-only line from the table; a custom model gets the declaration checkbox", async () => {
    const win = await app.firstWindow();
    const heading = win.getByRole("heading", { name: "模型设置" });
    if (!(await heading.isVisible())) await win.getByRole("button", { name: "设置", exact: true }).click();
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
    const modelInput = win.getByLabel("模型", { exact: true });
    await modelInput.fill("deepseek-flash");
    await expect(win.getByTestId("vision-readonly")).toHaveText("看图：支持");
    await expect(win.getByTestId("vision-toggle")).toHaveCount(0);
    await modelInput.fill("deepseek-v4-pro");
    await expect(win.getByTestId("vision-readonly")).toHaveText("看图：不支持");
    await expect(win.getByTestId("vision-toggle")).toHaveCount(0);
    await win.screenshot({ path: join(results, "settings-vision-preset.png") });
    // Preset endpoint: an id outside the table is not a custom model (no declaration; falls back).
    await modelInput.fill("my-custom-vl");
    await expect(win.getByTestId("vision-toggle")).toHaveCount(0);
    await expect(win.getByTestId("model-fallback-hint")).toHaveText("预设服务只能用列表中的模型，保存后将改用 deepseek-flash");
    await expect(win.getByTestId("vision-readonly")).toHaveText("看图：支持");
    await win.screenshot({ path: join(results, "settings-vision-preset-unknown.png") });
    // Custom OpenAI-compatible endpoint: the same id is a custom model with the declaration checkbox.
    const baseInput = win.getByLabel("Base URL");
    await baseInput.fill("https://llm.example.test/v1");
    await expect(win.getByTestId("model-fallback-hint")).toHaveCount(0);
    await expect(win.getByTestId("vision-readonly")).toHaveCount(0);
    await expect(win.getByLabel("声明此模型支持看图")).toBeVisible();
    await expect(win.getByText("由你自行声明，应用会按此判断")).toBeVisible();
    await win.screenshot({ path: join(results, "settings-vision-custom.png") });
    await baseInput.fill("https://api.deepseek.com/v1");
    await modelInput.fill("deepseek-flash");
  });
});


test.describe("per-conversation model and effort", () => {
  test.describe.configure({ mode: "serial" });
  let app: ElectronApplication;
  test.beforeAll(async () => {
    // Fake LLM so the composer is usable; models:list still comes from the real DeepSeek preset.
    app = await launch(launchEnv({ POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-mm-")), POINT_FAKE_LLM: "1" }));
  });
  test.afterAll(async () => {
    await app?.close();
  });

  test("dropdown lists only the current provider; effort control appears for DeepSeek Flash", async () => {
    const win = await app.firstWindow();
    await openWorkspace(app, win);
    const bar = win.getByTestId("model-bar");
    await expect(bar).toBeVisible();
    const select = bar.getByTestId("model-select");
    await expect(select).toBeVisible();
    const labels = await select.locator("option").allTextContents();
    expect(labels.some((t) => /Flash/i.test(t))).toBe(true);
    expect(labels.some((t) => /gpt-4o/i.test(t))).toBe(false); // other providers stay in Settings
    // Options show only the model id (no label, no 看图/思考 tags).
    expect(labels).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    for (const opt of await select.locator("option").all()) expect(await opt.textContent()).toBe(await opt.getAttribute("value"));
    // Evidence: show the option list in-page (size=N; the native popup is not capturable), light and dark.
    await select.evaluate((el: HTMLSelectElement) => {
      el.size = el.options.length;
      el.style.height = "auto";
    });
    await select.screenshot({ path: join(results, "model-names.png") });
    await win.emulateMedia({ colorScheme: "dark" });
    await select.screenshot({ path: join(results, "model-names-dark.png") });
    await win.emulateMedia({ colorScheme: "light" });
    await select.evaluate((el: HTMLSelectElement) => {
      el.size = 0;
      el.style.height = "";
    });
    await expect(bar.getByTestId("effort-control")).toBeVisible();
    await expect(bar.getByTestId("effort-off")).toBeVisible();
    await expect(bar.getByTestId("effort-high")).toBeVisible();
    await bar.getByTestId("effort-off").click();
    await expect(bar.getByTestId("effort-off")).toHaveAttribute("aria-pressed", "true");
    // Second model under the same provider (clearly labelled mock alternative to Flash).
    await select.selectOption("deepseek-v4-pro");
    await expect(select).toHaveValue("deepseek-v4-pro");
    await expect(bar.getByTestId("effort-control")).toBeVisible();
    await win.screenshot({ path: join(results, "multi-model.png") });
  });

  test("settings save broadcasts: ModelBar re-fetches models:list for the new provider", async () => {
    const win = await app.firstWindow();
    const select = win.getByTestId("model-bar").getByTestId("model-select");
    await expect(select.locator('option[value="deepseek-flash"]')).toHaveCount(1);
    // Switch active provider in Settings; broadcast must refresh ModelBar without remounting the chat.
    await win.getByRole("button", { name: "设置" }).click();
    await win.getByLabel("模型服务").selectOption({ label: "OpenAI GPT" });
    await win.getByLabel("模型", { exact: true }).fill("gpt-4o");
    await win.getByRole("button", { name: "保存" }).click();
    await expect(win.getByText("已保存", { exact: true })).toBeVisible();
    await win.getByRole("button", { name: "返回阅读" }).click();
    // settings:changed → models:list; DeepSeek options gone, GPT present (conversationId unchanged).
    await expect(select.locator('option[value="gpt-4o"]')).toHaveCount(1);
    await expect(select.locator('option[value="deepseek-flash"]')).toHaveCount(0);
    // Switch back so later asks still use DeepSeek presets in this serial suite.
    await win.getByRole("button", { name: "设置" }).click();
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
    await win.getByLabel("模型", { exact: true }).fill("deepseek-flash");
    await win.getByRole("button", { name: "保存" }).click();
    await expect(win.getByText("已保存", { exact: true })).toBeVisible();
    await win.getByRole("button", { name: "返回阅读" }).click();
    await expect(select.locator('option[value="deepseek-flash"]')).toHaveCount(1);
  });

  test("first ask stores ModelBar model/effort; unavailable model emits one model-notice", async () => {
    const win = await app.firstWindow();
    const bar = win.getByTestId("model-bar");
    await bar.getByTestId("model-select").selectOption("deepseek-flash");
    await bar.getByTestId("effort-off").click();
    await win.getByPlaceholder(/问点什么/).fill("记住模型和思考");
    await win.getByRole("button", { name: "发送" }).click();
    await expect(win.locator(".msg.user").filter({ hasText: "记住模型和思考" })).toBeVisible({ timeout: 15_000 });
    await expect(win.locator(".msg.assistant").getByText("模拟回答")).toBeVisible({ timeout: 15_000 });
    const remembered = await win.evaluate(async () => {
      const list = await window.point.conversations.list();
      return list[0] ?? null;
    });
    expect(remembered?.model).toBe("deepseek-flash");
    expect(remembered?.effort).toBe("off");

    // resolveAsk → TaskEvent model-notice (renderer shows it when the panel owns the request).
    const notice = await win.evaluate(async () => {
      return await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("model-notice timeout")), 10_000);
        const off = window.point.tasks.onEvent((e) => {
          if (e.type === "model-notice") {
            clearTimeout(t);
            off();
            resolve(e.message);
          }
        });
        void window.point.tasks.run({ kind: "ask", selection: "", question: "触发回退提示", model: "no-such-model-xyz" }).catch((err) => {
          clearTimeout(t);
          off();
          reject(err);
        });
      });
    });
    expect(notice).toMatch(/原模型已不可用/);
  });

  test("region capture follows the ModelBar pick: v4-pro (no vision) disables it even though Settings has flash", async () => {
    const win = await app.firstWindow();
    const src = mkdtempSync(join(tmpdir(), "point-src-"));
    const docx = join(src, "vision.docx");
    writeFileSync(docx, await makeDocx([{ style: "Heading1", text: "看图测试" }, { text: "正文。" }]));
    await stub(app, [docx]);
    await win.getByRole("button", { name: "导入文档" }).click();
    await expect(win.getByTestId("reader").getByText("看图测试", { exact: true })).toBeVisible();
    const select = win.getByTestId("model-bar").getByTestId("model-select");
    const capture = win.getByTestId("capture-button");
    await select.selectOption("deepseek-flash");
    await expect(capture).toBeEnabled();
    await select.selectOption("deepseek-v4-pro");
    await expect(capture).toBeDisabled();
    // Status bar follows the ModelBar pick (Settings still has flash).
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-v4-pro");
    await expect(win.getByTestId("status-vision")).toHaveText("不支持看图");
    await expect(win.locator(".statusbar")).not.toContainText(/(?<!不)支持看图/);
    await expect(capture).toHaveAttribute("title", "当前模型不支持图片");
    // Same source in the list main gates on.
    const listed = await win.evaluate(() => window.point.models.list());
    expect(listed.models.find((m) => m.id === "deepseek-v4-pro")?.vision).toBe(false);
    await select.selectOption("deepseek-flash");
    await expect(capture).toBeEnabled();
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-flash");
    await expect(win.getByTestId("status-vision")).toHaveText("支持看图");

    // Repro: capture a region while flash is picked, then switch to v4-pro and send → refused, nothing sent.
    await capture.click();
    const box = (await win.getByTestId("reader").boundingBox())!;
    await win.mouse.move(box.x + 20, box.y + 60);
    await win.mouse.down();
    await win.mouse.move(box.x + 200, box.y + 140, { steps: 5 });
    await win.mouse.up();
    const regionBar = win.locator('[aria-label="选区操作"][data-kind="region"]');
    await regionBar.getByRole("button", { name: "问 AI" }).click();
    const thumb = win.getByTestId("attached-image").locator("img");
    await expect(thumb).toBeVisible();
    const sha = (await thumb.getAttribute("src"))!.replace("point-capture://", "");
    await select.selectOption("deepseek-v4-pro");
    const before = await win.evaluate(async () => {
      const list = await window.point.conversations.list();
      let n = 0;
      for (const c of list) n += (await window.point.conversations.tree(c.id)).messages.length;
      return { convs: list.length, msgs: n };
    });
    await win.getByPlaceholder(/问点什么/).fill("图里是什么？");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    await expect(win.getByTestId("chat-error")).toContainText("当前模型不支持图片");
    await expect(thumb).toBeVisible(); // kept so the user can switch back
    // Main gates on the same resolved model (IPC directly, bypassing the UI check).
    const ipc = await win.evaluate(
      (sha) => window.point.tasks.run({ kind: "ask", selection: "", question: "q", image: sha, model: "deepseek-v4-pro" }).then(() => "sent", (e: Error) => e.message),
      sha
    );
    expect(ipc).toMatch(/当前模型不支持图片/);
    const after = await win.evaluate(async () => {
      const list = await window.point.conversations.list();
      let n = 0;
      for (const c of list) n += (await window.point.conversations.tree(c.id)).messages.length;
      return { convs: list.length, msgs: n };
    });
    expect(after).toEqual(before);
    await win.getByRole("button", { name: "移除截图" }).click();
    await select.selectOption("deepseek-flash");
  });

  test("selecting formatted (bold) text in an answer offers 追问分支 and stores a span that matches the source", async () => {
    const win = await app.firstWindow();
    const answer = win.locator(".msg.assistant").filter({ hasText: "模拟回答" }).first();
    await expect(answer.locator("strong", { hasText: "模拟回答" })).toBeVisible();
    // Select across the <strong> boundary: rendered 「模拟回答：这是」, source 「模拟回答**：这是」.
    await answer.evaluate((el) => {
      const p = [...el.querySelectorAll(".markdown p")].find((e) => e.querySelector("strong"))!;
      const strong = p.querySelector("strong")!;
      const tail = strong.nextSibling!;
      const range = document.createRange();
      range.setStart(strong.firstChild!, 0);
      range.setEnd(tail, 3);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await win.getByRole("toolbar", { name: "回答选区操作" }).getByRole("button", { name: "追问分支" }).click();
    await expect(win.getByTestId("branch-draft")).toContainText("追问分支：「模拟回答：这是」");
    await win.getByPlaceholder(/问点什么/).fill("加粗这段是什么意思？");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    await expect(win.getByTestId("crumbs")).toContainText("「模拟回答：这是」");
    const b = await lastBranch(win);
    expect(b.quote).toBe(b.slice); // anchor only
    expect(b.selection).toBe("模拟回答：这是"); // what the user saw is what is sent
  });

  test("list item with bold, inline code and a link: triple-click the whole item, and a partial selection across the link", async () => {
    const win = await app.firstWindow();
    const input = win.getByPlaceholder(/问点什么/);
    await input.fill("FORMAT-PROBE 给我一个带格式的列表");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    const answer = win.locator(".msg.assistant").filter({ hasText: "格式探针" }).last();
    await expect(answer.getByRole("button", { name: "插入笔记" })).toBeVisible({ timeout: 15_000 }); // streaming done
    const li = answer.locator(".markdown li").filter({ hasText: "粗体要点" });
    await expect(li.locator("strong")).toHaveText("粗体要点");
    await expect(li.locator("code")).toHaveText("inline_code");
    await expect(li.locator("a")).toHaveText("链接文字");
    const visible = (await li.evaluate((el) => (el as HTMLElement).innerText)).trim();
    expect(visible).toBe("粗体要点：带 inline_code 与 链接文字 的一项");
    const bar = win.getByRole("toolbar", { name: "回答选区操作" });

    // 1) Triple-click selects the whole formatted item.
    await li.locator("strong").click({ clickCount: 3 });
    await bar.getByRole("button", { name: "追问分支" }).click();
    await expect(win.getByTestId("branch-draft")).toContainText(`追问分支：「${visible}」`);
    await input.fill("这一项展开说说");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    await expect(win.getByTestId("crumbs")).toContainText(`「${visible.slice(0, 16)}」`);
    let b = await lastBranch(win);
    expect(b.selection).toBe(visible);
    expect(b.quote).toBe(b.slice);
    expect(b.quote).toBe("粗体要点**：带 `inline_code` 与 [链接文字](https://example.com/docs/page) 的一项");
    await win.getByTestId("crumbs").getByRole("button", { name: "主线" }).click();

    // 2) Partial selection across the link: 「与 链接文字 的一」 (link text only, URL never part of the text).
    await li.evaluate((el) => {
      const a = el.querySelector("a")!;
      const range = document.createRange();
      range.setStart(a.previousSibling!, (a.previousSibling as Text).data.indexOf("与"));
      range.setEnd(a.nextSibling!, 3);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.closest(".msg.assistant")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const partial = (await win.evaluate(() => window.getSelection()!.toString())).trim();
    expect(partial).toBe("与 链接文字 的一");
    await bar.getByRole("button", { name: "追问分支" }).click();
    await expect(win.getByTestId("branch-draft")).toContainText(`追问分支：「${partial}」`);
    await input.fill("这个链接是什么？");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    await expect(win.getByTestId("crumbs")).toContainText(`「${partial}」`);
    b = await lastBranch(win);
    expect(b.selection).toBe(partial);
    expect(b.quote).toBe(b.slice);
    expect(b.quote).toBe("与 [链接文字](https://example.com/docs/page) 的一");
  });

  test("formulas render with local KaTeX ($…$, \\(…\\), \\[…\\], $$…$$); branch selections through and from formulas map to their LaTeX", async () => {
    const win = await app.firstWindow();
    const input = win.getByPlaceholder(/问点什么/);
    await input.fill("MATH-PROBE 解释一下这个公式");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    const answer = win.locator(".msg.assistant").filter({ hasText: "结论" }).last();
    await expect(answer.getByRole("button", { name: "插入笔记" })).toBeVisible({ timeout: 15_000 });
    const md = answer.locator(".markdown");
    await expect(md.locator(".katex")).toHaveCount(5);
    await expect(md.locator(".katex-display")).toHaveCount(2);
    await expect(md.locator("h2 .katex")).toHaveCount(1);
    // No raw TeX or delimiters left in what the user sees (MathML annotations are not visible text).
    const shown = await md.evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      c.querySelectorAll(".katex-mathml").forEach((n) => n.remove());
      return c.textContent ?? "";
    });
    for (const raw of ["$", "\\dfrac", "\\sqrt", "\\(", "\\[", "\\frac"]) expect(shown).not.toContain(raw);
    // KaTeX fonts come from the app bundle (CSP unchanged: default-src 'self'), not a CDN.
    const fonts = await win.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.family.replace(/"/g, "").startsWith("KaTeX") && f.status === "loaded");
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
      const remote = performance.getEntriesByType("resource").filter((r) => /^https?:/.test(r.name)).map((r) => r.name);
      return { loaded: loaded.length, csp, remote };
    });
    expect(fonts.loaded).toBeGreaterThan(0);
    expect(fonts.csp).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' point-capture:");
    expect(fonts.remote).toEqual([]);
    await answer.screenshot({ path: join(results, "math-answer.png") });
    await win.emulateMedia({ colorScheme: "dark" });
    await answer.screenshot({ path: join(results, "math-answer-dark.png") });
    await win.emulateMedia({ colorScheme: "light" });

    const bar = win.getByRole("toolbar", { name: "回答选区操作" });
    const select = (from: string, to: string | null) =>
      md.evaluate(
        (el, [a, b]) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const find = (needle: string) => {
            for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
              if (n.parentElement?.closest(".katex")) continue;
              const i = n.data.indexOf(needle);
              if (i >= 0) return { n, i };
            }
            throw new Error("not found: " + needle);
          };
          const s = find(a!);
          walker.currentNode = el;
          const e = b ? find(b) : { n: s.n, i: s.i + a!.length };
          const range = document.createRange();
          range.setStart(s.n, s.i);
          range.setEnd(e.n, b ? e.i + b.length : e.i);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          el.closest(".msg.assistant")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return sel.toString();
        },
        [from, to] as const
      );
    // Plain text after several formulas still aligns: 追问分支 opens, anchor = source slice.
    expect(await select("来自正弦均方根", null)).toBe("来自正弦均方根");
    await bar.getByRole("button", { name: "追问分支" }).click();
    await expect(win.getByTestId("branch-draft")).toContainText("追问分支：「来自正弦均方根」");
    await input.fill("为什么是均方根？");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    await expect(win.getByTestId("crumbs")).toContainText("「来自正弦均方根」");
    const b = await lastBranch(win);
    expect(b.selection).toBe("来自正弦均方根");
    expect(b.quote).toBe(b.slice);
    expect(b.quote).toBe("来自正弦均方根");
    await win.getByTestId("crumbs").getByRole("button", { name: "主线" }).click();
    // Through an inline formula: the formula counts as its LaTeX, shown/sent as $…$, anchor maps 1:1.
    const ans = win.locator(".msg.assistant").filter({ hasText: "结论" }).first().locator(".markdown");
    await expect(ans.locator(".katex")).toHaveCount(5);
    const branchVia = async (mode: "inline" | "display", expected: string, quote: string, ask: string) => {
      await ans.evaluate((el, which) => {
        const range = document.createRange();
        if (which === "inline") {
          const p = [...el.querySelectorAll("p")].find((x) => x.textContent!.includes("是峰值幅度"))!;
          const after = p.childNodes[2] as Text; // " 是峰值幅度，" after the $P$ formula
          range.setStart(p.firstChild!, 0);
          range.setEnd(after, after.data.indexOf("，"));
        } else {
          // Inside the KaTeX block only: the formula is selected whole.
          range.selectNodeContents(el.querySelectorAll(".katex-display")[0]!.querySelector(".katex-html")!);
        }
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        el.closest(".msg.assistant")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }, mode);
      await bar.getByRole("button", { name: "追问分支" }).click();
      await expect(win.getByTestId("branch-draft")).toContainText(`追问分支：「${expected.slice(0, 40)}」`);
      await input.fill(ask);
      await win.getByRole("button", { name: "发送", exact: true }).click();
      await expect(win.getByTestId("crumbs")).toContainText(`「${expected.slice(0, 16)}`);
      const got = await lastBranch(win);
      expect(got.selection).toBe(expected);
      expect(got.quote).toBe(got.slice);
      expect(got.quote).toBe(quote);
      await win.getByTestId("crumbs").getByRole("button", { name: "主线" }).click();
    };
    await branchVia(
      "inline",
      "其中 $P$ 是峰值幅度",
      "其中 $P$ 是峰值幅度",
      "P 指什么？"
    );
    // Branch from a display formula itself.
    await branchVia(
      "display",
      "$$L = 20\\lg\\frac{p}{p_0}$$",
      "L = 20\\lg\\frac{p}{p_0}",
      "这个公式怎么来的？"
    );
  });

  test("chat typography: prices stay text, KaTeX 1.05em, heading sizes, inline \\dfrac as \\frac, display box, local fonts under CSP, error colour", async () => {
    const win = await app.firstWindow();
    const csp: string[] = [];
    win.on("console", (m) => {
      if (/Content Security Policy|Refused to load/i.test(m.text())) csp.push(m.text());
    });
    const input = win.getByPlaceholder(/问点什么/);
    await input.fill("TYPO-PROBE 排版检查");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    const answer = win.locator(".msg.assistant").filter({ hasText: "作为行高基准" }).last();
    await expect(answer.getByRole("button", { name: "插入笔记" })).toBeVisible({ timeout: 15_000 });
    const md = answer.locator(".markdown");
    await expect(md.locator(".katex")).toHaveCount(5);
    await expect(md.locator(".katex-error")).toHaveCount(1);
    // (1) Pandoc rule: prices are literal text.
    const price = md.locator("p", { hasText: "价格" });
    await expect(price).toHaveText("价格 $5 和 $10 都行。");
    await expect(price.locator(".katex")).toHaveCount(0);
    await document_fonts_ready(win);
    const m = await md.evaluate((el) => {
      const px = (e: Element, prop: string) => parseFloat(getComputedStyle(e).getPropertyValue(prop));
      const pBy = (t: string) => [...el.querySelectorAll("p")].find((p) => p.textContent!.includes(t))!;
      const h1 = el.querySelector("h1")!;
      const h2 = el.querySelector("h2")!;
      const plain = pBy("作为行高基准");
      const frac = pBy("行内分式");
      const displays = [...el.querySelectorAll<HTMLElement>(".katex-display")];
      const err = el.querySelector(".katex-error")!;
      const probe = document.createElement("span");
      probe.style.color = "var(--danger)";
      el.append(probe);
      const danger = getComputedStyle(probe).color;
      probe.remove();
      const fontSrcs = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r) => r instanceof CSSFontFaceRule).map((r) => (r as CSSFontFaceRule).style.getPropertyValue("src"));
      return {
        inlineRatio: px(frac.querySelector(".katex")!, "font-size") / px(frac, "font-size"),
        h1: { size: px(h1, "font-size"), weight: getComputedStyle(h1).fontWeight, mt: px(h1, "margin-top"), mb: px(h1, "margin-bottom"), mathRatio: px(h1.querySelector(".katex")!, "font-size") / px(h1, "font-size") },
        h2: { size: px(h2, "font-size"), weight: getComputedStyle(h2).fontWeight, mt: px(h2, "margin-top"), mb: px(h2, "margin-bottom") },
        plainH: plain.getBoundingClientRect().height,
        fracH: frac.getBoundingClientRect().height,
        inlineFracH: frac.querySelector(".katex .katex-html")!.getBoundingClientRect().height,
        displayH: displays[0]!.querySelector(".katex-html")!.getBoundingClientRect().height,
        display: { mt: px(displays[0]!, "margin-top"), mb: px(displays[0]!, "margin-bottom"), ml: px(displays[0]!, "margin-left"), pt: px(displays[0]!, "padding-top"), pb: px(displays[0]!, "padding-bottom"), width: displays[0]!.getBoundingClientRect().width, text: el.getBoundingClientRect().width },
        scroll: { overflow: displays[1]!.scrollWidth > displays[1]!.clientWidth, sbH: displays[1]!.offsetHeight - displays[1]!.clientHeight - px(displays[1]!, "border-top-width") - px(displays[1]!, "border-bottom-width") },
        errColor: getComputedStyle(err).color,
        danger,
        dataFonts: fontSrcs.filter((s) => s.includes("data:")).length,
        katexFonts: fontSrcs.filter((s) => s.includes("KaTeX")).length,
        sizeFontLoaded: [...document.fonts].some((f) => f.family.replace(/"/g, "").startsWith("KaTeX_Size") && f.status === "loaded")
      };
    });
    // (2) inline math = 1.05 × body text; inside a heading 1em.
    expect(Math.abs(m.inlineRatio - 1.05)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(m.h1.mathRatio - 1)).toBeLessThanOrEqual(0.01);
    // (3)/(6) heading sizes, weight and margins (first heading: no top margin).
    expect(m.h1).toMatchObject({ size: 18, weight: "600", mt: 0, mb: 8 });
    expect(m.h2).toMatchObject({ size: 16, weight: "600", mt: 16, mb: 6 });
    // (5) inline \dfrac renders as \frac: the line stays within 4px of a plain line; display \dfrac stays large.
    expect(Math.abs(m.fracH - m.plainH)).toBeLessThanOrEqual(4);
    expect(m.displayH).toBeGreaterThan(m.inlineFracH * 1.3);
    // (7) display box: 12px 0, text width, 4px padding-block; long formula scrolls with a 6px bar.
    expect(m.display).toMatchObject({ mt: 12, mb: 12, ml: 0, pt: 4, pb: 4 });
    expect(Math.abs(m.display.width - m.display.text)).toBeLessThanOrEqual(1);
    expect(m.scroll.overflow).toBe(true);
    expect(m.scroll.sbH).toBe(6);
    // (8) KaTeX error text uses --danger.
    expect(m.errColor).toBe(m.danger);
    // (4) fonts are files, never data: URIs, and nothing was refused by the CSP (\bigg needs KaTeX_Size*).
    expect(m.katexFonts).toBeGreaterThan(0);
    expect(m.dataFonts).toBe(0);
    expect(m.sizeFontLoaded).toBe(true);
    expect(csp).toEqual([]);
    // The stored message keeps \dfrac (render-time macro only).
    const stored = await win.evaluate(async () => {
      const [c] = await window.point.conversations.list();
      const t = await window.point.conversations.tree(c!.id);
      return t.messages.filter((x) => x.role === "assistant").map((x) => x.content).find((x) => x.includes("行高基准")) ?? "";
    });
    expect(stored).toContain("行内分式 $\\dfrac{P}{\\sqrt{2}}$");
    await answer.screenshot({ path: join(results, "chat-typography.png") });
    await win.emulateMedia({ colorScheme: "dark" });
    await answer.screenshot({ path: join(results, "chat-typography-dark.png") });
    await win.emulateMedia({ colorScheme: "light" });
  });
  test("chat h3: 15px/600, 12px above and 4px below; an answer that opens with h3 has no top margin", async () => {
    const win = await app.firstWindow();
    await win.getByPlaceholder(/问点什么/).fill("H3-PROBE 三级标题");
    await win.getByRole("button", { name: "发送", exact: true }).click();
    const answer = win.locator(".msg.assistant").filter({ hasText: "中间的三级标题" }).last();
    await expect(answer.getByRole("button", { name: "插入笔记" })).toBeVisible({ timeout: 15_000 });
    const h3 = await answer.locator(".markdown h3").evaluateAll((els) =>
      els.map((e) => {
        const cs = getComputedStyle(e);
        return { text: e.textContent, size: parseFloat(cs.fontSize), weight: cs.fontWeight, mt: parseFloat(cs.marginTop), mb: parseFloat(cs.marginBottom) };
      })
    );
    expect(h3).toEqual([
      { text: "开头的三级标题", size: 15, weight: "600", mt: 0, mb: 4 },
      { text: "中间的三级标题", size: 15, weight: "600", mt: 12, mb: 4 }
    ]);
    await answer.screenshot({ path: join(results, "screenshots", "chat-h3-light.png") });
    await win.emulateMedia({ colorScheme: "dark" });
    await answer.screenshot({ path: join(results, "screenshots", "chat-h3-dark.png") });
    await win.emulateMedia({ colorScheme: "light" });
  });
});


const document_fonts_ready = (win: Win) => win.evaluate(async () => void (await document.fonts.ready));

test.describe("preset fallback notice", () => {
  test.describe.configure({ mode: "serial" });
  let app: ElectronApplication;
  test.beforeAll(async () => {
    // Saved DeepSeek model id that is not in the ModelSpec table, on the preset endpoint.
    const userData = mkdtempSync(join(tmpdir(), "point-e2e-fallback-"));
    writeFileSync(
      join(userData, "settings.json"),
      JSON.stringify({ activeProvider: "deepseek", providers: { deepseek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-gone-xyz", vision: true } } })
    );
    app = await launch(launchEnv({ POINT_USER_DATA: userData, POINT_FAKE_LLM: "1" }));
  });
  test.afterAll(async () => {
    await app?.close();
  });

  test("light notice under ModelBar; 知道了 hides it for this conversation; new conversation / reconfigure show it again", async () => {
    const win = await app.firstWindow();
    await openWorkspace(app, win);
    const notice = win.getByTestId("task-model-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("原模型已不可用，已改用 deepseek-flash");
    // Fell back: ModelBar runs the provider default, the unknown id is not listed.
    const select = win.getByTestId("model-bar").getByTestId("model-select");
    await expect(select).toHaveValue("deepseek-flash");
    await expect(select.locator('option[value="deepseek-gone-xyz"]')).toHaveCount(0);
    // Inline (follows ModelBar in the composer), design variables only.
    const style = await notice.evaluate((el) => {
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const probe = (v: string) => {
        const d = document.createElement("div");
        d.style.color = `var(${v})`;
        document.body.appendChild(d);
        const c = getComputedStyle(d).color;
        d.remove();
        return c;
      };
      const btn = getComputedStyle(el.querySelector("button")!);
      return {
        position: cs.position,
        prevIsModelBar: el.previousElementSibling?.getAttribute("data-testid") === "model-bar",
        bg: cs.backgroundColor,
        bgVar: (() => {
          const d = document.createElement("div");
          d.style.background = "var(--bg-muted)";
          document.body.appendChild(d);
          const c = getComputedStyle(d).backgroundColor;
          d.remove();
          return c;
        })(),
        color: cs.color,
        secondary: probe("--text-secondary"),
        link: btn.color,
        accent: probe("--accent"),
        hasBgMuted: root.getPropertyValue("--bg-muted").trim() !== ""
      };
    });
    expect(style.position).not.toBe("fixed");
    expect(style.prevIsModelBar).toBe(true);
    expect(style.hasBgMuted).toBe(true);
    expect(style.bg).toBe(style.bgVar);
    expect(style.color).toBe(style.secondary);
    expect(style.link).toBe(style.accent);
    await win.locator(".composer").screenshot({ path: join(results, "model-fallback-notice.png") });
    await win.emulateMedia({ colorScheme: "dark" });
    await win.locator(".composer").screenshot({ path: join(results, "model-fallback-notice-dark.png") });
    await win.emulateMedia({ colorScheme: "light" });

    await notice.getByRole("button", { name: "知道了" }).click();
    await expect(notice).toHaveCount(0);
    // Once per conversation: asking (which creates the conversation) does not bring it back.
    await win.getByPlaceholder(/问点什么/).fill("回退后提问");
    await win.getByRole("button", { name: "发送" }).click();
    await expect(win.locator(".msg.assistant").getByText("模拟回答")).toBeVisible({ timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    const stored = await win.evaluate(async () => (await window.point.conversations.list())[0]?.model ?? null);
    expect(stored).toBe("deepseek-flash");
    // Another conversation: shown again.
    await win.getByRole("button", { name: "新对话" }).click();
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "知道了" }).click();
    await expect(notice).toHaveCount(0);
    // Reconfigure (settings:changed) while the saved id is still unknown: shown again.
    await win.evaluate(async () => {
      await window.point.settings.update({ id: "deepseek", baseURL: "https://api.deepseek.com/v1" });
    });
    await expect(notice).toBeVisible();
  });
});
