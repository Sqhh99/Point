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
      w.setMinimumSize(Math.min(s[0], w.getMinimumSize()[0]!), Math.min(s[1], 600));
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
      const controlEls = [...document.querySelectorAll<HTMLElement>(".window-controls button")];
      const controls = controlEls.map((b) => b.getBoundingClientRect());
      const tb = q('[data-testid="reader-bar"]');
      const tbButtons = [...tb.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.getClientRects().length).map((b) => {
        const br = b.getBoundingClientRect();
        const texts = new Set<number>();
        const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const rect of range.getClientRects()) if (rect.width > 0) texts.add(Math.round(rect.top));
        }
        return { label: b.getAttribute("aria-label") ?? b.textContent!.trim(), text: b.textContent!.trim(), title: b.title, iconOnly: b.classList.contains("icon-only"), left: br.left, right: br.right, width: br.width, height: br.height, lines: texts.size };
      });
      const tbr = tb.getBoundingClientRect();
      const reader = q("main.center").getBoundingClientRect();
      const chat = document.querySelector(".chat, .ai-panel, aside.chat-panel")?.getBoundingClientRect() ?? null;
      return {
        vw: innerWidth,
        open: { ...r(".titlebar-open").toJSON(), lines: tops.size, aria: open.getAttribute("aria-label"), title: open.title, labelShown: label.getClientRects().length > 0, caretShown: q(".titlebar-open-caret").getClientRects().length > 0 },
        left: r(".titlebar-left").toJSON(),
        leftPad: parseFloat(getComputedStyle(q(".titlebar-left")).paddingLeft),
        title: r(".titlebar-title").toJSON(),
        controls: controls.map((c, i) => ({ left: c.left, right: c.right, width: c.width, title: controlEls[i]!.title, aria: controlEls[i]!.getAttribute("aria-label") })),
        toolbar: { left: tbr.left, right: tbr.right, scrollWidth: tb.scrollWidth, clientWidth: tb.clientWidth, level: Number(tb.dataset.collapse), buttons: tbButtons },
        readerWidth: reader.width,
        chatWidth: chat?.width ?? null,
        bar: r('[data-testid="titlebar"]').toJSON()
      };
    });
  const check = (g: Awaited<ReturnType<typeof geometry>>, why: string, collapsed: boolean) => {
    expect(g.bar.height, why).toBe(36);
    expect(g.open.lines, `${why}: 打开 ▾ on one line`).toBe(1);
    expect(g.open.right, `${why}: 打开 ▾ inside the left cell`).toBeLessThanOrEqual(g.left.right + 0.5);
    expect(g.open.aria, why).toBe("打开");
    expect(g.open.title, why).toBe("打开");
    expect(g.open.caretShown || g.open.labelShown, `${why}: ▾ always shown`).toBe(true);
    expect(g.open.labelShown, `${why}: label ${collapsed ? "collapsed" : "shown"}`).toBe(!collapsed);
    if (collapsed) {
      expect(g.open.width, why).toBeGreaterThanOrEqual(32);
      expect(g.open.height, why).toBeGreaterThanOrEqual(32);
    }
    // ≥ 12px from 打开 ▾ to the document title.
    expect(g.title.left - g.open.right, `${why}: gap 打开 ▾ → title`).toBeGreaterThanOrEqual(12);
    // Drag area: the centre cell keeps ≥ 48px.
    expect(g.title.width, `${why}: drag area`).toBeGreaterThanOrEqual(48);
    if (mac) expect(g.leftPad, `${why}: traffic lights`).toBeGreaterThanOrEqual(72);
    else {
      expect(g.controls, why).toHaveLength(3);
      for (const c of g.controls) {
        expect(c.width, `${why}: caption button width`).toBe(46);
        expect(c.title, `${why}: caption button tooltip`).toBe(c.aria);
      }
      expect(g.controls.map((c) => c.title)).toEqual(["最小化", expect.stringMatching(/^(最大化|还原)$/), "关闭"]);
      expect(g.controls[2]!.right, `${why}: caption buttons flush right`).toBeCloseTo(g.vw, 0);
      expect(g.controls[0]!.left, `${why}: caption buttons clear of the title`).toBeGreaterThanOrEqual(g.title.right - 0.5);
    }
  };
  // Reader toolbar: nothing wraps, nothing overflows; page switcher and zoom % always visible; icon-only
  // buttons ≥ 32×32 with tooltip = aria-label.
  const checkToolbar = (g: Awaited<ReturnType<typeof geometry>>, why: string) => {
    expect(g.toolbar.scrollWidth, `${why}: toolbar overflow (level ${g.toolbar.level})`).toBeLessThanOrEqual(g.toolbar.clientWidth);
    for (const b of g.toolbar.buttons) {
      expect(b.lines, `${why}: toolbar “${b.label}” wraps`).toBeLessThanOrEqual(1);
      expect(b.right, `${why}: toolbar “${b.label}” inside`).toBeLessThanOrEqual(g.toolbar.right + 0.5);
      if (b.iconOnly) {
        expect(b.width, `${why}: “${b.label}” width`).toBeGreaterThanOrEqual(32);
        expect(b.height, `${why}: “${b.label}” height`).toBeGreaterThanOrEqual(32);
        expect(b.title, `${why}: “${b.label}” tooltip`).toBeTruthy();
      }
    }
    const labels = g.toolbar.buttons.map((b) => b.label);
    for (const keep of ["上一页", "下一页", "恢复 100%"]) expect(labels, `${why}: ${keep} visible`).toContain(keep);
  };
  const [minW, minH] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize());
  const shoot = async (name: string) => {
    await win.screenshot({ path: join(shots, `tbfix-${name}-${process.platform}.png`), clip: { x: 0, y: 0, width: await win.evaluate(() => innerWidth), height: 80 } });
    await win.emulateMedia({ colorScheme: "dark" });
    await win.screenshot({ path: join(shots, `tbfix-${name}-${process.platform}-dark.png`), clip: { x: 0, y: 0, width: await win.evaluate(() => innerWidth), height: 80 } });
    await win.emulateMedia({ colorScheme: "light" });
  };
  // The narrowest real window: full label, one line.
  await resize([minW, Math.max(minH, 600)]);
  const gMin = await geometry();
  check(gMin, `min ${minW}px`, false);
  checkToolbar(gMin, `min ${minW}px`);
  // At the minimum the reader and chat panes are at (at least) their design minimums.
  expect(gMin.readerWidth, "reader ≥ 360 at the minimum window").toBeGreaterThanOrEqual(360);
  if (gMin.chatWidth !== null) expect(gMin.chatWidth, "chat ≥ 320 at the minimum window").toBeGreaterThanOrEqual(320);
  await shoot("min");
  // The ⋯ menu holds what no longer fits, 适合宽度 first. The reader never gets narrower than 360px, so
  // squeeze the toolbar itself (as a longer sheet name or wider system font would) to reach that stage.
  await win.getByTestId("reader-bar").evaluate((el) => (el.style.maxWidth = "300px"));
  await expect.poll(() => win.getByTestId("reader-bar").getAttribute("data-collapse")).toMatch(/^[34]$/);
  const gSqueezed = await geometry();
  expect(gSqueezed.toolbar.scrollWidth, "squeezed toolbar: no overflow").toBeLessThanOrEqual(gSqueezed.toolbar.clientWidth);
  {
    await win.getByTestId("reader-more").click();
    const items = await win.getByTestId("reader-bar").getByRole("menuitem").allTextContents();
    expect(items[0]).toBe("适合宽度");
    await win.screenshot({ path: join(shots, `toolbar-menu-min-${process.platform}.png`), clip: { x: 0, y: 0, width: minW, height: 200 } });
    await win.getByTestId("reader-bar").getByRole("menuitem", { name: "适合宽度" }).click();
    await expect(win.getByTestId("reader-bar").getByRole("menu")).toHaveCount(0);
  }
  await win.getByTestId("reader-bar").evaluate((el) => (el.style.maxWidth = ""));
  await expect.poll(() => win.getByTestId("reader-bar").getAttribute("data-collapse")).toBe(String(gMin.toolbar.level));
  // Narrower than the app allows (simulates large Windows text scaling): collapses, nothing else gives way.
  await resize([mac ? 600 : 440, 600]);
  check(await geometry(), "forced narrow", true);
  await shoot("narrowest");
  await win.getByTestId("titlebar").getByRole("button", { name: "打开" }).hover();
  await resize("maximized");
  const gMax = await geometry();
  check(gMax, "maximized", false);
  checkToolbar(gMax, "maximized");
  expect(gMax.toolbar.level, "maximized: toolbar fully labelled").toBe(0);
  await shoot("maximized");
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]!;
    bw.unmaximize();
    bw.setMinimumSize(w!, h!);
  }, [minW, minH]);
});

