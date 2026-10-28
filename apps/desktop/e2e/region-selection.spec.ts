import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build`. Region capture pending overlay; mark stores page+rects; click → confirm flash.
let app: ElectronApplication;
const shots = join(import.meta.dirname, "..", "test-results", "screenshots");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
  if (process.platform === "linux" && process.env.POINT_E2E_KEYRING === "1") extra.unshift("-r", join(import.meta.dirname, "keystore-preload.cjs"));
  app = await electron.launch({
    args: [...extra, join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-region-")), POINT_FAKE_LLM: "1" }
  });
});
test.afterAll(async () => {
  await app?.close();
});

test("pending dashed overlay after capture; confirm flash on mark click (region + text); capture button pressed", async () => {
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1400, height: 900 }));
  const root = mkdtempSync(join(tmpdir(), "point-ws-"));
  const src = mkdtempSync(join(tmpdir(), "point-src-"));
  const pdf = join(src, "region.pdf");
  writeFileSync(pdf, makePdf([["Region capture page one with enough words to select"], ["Region capture page two"]]));
  await app.evaluate(({ dialog }, paths) => {
    let n = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths[Math.min(n++, paths.length - 1)]!] })) as typeof dialog.showOpenDialog;
  }, [root, pdf]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await win.getByRole("button", { name: "导入文档" }).click();
  const reader = win.getByTestId("reader");
  await expect(reader.getByTestId("pdf-page").first()).toBeVisible({ timeout: 20_000 });
  await expect(reader.locator('[data-page="1"] .pdf-text')).toContainText("Region capture page one");

  await win.evaluate(async () => {
    await window.point.settings.setKey("deepseek", "sk-e2e-DUMMY-region-overlay-0001");
  });
  await expect(win.getByTestId("status-vision")).toHaveText("支持看图", { timeout: 10_000 });

  const captureBtn = win.getByTestId("capture-button");
  await expect(captureBtn).toBeEnabled();
  const h = (await captureBtn.boundingBox())!.height;
  expect(h, "capture button height ≥ 32").toBeGreaterThanOrEqual(32);

  await captureBtn.click();
  await expect(captureBtn).toHaveAttribute("aria-pressed", "true");
  const page = reader.locator('[data-page="1"]');
  const box = (await page.boundingBox())!;
  await win.mouse.move(box.x + 40, box.y + 40);
  await win.mouse.down();
  await win.mouse.move(box.x + 280, box.y + 130, { steps: 6 });
  await win.mouse.up();
  const bar = win.locator('[aria-label="选区操作"][data-kind="region"]');
  await expect(bar).toBeVisible();
  const pending = win.locator('[data-testid="selection-overlay"][data-mode="pending"]');
  await expect(pending).toBeVisible();
  expect(await pending.evaluate((el) => !!el.closest("[data-page]"))).toBe(true);
  await win.screenshot({ path: join(shots, `region-pending-${process.platform}.png`) });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(120);
  await win.screenshot({ path: join(shots, `region-pending-${process.platform}-dark.png`) });
  await win.emulateMedia({ colorScheme: "light" });

  await bar.getByRole("button", { name: "标记" }).click();
  await expect(bar).toBeHidden();
  await expect(pending).toHaveCount(0);
  const regionItem = win.getByTestId("marks").getByTestId("mark-item").first();
  await expect(regionItem.locator("img")).toBeVisible();

  // Text mark with rects on the same page.
  await reader.locator('[data-page="1"] .pdf-line > span').first().evaluate((el) => {
    const t = el.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, Math.min(12, t.data.length));
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const textBar = win.locator('[aria-label="选区操作"][data-kind="text"]');
  await expect(textBar).toBeVisible({ timeout: 5_000 });
  await textBar.getByRole("button", { name: "标记" }).click();
  await expect(win.getByTestId("marks").getByTestId("mark-item")).toHaveCount(2);

  // Click region mark → confirm overlay on original box.
  await reader.evaluate((el) => {
    el.parentElement!.scrollTop = el.parentElement!.scrollHeight;
  });
  await regionItem.locator(".mark-body").click();
  const confirm = win.locator('[data-testid="selection-overlay"][data-mode="confirm"]');
  await expect(confirm.first()).toBeVisible();
  expect(await confirm.first().evaluate((el) => el.closest("[data-page]")?.getAttribute("data-page"))).toBe("1");
  await win.screenshot({ path: join(shots, `region-confirm-${process.platform}.png`) });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(120);
  await win.screenshot({ path: join(shots, `region-confirm-${process.platform}-dark.png`) });
  await win.emulateMedia({ colorScheme: "light" });
  await expect(confirm).toHaveCount(0, { timeout: 3_000 });

  // Click text mark → confirm highlight (same overlay component).
  const textItem = win.getByTestId("marks").getByTestId("mark-item").nth(1);
  await textItem.locator(".mark-body").click();
  await expect(win.locator('[data-testid="selection-overlay"][data-mode="confirm"]').first()).toBeVisible();
  await win.screenshot({ path: join(shots, `text-confirm-${process.platform}.png`) });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(120);
  await win.screenshot({ path: join(shots, `text-confirm-${process.platform}-dark.png`) });
  await win.emulateMedia({ colorScheme: "light" });
});
