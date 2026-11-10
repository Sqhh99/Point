import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "./png";
import { buildPageTextGeom, type PdfPageForGeom, type TjWordBox } from "../src/renderer/viewers/pdf-tj-geom";

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

type Box = { id: string; w: string; l: number; r: number; t: number; b: number; h: number };
/** Every word of page 1's text layer, with its client box (for the current scroll position). */
const layerWords = (win: Win) =>
  page1(win).evaluate((el) => {
    const res: Box[] = [];
    el.querySelectorAll<HTMLElement>(".pdf-text span").forEach((s, si) => {
      const t = s.firstChild as Text | null;
      if (!t || t.nodeType !== 3) return;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.data))) {
        const r = document.createRange();
        r.setStart(t, m.index);
        r.setEnd(t, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        res.push({ id: `${si}:${m.index}`, w: m[0], l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height });
      }
    });
    return res;
  });

/**
 * Every word of page 1's text layer vs the canvas ink: best (dx, dy) by pixel overlap. The viewport can be
 * smaller than the page (macOS runner: 1024×677, so 200 % shows only part of it), so the view is scrolled
 * until every word has been seen whole once. The returned `total` is the layer's word count, the denominator.
 */
async function wordDrift(win: Win) {
  const center = win.locator("main.center");
  const vis = (await center.boundingBox())!;
  // The sticky reader toolbar sits inside main.center: the visible page starts below it.
  const bar = (await win.getByTestId("reader-bar").boundingBox())!;
  const top = bar.y + bar.height;
  const clip = { x: vis.x, y: top, width: vis.width - 16, height: vis.y + vis.height - 16 - top };
  const all = await layerWords(win);
  const rows: { w: string; dx: number; dy: number }[] = [];
  const seen = new Set<string>();
  const inView = (b: Box) => b.r - b.l >= 1 && b.t >= clip.y + 2 && b.b <= clip.y + clip.height - 2 && b.l >= clip.x + 1 && b.r <= clip.x + clip.width - 1;
  // Scroll the first word not yet measured to the top-left of the view, then measure every unmeasured word
  // that is wholly visible. Ends when all are measured or a word cannot be brought fully into view.
  for (let guard = 0; guard <= all.length; guard++) {
    const now = await layerWords(win);
    const next = now.find((b) => !seen.has(b.id));
    if (!next) break;
    if (!inView(next)) {
      await center.evaluate((e, [dx, dy]) => ((e.scrollLeft += dx!), (e.scrollTop += dy!)), [Math.floor(next.l - clip.x - 24), Math.floor(next.t - clip.y - 24)]);
      await win.waitForTimeout(80);
    }
    const words = (await layerWords(win)).filter((b) => !seen.has(b.id) && inView(b));
    if (!words.some((b) => b.id === next.id)) break;
    rows.push(...(await measureTile(win, clip, words)));
    for (const w of words) seen.add(w.id);
  }
  await center.evaluate((e) => ((e.scrollLeft = 0), (e.scrollTop = 0)));
  const missed = all.filter((b) => !seen.has(b.id)).map((b) => b.w);
  if (missed.length) console.log(`PDF-EMBEDDED-MISSED ${JSON.stringify(missed)}`);
  const within = rows.filter((r) => Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1).length / Math.max(1, rows.length);
  const ax = rows.map((r) => Math.abs(r.dx)).sort((a, b) => a - b);
  return {
    total: all.length,
    reached: seen.size,
    words: rows.length,
    within1px: +within.toFixed(3),
    maxDx: ax.at(-1) ?? 0,
    p95Dx: ax[Math.floor(ax.length * 0.95)] ?? 0,
    worst: [...rows].sort((a, b) => Math.abs(b.dx) - Math.abs(a.dx)).slice(0, 5)
  };
}

async function measureTile(win: Win, clip: { x: number; y: number; width: number; height: number }, words: Box[]) {
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
  // A word with no layer ink (e.g. a glyph the fallback font lacks) still counts, as maximally off.
  return words.map((wd) => {
    const S = Math.max(4, Math.ceil(0.35 * wd.h));
    const bm: [number, number][] = [];
    for (let y = Math.floor(wd.t - clip.y); y < Math.ceil(wd.b - clip.y); y++) for (let x = Math.floor(wd.l - clip.x); x < Math.ceil(wd.r - clip.x); x++) if (dark(B, x, y)) bm.push([x, y]);
    if (bm.length < 8) return { w: wd.w, dx: S + 1, dy: S + 1 };
    let best = { dx: 0, dy: 0, score: -1 };
    for (let dy = -S; dy <= S; dy++)
      for (let dx = -S; dx <= S; dx++) {
        let sc = 0;
        for (const [x, y] of bm) sc += dark(A, x + dx, y + dy);
        if (sc > best.score || (sc === best.score && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, score: sc };
      }
    return { w: wd.w, dx: -best.dx, dy: -best.dy };
  });
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
  console.log(`PDF-EMBEDDED-DRIFT ${JSON.stringify({ fonts, drift: Object.fromEntries(Object.entries(drift).map(([z, d]) => [z, { words: d.words, total: d.total, within1px: d.within1px, p95Dx: d.p95Dx, maxDx: d.maxDx }])) })}`);
  for (const [z, d] of Object.entries(drift)) {
    // Denominator: every word of the page's text layer, wherever it is on the page (scrolled scan above).
    expect(d.total, `${z}%: text layer has words (a missing layer must not pass as 0/0)`).toBeGreaterThanOrEqual(30);
    expect(d.words, `${z}%: every word of the page's text layer was measured`).toBe(d.total);
    expect(d.within1px, `${z}%: share of words within 1px of the canvas glyphs`).toBeGreaterThanOrEqual(0.9);
  }

  // --- Selection: drawn the upstream way inside the PDF only.
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

  // 125 %: the first two paragraphs; 200 %: the first paragraph (it has to fit the macOS runner's view).
  await checkSelection(win, 125, "accuracy.");
  await checkSelection(win, 200, "survey.");
});

