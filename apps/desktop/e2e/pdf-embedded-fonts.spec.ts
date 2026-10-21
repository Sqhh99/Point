import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "./png";

// Requires `pnpm build` first. Embedded-font, justified multi-paragraph PDF (fixtures/pdf/hydro-serif.pdf,
// Nimbus Roman subset): text-layer glyph boxes vs canvas glyphs at 100/125/150/200 %, and selection
// rendering: no ghost glyphs, no darker stripes where spans overlap, no strips between lines.
const results = join(import.meta.dirname, "..", "test-results");
const shots = join(results, "screenshots");
const FIXTURES = join(import.meta.dirname, "fixtures", "pdf");
type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
let app: ElectronApplication;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-pdfemb-")), POINT_FAKE_LLM: "1" }
  });
});
test.afterAll(async () => {
  await app?.close();
});

const page1 = (win: Win) => win.locator('[data-page="1"]');
async function setZoom(win: Win, z: number) {
  const zv = win.getByTestId("zoom-value");
  if ((await zv.innerText()) !== "100%") await zv.click();
  while ((await zv.innerText()) !== `${z}%`) await win.getByRole("button", { name: "放大" }).click();
  await expect
    .poll(() => page1(win).evaluate((el) => getComputedStyle(el.querySelector(".pdf-text")!).getPropertyValue("--scale-factor").trim() === el.getAttribute("data-scale") && el.querySelectorAll(".pdf-text span").length > 0))
    .toBe(true);
  await win.waitForTimeout(300);
  await win.locator("main.center").evaluate((e) => ((e.scrollTop = 0), (e.scrollLeft = 0)));
  await win.waitForTimeout(150);
}

/** Every word box of the layer (fully visible ones) vs the canvas ink: best (dx, dy) by pixel overlap. */
async function wordDrift(win: Win) {
  const vis = (await win.locator("main.center").boundingBox())!;
  const words = await page1(win).evaluate((el, vis) => {
    const res: { w: string; l: number; r: number; t: number; b: number; h: number }[] = [];
    for (const s of el.querySelectorAll<HTMLElement>(".pdf-text span")) {
      const t = s.firstChild as Text | null;
      if (!t || t.nodeType !== 3) continue;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.data))) {
        const r = document.createRange();
        r.setStart(t, m.index);
        r.setEnd(t, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (b.width < 2 || b.top < vis.y + 2 || b.bottom > vis.y + vis.height - 2 || b.left < vis.x || b.right > vis.x + vis.width - 16) continue;
        res.push({ w: m[0], l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height });
      }
    }
    return res;
  }, vis);
  const clip = { x: vis.x, y: vis.y, width: vis.width - 16, height: vis.height - 16 };
  const A = decodePng(await win.screenshot({ clip }));
  // Layer glyphs only: hide the canvas, paint the spans black at full opacity.
  await page1(win).evaluate((el) => {
    el.querySelector<HTMLElement>("canvas")!.style.visibility = "hidden";
    el.querySelector<HTMLElement>(".pdf-text")!.style.opacity = "1";
    el.querySelectorAll<HTMLElement>(".pdf-text span").forEach((x) => (x.style.color = "#000"));
  });
  await win.waitForTimeout(100);
  const B = decodePng(await win.screenshot({ clip }));
  await page1(win).evaluate((el) => {
    el.querySelector<HTMLElement>("canvas")!.style.visibility = "";
    el.querySelector<HTMLElement>(".pdf-text")!.style.opacity = "";
    el.querySelectorAll<HTMLElement>(".pdf-text span").forEach((x) => (x.style.color = ""));
  });
  const W = A.width;
  const dark = (img: typeof A, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= img.height) return 0;
    const i = (y * W + x) * 4;
    return img.data[i]! * 0.3 + img.data[i + 1]! * 0.59 + img.data[i + 2]! * 0.11 < 150 ? 1 : 0;
  };
  const rows = words
    .map((wd) => {
      const S = Math.max(4, Math.ceil(0.35 * wd.h));
      const bm: [number, number][] = [];
      for (let y = Math.floor(wd.t - clip.y); y < Math.ceil(wd.b - clip.y); y++) for (let x = Math.floor(wd.l - clip.x); x < Math.ceil(wd.r - clip.x); x++) if (dark(B, x, y)) bm.push([x, y]);
      if (bm.length < 8) return null;
      let best = { dx: 0, dy: 0, score: -1 };
      for (let dy = -S; dy <= S; dy++)
        for (let dx = -S; dx <= S; dx++) {
          let sc = 0;
          for (const [x, y] of bm) sc += dark(A, x + dx, y + dy);
          if (sc > best.score || (sc === best.score && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, score: sc };
        }
      return { w: wd.w, dx: -best.dx, dy: -best.dy };
    })
    .filter((r): r is { w: string; dx: number; dy: number } => !!r);
  const within = rows.filter((r) => Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1).length / Math.max(1, rows.length);
  const ax = rows.map((r) => Math.abs(r.dx)).sort((a, b) => a - b);
  return { words: rows.length, within1px: +within.toFixed(3), maxDx: ax.at(-1) ?? 0, p95Dx: ax[Math.floor(ax.length * 0.95)] ?? 0, worst: [...rows].sort((a, b) => Math.abs(b.dx) - Math.abs(a.dx)).slice(0, 5) };
}

