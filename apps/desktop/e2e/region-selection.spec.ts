import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  expect(await storedTextRects(win, "region"), "stored text-mark rects === selected lines (1)").toEqual([1]);
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

  // Click text mark → confirm highlight (same overlay component). Reduced motion holds the flash at its steady
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

test("1, 3 and 12 selected lines store 1, 3 and 12 rects; the 12-line confirm flash has no seam at 100 % and 200 %", async () => {
  const win = await app.firstWindow();
  const src = mkdtempSync(join(tmpdir(), "point-src-"));
  const pdf = join(src, "lines.pdf");
  // Justified embedded-font paragraphs: consecutive line boxes overlap by a few px (line pitch < box height).
  copyFileSync(join(import.meta.dirname, "fixtures", "pdf", "hydro-serif.pdf"), pdf);
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, pdf);
  await win.getByRole("button", { name: "导入文档" }).click();
  const page = win.getByTestId("reader").locator('[data-page="1"]');
  await expect(page.locator(".pdf-text")).toContainText("Depth", { timeout: 20_000 });
  await setZoom(win, 100);
  const toolbar = win.locator('[aria-label="选区操作"][data-kind="text"]');
  const before = (await storedTextRects(win, "lines")).length;
  for (const [k, [i0, i1]] of ([[1, 1], [3, 5], [0, 11]] as const).entries()) {
    await selectLines(win, i0, i1);
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    await toolbar.getByRole("button", { name: "标记" }).click();
    await expect.poll(async () => (await storedTextRects(win, "lines")).length).toBe(before + k + 1);
  }
  // One rect per line band; lines 0–11 hold one superscript ("th" at the end of line 6) that sticks out of its line
  // box, so by the rule (top and height within 1px) it stays a rect of its own: 12 line bands + 1. Never the 64 cap.
  expect(await storedLineBands(win, "lines"), "stored line bands === selected lines").toEqual([1, 3, 12]);
  expect(await storedTextRects(win, "lines"), "stored rects === selected lines (+ the one superscript)").toEqual([1, 3, 13]);
  // The page draws all its marks' rects merged: lines 0–11 once each, + the superscript.
  await expect(page.locator('[data-testid="mark-rect"]'), "persistent highlight: one box per line").toHaveCount(13);

  const item = win.getByTestId("marks").getByTestId("mark-item").last();
  await win.emulateMedia({ reducedMotion: "reduce" });
  // The persistent highlight (and its underline) is hidden for the measurement, so only the confirm flash tints.
  await win.addStyleTag({ content: ".e2e-hide-marks .mark-rects, .e2e-hide-marks .mark-lines { visibility: hidden; }" });
  await win.evaluate(() => document.documentElement.classList.add("e2e-hide-marks"));
  for (const z of [100, 200])
    for (const theme of ["light", "dark"] as const) {
      await setZoom(win, z);
      await win.emulateMedia({ colorScheme: theme });
      await win.waitForTimeout(120);
      await item.locator(".mark-body").click();
      const confirm = win.locator('[data-testid="selection-overlay"][data-mode="confirm"]');
      await expect(confirm.first()).toBeVisible();
      expect(await confirm.count(), "12-line mark → 12 line boxes + the superscript").toBe(13);
      await checkLineSeams(win, z, theme);
      await expect(confirm).toHaveCount(0, { timeout: 3_000 });
    }
  await win.evaluate(() => document.documentElement.classList.remove("e2e-hide-marks"));
  await win.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await setZoom(win, 100);
});

test("text mark rects survive a restart: stored count still === lines, one persistent box per line", async () => {
  await app.close();
  await launch();
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1400, height: 900 }));
  await win.getByRole("button", { name: "PDF region" }).click();
  await expect(win.getByTestId("marks").getByTestId("mark-item")).toHaveCount(2, { timeout: 20_000 });
  expect(await storedTextRects(win, "region"), "after restart: stored text-mark rects === selected lines (1)").toEqual([1]);
  expect(await storedLineBands(win, "lines"), "after restart: 1, 3 and 12 lines still store 1, 3 and 12 line bands").toEqual([1, 3, 12]);
  expect(await storedTextRects(win, "lines"), "after restart: rects unchanged (+ the one superscript)").toEqual([1, 3, 13]);
  await expect(win.getByTestId("reader").locator('[data-page="1"] [data-testid="mark-rect"]')).toHaveCount(1, { timeout: 20_000 });
});