/** Tint threshold: the lowest ratio measured on the three platforms (Windows CI 125 % 0.619) minus a 0.10 margin, floored. */
const TINT_MIN = 0.51;
let geomWords: Promise<TjWordBox[]> | undefined;
/** PageTextGeom.words of the fixture's page 1, built in Node with the app's pdf.js. */
async function selectedGeomWords(endWord: string) {
  geomWords ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= worker;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIXTURES, "hydro-serif.pdf"))), verbosity: 0, isEvalSupported: false }).promise;
    try {
      return (await buildPageTextGeom((await doc.getPage(1)) as unknown as PdfPageForGeom)).words;
    } finally {
      await doc.destroy();
    }
  })();
  const all = await geomWords;
  // The selection runs from the second "Depth" (the paragraph, not the heading) to endWord.
  const a = all.findIndex((w, i) => w.text === "Depth" && all.slice(0, i).some((x) => x.text === "Depth"));
  const z = all.findIndex((w, i) => i > a && w.text === endWord);
  return a >= 0 && z > a ? all.slice(a, z + 1) : [];
}

async function checkSelection(win: Win, z: number, endWord: string) {
  await setZoom(win, z);
  const center = win.locator("main.center");
  const vis = (await center.boundingBox())!;
  const bar = (await win.getByTestId("reader-bar").boundingBox())!;
  const clip = { x: vis.x, y: bar.y + bar.height, width: vis.width - 16, height: vis.y + vis.height - 16 - (bar.y + bar.height) };
  // Bring the paragraph's first line to the top-left of the view.
  const start = await page1(win).evaluate((el) => {
    const s = [...el.querySelectorAll<HTMLElement>(".pdf-text span")].filter((x) => x.textContent?.startsWith("Depth"))[0]!;
    const r = s.getBoundingClientRect();
    return { l: r.left, t: r.top };
  });
  await center.evaluate((e, [dx, dy]) => ((e.scrollLeft += dx!), (e.scrollTop += dy!)), [Math.floor(start.l - clip.x - 24), Math.floor(start.t - clip.y - 24)]);
  await win.waitForTimeout(150);
  const plain = decodePng(await win.screenshot({ clip }));
  const ends = await page1(win).evaluate((el, endWord) => {
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
    return { a: find("Depth", 1), z: find(endWord, 0) };
  }, endWord);
  expect(ends.a && ends.z, "paragraph start / end words found").toBeTruthy();
  expect(ends.z!.b <= clip.y + clip.height && ends.z!.r <= clip.x + clip.width, `${z}%: selected passage fits the view`).toBe(true);
  const sx = ends.a!.l + 1, sy = (ends.a!.t + ends.a!.b) / 2, ex = ends.z!.r - 1, ey = (ends.z!.t + ends.z!.b) / 2;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  for (let i = 1; i <= 16; i++) await win.mouse.move(sx + ((ex - sx) * i) / 16, sy + ((ey - sy) * i) / 16);
  await win.mouse.up();
  await win.waitForTimeout(300);
  const selText = (await win.evaluate(() => getSelection()!.toString())).replace(/\s+/g, " ").trim();
  expect(selText.startsWith("Depth determination is a fundamental task")).toBe(true);
  expect(selText.endsWith(endWord)).toBe(true);
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
  await win.screenshot({ path: join(shots, `pdf-embedded-selection-${z}-${process.platform}.png`), clip });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(150);
  await win.screenshot({ path: join(shots, `pdf-embedded-selection-${z}-${process.platform}-dark.png`), clip });
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
  const chans: [number[], number[], number[]] = [[], [], []];
  for (const ln of lines.slice(1, -1)) {
    const y = Math.round((ln.t + ln.b) / 2 - clip.y);
    for (let x = Math.ceil(ln.l - clip.x) + 2; x < Math.floor(ln.r - clip.x) - 2; x++) {
      if (!clearPaper(x, y)) continue;
      const c = px(selected, x, y);
      tints.push(c[0]! + c[1]! + c[2]!);
      c.forEach((v, k) => chans[k as 0 | 1 | 2].push(v));
    }
  }
  tints.sort((a, b) => a - b);
  // Painted selection, proportional to the selected text: device pixels of clear paper that carry the tint,
  // inside the selected lines' boxes (first and last line included), over the selected words' area from the
  // page's own geometry (PageTextGeom.words of the same pdf.js build, PageRect at 100 %): Σ w·h × k² × dpr², k =
  // data-scale / (96/72) = zoom / 100. The ratio is independent of the platform's glyph antialiasing count and
  // of the window size; it is 0 when no selection is painted.
  // Measured (tinted / Σ word area, 91 words at 125 %, 47 at 200 %, dpr 1): Linux (xvfb) 125 % 0.638, 200 % 0.773;
  // Windows CI 125 % 0.619, 200 % 0.760; macOS CI 125 % 0.626, 200 % 0.748 (run 40757035570).
  // Threshold = min (0.619) − margin 0.10 = 0.519, floored to 0.51. With the ::selection tint off the ratio is ~0.
  const dpr = W / clip.width;
  const k = Number(await page1(win).getAttribute("data-scale")) / (96 / 72);
  const words = await selectedGeomWords(endWord);
  const wordArea = words.reduce((a, w) => a + w.rect.w * w.rect.h, 0) * k * k * dpr * dpr;
  let tinted = 0;
  for (const ln of lines)
    for (let y = Math.ceil((ln.t - clip.y) * dpr); y < Math.floor((ln.b - clip.y) * dpr); y++)
      for (let x = Math.ceil((ln.l - clip.x) * dpr); x < Math.floor((ln.r - clip.x) * dpr); x++) {
        if (!clearPaper(x, y)) continue;
        const c = px(selected, x, y), p = px(plain, x, y);
        if (Math.abs(c[0]! - p[0]!) + Math.abs(c[1]! - p[1]!) + Math.abs(c[2]! - p[2]!) >= 15) tinted++;
      }
  const ratio = tinted / wordArea;
  console.log("PDF-SELECTION-TINT", JSON.stringify({ platform: process.platform, z, dpr, k, words: words.length, midSamples: tints.length, tinted, wordArea: Math.round(wordArea), tintedOfWordArea: +ratio.toFixed(3) }));
  expect(words.length, `${z}%: selected words found in PageTextGeom`).toBeGreaterThanOrEqual(30);
  expect(ratio, `${z}%: tinted clear paper / selected words' geom area (${tinted} / ${Math.round(wordArea)})`).toBeGreaterThanOrEqual(TINT_MIN);
  const median = tints[tints.length >> 1]!;
  const tint = chans.map((c) => c.sort((x, y) => x - y)[c.length >> 1]!);
  // Light theme: --accent at the layer's 25 % over white paper.
  tint.forEach((v, k) => expect(Math.abs(v - [203, 219, 250][k]!), `${z}%: selection colour ${JSON.stringify(tint)} ≈ rgb(203, 219, 250)`).toBeLessThanOrEqual(4));
  // Ghost glyphs (layer text drawn over the canvas) and double-tinted stripes both show up as clean paper
  // that turned darker than the single selection tint.
  const darker = tints.filter((t) => t < median - 12).length / tints.length;
  expect(darker, `${z}%: share of selected paper darker than the single selection tint (median ${median}, sum of RGB)`).toBeLessThanOrEqual(0.005);
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
  expect(gapRows, `${z}%: rows of untinted paper between selected lines`).toEqual([]);
}


