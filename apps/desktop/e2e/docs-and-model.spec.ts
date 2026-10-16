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
const launch = (env: Record<string, string>) =>
  electron.launch({ args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")], env });
const stub = (app: ElectronApplication, paths: string[]) =>
  app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, paths);
type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
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
  // POINT_FAKE_LLM would pin the status bar to "fake", so this app runs without it. Nothing here
  // calls a model: only settings are saved and displayed.
  const start = async () => {
    app = await launch(launchEnv({ POINT_USER_DATA: userData }, ["POINT_FAKE_LLM", "POINT_FAKE_VISION"]));
    const win = await app.firstWindow();
    return win;
  };
  test.afterAll(async () => {
    await app?.close();
  });

  const save = async (win: Win, provider: string, model: string) => {
    await win.getByLabel("模型服务").selectOption({ label: provider });
    await win.getByLabel("模型", { exact: true }).fill(model);
    await win.getByRole("button", { name: "保存" }).click();
    await expect(win.getByText("已保存", { exact: true })).toBeVisible();
  };

  /** The status bar re-reads the active model when settings are left (App.tsx:97), so check it there. */
  const leaveAndReopen = async (win: Win) => {
    await win.getByRole("button", { name: "返回阅读" }).click();
    await expect(win.getByRole("heading", { name: "模型设置" })).toBeHidden();
  };

  test("changing provider and model updates the status bar", async () => {
    const win = await start();
    await openWorkspace(app, win);
    await win.getByRole("button", { name: "设置" }).click();
    await expect(win.getByRole("heading", { name: "模型设置" })).toBeVisible();
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-chat");
    await expect(win.getByTestId("status-vision")).toHaveText("不支持看图");

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
    await save(win, "DeepSeek", "deepseek-reasoner");
    await leaveAndReopen(win);
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-reasoner");
  });

  // Known bug: the status bar stays on the old model while the settings page is still open, right
  // after 「已保存」 (App.tsx:97 refreshes only after leaving settings). Expected-to-fail; flip to
  // a plain test() once the status bar follows the save.
  test("status bar follows a save immediately, without leaving settings", async () => {
    test.fail();
    const win = await app.firstWindow();
    await win.getByRole("button", { name: "设置" }).click();
    try {
      await save(win, "OpenAI GPT", "gpt-4.1");
      await expect(win.getByTestId("status-model")).toHaveText("gpt-4.1", { timeout: 2000 });
    } finally {
      // Put the active model back for the tests that follow.
      await save(win, "DeepSeek", "deepseek-reasoner");
    }
  });

  test("the choice survives a restart, and the form shows it", async () => {
    await app.close();
    const win = await start();
    await expect(win.getByTestId("status-model")).toHaveText("deepseek-reasoner");
    await win.getByRole("button", { name: "设置" }).click();
    await expect(win.getByLabel("模型服务")).toHaveValue("deepseek");
    await expect(win.getByLabel("模型", { exact: true })).toHaveValue("deepseek-reasoner");
    // Other providers keep their own last model.
    await win.getByLabel("模型服务").selectOption({ label: "OpenAI GPT" });
    await expect(win.getByLabel("模型", { exact: true })).toHaveValue("gpt-4.1");
  });

  test("API key: saved encrypted when the OS allows it, otherwise refused with a visible reason", async () => {
    const win = await app.firstWindow();
    const encryption = await win.evaluate(async () => (await window.point.settings.get()).encryptionAvailable);
    test.info().annotations.push({ type: "safeStorage", description: encryption ? "available: key saved and checked" : "UNAVAILABLE on this machine: asserting the refusal instead of saving a key" });
    await win.getByLabel("模型服务").selectOption({ label: "DeepSeek" });
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
});
