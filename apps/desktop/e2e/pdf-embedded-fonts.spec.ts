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
  expect.soft(style.selBg, "COUNTER-PROOF soft: solid --accent selection (the layer applies the 25%)").toBe(style.accent);

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
  const targets = [
    { name: "line gap", x: gapX, y: (short.t + short.b) / 2, maxBottom: short.b + 2 },
    { name: "below the text", x: page.x + page.width / 2, y: belowY, maxBottom: Infinity }
  ];
  for (const tg of targets) {
    await win.evaluate(() => getSelection()!.removeAllRanges());
    const sx = start.l + 2, sy = (start.t + start.b) / 2;
    await win.mouse.move(sx, sy);
    await win.mouse.down();
    await win.mouse.move(sx + 10, sy, { steps: 2 });
    await win.mouse.move(tg.x, tg.y, { steps: 1 });
    await win.waitForTimeout(100);
    const during = await page1(win).evaluate((el) => {
      const end = el.querySelector<HTMLElement>(".pdf-text .endOfContent");
      return { selecting: el.querySelector(".pdf-text")!.classList.contains("selecting"), endInLine: !!end?.parentElement?.classList.contains("pdf-line") };
    });
    await win.mouse.up();
    await win.waitForTimeout(150);
    const sel = await win.evaluate(() => {
      const s = getSelection()!;
      const rects = s.rangeCount ? [...s.getRangeAt(0).getClientRects()].filter((r) => r.width > 1) : [];
      return { text: s.toString().replace(/\s+/g, " ").trim(), bottom: Math.max(0, ...rects.map((r) => r.bottom)) };
    });
    const after = await page1(win).evaluate((el) => ({ selecting: el.querySelector(".pdf-text")!.classList.contains("selecting"), endLast: el.querySelector(".pdf-text")!.lastElementChild?.classList.contains("endOfContent") }));
    console.log(`PDF-SELECTION-LOCAL ${JSON.stringify({ target: tg.name, during, text: sel.text, bottom: sel.bottom })}`);
    expect(sel.text, `${tg.name}: the drag selected from the start word`).toMatch(/^techniques\b/);
    expect(during.selecting, `${tg.name}: layer is .selecting while dragging`).toBe(true);
    expect(during.endInLine, `${tg.name}: .endOfContent follows the selection end into its line`).toBe(true);
    expect(sel.text, `${tg.name}: selection did not jump to the end of the layer`).not.toContain("each sounding");
    expect(sel.text, `${tg.name}: selection did not jump to a later paragraph`).not.toContain("Tidal reduction");
    expect(sel.bottom, `${tg.name}: selection stays on the lines the drag crossed`).toBeLessThanOrEqual(tg.maxBottom);
    expect(after, `${tg.name}: .selecting off and .endOfContent back at the layer end after pointerup`).toEqual({ selecting: false, endLast: true });
  }
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
