import { test, expect, _electron as electron, type ElectronApplication, type TestInfo } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first. Captures the title bar (and the reader toolbar under it) at the
// window's minimum size, at 1024px wide and maximized, for design review of the title bar (#65).
// Screenshots + measurements go to testInfo.outputPath() (apps/desktop/test-results/…) and are
// attached to the report; the measurements are also printed as one `TITLEBAR-MEASURE` line so they
// can be read from the CI log.
//
// Hard assertions here hold on main today. Measured-only values (no hard assertion yet) are listed
// in docs/pull-requests/2026-10-21-titlebar-min-width-capture.md and become assertions once #65 merges.

type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
let app: ElectronApplication;

const stub = (paths: string[]) =>
  app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, paths);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-tbnarrow-")), POINT_FAKE_LLM: "1" }
  });
});
test.afterAll(async () => {
  await app?.close();
});

/** Geometry of the title bar and the reader toolbar: heights, button boxes, text wrapping, overflow. */
const measure = (win: Win) =>
  win.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
    };
    // Number of rendered text lines inside an element (1 = no wrapping; 0 = icon / no text).
    const lines = (el: Element) => {
      const tops = new Set<number>();
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.textContent!.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const rect of r.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      return tops.size;
    };
    const buttons = (root: Element | null, bounds: DOMRect | undefined) =>
      root
        ? [...root.querySelectorAll<HTMLButtonElement>("button")]
            .filter((b) => b.getClientRects().length > 0)
            .map((b) => {
              const r = b.getBoundingClientRect();
              return {
                label: b.getAttribute("aria-label") ?? b.textContent!.trim(),
                text: b.textContent!.trim(),
                iconOnly: !b.textContent!.replace(/[‹›−+▾\s]/g, "").length,
                ...box(b)!,
                textLines: lines(b),
                clipped: b.scrollWidth > b.clientWidth + 1,
                insideBar: !!bounds && r.left >= bounds.left - 0.5 && r.right <= bounds.right + 0.5 && r.top >= bounds.top - 0.5 && r.bottom <= bounds.bottom + 0.5,
                insideViewport: r.left >= -0.5 && r.right <= innerWidth + 0.5
              };
            })
        : [];
    const tb = document.querySelector('[data-testid="titlebar"]');
    const rb = document.querySelector('[data-testid="reader-bar"]');
    const part = (sel: string) => {
      const el = tb?.querySelector(sel);
      return el ? { ...box(el)!, truncated: el.scrollWidth > el.clientWidth + 1, text: el.textContent!.trim().slice(0, 80) } : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      docScroll: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
      titlebar: tb ? { ...box(tb)!, computedHeight: getComputedStyle(tb).height, className: tb.className } : null,
      titlebarParts: { left: part(".titlebar-left"), workspace: part(".titlebar-workspace"), title: part(".titlebar-title"), right: part(".titlebar-right") },
      titlebarButtons: buttons(tb, tb?.getBoundingClientRect()),
      readerBar: rb ? { ...box(rb)!, scrollWidth: rb.scrollWidth, clientWidth: rb.clientWidth, overflowing: rb.scrollWidth > rb.clientWidth + 1 } : null,
      readerBarButtons: buttons(rb, rb?.getBoundingClientRect())
    };
  });