// The dragged chat width is a preference: shrinking the window clamps only what is shown (reader ≥ 360,
// chat ≥ 320), and enlarging it again restores the preference; point.chatWidth is written only on drag end.
test("splitter: chat width 600 at full size survives shrinking to the minimum and re-enlarging; storage stays 600", async () => {
  const win = await app.firstWindow();
  const full = async () => {
    const want = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.maximize();
      if (!w.isMaximized()) w.setBounds(screen.getDisplayMatching(w.getBounds()).workArea);
      return w.getContentSize()[0]!;
    });
    await expect.poll(() => win.evaluate(() => innerWidth), { timeout: 5_000 }).toBe(want);
  };
  const panes = () =>
    win.evaluate(() => ({
      reader: document.querySelector("main.center")!.getBoundingClientRect().width,
      chat: document.querySelector(".ai-panel")!.getBoundingClientRect().width,
      stored: localStorage.getItem("point.chatWidth"),
      overflow: document.querySelector(".desk")!.scrollWidth - document.querySelector(".desk")!.clientWidth
    }));
  await full();
  // Real mouse drag on the splitter until the chat is 600px wide.
  const sep = win.getByRole("separator", { name: "调整对话面板宽度" });
  const box = (await sep.boundingBox())!;
  const before = await panes();
  const x0 = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await win.mouse.move(x0, y);
  await win.mouse.down();
  await win.mouse.move(x0 - (600 - before.chat), y, { steps: 8 });
  await win.mouse.up();
  await expect.poll(async () => (await panes()).chat).toBe(600);
  expect((await panes()).stored).toBe("600");
  // Shrink to the minimum: both minimums hold, nothing overflows, storage untouched.
  const [minW, minH] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize());
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]!;
    bw.unmaximize();
    bw.setSize(w!, h!);
  }, [minW, minH]);
  await expect.poll(() => win.evaluate(() => innerWidth)).toBe(minW);
  const small = await panes();
  expect(small.reader).toBeGreaterThanOrEqual(360);
  expect(small.chat).toBeGreaterThanOrEqual(320);
  expect(small.overflow).toBeLessThanOrEqual(0);
  expect(small.stored).toBe("600");
  // Asking for less than the minimum is refused by the window.
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w! - 50, h!), [minW, minH]);
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => innerWidth)).toBe(minW);
  // Re-enlarge: the preferred 600 comes back.
  await full();
  await expect.poll(async () => (await panes()).chat).toBe(600);
  expect((await panes()).stored).toBe("600");
});