/** Client box of the nth occurrence of `w` in page 1's text layer. */
const wordBox = (win: Win, w: string, nth = 0) =>
  page1(win).evaluate(
    (el, [w, nth]) => {
      let k = 0;
      for (const s of el.querySelectorAll<HTMLElement>(".pdf-line > span")) {
        const t = s.firstChild as Text | null;
        if (!t || t.nodeType !== 3) continue;
        let i = -1;
        while ((i = t.data.indexOf(w as string, i + 1)) >= 0)
          if (k++ === nth) {
            const r = document.createRange();
            r.setStart(t, i);
            r.setEnd(t, i + (w as string).length);
            const b = r.getBoundingClientRect();
            return { l: b.left, r: b.right, t: b.top, b: b.bottom };
          }
      }
      return null;
    },
    [w, nth] as const
  );

test("dragging from a word into a line gap or below the text keeps the selection local (.endOfContent, .selecting)", async () => {
  const win = await app.firstWindow();
  // 125 %, not 100 %: on a window shorter than the page (macOS CI, ~680 px) a Playwright (CDP) mouse drag at 100 % leaves the
  // selection collapsed at the pointer in Chromium even with the guard off; real X input selects fine there. 125 % is the zoom
  // the 147 drags use and drags normally on every runner.
  await setZoom(win, 125);
  const center = win.locator("main.center");
  const vis = (await center.boundingBox())!;
  const bar = (await win.getByTestId("reader-bar").boundingBox())!;
  const viewTop = bar.y + bar.height, viewBottom = vis.y + vis.height - 16;
  const s0 = (await wordBox(win, "techniques"))!;
  await center.evaluate((e, dy) => (e.scrollTop += dy), Math.floor(s0.t - viewTop - 40));
  await win.waitForTimeout(150);
  const start = (await wordBox(win, "techniques"))!;
  const short = (await wordBox(win, "survey."))!; // last line of paragraph 1: empty paper to its right
  const page = (await page1(win).boundingBox())!;
  const lastLine = await page1(win).evaluate((el) => Math.max(...[...el.querySelectorAll<HTMLElement>(".pdf-line > span")].map((s) => s.getBoundingClientRect().bottom)));
  expect(start && short).toBeTruthy();
  const gapX = page.x + page.width - 60;
  // Below the text, on the page and inside the visible scroller (the page bottom is off-screen on short windows).
  const belowY = Math.min(page.y + page.height - 30, viewBottom - 20);
  expect(gapX > short.r + 40, "empty paper right of the paragraph's short last line").toBe(true);
  expect(start.t >= viewTop && belowY > lastLine + 20, "empty paper below the last text line, in view").toBe(true);
  const last = (await wordBox(win, "sounding."))!; // last word of the page ("each sounding.")
  expect(last && last.b < viewBottom, "last word in view").toBeTruthy();
  // Each drag walks through the text to its last word (so the selection really grows to it), then leaves the text for
  // empty paper: the selection must end at that word, not jump to the end of the layer or to a later paragraph.
  const targets = [
    { name: "line gap", via: short, word: "survey.", x: gapX, y: (short.t + short.b) / 2, end: /in the survey\.$/, maxBottom: short.b + 2, notAfter: "During the last decade" },
    { name: "right of the last line +30px", via: last, word: "sounding.", x: last.r + 30, y: (last.t + last.b) / 2, end: /total propagated uncertainty of each sounding\.$/, maxBottom: last.b + 2, notAfter: null },
    { name: "right of a middle line +30px", via: short, word: "survey.", x: short.r + 30, y: (short.t + short.b) / 2, end: /in the survey\.$/, maxBottom: short.b + 2, notAfter: "During the last decade" },
    { name: "right of the last line +3px", via: last, word: "sounding.", x: last.r + 3, y: (last.t + last.b) / 2, end: /total propagated uncertainty of each sounding\.$/, maxBottom: last.b + 2, notAfter: null },
    { name: "below the text", via: last, word: "sounding.", x: page.x + page.width / 2, y: belowY, end: /total propagated uncertainty of each sounding\.$/, maxBottom: last.b + 2, notAfter: null }
  ];
  for (const tg of targets) {
    await win.evaluate(() => getSelection()!.removeAllRanges());
    // The previous drag's selection bar sits above its start word: wait until it closed, or the mousedown lands on it.
    await expect(win.getByRole("toolbar", { name: "选区操作" })).toBeHidden();
    const sx = start.l + 2, sy = (start.t + start.b) / 2;
    await win.mouse.move(sx, sy);
    await win.mouse.down();
    await win.mouse.move(sx + 10, sy, { steps: 2 });
    await win.mouse.move(tg.via.r - 2, (tg.via.t + tg.via.b) / 2, { steps: 20 });
    await win.mouse.move(tg.x, tg.y, { steps: 6 });
    await win.waitForTimeout(100);
    const during = await page1(win).evaluate((el, word) => {
      const end = el.querySelector<HTMLElement>(".pdf-text .endOfContent");
      let line = end?.previousElementSibling;
      if (line?.tagName === "BR") line = line.previousElementSibling; // the line's own <br>
      return { selecting: el.querySelector(".pdf-text")!.classList.contains("selecting"), endAtLine: !!line?.classList.contains("pdf-line") && line.textContent!.trim().endsWith(word) };
    }, tg.word);
    await win.mouse.up();
    await win.waitForTimeout(150);
    const sel = await win.evaluate(() => {
      const s = getSelection()!;
      const rects = s.rangeCount ? [...s.getRangeAt(0).getClientRects()].filter((r) => r.width > 1) : [];
      const end = s.rangeCount ? s.getRangeAt(0).endContainer : null;
      const endEl = end instanceof Element ? end : end?.parentElement;
      return { endInText: !!endEl?.closest(".pdf-text"), text: s.toString().replace(/\s+/g, " ").trim(), bottom: Math.max(0, ...rects.map((r) => r.bottom)) };
    });
    const after = await page1(win).evaluate((el) => ({ selecting: el.querySelector(".pdf-text")!.classList.contains("selecting"), endLast: el.querySelector(".pdf-text")!.lastElementChild?.classList.contains("endOfContent") }));
    console.log(`PDF-SELECTION-LOCAL ${JSON.stringify({ target: tg.name, during, words: sel.text.split(" ").length, head: sel.text.slice(0, 40), tail: sel.text.slice(-40), bottom: Math.round(sel.bottom), maxBottom: Math.round(tg.maxBottom) })}`);
    expect(sel.text, `${tg.name}: the drag selected from the start word`).toMatch(/^techniques\b/);
    expect(sel.text, `${tg.name}: the selection grew to the target's word and ends there`).toMatch(tg.end);
    expect(during.selecting, `${tg.name}: layer is .selecting while dragging`).toBe(true);
    expect(during.endAtLine, `${tg.name}: .endOfContent moved next to the selection end's line, not left at the layer end`).toBe(true);
    if (tg.notAfter) expect(sel.text, `${tg.name}: selection did not jump to a later paragraph or the end of the layer`).not.toContain(tg.notAfter);
    expect(sel.bottom, `${tg.name}: selection stays on the lines the drag crossed`).toBeLessThanOrEqual(tg.maxBottom);
    expect(sel.endInText, `${tg.name}: the selection ends inside .pdf-text, not past the article`).toBe(true);
    await expect(win.getByRole("toolbar", { name: "选区操作" }), `${tg.name}: the selection bar opens`).toBeVisible();
    expect(after, `${tg.name}: .selecting off and .endOfContent back at the layer end after pointerup`).toEqual({ selecting: false, endLast: true });
  }
  // An end that escaped the article is pulled back by the pointer's height, not to the page end: put the end on
  // .col-resizer and release right of a middle line; it must end on that line.
  await win.evaluate(() => getSelection()!.removeAllRanges());
  const pulled = await page1(win).evaluate((el, [x, y]) => {
    const t = [...el.querySelectorAll<HTMLElement>(".pdf-line > span")].find((s) => s.textContent!.includes("techniques"))!.firstChild!;
    const out = document.querySelector(".col-resizer")!;
    getSelection()!.setBaseAndExtent(t, (t.textContent ?? "").indexOf("techniques"), out, 0);
    document.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, bubbles: true }));
    const s = getSelection()!;
    const f = s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement;
    return { inText: !!f?.closest(".pdf-text"), tail: s.toString().replace(/\s+/g, " ").trim().slice(-30) };
  }, [short.r + 30, (short.t + short.b) / 2] as const);
  expect(pulled, "escaped end pulled back to the line at the pointer's height").toEqual({ inText: true, tail: expect.stringMatching(/in the survey\.$/) });
  await win.evaluate(() => getSelection()!.removeAllRanges());
});

