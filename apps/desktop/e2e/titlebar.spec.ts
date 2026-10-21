import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first. The title bar must stay fully inside the window whatever scrolls.
const results = join(import.meta.dirname, "..", "test-results");
let app: ElectronApplication;
test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: mkdtempSync(join(tmpdir(), "point-e2e-tb-")), POINT_FAKE_LLM: "1" }
  });
});
test.afterAll(async () => {
  await app?.close();
});

test("title bar is never clipped: body overflow and scrollIntoView cannot scroll the app shell", async () => {
  const win = await app.firstWindow();
  const src = mkdtempSync(join(tmpdir(), "point-tb-src-"));
  const pdf = join(src, "long.pdf");
  writeFileSync(pdf, makePdf(Array.from({ length: 6 }, (_, p) => Array.from({ length: 15 }, (_, i) => `Page ${p + 1} line ${i + 1}`))));
  const ws = mkdtempSync(join(tmpdir(), "point-tb-ws-"));
  await app.evaluate(({ dialog }, paths) => {
    let n = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths[Math.min(n++, 1)]!] })) as typeof dialog.showOpenDialog;
  }, [ws, pdf]);
  await win.getByRole("button", { name: "选择工作区…" }).click();
  await win.getByRole("button", { name: "导入文档" }).click();
  await expect(win.locator('[data-page="1"] .pdf-text span').first()).toBeVisible({ timeout: 15_000 });

  const bar = win.getByTestId("titlebar");
  const check = async (why: string) => {
    const r = await win.evaluate(() => {
      const t = document.querySelector('[data-testid="titlebar"]')!.getBoundingClientRect();
      const shell = document.querySelector(".shell")!.getBoundingClientRect();
      return { top: t.top, height: t.height, shellTop: shell.top, shellBottom: shell.bottom, vh: window.innerHeight, scrollY: window.scrollY };
    });
    expect(r.top, why).toBe(0);
    expect(r.height, why).toBe(36);
    expect(r.shellTop, why).toBe(0);
    expect(r.shellBottom, why).toBe(r.vh);
  };
  await check("after opening a PDF");
  // Anything appended to <body> (pdf.js measuring canvas, a stray library node) plus the viewport being
  // scrolled, directly or by scrollIntoView from deep inside the reader, must not move the shell.
  await win.evaluate(() => {
    const junk = document.createElement("div");
    junk.id = "stray-tall-node";
    junk.style.height = "400px";
    document.body.append(junk);
    document.scrollingElement!.scrollTop = 500;
  });
  await check("after body grows and the viewport is scrolled");
  await win.evaluate(() => document.querySelector('[data-page="6"]')!.scrollIntoView({ block: "end" }));
  await win.evaluate(() => document.querySelector('[data-page="1"]')!.scrollIntoView({ block: "start" }));
  await check("after scrollIntoView");
  await win.evaluate(() => document.getElementById("stray-tall-node")!.remove());
  await expect(bar).toBeVisible();
  await win.screenshot({ path: join(results, "titlebar-light.png"), clip: { x: 0, y: 0, width: 1280, height: 120 } });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.screenshot({ path: join(results, "titlebar-dark.png"), clip: { x: 0, y: 0, width: 1280, height: 120 } });
  await win.emulateMedia({ colorScheme: "light" });
});