async function capture(win: Win, testInfo: TestInfo, label: string, size: [number, number] | "maximized") {
  if (size === "maximized") {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize());
    // maximize() is async on every platform; wait for the resize (or give up and record what happened).
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()), { timeout: 5_000 }).toBe(true).catch(() => undefined);
  } else {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; if (w.isMaximized()) w.unmaximize(); });
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), size);
  }
  const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    const display = screen.getDisplayMatching(w.getBounds());
    const btn = (w as unknown as { getWindowButtonPosition?: () => { x: number; y: number } | null }).getWindowButtonPosition?.() ?? null;
    return { isMaximized: w.isMaximized(), size: w.getSize(), contentSize: w.getContentSize(), minimumSize: w.getMinimumSize(), windowBounds: w.getBounds(), contentBounds: w.getContentBounds(), workArea: display.workArea, displayBounds: display.bounds, scaleFactor: display.scaleFactor, macWindowButtonPosition: btn };
  });
  await expect.poll(() => win.evaluate(() => innerWidth)).toBe(bounds.contentSize[0]);
  await win.waitForTimeout(300); // let layout + the PDF re-fit settle
  const measured = await measure(win);
  // Window controls (min / max / close on Windows+Linux) relative to the window and to the screen's work area edges.
  const cb = bounds.contentBounds, wa = bounds.workArea;
  const controls = measured.titlebarButtons.filter((b) => ["最小化", "最大化", "还原", "关闭"].includes(b.label)).map((b) => ({
    label: b.label, left: b.left, top: b.top, right: b.right, bottom: b.bottom,
    toWindowRight: +(measured.viewport.width - b.right).toFixed(1), toWindowTop: b.top,
    screenLeft: +(cb.x + b.left).toFixed(1), screenTop: +(cb.y + b.top).toFixed(1), screenRight: +(cb.x + b.right).toFixed(1),
    toWorkAreaRight: +(wa.x + wa.width - (cb.x + b.right)).toFixed(1), toWorkAreaTop: +(cb.y + b.top - wa.y).toFixed(1)
  }));
  const m = { label, platform: process.platform, requested: size, ...bounds, ...measured, windowControls: controls };

  const tb = win.getByTestId("titlebar");
  const files = {
    titlebar: testInfo.outputPath(`titlebar-${label}-${process.platform}.png`),
    window: testInfo.outputPath(`window-${label}-${process.platform}.png`)
  };
  await tb.screenshot({ path: files.titlebar });
  await win.screenshot({ path: files.window });
  await testInfo.attach(`titlebar-${label}-${process.platform}.png`, { path: files.titlebar, contentType: "image/png" });
  await testInfo.attach(`window-${label}-${process.platform}.png`, { path: files.window, contentType: "image/png" });
  const json = testInfo.outputPath(`titlebar-${label}-${process.platform}.json`);
  writeFileSync(json, JSON.stringify(m, null, 2));
  await testInfo.attach(`titlebar-${label}-${process.platform}.json`, { path: json, contentType: "application/json" });
  console.log(`TITLEBAR-MEASURE ${JSON.stringify(m)}`);
  return m;
}

// Playwright requires the fixtures argument to be destructured.
// eslint-disable-next-line no-empty-pattern
test("title bar at the minimum window size, at 1024px and maximized: screenshots + measurements", async ({}, testInfo) => {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  // A workspace and an open PDF with a long name, so the title bar carries workspace + file title
  // and the reader toolbar (page switcher, zoom, 适合宽度) is on screen.
  const ws = mkdtempSync(join(tmpdir(), "point-e2e-tbnarrow-ws-"));
  const src = mkdtempSync(join(tmpdir(), "point-e2e-tbnarrow-src-"));
  const pdf = join(src, "一份文件名很长的水文测量报告-Depth-determination-and-uncertainty.pdf");
  writeFileSync(pdf, makePdf([["Page one of the title bar capture"], ["Page two"]]));
  await stub([ws]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await stub([pdf]);
  await win.getByRole("button", { name: "导入文档" }).click();
  await win.getByTestId("doc-list").getByRole("button", { name: /一份文件名很长/ }).click();
  await expect(win.getByTestId("reader-bar")).toBeVisible();

  const [minW, minH] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize());
  expect(minW, "the window declares a minimum width").toBeGreaterThan(0);
  const results = [
    await capture(win, testInfo, "min", [minW, minH]),
    await capture(win, testInfo, "1024", [1024, Math.max(minH, 700)]),
    await capture(win, testInfo, "maximized", "maximized")
  ];

  for (const m of results) {
    // Hold on main and after #65: the bar is visible and wholly inside the viewport.
    await expect(win.getByTestId("titlebar")).toBeVisible();
    expect(m.titlebar, `${m.label}: title bar exists`).not.toBeNull();
    expect(m.titlebar!.top, `${m.label}: title bar top`).toBeGreaterThanOrEqual(0);
    expect(m.titlebar!.bottom, `${m.label}: title bar bottom`).toBeLessThanOrEqual(m.viewport.height);
    // Measured on main (Linux xvfb) before adding: height 36, every title bar button one line and
    // inside the bar and the viewport.
    expect(m.titlebar!.height, `${m.label}: title bar height`).toBe(36);
    for (const b of m.titlebarButtons) {
      expect(b.textLines, `${m.label}: “${b.label}” wraps`).toBeLessThanOrEqual(1);
      expect(b.insideBar, `${m.label}: “${b.label}” inside the title bar`).toBe(true);
      expect(b.insideViewport, `${m.label}: “${b.label}” inside the window`).toBe(true);
    }
  }
});