test("200 % selection across paragraphs, framing the worst-drift word (screenshots)", async () => {
  const win = await app.firstWindow();
  await setZoom(win, 200);
  const center = win.locator("main.center");
  const vis = (await center.boundingBox())!;
  const bar = (await win.getByTestId("reader-bar").boundingBox())!;
  const view = { x: vis.x, y: bar.y + bar.height, width: vis.width - 16, height: vis.y + vis.height - 16 - (bar.y + bar.height) };
  // Page's left edge in view as far as it fits (at 200 % the page is about as wide as the view), the passage a few lines down.
  const a0 = (await wordBox(win, "According"))!;
  const pg0 = (await page1(win).boundingBox())!;
  await center.evaluate((e, [dx, dy]) => ((e.scrollLeft += dx!), (e.scrollTop += dy!)), [Math.floor(pg0.x - view.x - 24), Math.floor(a0.t - view.y - 160)]);
  await win.waitForTimeout(150);
  // Paragraph 1 line 2 (with the "5th" superscript) through the worst-drift word ("confidence" at 200 %) into
  // paragraph 2 line 2 (with "2nd").
  const a = (await wordBox(win, "According"))!;
  const z = (await wordBox(win, "moving"))!;
  const sx = a.l + 1, sy = (a.t + a.b) / 2, ex = z.r - 1, ey = (z.t + z.b) / 2;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  for (let i = 1; i <= 16; i++) await win.mouse.move(sx + ((ex - sx) * i) / 16, sy + ((ey - sy) * i) / 16);
  await win.mouse.up();
  await win.waitForTimeout(300);
  const text = (await win.evaluate(() => getSelection()!.toString())).replace(/\s+/g, " ").trim();
  expect(text.startsWith("According")).toBe(true);
  expect(text).toContain("confidence");
  expect(text.endsWith("moving")).toBe(true);
  const r = await win.evaluate(() => {
    const rs = [...getSelection()!.getRangeAt(0).getClientRects()].filter((x) => x.width > 1);
    return { l: Math.min(...rs.map((x) => x.left)), r: Math.max(...rs.map((x) => x.right)), t: Math.min(...rs.map((x) => x.top)), b: Math.max(...rs.map((x) => x.bottom)) };
  });
  // Frame: from the page's left edge and one line above the selection (with the selection bar) to just past it.
  // The paper is white in both themes; the dark shot shows the dark selection bar over the same --accent selection.
  const pg = (await page1(win).boundingBox())!;
  const x0 = Math.max(view.x, pg.x - 24), y0 = Math.max(view.y, r.t - 90);
  const clip = { x: x0, y: y0, width: Math.min(view.x + view.width, r.r + 24) - x0, height: Math.min(view.y + view.height, r.b + 24) - y0 };
  mkdirSync(shots, { recursive: true });
  await win.screenshot({ path: join(shots, `pdf-embedded-selection-200-cross-${process.platform}.png`), clip });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(150);
  await win.screenshot({ path: join(shots, `pdf-embedded-selection-200-cross-${process.platform}-dark.png`), clip });
  await win.emulateMedia({ colorScheme: "light" });
  await win.evaluate(() => getSelection()!.removeAllRanges());
});