test("embedded-font justified PDF: layer glyphs vs canvas glyphs, and selection without ghosting, stripes or line gaps", async () => {
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 2200, height: 1500 }));
  mkdirSync(shots, { recursive: true });
  const src = mkdtempSync(join(tmpdir(), "point-pdfemb-src-"));
  const pdf = join(src, "hydro-serif.pdf");
  copyFileSync(join(FIXTURES, "hydro-serif.pdf"), pdf);
  const ws = mkdtempSync(join(tmpdir(), "point-pdfemb-ws-"));
  await app.evaluate(({ dialog }, paths) => {
    let n = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths[Math.min(n++, 1)]!] })) as typeof dialog.showOpenDialog;
  }, [ws, pdf]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await win.getByRole("button", { name: "导入文档" }).click();
  await expect(page1(win).locator(".pdf-text span").first()).toBeVisible({ timeout: 20_000 });

  const fonts = await page1(win).evaluate((el) => [...new Set([...el.querySelectorAll<HTMLElement>(".pdf-text span")].map((s) => s.style.fontFamily))]);
  const drift: Record<string, Awaited<ReturnType<typeof wordDrift>>> = {};
  for (const z of [100, 125, 150, 200]) {
    await setZoom(win, z);
    drift[z] = await wordDrift(win);
  }
  writeFileSync(join(shots, `pdf-embedded-drift-${process.platform}.json`), JSON.stringify({ fonts, drift }, null, 2));
  console.log(`PDF-EMBEDDED-DRIFT ${JSON.stringify({ fonts, drift: Object.fromEntries(Object.entries(drift).map(([z, d]) => [z, { words: d.words, within1px: d.within1px, maxDx: d.maxDx }])) })}`);
  // Known issue (v0.2.3): with embedded, kerned fonts the layer's glyph advances are not the PDF's
  // positioned glyphs, so words drift inside a line (target: ≥ 90 % within 1px). Measured and published
  // above; here only a coarse bound against regressions (fallback fonts differ per OS, hence the slack).
  for (const [z, d] of Object.entries(drift)) {
    // Only words on screen are measured: on a small screen (macOS runner, 1024 wide) 200% shows about half.
    expect(d.words, `${z}%: words measured`).toBeGreaterThan(60);
    expect(d.p95Dx, `${z}%: 95th percentile horizontal drift (px), worst ${JSON.stringify(d.worst)}`).toBeLessThanOrEqual(Math.ceil(0.12 * Number(z)));
  }

  // --- Selection at 125%: drag across the first two paragraphs.
  await setZoom(win, 125);
  const style = await page1(win).evaluate((el) => {
    const layer = el.querySelector<HTMLElement>(".pdf-text")!;
    const span = layer.querySelector<HTMLElement>("span:not(.markedContent)")!;
    const sel = getComputedStyle(span, "::selection");
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    layer.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { layerOpacity: getComputedStyle(layer).opacity, spanOpacity: getComputedStyle(span).opacity, spanColor: getComputedStyle(span).color, selColor: sel.color, selBg: sel.backgroundColor, accent };
  });
  expect(style.layerOpacity).toBe("0.25");
  expect(style.spanOpacity).toBe("1");
  expect(style.spanColor).toBe("rgba(0, 0, 0, 0)");
  expect(style.selColor, "selected layer glyphs stay transparent (no ghosting)").toBe("rgba(0, 0, 0, 0)");
  expect(style.selBg, "solid --accent selection (the layer applies the 25%)").toBe(style.accent);

  const vis = (await win.locator("main.center").boundingBox())!;
  const clip = { x: vis.x, y: vis.y, width: vis.width - 16, height: vis.height - 16 };
  const plain = decodePng(await win.screenshot({ clip }));
  const ends = await page1(win).evaluate((el) => {
    const find = (w: string, nth: number) => {
      let k = 0;
      for (const s of el.querySelectorAll<HTMLElement>(".pdf-text span")) {
        const t = s.firstChild as Text | null;
        if (!t || t.nodeType !== 3) continue;
        let i = -1;
        while ((i = t.data.indexOf(w, i + 1)) >= 0) if (k++ === nth) {
          const r = document.createRange();
          r.setStart(t, i);
          r.setEnd(t, i + w.length);
          const b = r.getBoundingClientRect();
          return { l: b.left, r: b.right, t: b.top, b: b.bottom };
        }
      }
      return null;
    };
    return { a: find("Depth", 1), z: find("accuracy.", 0) };
  });
  expect(ends.a && ends.z, "paragraph start / end words found").toBeTruthy();
  const sx = ends.a!.l + 1, sy = (ends.a!.t + ends.a!.b) / 2, ex = ends.z!.r - 1, ey = (ends.z!.t + ends.z!.b) / 2;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  for (let i = 1; i <= 16; i++) await win.mouse.move(sx + ((ex - sx) * i) / 16, sy + ((ey - sy) * i) / 16);
  await win.mouse.up();
  await win.waitForTimeout(300);
  const selText = (await win.evaluate(() => getSelection()!.toString())).replace(/\s+/g, " ").trim();
  expect(selText.startsWith("Depth determination is a fundamental task")).toBe(true);
  expect(selText.endsWith("improved accuracy.")).toBe(true);
  const lines = await win.evaluate(() => {
    const r = getSelection()!.getRangeAt(0);
    const rects = [...r.getClientRects()].filter((x) => x.width > 2 && x.height > 4);
    // One rect per visual line (merge by top).
    const byTop = new Map<number, { l: number; r: number; t: number; b: number }>();
    for (const x of rects) {
      const k = Math.round(x.top);
      const o = byTop.get(k);
      byTop.set(k, o ? { l: Math.min(o.l, x.left), r: Math.max(o.r, x.right), t: Math.min(o.t, x.top), b: Math.max(o.b, x.bottom) } : { l: x.left, r: x.right, t: x.top, b: x.bottom });
    }
    return [...byTop.values()].sort((a, b) => a.t - b.t);
  });
  const selected = decodePng(await win.screenshot({ clip }));
  await win.screenshot({ path: join(shots, `pdf-embedded-selection-125-${process.platform}.png`), clip });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(150);
  await win.screenshot({ path: join(shots, `pdf-embedded-selection-125-${process.platform}-dark.png`), clip });
  await win.emulateMedia({ colorScheme: "light" });
  const W = plain.width;
  const px = (img: typeof plain, x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
  };
  const isPaper = (c: number[]) => c[0]! > 248 && c[1]! > 248 && c[2]! > 248;
  // Paper with no glyph ink within 1px (antialiased glyph edges darken legitimately under any tint).
  const clearPaper = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isPaper(px(plain, x + dx, y + dy))) return false;
    return true;
  };
  // Stripes: every paper pixel under the selection gets the same single tint (no double-darkened bands).
  const tints: number[] = [];
  for (const ln of lines.slice(1, -1)) {
    const y = Math.round((ln.t + ln.b) / 2 - clip.y);
    for (let x = Math.ceil(ln.l - clip.x) + 2; x < Math.floor(ln.r - clip.x) - 2; x++) {
      if (!clearPaper(x, y)) continue;
      const c = px(selected, x, y);
      tints.push(c[0]! + c[1]! + c[2]!);
    }
  }
  tints.sort((a, b) => a - b);
  expect(tints.length).toBeGreaterThan(500);
  const median = tints[tints.length >> 1]!;
  const darker = tints.filter((t) => t < median - 12).length / tints.length;
  expect(darker, `share of selected paper darker than the single selection tint (median ${median}, sum of RGB)`).toBeLessThanOrEqual(0.005);
  // Line gaps: between consecutive selected lines of a paragraph, no row of untinted paper.
  const gapRows: number[] = [];
  const pitches = lines.slice(1).map((b, i) => b.t - lines[i]!.t).sort((x, y) => x - y);
  const pitch = pitches[pitches.length >> 1]!;
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i]!, b = lines[i + 1]!;
    if (b.t - a.t > pitch * 1.3) continue; // paragraph break: the PDF itself leaves space there
    const x0 = Math.ceil(Math.max(a.l, b.l) - clip.x) + 4, x1 = Math.floor(Math.min(a.r, b.r) - clip.x) - 4;
    for (let y = Math.round(a.t - clip.y) + 2; y < Math.round(b.b - clip.y) - 2; y++) {
      let paper = 0, untinted = 0;
      for (let x = x0; x < x1; x += 3) {
        if (!clearPaper(x, y)) continue;
        paper++;
        const c = px(selected, x, y), p = px(plain, x, y);
        if (Math.abs(c[0]! - p[0]!) + Math.abs(c[1]! - p[1]!) + Math.abs(c[2]! - p[2]!) < 15) untinted++;
      }
      if (paper > 20 && untinted / paper > 0.9) gapRows.push(y);
    }
  }
  expect(gapRows, "rows of untinted paper between selected lines").toEqual([]);
});