type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;

/** Rect count of each stored text mark of the doc titled `name`, in creation order, over IPC. */
const storedTextRects = (win: Win, name: string) =>
  win.evaluate(async (name) => {
    const doc = (await window.point.docs.list()).find((d) => d.title === name);
    if (!doc) return [];
    const marks = await window.point.marks.list(doc.id);
    return marks.flatMap((m) => (m.anchor.kind === "text" ? [m.anchor.rects?.length ?? 0] : []));
  }, name);

/** Line bands of each stored text mark: rects not vertically inside a taller rect (a superscript is inside its line's band). */
const storedLineBands = (win: Win, name: string) =>
  win.evaluate(async (name) => {
    const doc = (await window.point.docs.list()).find((d) => d.title === name);
    if (!doc) return [];
    const marks = await window.point.marks.list(doc.id);
    return marks.flatMap((m) => {
      if (m.anchor.kind !== "text") return [];
      const rs = m.anchor.rects ?? [];
      return [rs.filter((r) => !rs.some((o) => o !== r && o.h > r.h && o.y <= r.y + 1 && o.y + o.h >= r.y + r.h - 1)).length];
    });
  }, name);

const page1 = (win: Win) => win.getByTestId("reader").locator('[data-page="1"]');

async function setZoom(win: Win, z: number) {
  const zv = win.getByTestId("zoom-value");
  if ((await zv.innerText()) !== "100%") await zv.click();
  while ((await zv.innerText()) !== `${z}%`) await win.getByRole("button", { name: "放大" }).click();
  await expect
    .poll(() => page1(win).evaluate((el) => getComputedStyle(el.querySelector(".pdf-text")!).getPropertyValue("--scale-factor").trim() === el.getAttribute("data-scale") && el.querySelectorAll(".pdf-text span").length > 0))
    .toBe(true);
}

/** Selects text lines i0…i1 of page 1 (whole lines, lines = word text boxes grouped by vertical centre). */
async function selectLines(win: Win, i0: number, i1: number) {
  await page1(win).evaluate(
    (el, [i0, i1]) => {
      const layer = el.querySelector<HTMLElement>(".pdf-text")!;
      const words: { n: Text; c: number; l: number; t: number; b: number }[] = [];
      const tw = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode() as Text | null; n; n = tw.nextNode() as Text | null) {
        if (!n.data.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.width > 0) words.push({ n, c: (b.top + b.bottom) / 2, l: b.left, t: b.top, b: b.bottom });
      }
      const lines: (typeof words)[] = [];
      for (const w of [...words].sort((a, b) => a.c - b.c)) {
        const ln = lines.find((x) => w.c > x[0]!.t && w.c < x[0]!.b);
        if (ln) ln.push(w);
        else lines.push([w]);
      }
      lines.forEach((ln) => ln.sort((a, b) => a.l - b.l));
      const first = lines[i0!]![0]!.n, last = lines[i1!]!.at(-1)!.n;
      const r = document.createRange();
      r.setStart(first, 0);
      r.setEnd(last, last.data.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    [i0, i1]
  );
}

const rowMode = (img: ReturnType<typeof decodePng>, y: number, x0: number, x1: number) => {
  const count = new Map<string, number>();
  for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * 4;
    const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0].split(",").map(Number);
};

/**
 * Crop of the confirm flash's first three line boxes (with both line boundaries), and the seam check: the
 * background (commonest colour of a pixel row, over the columns all three boxes cover) of the rows where two line
 * boxes overlap equals the background inside the lines, within 3 per channel. Writes
 * text-confirm-lines-<z>-<platform>[-dark].png.
 */