/** Import `file` from the fixtures (choosing a workspace first when the test runs alone); it opens in the reader. */
async function openFixture(win: Win, file: string) {
  const src = mkdtempSync(join(tmpdir(), "point-pdfemb-src-"));
  copyFileSync(join(FIXTURES, file), join(src, file));
  const pick = win.getByRole("button", { name: "选择工作区…" });
  const imp = win.getByRole("button", { name: "导入文档" });
  await expect(pick.or(imp).first()).toBeVisible();
  const paths = (await pick.isVisible()) ? [mkdtempSync(join(tmpdir(), "point-pdfemb-ws-")), join(src, file)] : [join(src, file)];
  await app.evaluate(({ dialog }, paths) => {
    let n = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths[Math.min(n++, paths.length - 1)]!] })) as typeof dialog.showOpenDialog;
  }, paths);
  if (paths.length > 1) await pick.click();
  await imp.click();
}

/** Selection from the `nth` word containing `from` (from its start; with `up`, from its end) to `out`, as Chromium leaves
 *  it after a release past the article, then a pointerup at (x, y): returns where the end was pulled back to.
 *  Chromium's escaped end lands after the article (.col-resizer) even when the drag went up; it can also land before
 *  it (the document list). */
const pullBack = (win: Win, from: string, x: number, y: number, { up = false, out = ".col-resizer", nth = 0 } = {}) =>
  win.evaluate(
    ([from, x, y, up, out, nth]) => {
      const span = [...document.querySelectorAll<HTMLElement>(".pdf-line > span")].filter((s) => s.textContent!.includes(from))[nth]!;
      const t = span.firstChild!;
      const i = (t.textContent ?? "").indexOf(from);
      const o = document.querySelector(out)!;
      getSelection()!.setBaseAndExtent(t, up ? i + from.length : i, o, 0);
      document.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, bubbles: true }));
      const s = getSelection()!;
      const f = s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement;
      const text = s.toString().replace(/\s+/g, " ").trim();
      const r = { inText: !!f?.closest(".pdf-text"), up: !!(s.anchorNode!.compareDocumentPosition(s.focusNode!) & Node.DOCUMENT_POSITION_PRECEDING), head: text.slice(0, 30), tail: text.slice(-30), length: text.length };
      s.removeAllRanges();
      return r;
    },
    [from, x, y, up, out, nth] as const
  );

