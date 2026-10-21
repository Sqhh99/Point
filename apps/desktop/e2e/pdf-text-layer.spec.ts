import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first. pdf.js text layer must hug the canvas glyphs at every zoom.
const results = join(import.meta.dirname, "..", "test-results");
const LINES = [
  "Depth determination is a fundamental task for a hydrographer, which requires specific",
  "Lead line and sounding pole were the earliest methods used for directly measuring water depth.",
  "During the last decade, hydrographic surveying has experienced a conceptual change in depth"
];

let app: ElectronApplication;
test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-pdftl-")), POINT_FAKE_LLM: "1" }
  });
});
test.afterAll(async () => {
  await app?.close();
});

test("PDF text layer: spans line up with the canvas glyphs at 100% and 125%, selection copies the exact lines, window never scrolls", async () => {
  const win = await app.firstWindow();
  const src = mkdtempSync(join(tmpdir(), "point-pdftl-src-"));
  const pdf = join(src, "times.pdf");
  writeFileSync(pdf, makePdf([LINES], "Times-Roman"));
  const ws = mkdtempSync(join(tmpdir(), "point-pdftl-ws-"));
  await app.evaluate(({ dialog }, paths) => {
    let n = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths[Math.min(n++, 1)]!] })) as typeof dialog.showOpenDialog;
  }, [ws, pdf]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await win.getByRole("button", { name: "导入文档" }).click();
  const page = win.locator('[data-page="1"]');
  await expect(page.locator(".pdf-text span").first()).toBeVisible({ timeout: 15_000 });

  for (const zoom of [100, 125]) {
    if (zoom === 100) {
      const z = win.getByTestId("zoom-value");
      if (await z.isEnabled()) await z.click();
    } else await win.getByRole("button", { name: "放大" }).click();
    await expect(win.getByTestId("zoom-value")).toHaveText(`${zoom}%`);
    // Wait until the layer was rebuilt for this zoom (scale factor matches the page attribute).
    await expect
      .poll(() => page.evaluate((el) => getComputedStyle(el.querySelector(".pdf-text")!).getPropertyValue("--scale-factor").trim() === el.getAttribute("data-scale") && el.querySelectorAll(".pdf-text span").length > 0))
      .toBe(true);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = await page.evaluate((el) => {
      const layer = el.querySelector<HTMLElement>(".pdf-text")!;
      const c = el.querySelector("canvas")!;
      const cr = c.getBoundingClientRect();
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const k = c.width / cr.width;
      const spans = [...layer.querySelectorAll<HTMLElement>("span")].filter((s) => s.textContent!.trim());
      return {
        lang: layer.getAttribute("lang"),
        docScroll: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
        rows: spans.map((s) => {
          const b = s.getBoundingClientRect();
          const y0 = Math.max(0, Math.floor((b.top - cr.top) * k) - 3);
          const y1 = Math.min(c.height, Math.ceil((b.bottom - cr.top) * k) + 3);
          let minX = Infinity;
          let maxX = -Infinity;
          for (let y = y0; y < y1; y++)
            for (let x = 0; x < c.width; x++) {
              const i = (y * c.width + x) * 4;
              if (d[i]! < 140 && d[i + 1]! < 140 && d[i + 2]! < 140) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
              }
            }
          return { text: s.textContent!, left: b.left - cr.left, right: b.right - cr.left, inkLeft: minX / k, inkRight: (maxX + 1) / k };
        })
      };
    });
    expect(m.lang, "layer resolves fonts with the PDF's lang, not the app's zh-CN").toBe("");
    expect(m.docScroll).toBeLessThanOrEqual(0);
    expect(m.rows.map((r) => r.text)).toEqual(LINES);
    const tol = 3 * (zoom / 100);
    for (const r of m.rows) {
      expect(Math.abs(r.left - r.inkLeft), `${zoom}% left of “${r.text.slice(0, 20)}”`).toBeLessThanOrEqual(tol);
      expect(Math.abs(r.right - r.inkRight), `${zoom}% right of “${r.text.slice(0, 20)}”`).toBeLessThanOrEqual(tol);
    }
    // Selecting the whole page layer copies exactly the text lines (no overlaps, nothing cut off).
    const copied = await page.evaluate((el) => {
      const layer = el.querySelector(".pdf-text")!;
      const r = document.createRange();
      r.setStartBefore(layer.querySelector("span")!);
      r.setEndAfter([...layer.querySelectorAll("span")].at(-1)!);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return s.toString();
    });
    expect(copied.replace(/\s+/g, " ").trim()).toBe(LINES.join(" "));
    const scroller = win.getByTestId("reader").locator("xpath=..");
    await scroller.evaluate((e) => (e.scrollTop = 0));
    const box = (await scroller.boundingBox())!;
    const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 260) };
    await win.screenshot({ path: join(results, `pdf-selection-${zoom}.png`), clip });
    await win.emulateMedia({ colorScheme: "dark" });
    await win.screenshot({ path: join(results, `pdf-selection-${zoom}-dark.png`), clip });
    await win.emulateMedia({ colorScheme: "light" });
    await win.evaluate(() => window.getSelection()!.removeAllRanges());
  }
});