// Narrow windows (#68, Windows): the 打开 ▾ button never wraps; when the left cell is too narrow it
// collapses to folder icon + ▾ (≥ 32×32, tooltip + aria-label keep the label). A ≥ 48px drag area and
// the window controls (Windows/Linux) or the 78px traffic-light inset (mac) are always kept.
test("title bar at narrow widths: no wrapping, 打开 ▾ collapses to icon + ▾, drag area and window controls kept", async () => {
  const win = await app.firstWindow();
  const shots = join(results, "screenshots");
  mkdirSync(shots, { recursive: true });
  // A long workspace folder name and a long file name fill both sides of the bar.
  const ws = join(mkdtempSync(join(tmpdir(), "point-tb-ws2-")), "一个名字非常非常长的工作区文件夹-Hydrographic-Survey-Project-2026");
  mkdirSync(ws);
  const src = mkdtempSync(join(tmpdir(), "point-tb-src2-"));
  const pdf = join(src, "一份文件名很长的水文测量报告-Depth-determination-and-uncertainty.pdf");
  writeFileSync(pdf, makePdf([["Narrow title bar"]]));
  await app.evaluate(({ dialog }, paths) => {
    let n = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths[Math.min(n++, 1)]!] })) as typeof dialog.showOpenDialog;
  }, [ws, pdf]);
  await win.getByTestId("titlebar").getByRole("button", { name: "打开" }).click();
  await win.getByRole("menuitem", { name: "工作区…", exact: true }).click();
  await win.getByRole("button", { name: "导入文档" }).click();
  await win.getByTestId("doc-list").getByRole("button", { name: /一份文件名很长/ }).click();
  await expect(win.locator(".titlebar-title")).toContainText("一份文件名很长");

  const mac = process.platform === "darwin";
  const resize = async (size: [number, number] | "maximized") => {
    await app.evaluate(({ BrowserWindow }, s) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      if (s === "maximized") return w.maximize();
      if (w.isMaximized()) w.unmaximize();
      w.setMinimumSize(Math.min(s[0], 900), Math.min(s[1], 600));
      w.setSize(s[0], s[1]);
    }, size);
    if (size !== "maximized") await expect.poll(() => win.evaluate(() => innerWidth)).toBe(size[0]);
    else {
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()), { timeout: 5_000 }).toBe(true).catch(() => undefined);
      // No window manager (Linux xvfb): maximize() is a no-op, so fill the work area instead.
      const want = await app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        if (!w.isMaximized()) w.setBounds(screen.getDisplayMatching(w.getBounds()).workArea);
        return w.getContentSize()[0]!;
      });
      await expect.poll(() => win.evaluate(() => innerWidth)).toBe(want);
    }
    await win.waitForTimeout(200);
  };
  const geometry = () =>
    win.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(s)!;
      const r = (s: string) => q(s).getBoundingClientRect();
      const open = q(".titlebar-open");
      const label = q(".titlebar-open-label");
      const tops = new Set<number>();
      const w = document.createTreeWalker(open, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      const controls = [...document.querySelectorAll<HTMLElement>(".window-controls button")].map((b) => b.getBoundingClientRect());
      return {
        vw: innerWidth,
        open: { ...r(".titlebar-open").toJSON(), lines: tops.size, aria: open.getAttribute("aria-label"), title: open.title, labelShown: label.getClientRects().length > 0, caretShown: q(".titlebar-open-caret").getClientRects().length > 0 },
        left: r(".titlebar-left").toJSON(),
        leftPad: parseFloat(getComputedStyle(q(".titlebar-left")).paddingLeft),
        title: r(".titlebar-title").toJSON(),
        controls: controls.map((c) => ({ left: c.left, right: c.right, width: c.width })),
        bar: r('[data-testid="titlebar"]').toJSON()
      };
    });
  const check = (g: Awaited<ReturnType<typeof geometry>>, why: string, collapsed: boolean) => {
    expect(g.bar.height, why).toBe(36);
    expect(g.open.lines, `${why}: 打开 ▾ on one line`).toBe(1);
    expect(g.open.right, `${why}: 打开 ▾ inside the left cell`).toBeLessThanOrEqual(g.left.right + 0.5);
    expect(g.open.aria, why).toBe("打开");
    expect(g.open.title, why).toBe("打开");
    expect(g.open.caretShown, `${why}: ▾ always shown`).toBe(true);
    expect(g.open.labelShown, `${why}: label ${collapsed ? "collapsed" : "shown"}`).toBe(!collapsed);
    if (collapsed) {
      expect(g.open.width, why).toBeGreaterThanOrEqual(32);
      expect(g.open.height, why).toBeGreaterThanOrEqual(32);
    }
    // Drag area: the centre cell keeps ≥ 48px.
    expect(g.title.width, `${why}: drag area`).toBeGreaterThanOrEqual(48);
    if (mac) expect(g.leftPad, `${why}: traffic lights`).toBeGreaterThanOrEqual(72);
    else {
      expect(g.controls, why).toHaveLength(3);
      for (const c of g.controls) expect(c.width, `${why}: caption button width`).toBe(46);
      expect(g.controls[2]!.right, `${why}: caption buttons flush right`).toBeCloseTo(g.vw, 0);
      expect(g.controls[0]!.left, `${why}: caption buttons clear of the title`).toBeGreaterThanOrEqual(g.title.right - 0.5);
    }
  };
  const [minW, minH] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize());
  const shoot = async (name: string) => {
    await win.screenshot({ path: join(shots, `titlebar-${name}-${process.platform}.png`), clip: { x: 0, y: 0, width: await win.evaluate(() => innerWidth), height: 80 } });
    await win.emulateMedia({ colorScheme: "dark" });
    await win.screenshot({ path: join(shots, `titlebar-${name}-${process.platform}-dark.png`), clip: { x: 0, y: 0, width: await win.evaluate(() => innerWidth), height: 80 } });
    await win.emulateMedia({ colorScheme: "light" });
  };
  // The narrowest real window: full label, one line.
  await resize([minW, Math.max(minH, 600)]);
  check(await geometry(), `min ${minW}px`, false);
  await shoot("min");
  // Narrower than the app allows (simulates large Windows text scaling): collapses, nothing else gives way.
  await resize([mac ? 600 : 520, 600]);
  check(await geometry(), "forced narrow", true);
  await shoot("narrowest");
  await win.getByTestId("titlebar").getByRole("button", { name: "打开" }).hover();
  await resize("maximized");
  check(await geometry(), "maximized", false);
  await shoot("maximized");
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]!;
    bw.unmaximize();
    bw.setMinimumSize(w!, h!);
  }, [minW, minH]);
});