test("an end released past the article is pulled back on the page and column under the pointer (two pages, two columns)", async () => {
  const win = await app.firstWindow();
  // 1280x800 (what the macOS runner's screen holds; an earlier test asks for 2200x1500, which macOS shrinks). At
  // 125 % page 2 starts below the view but within the reader's 800 px preload margin, so its text layer is built.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1280, height: 800 }));
  await openFixture(win, "hydro-times-std-2p.pdf");
  await expect(page1(win).locator(".pdf-text span").first()).toBeVisible();
  await setZoom(win, 125);
  const bar = (await win.getByTestId("reader-bar").boundingBox())!;
  const s0 = (await wordBox(win, "techniques"))!;
  await win.locator("main.center").evaluate((e, dy) => (e.scrollTop += dy), Math.floor(s0.t - bar.y - bar.height - 40));
  await expect(win.locator('[data-page="2"] .pdf-text span').first(), "page 2, below the view, is preloaded").toBeAttached({ timeout: 10_000 });
  await win.waitForTimeout(150);
  const start = (await wordBox(win, "techniques"))!;
  const mid = (await wordBox(win, "survey."))!; // page 1, paragraph 1's short last line; page 2 follows in the layer order
  const pg = (await page1(win).boundingBox())!;
  const besideStart = [pg.x + pg.width - 20, (start.t + start.b) / 2] as const;
  // Direct: page 2 is the last selected layer, but the pointer is beside a page-1 line.
  expect(await pullBack(win, "techniques", mid.r + 30, (mid.t + mid.b) / 2), "two pages: pulled back to the page-1 line at the pointer").toMatchObject({ inText: true, up: false, tail: expect.stringMatching(/in the survey\.$/) });
  // Dragging up from "survey." and released right of the "techniques" line: the selection keeps the lines below that
  // line, upwards (it starts at that line's end), and does not flip, whichever side of the article the end escaped to.
  const upToStart = { inText: true, up: true, head: expect.stringMatching(/^S-44/), tail: expect.stringMatching(/in the survey\.$/) };
  expect(await pullBack(win, "survey.", ...besideStart, { up: true }), "dragging up, end on the resizer: still upwards").toMatchObject(upToStart);
  expect(await pullBack(win, "survey.", ...besideStart, { up: true, out: '[data-testid="doc-list"]' }), "dragging up, end on the document list").toMatchObject(upToStart);
  // Across pages: from page 2's "survey." up to page 1, released on the resizer. Page 1 is not in the selection
  // Chromium reports (that runs forward from page 2), yet the end lands there.
  const across = await pullBack(win, "survey.", ...besideStart, { up: true, nth: 1 });
  expect(across, "dragging up across pages: pulled back to the page-1 line at the pointer").toMatchObject(upToStart);
  expect(across.length, "across pages: page 1's tail plus page 2 down to its \"survey.\"").toBeGreaterThan(700);
  // Counter-proof: on the anchor's line, right of it, is a drag down to that line's end.
  expect(await pullBack(win, "techniques", ...besideStart), "same line, right of the anchor: downwards").toMatchObject({ inText: true, up: false, head: expect.stringMatching(/^techniques/), tail: expect.stringMatching(/IHO publication$/) });
  // Real drag: page-1 word, through "survey.", released right of it.
  const toolbar = win.getByRole("toolbar", { name: "选区操作" });
  await expect(toolbar).toBeHidden();
  const sx = start.l + 2, sy = (start.t + start.b) / 2;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(sx + 10, sy, { steps: 2 });
  await win.mouse.move(mid.r - 2, (mid.t + mid.b) / 2, { steps: 20 });
  await win.mouse.move(mid.r + 30, (mid.t + mid.b) / 2, { steps: 6 });
  await win.waitForTimeout(100);
  await win.mouse.up();
  await win.waitForTimeout(150);
  const sel = await win.evaluate(() => {
    const s = getSelection()!;
    const end = s.rangeCount ? s.getRangeAt(0).endContainer : null;
    const endEl = end instanceof Element ? end : end?.parentElement;
    return { endInText: !!endEl?.closest(".pdf-text"), text: s.toString().replace(/\s+/g, " ").trim() };
  });
  expect(sel.text, "two pages, real drag: ends at the page-1 line it was released beside").toMatch(/^techniques\b.*in the survey\.$/);
  expect(sel.endInText).toBe(true);
  await expect(toolbar, "two pages, real drag: the selection bar opens").toBeVisible();
  await win.evaluate(() => getSelection()!.removeAllRanges());
  await expect(toolbar).toBeHidden();

  // Two columns: beside the right column's last line, the left column has a line at the same height; take the right one.
  await openFixture(win, "hydro-2col.pdf");
  await expect.poll(() => page1(win).evaluate((el) => el.querySelectorAll(".pdf-text span").length > 0 && !document.querySelector('[data-page="2"]'))).toBe(true);
  await setZoom(win, 125);
  const page = (await page1(win).boundingBox())!;
  const last = (await wordBox(win, "sounding.", 2))!; // P4's third copy: the right column's last line
  expect(last.l > page.x + page.width / 2, "the last \"sounding.\" is in the right column").toBe(true);
  expect(await pullBack(win, "techniques", last.r + 30, (last.t + last.b) / 2), "two columns: pulled back to the right column's line").toMatchObject({ inText: true, tail: expect.stringMatching(/of each sounding\.$/) });
  // Dragging up within the right column, released on the resizer right of an earlier right-column line: stays
  // upwards and in that column, starting at that line's end, so the selection opens with the next line. (A line
  // above the anchor but later in reading order would be a drag down; not this one.)
  const right = await page1(win).evaluate((el, mid) => {
    const ls = [...el.querySelectorAll(".pdf-line")]
      .map((l) => ({ r: l.getBoundingClientRect(), text: l.textContent!.replace(/\s+/g, " ").trim() }))
      .filter((l) => l.r.left > mid && l.text)
      .sort((p, q) => p.r.top - q.r.top);
    const i = ls.length - 4;
    return { y: (ls[i]!.r.top + ls[i]!.r.bottom) / 2, next: ls[i + 1]!.text.slice(0, 12) };
  }, page.x + page.width / 2);
  const twoColUp = await pullBack(win, "sounding.", page.x + page.width - 20, right.y, { up: true, nth: 2 });
  expect(twoColUp, "two columns, dragging up: upwards, ending at the anchor").toMatchObject({ inText: true, up: true, tail: expect.stringMatching(/of each sounding\.$/) });
  expect(twoColUp.head.startsWith(right.next), `two columns, dragging up: starts at "${right.next}", got "${twoColUp.head}"`).toBe(true);
});

