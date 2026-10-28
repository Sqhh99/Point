import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";
import { decodePng } from "./png";

// Requires `pnpm build`. Region capture pending overlay; mark stores page+rects; click → confirm flash.
let app: ElectronApplication;
let userData = "";
const shots = join(import.meta.dirname, "..", "test-results", "screenshots");

test.describe.configure({ mode: "serial" });
const launch = async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
  if (process.platform === "linux" && process.env.POINT_E2E_KEYRING === "1") extra.unshift("-r", join(import.meta.dirname, "keystore-preload.cjs"));
  app = await electron.launch({
    args: [...extra, join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: userData, POINT_FAKE_LLM: "1" }
  });
};
test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  userData = mkdtempSync(join(tmpdir(), "point-e2e-region-"));
  await launch();
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

  // Text mark with rects on the same page: the whole first line (one leaf span per word → one rect per word).
  await reader.locator('[data-page="1"] .pdf-line').first().evaluate((line) => {
    const words = [...line.querySelectorAll<HTMLElement>("span")].filter((s) => s.firstChild?.nodeType === Node.TEXT_NODE);
    const last = words.at(-1)!.firstChild as Text;
    const r = document.createRange();
    r.setStart(words[0]!.firstChild!, 0);
    r.setEnd(last, last.data.length);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    line.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const textBar = win.locator('[aria-label="选区操作"][data-kind="text"]');
  await expect(textBar).toBeVisible({ timeout: 5_000 });
  await textBar.getByRole("button", { name: "标记" }).click();
  await expect(win.getByTestId("marks").getByTestId("mark-item")).toHaveCount(2);
  // The stored anchor holds one rect per selected line (mergeLineRects before the write), read back over IPC.
  expect(await storedTextRects(win), "stored text-mark rects === selected lines (1)").toEqual([1]);
  await expect(reader.locator('[data-page="1"] [data-testid="mark-rect"]'), "persistent highlight: one box per line").toHaveCount(1);

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

  // Click text mark → confirm highlight (same overlay component). Reduced motion holds the flash at full
  // opacity (no fade), so the screenshots and the colour check see its steady state.
  await win.emulateMedia({ reducedMotion: "reduce" });
  const textItem = win.getByTestId("marks").getByTestId("mark-item").nth(1);
  await textItem.locator(".mark-body").click();
  const textConfirm = win.locator('[data-testid="selection-overlay"][data-mode="confirm"]');
  await expect(textConfirm.first()).toBeVisible();
  // One box per text line (merged from the per-word rects), not one per word.
  expect(await textConfirm.count(), "text mark on one line → one confirm box").toBe(1);
  await win.screenshot({ path: join(shots, `text-confirm-${process.platform}.png`) });
  await checkUniformLine(win, "light");
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(120);
  await win.screenshot({ path: join(shots, `text-confirm-${process.platform}-dark.png`) });
  await checkUniformLine(win, "dark");
  await win.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
});

test("text mark rects survive a restart: stored count still === lines, one persistent box per line", async () => {
  await app.close();
  await launch();
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1400, height: 900 }));
  await win.getByRole("button", { name: "PDF region" }).click();
  await expect(win.getByTestId("marks").getByTestId("mark-item")).toHaveCount(2, { timeout: 20_000 });
  expect(await storedTextRects(win), "after restart: stored text-mark rects === selected lines (1)").toEqual([1]);
  await expect(win.getByTestId("reader").locator('[data-page="1"] [data-testid="mark-rect"]')).toHaveCount(1, { timeout: 20_000 });
});

type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;

/** Rect count of each stored text mark, from the mark store over IPC. */
const storedTextRects = (win: Win) =>
  win.evaluate(async () => {
    const [doc] = await window.point.docs.list();
    const marks = await window.point.marks.list(doc!.id);
    return marks.flatMap((m) => (m.anchor.kind === "text" ? [m.anchor.rects?.length ?? 0] : []));
  });

/**
 * Zoomed crop of the marked line during the confirm flash, and its colour check: every pixel row inside the box
 * (above the 2px underline) has the same background — the commonest colour of the row — within 3 per channel,
 * so no darker band from stacked boxes. Writes text-confirm-line-<platform>[-dark].png.
 */
async function checkUniformLine(win: Win, theme: "light" | "dark") {
  const box = (await win.locator('[data-testid="selection-overlay"][data-mode="confirm"]').first().boundingBox())!;
  const pad = 6;
  const clip = { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), width: Math.ceil(box.width + 2 * pad), height: Math.ceil(box.height + 2 * pad) };
  const png = await win.screenshot({ clip, scale: "device" });
  writeFileSync(join(shots, `text-confirm-line-${process.platform}${theme === "dark" ? "-dark" : ""}.png`), png);
  const img = decodePng(png);
  const dpr = img.width / clip.width;
  const modes: number[][] = [];
  for (let y = Math.ceil((box.y - clip.y) * dpr) + 1; y < Math.floor((box.y + box.height - clip.y) * dpr) - 3 * dpr; y++) {
    const count = new Map<string, number>();
    for (let x = Math.ceil((box.x - clip.x) * dpr) + 1; x < Math.floor((box.x + box.width - clip.x) * dpr) - 1; x++) {
      const i = (y * img.width + x) * 4;
      const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    modes.push([...count.entries()].sort((a, b) => b[1] - a[1])[0]![0].split(",").map(Number));
  }
  const spread = [0, 1, 2].map((c) => Math.max(...modes.map((m) => m[c]!)) - Math.min(...modes.map((m) => m[c]!)));
  console.log("TEXT-CONFIRM-LINE", JSON.stringify({ theme, rows: modes.length, first: modes[0], spread }));
  expect(modes.length, `${theme}: rows measured inside the confirm box`).toBeGreaterThanOrEqual(8);
  spread.forEach((v) => expect(v, `${theme}: one background colour across the marked line's rows (spread ${JSON.stringify(spread)})`).toBeLessThanOrEqual(3));
}
