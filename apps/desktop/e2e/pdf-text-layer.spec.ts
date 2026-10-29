import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first. The text layer must hug the canvas glyphs at every zoom.
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
      // Ink extents per word: dark columns over the word's rows, split into words at gaps of 0.2 em or more.
      const inkWords = (top: number, bottom: number, em: number) => {
        const y0 = Math.max(0, Math.floor((top - cr.top) * k) - 3);
        const y1 = Math.min(c.height, Math.ceil((bottom - cr.top) * k) + 3);
        const cols: number[] = [];
        for (let x = 0; x < c.width; x++)
          for (let y = y0; y < y1; y++) {
            const i = (y * c.width + x) * 4;
            if (d[i]! < 140 && d[i + 1]! < 140 && d[i + 2]! < 140) {
              cols.push(x);
              break;
            }
          }
        const segs: { l: number; r: number }[] = [];
        for (const x of cols) {
          const last = segs.at(-1);
          if (last && x - last.r <= 0.2 * em * k) last.r = x + 1;
          else segs.push({ l: x, r: x + 1 });
        }
        return segs.map((g) => ({ l: g.l / k, r: g.r / k }));
      };
      // One leaf span per word run (`.pdf-line > span`), measured on its own so per-word drift cannot hide in
      // a line box. The word's box is a Range over its non-space text (the trailing space reaches the next word).
      const words = [...layer.querySelectorAll<HTMLElement>(".pdf-line > span")].flatMap((s) => {
        const t = s.firstChild as Text | null;
        if (!t || t.nodeType !== 3 || !t.data.trim()) return [];
        const i = t.data.search(/\S/);
        const w = t.data.trim();
        const r = document.createRange();
        r.setStart(t, i);
        r.setEnd(t, i + w.length);
        const b = r.getBoundingClientRect();
        const left = b.left - cr.left, right = b.right - cr.left;
        const segs = inkWords(b.top, b.bottom, parseFloat(getComputedStyle(s).fontSize)).filter((g) => g.l < right && g.r > left);
        return [{ text: w, left, right, inkLeft: Math.min(...segs.map((g) => g.l)), inkRight: Math.max(...segs.map((g) => g.r)) }];
      });
      return {
        lang: layer.getAttribute("lang"),
        docScroll: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
        lines: [...layer.querySelectorAll<HTMLElement>(".pdf-line")].map((l) => l.textContent!).filter((x) => x.trim()),
        rows: words
      };
    });
    expect(m.lang, "layer resolves fonts with the PDF's lang, not the app's zh-CN").toBe("");
    expect(m.docScroll).toBeLessThanOrEqual(0);
    expect(m.lines).toEqual(LINES);
    expect(m.rows.map((r) => r.text).join(" ")).toBe(LINES.join(" "));
    expect(m.rows.length, "one leaf span per word").toBe(LINES.join(" ").split(" ").length);
    const tol = 3 * (zoom / 100);
    console.log(`PDF-TEXT-LAYER-WORDS ${zoom}% max |dL| ${Math.max(...m.rows.map((r) => Math.abs(r.left - r.inkLeft))).toFixed(2)} max |dR| ${Math.max(...m.rows.map((r) => Math.abs(r.right - r.inkRight))).toFixed(2)}`);
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