async function checkLineSeams(win: Win, z: number, theme: "light" | "dark") {
  // Jumping to the mark scrolls the reader; measure once the boxes stopped moving (same rects two frames apart).
  const boxRects = () =>
    win.locator('[data-testid="selection-overlay"][data-mode="confirm"]').evaluateAll(
      (els) => new Promise<DOMRect[]>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect)))))
    );
  let all = await boxRects();
  await expect.poll(async () => { const prev = JSON.stringify(all); all = await boxRects(); return JSON.stringify(all) === prev; }).toBe(true);
  all.sort((a, b) => a.y - b.y);
  // The first three consecutive line boxes that touch (each overlaps the next): body lines of one paragraph.
  const bands = all.filter((r) => !all.some((o) => o !== r && o.height > r.height && o.y <= r.y + 1 && o.y + o.height >= r.y + r.height - 1));
  const at = bands.findIndex((b, i) => i + 2 < bands.length && b.y + b.height > bands[i + 1]!.y && bands[i + 1]!.y + bands[i + 1]!.height > bands[i + 2]!.y);
  expect(at, "three touching line boxes").toBeGreaterThanOrEqual(0);
  const boxes = bands.slice(at, at + 3);
  const view = (await win.locator("main.center").boundingBox())!;
  const pad = 6;
  const x0 = Math.max(...boxes.map((b) => b.x)), x1 = Math.min(...boxes.map((b) => b.x + b.width), view.x + view.width - 16);
  const clip = { x: Math.floor(x0 - pad), y: Math.floor(boxes[0]!.y - pad), width: Math.ceil(x1 - x0 + 2 * pad), height: Math.ceil(boxes[2]!.y + boxes[2]!.height - boxes[0]!.y + 2 * pad) };
  expect(clip.y + clip.height, "the three boxes are in view").toBeLessThanOrEqual(view.y + view.height);
  const png = await win.screenshot({ clip, scale: "device" });
  expect(JSON.stringify((await boxRects()).sort((a, b) => a.y - b.y)), "boxes did not move during the screenshot").toBe(JSON.stringify(all));
  writeFileSync(join(shots, `text-confirm-lines-${z}-${process.platform}${theme === "dark" ? "-dark" : ""}.png`), png);
  const img = decodePng(png);
  const dpr = img.width / clip.width;
  const px = (v: number, o: number) => (v - o) * dpr;
  const cx0 = Math.ceil(px(x0, clip.x)) + 1, cx1 = Math.floor(px(x1, clip.x)) - 1;
  const inside: number[][] = [], seam: number[][] = [];
  const overlaps: number[] = [];
  for (let i = 0; i < 3; i++) {
    const b = boxes[i]!, prev = boxes[i - 1], next = boxes[i + 1];
    const top = prev ? Math.max(b.y, prev.y + prev.height) : b.y, bottom = next ? Math.min(b.y + b.height, next.y) : b.y + b.height;
    for (let y = Math.ceil(px(top, clip.y)) + 1; y < Math.floor(px(bottom, clip.y)) - 1; y++) inside.push(rowMode(img, y, cx0, cx1));
    if (next) {
      overlaps.push(+(b.y + b.height - next.y).toFixed(2));
      for (let y = Math.ceil(px(next.y, clip.y)); y < Math.floor(px(b.y + b.height, clip.y)); y++) seam.push(rowMode(img, y, cx0, cx1));
    }
  }
  const counts = (rows: number[][]) => [...rows.reduce((m, r) => m.set(r.join(","), (m.get(r.join(",")) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const insideRgb = counts(inside)[0]![0].split(",").map(Number);
  const worst = (rows: number[][]) => Math.max(0, ...rows.map((r) => Math.max(...r.map((v, c) => Math.abs(v - insideRgb[c]!)))));
  console.log("TEXT-CONFIRM-SEAM", JSON.stringify({ platform: process.platform, z, theme, dpr, overlaps, insideRows: inside.length, seamRows: seam.length, inside: insideRgb, seam: counts(seam).slice(0, 3), worstInside: worst(inside), worstSeam: worst(seam) }));
  expect(inside.length, `${z}% ${theme}: rows measured inside the lines`).toBeGreaterThanOrEqual(8);
  expect(worst(inside), `${z}% ${theme}: one background inside the lines`).toBeLessThanOrEqual(3);
  expect(worst(seam), `${z}% ${theme}: line-boundary rows have the in-line background (no darker seam)`).toBeLessThanOrEqual(3);
}

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