test("clicks on the span layer behave as on plain text: caret, word, line, and a click on the margin clears", async () => {
  const win = await app.firstWindow();
  await openFixture(win, "hydro-serif.pdf");
  await expect(page1(win).locator(".pdf-text span").first()).toBeVisible();
  await setZoom(win, 125);
  // Line 6 of page 1, its middle word.
  const target = await page1(win).evaluate((el) => {
    const line = [...el.querySelectorAll(".pdf-line")].filter((l) => l.textContent!.trim())[5]!;
    const t = [...line.querySelectorAll(":scope > span")].map((s) => s.firstChild).filter((n): n is Text => n?.nodeType === Node.TEXT_NODE);
    const words: { w: string; x: number; y: number }[] = [];
    for (const n of t)
      for (const m of n.data.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (b.width > 10) words.push({ w: m[0], x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
      }
    const pg = el.getBoundingClientRect();
    return { line: line.textContent!.replace(/\s+/g, " ").trim(), word: words[Math.floor(words.length / 2)]!, margin: pg.right - 15 };
  });
  const toolbar = win.getByRole("toolbar", { name: "选区操作" });
  const sel = () => win.evaluate(() => ({ collapsed: getSelection()!.isCollapsed, text: getSelection()!.toString().replace(/\s+/g, " ").trim() }));
  const clear = async () => {
    await win.evaluate(() => getSelection()!.removeAllRanges());
    await expect(toolbar).toBeHidden();
  };
  const { x, y, w } = target.word;
  await clear();
  await win.mouse.click(x, y);
  expect(await sel(), "single click: a caret, nothing selected").toMatchObject({ collapsed: true });
  await expect(toolbar).toBeHidden();
  await clear();
  await win.mouse.dblclick(x, y);
  expect((await sel()).text, "double click: the word").toBe(w);
  await expect(toolbar, "double click: the selection bar opens").toBeVisible();
  await clear();
  await win.mouse.click(x, y, { clickCount: 3 });
  expect((await sel()).text, "triple click: the whole line").toBe(target.line);
  await clear();
  await win.mouse.dblclick(x, y);
  await expect(toolbar).toBeVisible();
  await win.mouse.click(target.margin, y);
  expect((await sel()).text, "a click on the page margin after a double click clears the selection").toBe("");
  await expect(toolbar, "and closes the selection bar").toBeHidden();
});

test("triple-click on a mid-page line puts the toolbar below, not over the lines above", async () => {
  const win = await app.firstWindow();
  await openFixture(win, "hydro-serif.pdf");
  await expect(page1(win).locator(".pdf-text span").first()).toBeVisible();
  await setZoom(win, 125);
  const lines = await page1(win).evaluate((el) =>
    [...el.querySelectorAll(".pdf-line")]
      .filter((l) => l.textContent!.trim())
      .map((l) => {
        const spans = [...l.querySelectorAll(":scope > span")].map((s) => s.firstChild).filter((n): n is Text => n?.nodeType === Node.TEXT_NODE);
        const words: { x: number; y: number }[] = [];
        for (const n of spans)
          for (const m of n.data.matchAll(/\S+/g)) {
            const r = document.createRange();
            r.setStart(n, m.index);
            r.setEnd(n, m.index + m[0].length);
            const b = r.getBoundingClientRect();
            if (b.width > 10) words.push({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
          }
        const box = l.getBoundingClientRect();
        return { text: l.textContent!.replace(/\s+/g, " ").trim(), mid: words[Math.floor(words.length / 2)]!, top: box.top, bottom: box.bottom };
      })
  );
  expect(lines.length, "enough lines to have body above line 3").toBeGreaterThanOrEqual(3);
  const toolbar = win.getByRole("toolbar", { name: "选区操作" });
  const place = () =>
    win.evaluate(() => {
      const sel = getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const s = sel.getRangeAt(0).getBoundingClientRect();
      const bar = document.querySelector<HTMLElement>(".selection-toolbar")?.getBoundingClientRect();
      if (!bar) return null;
      return { selTop: s.top, selBottom: s.bottom, barTop: bar.top, barBottom: bar.bottom, text: sel.toString().replace(/\s+/g, " ").trim() };
    });

  const midLine = lines.find((l) => l.text.includes("uncertainty of depth measurements"));
  const nextPara = lines.find((l) => l.text.includes("During the last decade"));
  expect(midLine, "mid-page body line").toBeTruthy();
  expect(nextPara, "following paragraph").toBeTruthy();
  await win.mouse.click(midLine!.mid.x, midLine!.mid.y, { clickCount: 3 });
  await expect(toolbar, "mid-page line: the bar opens").toBeVisible();
  const mid = await place();
  expect(mid?.text, "mid-page line: the whole line").toBe(midLine!.text);
  expect(
    mid!.barBottom <= nextPara!.top + 1 || mid!.barTop >= nextPara!.bottom - 1,
    "does not cover the next paragraph"
  ).toBe(true);
  for (const [i, line] of lines.entries()) {
    if (line.bottom <= mid!.selTop + 1) {
      expect(
        mid!.barBottom <= line.top + 1 || mid!.barTop >= line.bottom - 1,
        `does not cover a line above the selection (${i + 1})`
      ).toBe(true);
    }
  }

  await win.evaluate(() => getSelection()!.removeAllRanges());
  await expect(toolbar).toBeHidden();
  await win.mouse.click(lines[0]!.mid.x, lines[0]!.mid.y, { clickCount: 3 });
  await expect(toolbar, "line 1: the bar opens").toBeVisible();
  const first = await place();
  expect(first?.text, "line 1: the whole line").toBe(lines[0]!.text);
  expect(first!.barBottom, "line 1: nothing above, bar stays above the line").toBeLessThanOrEqual(first!.selTop - 8 + 2);
});


/** Client box of the first glyph-run of page 1's `nth` visual (non-empty) line in the left or right column. `nth` is 0-based. */
const lineStart = (win: Win, nth: number, right: boolean) =>
  page1(win).evaluate(
    (el, [nth, right]) => {
      const lines = [...el.querySelectorAll<HTMLElement>(".pdf-line")]
        .filter((l) => l.textContent!.trim() && l.firstElementChild)
        .map((l) => (l.firstElementChild as HTMLElement).getBoundingClientRect());
      const mid = (Math.min(...lines.map((b) => b.left)) + Math.max(...lines.map((b) => b.left))) / 2;
      const spread = Math.max(...lines.map((b) => b.left)) - Math.min(...lines.map((b) => b.left));
      const col = lines.filter((b) => spread < 50 || (right ? b.left > mid : b.left <= mid));
      const b = col.sort((a, c) => a.top - c.top)[nth as number]!;
      return { l: b.left, y: (b.top + b.bottom) / 2 };
    },
    [nth, right] as const
  );

/** Press at each listed offset into the line, drag right: the presses that select nothing. */
async function deadPresses(win: Win, at: { l: number; y: number }, dxs: number[]) {
  const dead: number[] = [];
  for (const dx of dxs) {
    await win.evaluate(() => getSelection()!.removeAllRanges());
    await win.mouse.move(at.l + dx, at.y);
    await win.mouse.down();
    await win.mouse.move(at.l + dx + 40, at.y, { steps: 4 });
    const len = await win.evaluate(() => getSelection()!.toString().length);
    await win.mouse.up();
    if (len === 0) dead.push(dx);
  }
  await win.evaluate(() => getSelection()!.removeAllRanges());
  return dead;
}

test("a drag pressed anywhere 0–8px into a line selects (single column, both columns)", async () => {
  test.setTimeout(120_000);
  const win = await app.firstWindow();
  const toolbar = win.getByRole("toolbar", { name: "选区操作" });
  // #81: hydro L2/L6, twocol L2/L7/R2/R7 × dx 0/2/4/5/6/8. Pressing on a caret-offset boundary used to leave
  // Chromium moving a caret instead of selecting (see startDragSelection).
  const dxs = [0, 2, 4, 5, 6, 8];
  for (const [file, cols, nth] of [
    ["hydro-times-std.pdf", [false], [1, 5]],
    ["hydro-2col.pdf", [false, true], [1, 6]],
  ] as const) {
    await openFixture(win, file);
    await expect
      .poll(() => page1(win).evaluate((el) => el.querySelectorAll(".pdf-text span").length > 0 && !document.querySelector('[data-page="2"]')))
      .toBe(true);
    for (const z of [100, 125]) {
      await setZoom(win, z);
      for (const right of cols)
        for (const n of nth)
          expect(await deadPresses(win, await lineStart(win, n, right), dxs), `${file} ${z}% ${right ? "right" : "left"} column, line ${n + 1}`).toEqual([]);
    }
  }

  // Page-margin click (left of the line, not an expanded hit target) still clears the selection and the bar.
  await openFixture(win, "hydro-times-std.pdf");
  await expect.poll(() => page1(win).evaluate((el) => el.querySelectorAll(".pdf-text span").length > 0)).toBe(true);
  await setZoom(win, 125);
  const at = await lineStart(win, 1, false);
  await win.mouse.move(at.l + 40, at.y);
  await win.mouse.down();
  await win.mouse.move(at.l + 120, at.y, { steps: 4 });
  await win.mouse.up();
  await expect(toolbar, "setup: a selection from inside the line opens the bar").toBeVisible();
  await win.mouse.click(at.l - 12, at.y);
  expect(await win.evaluate(() => getSelection()!.toString()), "a click 12px left of the line start clears the selection").toBe("");
  await expect(toolbar, "and closes the selection bar").toBeHidden();
});
