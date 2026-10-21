import { test, expect, _electron as electron, type ElectronApplication, type TestInfo } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../../../packages/core/test/fixtures/make";

// Requires `pnpm build` first. Captures the title bar (and the reader toolbar under it) at the
// window's minimum size, at 1024px wide and maximized, for design review of the title bar (#65).
// Screenshots + measurements go to apps/desktop/test-results/screenshots/ (CI uploads that folder as
// e2e-screenshots-<os> on every run, #67) and are attached to the report; the measurements are also
// printed as one `TITLEBAR-MEASURE` line so they can be read from the CI log.
//
// Hard assertions here hold on main today. Measured-only values (no hard assertion yet) are listed
// in docs/pull-requests/2026-10-21-titlebar-min-width-capture.md and become assertions once #65 merges.

type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
let app: ElectronApplication;
const shots = join(import.meta.dirname, "..", "test-results", "screenshots");
const WINDOW_CONTROLS = ["最小化", "最大化", "还原", "关闭"];
/** macOS traffic lights occupy the left of the title bar (designer rule: 72px). */
const MAC_TRAFFIC_LIGHTS = 72;

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

/**
 * UI designer's narrow-title-bar rules, measured with selectors that don't depend on class names:
 * buttons by role, the open menu by its accessible name, drag regions by computed -webkit-app-region.
 */
const designRules = (win: Win) =>
  win.evaluate(
    ({ controls, trafficLights }) => {
      const tb = document.querySelector<HTMLElement>('[data-testid="titlebar"]') ?? document.querySelector<HTMLElement>("header");
      if (!tb) return null;
      const tr = tb.getBoundingClientRect();
      const shown = (el: Element) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0 && r.width > 0.5 && r.height > 0.5;
      };
      // Text that is actually painted (visually-hidden text, e.g. a 1px clipped label, does not count).
      const paintedText = (el: Element) => {
        let text = "";
        const rects: DOMRect[] = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const parent = n.parentElement!;
          if (!n.textContent!.trim() || !shown(parent)) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          const rs = [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
          if (!rs.length) continue;
          text += n.textContent;
          rects.push(...rs);
        }
        return { text: text.trim(), rects };
      };
      const box = (r: DOMRect) => ({ left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) });
      const buttons = [...tb.querySelectorAll<HTMLElement>('button, [role="button"], a[href], select, input')].filter(shown).map((b) => {
        const r = b.getBoundingClientRect();
        const { text, rects } = paintedText(b);
        const aria = (b.getAttribute("aria-label") ?? "").trim();
        const name = aria || (b.textContent ?? "").trim();
        const lineTops = new Set(rects.map((x) => Math.round(x.top)));
        const lineHeight = parseFloat(getComputedStyle(b).lineHeight) || parseFloat(getComputedStyle(b).fontSize) * 1.2;
        const textHeight = rects.length ? Math.max(...rects.map((x) => x.bottom)) - Math.min(...rects.map((x) => x.top)) : 0;
        const caretSvg = [...b.querySelectorAll("svg")].some((svg) => /caret|chevron|arrow|down/i.test(`${svg.getAttribute("class") ?? ""} ${svg.getAttribute("data-icon") ?? ""} ${svg.getAttribute("aria-label") ?? ""}`) && shown(svg));
        return {
          name,
          ariaLabel: aria || null,
          title: b.getAttribute("title"),
          paintedText: text,
          iconOnly: text.replace(/[▾▼⌄\s]/g, "") === "",
          caretVisible: text.includes("▾") || text.includes("▼") || caretSvg,
          textLines: lineTops.size,
          textHeight: +textHeight.toFixed(1),
          lineHeight: +lineHeight.toFixed(1),
          singleLine: lineTops.size <= 1 && textHeight <= lineHeight + 1,
          windowControl: controls.includes(name),
          ...box(r)
        };
      });
      const open = buttons.find((b) => /^打开/.test(b.name)) ?? null;
      const secondary = buttons.filter((b) => !b.windowControl && b !== open);
      // Drag region: scan the bar's middle row; a point drags if its hit chain (up to the bar) has a
      // drag region and no no-drag region / interactive element.
      const region = (el: Element) => getComputedStyle(el).getPropertyValue("-webkit-app-region").trim() || (getComputedStyle(el) as unknown as Record<string, string>)["webkitAppRegion"] || "";
      const y = tr.top + tr.height / 2;
      const runs: { left: number; right: number }[] = [];
      let start = -1;
      for (let x = Math.ceil(tr.left); x <= Math.floor(tr.right); x++) {
        let el = document.elementFromPoint(Math.min(x, innerWidth - 1), y);
        let drag = false;
        let blocked = false;
        while (el && el !== document.documentElement) {
          const r = region(el);
          if (r === "no-drag" || el.matches('button, [role="button"], a[href], select, input')) blocked = true;
          if (r === "drag") drag = true;
          if (el === tb) break;
          el = el.parentElement;
        }
        const ok = drag && !blocked;
        if (ok && start < 0) start = x;
        if ((!ok || x === Math.floor(tr.right)) && start >= 0) { runs.push({ left: start, right: ok ? x + 1 : x }); start = -1; }
      }
      const widest = runs.reduce((m, r) => Math.max(m, r.right - r.left), 0);
      // Caption-button area: Window Controls Overlay geometry when the app uses it; otherwise the
      // in-app window controls' own box (frameless Windows/Linux); on macOS the traffic-light strip.
      const wco = (navigator as unknown as { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
      const wcoRect = wco?.visible ? box(wco.getTitlebarAreaRect()) : null;
      const ctrl = buttons.filter((b) => b.windowControl);
      const captionArea = wcoRect
        ? { source: "windowControlsOverlay", left: wcoRect.right, right: innerWidth }
        : ctrl.length
          ? { source: "in-app window controls", left: Math.min(...ctrl.map((b) => b.left)), right: Math.max(...ctrl.map((b) => b.right)) }
          : null;
      const others = buttons.filter((b) => !b.windowControl);
      const overlapsCaption = captionArea ? others.filter((b) => b.right > captionArea.left + 0.5 && b.left < captionArea.right - 0.5).map((b) => b.name) : [];
      const overlapsTrafficLights = others.filter((b) => b.left < trafficLights - 0.5 && b.top < tr.bottom).map((b) => b.name);
      return { buttons, open, secondaryNames: secondary.map((b) => b.name), dragRuns: runs, widestDragRun: widest, wcoVisible: !!wco?.visible, wcoRect, captionArea, overlapsCaption, overlapsTrafficLights, trafficLightsWidth: trafficLights };
    },
    { controls: WINDOW_CONTROLS, trafficLights: MAC_TRAFFIC_LIGHTS }
  );

/**
 * Title-bar spacing and reader-toolbar layout (#68 round 2), all from role / aria / computed geometry:
 * the reader toolbar is role=toolbar “阅读工具”, the reader pane is <main>, the chat pane is the
 * complementary region “AI 面板”, the open menu is the button named 打开…, the document title is the
 * title-bar element that paints the open file's name.
 */
const layoutRules = (win: Win, docName: string) =>
  win.evaluate(
    ({ docName, controls }) => {
      const shown = (el: Element) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0 && r.width > 0.5 && r.height > 0.5;
      };
      const box = (r: DOMRect) => ({ left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) });
      const painted = (el: Element) => {
        let text = "";
        const rects: DOMRect[] = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent!.trim() || !shown(n.parentElement!)) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          const rs = [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
          if (!rs.length) continue;
          text += n.textContent;
          rects.push(...rs);
        }
        return { text: text.trim(), rects };
      };
      const name = (b: Element) => ((b.getAttribute("aria-label") ?? "").trim() || (b.textContent ?? "").trim());
      const tooltipAttr = (b: Element, root: Element) => {
        for (let el: Element | null = b; el && el !== root.parentElement; el = el.parentElement) {
          const t = el.getAttribute("title");
          if (t) return t;
        }
        const ids = b.getAttribute("aria-describedby");
        return ids ? ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim() || null : null;
      };
      const inside = (r: DOMRect, o: DOMRect) => r.left >= o.left - 0.5 && r.right <= o.right + 0.5 && r.top >= o.top - 0.5 && r.bottom <= o.bottom + 0.5;

      // ---- title bar
      const tb = document.querySelector('[data-testid="titlebar"]') ?? document.querySelector("header");
      const tr = tb!.getBoundingClientRect();
      const tbButtons = [...tb!.querySelectorAll<HTMLElement>('button, [role="button"]')];
      const openEl = tbButtons.find((b) => shown(b) && /^打开/.test(name(b))) ?? null;
      const openR = openEl?.getBoundingClientRect();
      // Deepest title-bar element whose own painted text is (a prefix of) the document name.
      const key = docName.slice(0, 6);
      const titleEl = [...tb!.querySelectorAll<HTMLElement>("*")].filter((el) => shown(el) && (el.textContent ?? "").includes(key) && ![...el.children].some((c) => (c.textContent ?? "").includes(key))).pop() ?? null;
      const titleText = titleEl ? painted(titleEl) : null;
      const titleLeft = titleText?.rects.length ? Math.min(...titleText.rects.map((x) => x.left)) : titleEl?.getBoundingClientRect().left ?? null;
      const titlebar = {
        open: openR ? { ...box(openR), topGap: +(openR.top - tr.top).toFixed(1), bottomGap: +(tr.bottom - openR.bottom).toFixed(1), centerDelta: +Math.abs((openR.top - tr.top) - (tr.bottom - openR.bottom)).toFixed(1) } : null,
        docTitle: titleEl ? { ...box(titleEl.getBoundingClientRect()), paintedLeft: titleLeft === null ? null : +titleLeft.toFixed(1), text: titleText?.text.slice(0, 60) ?? "" } : null,
        openToTitleGap: openR && titleLeft !== null ? +(titleLeft - openR.right).toFixed(1) : null,
        captionButtons: tbButtons.filter((b) => shown(b) && controls.includes(name(b))).map((b) => ({ name: name(b), title: b.getAttribute("title"), tooltipAttr: tooltipAttr(b, tb!) }))
      };

      // ---- reader toolbar
      const bar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="阅读工具"]');
      const br = bar?.getBoundingClientRect();
      const all = bar ? [...bar.querySelectorAll<HTMLElement>('button, [role="button"]')] : [];
      const iconGlyphs = /^[‹›−+\-⋯…▾\s]*$/;
      const btns = all.map((b, index) => {
        const r = b.getBoundingClientRect();
        const t = painted(b);
        const tops = new Set(t.rects.map((x) => Math.round(x.top)));
        const lh = parseFloat(getComputedStyle(b).lineHeight) || parseFloat(getComputedStyle(b).fontSize) * 1.2;
        const textHeight = t.rects.length ? Math.max(...t.rects.map((x) => x.bottom)) - Math.min(...t.rects.map((x) => x.top)) : 0;
        return {
          index,
          name: name(b),
          ariaLabel: (b.getAttribute("aria-label") ?? "").trim() || null,
          sourceText: (b.textContent ?? "").trim(),
          paintedText: t.text,
          shown: shown(b),
          iconOnly: iconGlyphs.test(t.text),
          tooltipAttr: tooltipAttr(b, bar!),
          textLines: tops.size,
          textHeight: +textHeight.toFixed(1),
          lineHeight: +lh.toFixed(1),
          insideToolbar: !!br && shown(b) && inside(r, br),
          ...box(r)
        };
      });
      const children = bar ? [...bar.children].filter(shown).map((c) => ({ name: (c.getAttribute("aria-label") ?? c.textContent ?? "").trim().slice(0, 40), ...box(c.getBoundingClientRect()), inside: inside(c.getBoundingClientRect(), br!) })) : [];
      const find = (re: RegExp) => btns.find((b) => re.test(b.name)) ?? null;
      const label = bar?.querySelector<HTMLElement>('[aria-live], [data-testid="switcher-label"]');
      const labelText = label && shown(label) ? painted(label).text : "";
      const zoomBtn = btns.find((b) => /^\d+%$/.test(b.paintedText)) ?? null;
      const prev = find(/^上一/), next = find(/^下一/);
      const overflow = btns.find((b) => b.shown && (/更多|溢出|overflow/i.test(b.name) || /^[⋯…]$/.test(b.paintedText))) ?? null;
      // Reader pane: the <main> landmark holding the reader toolbar; chat pane: the “AI 面板” region.
      const main = bar?.closest("main") ?? document.querySelector("main"), aside = document.querySelector('aside[aria-label="AI 面板"], [role="complementary"]');
      const readerW = main ? +main.getBoundingClientRect().width.toFixed(1) : null, chatW = aside ? +aside.getBoundingClientRect().width.toFixed(1) : null;
      const chain: string[] = [];
      for (let el: Element | null = bar; el && el !== document.body; el = el.parentElement) chain.push(`${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`);
      return {
        titlebar,
        toolbar: br ? { ...box(br), scrollWidth: bar!.scrollWidth, clientWidth: bar!.clientWidth } : null,
        toolbarChildren: children,
        toolbarButtons: btns,
        pageNav: { prevShown: !!prev?.shown && prev.insideToolbar, prevText: prev?.paintedText ?? null, nextShown: !!next?.shown && next.insideToolbar, nextText: next?.paintedText ?? null, label: labelText, labelInside: !!label && !!br && shown(label) && inside(label.getBoundingClientRect(), br) },
        zoom: { text: zoomBtn?.paintedText ?? null, inside: !!zoomBtn?.insideToolbar },
        capture: find(/框选/),
        fitWidth: find(/适合宽度/),
        overflowButton: overflow ? { ...overflow, rightmost: children.every((c) => c.right <= overflow.right + 0.5) } : null,
        panes: { reader: readerW, spaceForReaderAndChat: main && aside ? +(aside.getBoundingClientRect().right - main.getBoundingClientRect().left).toFixed(1) : null, readerBox: main ? box(main.getBoundingClientRect()) : null, chatBox: aside ? box(aside.getBoundingClientRect()) : null, toolbarAncestors: chain, chat: chatW, viewport: innerWidth, docScrollWidth: document.scrollingElement!.scrollWidth, bodyScrollWidth: document.body.scrollWidth, fits360plus320: !!main && !!aside && aside.getBoundingClientRect().right - main.getBoundingClientRect().left >= 360 + 320 + (aside.getBoundingClientRect().left - main.getBoundingClientRect().right) }
      };
    },
    { docName, controls: WINDOW_CONTROLS }
  );

/** Hover tooltip: title / aria-describedby (from layoutRules), else a role=tooltip element shown on hover. */
async function hoverTooltip(win: Win, target: ReturnType<Win["locator"]>, attr: string | null) {
  if (attr) return { source: "attribute", text: attr };
  try {
    await target.hover({ force: true, timeout: 2_000 });
    await win.waitForTimeout(800);
    const tip = win.getByRole("tooltip");
    const text = (await tip.count()) ? ((await tip.first().textContent()) ?? "").trim() : "";
    await win.mouse.move(1, 200);
    return text ? { source: "role=tooltip", text } : null;
  } catch {
    return null;
  }
}

/** Opens the reader toolbar's ⋯ overflow menu (if any) and lists its items, then closes it. */
async function overflowItems(win: Win, index: number | undefined) {
  if (index === undefined) return null;
  const toolbar = win.getByRole("toolbar", { name: "阅读工具" });
  try {
    await toolbar.locator('button, [role="button"]').nth(index).click({ timeout: 2_000 });
    const menu = win.getByRole("menu");
    await menu.first().waitFor({ state: "visible", timeout: 2_000 });
    const items = await menu.first().locator('[role="menuitem"], [role="menuitemcheckbox"], button').evaluateAll((els) => els.map((e) => ((e.getAttribute("aria-label") ?? "").trim() || (e.textContent ?? "").trim())));
    await win.keyboard.press("Escape");
    return items;
  } catch {
    await win.keyboard.press("Escape").catch(() => undefined);
    return [];
  }
}

type Layout = Awaited<ReturnType<typeof layoutRules>> & { captionTooltips: { name: string; tooltip: { source: string; text: string } | null }[]; iconTooltips: { name: string; tooltip: { source: string; text: string } | null }[]; overflowMenu: string[] | null };

async function capture(win: Win, testInfo: TestInfo, label: string, size: [number, number] | "maximized", docName: string) {
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
  const base = { label, platform: process.platform, requested: size, ...bounds, ...measured, windowControls: controls, design: await designRules(win) };

  const tb = win.getByTestId("titlebar");
  mkdirSync(shots, { recursive: true });
  const files = {
    titlebar: join(shots, `titlebar-${label}-${process.platform}.png`),
    window: join(shots, `window-${label}-${process.platform}.png`)
  };
  await tb.screenshot({ path: files.titlebar });
  await win.screenshot({ path: files.window });
  await testInfo.attach(`titlebar-${label}-${process.platform}.png`, { path: files.titlebar, contentType: "image/png" });
  await testInfo.attach(`window-${label}-${process.platform}.png`, { path: files.window, contentType: "image/png" });
  // Interactive checks run after the screenshots so hover / menus don't show up in them.
  const layout = await layoutRules(win, docName);
  const tbLoc = win.getByTestId("titlebar");
  const captionTooltips: Layout["captionTooltips"] = [];
  for (const c of layout.titlebar.captionButtons) captionTooltips.push({ name: c.name, tooltip: await hoverTooltip(win, tbLoc.getByRole("button", { name: c.name, exact: true }), c.tooltipAttr) });
  const toolbarLoc = win.getByRole("toolbar", { name: "阅读工具" }).locator('button, [role="button"]');
  const iconTooltips: Layout["iconTooltips"] = [];
  for (const b of layout.toolbarButtons.filter((x) => x.shown && x.iconOnly)) iconTooltips.push({ name: b.name, tooltip: await hoverTooltip(win, toolbarLoc.nth(b.index), b.tooltipAttr) });
  const menu = await overflowItems(win, layout.overflowButton?.index);
  const m = { ...base, layout: { ...layout, captionTooltips, iconTooltips, overflowMenu: menu } as Layout };
  const json = join(shots, `titlebar-${label}-${process.platform}.json`);
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
  const docName = "一份文件名很长的水文测量报告-Depth-determination-and-uncertainty";
  const pdf = join(src, `${docName}.pdf`);
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
    await capture(win, testInfo, "min", [minW, minH], docName),
    await capture(win, testInfo, "1024", [1024, Math.max(minH, 700)], docName),
    await capture(win, testInfo, "maximized", "maximized", docName)
  ];

  // Minimum window: the “min” state is the window's real minimum (getMinimumSize(), not a fixed 900),
  // and that minimum must fit sidebar + reader >= 360 + chat >= 320 + splitters without horizontal overflow.
  const min = results[0]!;
  const P = min.layout!.panes;
  const rb = P.readerBox, cbx = P.chatBox;
  const requiredMinWidth = rb && cbx ? +(rb.left + 360 + (cbx.left - rb.right) + 320 + (P.viewport - cbx.right)).toFixed(1) : null;
  // Window refuses to go below its minimum.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; if (w.isMaximized()) w.unmaximize(); });
  const narrower = await app.evaluate(async ({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]!;
    bw.setSize(w!, h!);
    await new Promise((r) => setTimeout(r, 300));
    return { requested: [w, h], size: bw.getSize(), contentSize: bw.getContentSize() };
  }, [minW - 50, minH]);
  const minCheck = { minimumSize: [minW, minH], minStateSize: min.size, minStateContentWidth: min.viewport.width, sidebarWidth: rb?.left ?? null, splitterWidth: rb && cbx ? +(cbx.left - rb.right).toFixed(1) : null, rightOfChat: cbx ? +(P.viewport - cbx.right).toFixed(1) : null, reader: P.reader, chat: P.chat, requiredMinWidth, docScrollWidth: P.docScrollWidth, bodyScrollWidth: P.bodyScrollWidth, setSizeMinus50: narrower };
  writeFileSync(join(shots, `min-width-${process.platform}.json`), JSON.stringify(minCheck, null, 2));
  console.log(`TITLEBAR-MINWIDTH ${JSON.stringify(minCheck)}`);
  expect.soft(min.size[0], `min: window resized to exactly getMinimumSize() width ${minW}`).toBe(minW);
  expect.soft(minW, `min: minWidth vs sidebar ${minCheck.sidebarWidth} + reader 360 + splitter ${minCheck.splitterWidth} + chat 320 + ${minCheck.rightOfChat}`).toBeGreaterThanOrEqual(requiredMinWidth ?? Infinity);
  expect.soft(P.reader, "min: reader pane >= 360 at the minimum width").toBeGreaterThanOrEqual(360);
  expect.soft(P.chat, "min: chat pane >= 320 at the minimum width").toBeGreaterThanOrEqual(320);
  expect.soft(P.docScrollWidth, `min: no horizontal overflow (document scrollWidth vs ${P.viewport})`).toBeLessThanOrEqual(P.viewport);
  expect.soft(cbx?.right ?? Infinity, "min: chat pane ends inside the window").toBeLessThanOrEqual(P.viewport + 0.5);
  expect.soft(narrower.size[0], `min: setSize(${minW - 50}) is refused (window stays >= ${minW})`).toBeGreaterThanOrEqual(minW);

  // UI designer's narrow-title-bar rules, at the minimum width on every platform. Expected to fail on
  // main until the product fix lands; soft so each rule reports its own measured value.
  const d = results[0]!.design!;
  expect.soft(d, "min: title bar found").not.toBeNull();
  for (const b of d.buttons) {
    // (a) no button text wraps: one painted line, text height within one line box.
    expect.soft(b.textLines, `(a) min: “${b.name}” text lines`).toBeLessThanOrEqual(1);
    expect.soft(b.textHeight, `(a) min: “${b.name}” text height vs line height ${b.lineHeight}px`).toBeLessThanOrEqual(b.lineHeight + 1);
  }
  // (b) collapse order: secondary buttons go icon-only before 打开; an icon-only 打开 keeps its ▾ caret.
  expect.soft(d.open, "(b) min: the 打开 menu button exists").not.toBeNull();
  if (d.open?.iconOnly) {
    for (const b of d.buttons.filter((x) => !x.windowControl && x.name !== d.open!.name)) expect.soft(b.iconOnly, `(b) min: “${b.name}” is icon-only before 打开`).toBe(true);
    expect.soft(d.open.caretVisible, "(b) min: icon-only 打开 still shows its ▾ caret").toBe(true);
  }
  // (c) icon-only buttons: hit box >= 32x32 and an aria-label equal to the original text.
  for (const b of d.buttons.filter((x) => x.iconOnly)) {
    expect.soft(b.width, `(c) min: icon-only “${b.name}” hit-box width`).toBeGreaterThanOrEqual(32);
    expect.soft(b.height, `(c) min: icon-only “${b.name}” hit-box height`).toBeGreaterThanOrEqual(32);
    expect.soft(b.ariaLabel, `(c) min: icon-only “${b.name}” has an aria-label`).toBeTruthy();
    if (b === d.open || /^打开/.test(b.name)) expect.soft((b.ariaLabel ?? "").replace(/[▾▼\s]/g, ""), "(c) min: icon-only 打开 aria-label = its text").toBe("打开");
  }
  // (d) a drag region >= 48px wide, and no title-bar control over the caption buttons (Windows) or
  // the traffic lights (macOS).
  expect.soft(d.widestDragRun, "(d) min: widest drag region (px)").toBeGreaterThanOrEqual(48);
  if (process.platform === "darwin") expect.soft(d.overlapsTrafficLights, `(d) min: controls inside the ${MAC_TRAFFIC_LIGHTS}px traffic-light area`).toEqual([]);
  else expect.soft(d.overlapsCaption, "(d) min: controls over the caption-button area").toEqual([]);


  // Title bar spacing + reader toolbar layout, every state (min, 1024, maximized), every platform.
  // Expected to fail on main until the product fix lands; soft so each value is reported.
  for (const m of results) {
    const L = m.layout!;
    const s = m.label;
    // Title bar: 打开 vertically centred in the 36px bar, >= 12px clear of the document title.
    expect.soft(L.titlebar.open, `${s}: 打开 button found`).not.toBeNull();
    expect.soft(L.titlebar.open?.centerDelta, `${s}: 打开 |top gap - bottom gap| (top ${L.titlebar.open?.topGap}, bottom ${L.titlebar.open?.bottomGap})`).toBeLessThanOrEqual(1);
    expect.soft(L.titlebar.docTitle, `${s}: document title found in the title bar`).not.toBeNull();
    expect.soft(L.titlebar.openToTitleGap, `${s}: gap 打开 → document title (px)`).toBeGreaterThanOrEqual(12);
    // Caption buttons (Windows / frameless Linux): hover tooltip with the button's name.
    if (process.platform !== "darwin") {
      const want: Record<string, RegExp> = { 最小化: /^最小化$/, 最大化: /^(最大化|还原)$/, 还原: /^(最大化|还原)$/, 关闭: /^关闭$/ };
      expect.soft(L.captionTooltips.map((c) => c.name).sort(), `${s}: caption buttons present`).toHaveLength(3);
      for (const c of L.captionTooltips) expect.soft(c.tooltip?.text ?? "", `${s}: “${c.name}” hover tooltip`).toMatch(want[c.name] ?? /^$/);
    }
    // Reader toolbar.
    expect.soft(L.toolbar, `${s}: reader toolbar found`).not.toBeNull();
    for (const c of L.toolbarChildren) expect.soft(c.inside, `${s}: toolbar child “${c.name}” inside the toolbar (${c.left}–${c.right} vs ${L.toolbar?.left}–${L.toolbar?.right})`).toBe(true);
    for (const b of L.toolbarButtons.filter((x) => x.shown)) {
      expect.soft(b.insideToolbar, `${s}: toolbar button “${b.name}” inside the toolbar`).toBe(true);
      expect.soft(b.textLines, `${s}: toolbar button “${b.name}” text lines`).toBeLessThanOrEqual(1);
      expect.soft(b.textHeight, `${s}: toolbar button “${b.name}” text height vs line height ${b.lineHeight}`).toBeLessThanOrEqual(b.lineHeight + 1);
    }
    expect.soft(L.pageNav.prevShown && L.pageNav.nextShown, `${s}: page nav ‹ › visible (${L.pageNav.prevText} ${L.pageNav.nextText})`).toBe(true);
    expect.soft(L.pageNav.labelInside ? L.pageNav.label : "", `${s}: page label n / N visible`).toMatch(/\d+\s*\/\s*\d+/);
    expect.soft(L.zoom.inside ? L.zoom.text : "", `${s}: zoom percentage visible`).toMatch(/^\d+%$/);
    // Collapse order: 框选 icon-only before 适合宽度 goes; 适合宽度 leads the rightmost ⋯ menu.
    const fitVisible = !!L.fitWidth?.shown && !!L.fitWidth?.insideToolbar;
    const capVisible = !!L.capture?.shown && !!L.capture?.insideToolbar;
    const menu = L.overflowMenu ?? [];
    if (fitVisible && capVisible && L.fitWidth!.iconOnly) expect.soft(L.capture!.iconOnly, `${s}: 框选 icon-only before 适合宽度`).toBe(true);
    if (!fitVisible) {
      expect.soft(capVisible ? L.capture!.iconOnly : menu.some((n) => /框选/.test(n)), `${s}: 适合宽度 overflowed → 框选 icon-only or in ⋯`).toBe(true);
      expect.soft(L.overflowButton, `${s}: ⋯ overflow button present`).not.toBeNull();
      expect.soft(menu[0] ?? "", `${s}: ⋯ menu starts with 适合宽度`).toMatch(/适合宽度/);
    }
    if (L.overflowButton) expect.soft(L.overflowButton.rightmost, `${s}: ⋯ is the rightmost toolbar item`).toBe(true);
    for (const b of L.toolbarButtons.filter((x) => !x.shown || !x.insideToolbar)) expect.soft(menu.some((n) => n.includes(b.name.replace(/[▾\s]/g, "").slice(0, 4))), `${s}: overflowed “${b.name}” reachable via ⋯`).toBe(true);
    // Icon-only toolbar buttons: >= 32x32, aria-label = original text, hover tooltip.
    const original: Record<string, string> = { 框选: "框选", 适合宽度: "适合宽度" };
    for (const b of L.toolbarButtons.filter((x) => x.shown && x.iconOnly)) {
      expect.soft(b.width, `${s}: icon-only “${b.name}” hit-box width`).toBeGreaterThanOrEqual(32);
      expect.soft(b.height, `${s}: icon-only “${b.name}” hit-box height`).toBeGreaterThanOrEqual(32);
      const orig = Object.keys(original).find((k) => b.sourceText.includes(k) || (b.ariaLabel ?? "").includes(k));
      if (orig) expect.soft(b.ariaLabel, `${s}: icon-only “${b.name}” aria-label`).toBe(original[orig]);
      else expect.soft(b.ariaLabel, `${s}: icon-only “${b.name}” has an aria-label`).toBeTruthy();
      expect.soft(L.iconTooltips.find((t) => t.name === b.name)?.tooltip?.text ?? "", `${s}: icon-only “${b.name}” hover tooltip`).not.toBe("");
    }
    // Panes: reader >= 360px, chat >= 320px (recorded; at min the window may not fit both).
    expect.soft(L.panes.reader, `${s}: reader pane width (space for reader+chat ${L.panes.spaceForReaderAndChat}px, 360+320 fits: ${L.panes.fits360plus320})`).toBeGreaterThanOrEqual(360);
    expect.soft(L.panes.chat, `${s}: chat pane width`).toBeGreaterThanOrEqual(320);
  }

  for (const m of results) {
    // Hold on main and after #65: the bar is visible and wholly inside the viewport.
    await expect(win.getByTestId("titlebar")).toBeVisible();
    expect(m.titlebar, `${m.label}: title bar exists`).not.toBeNull();
    expect(m.titlebar!.top, `${m.label}: title bar top`).toBeGreaterThanOrEqual(0);
    expect(m.titlebar!.bottom, `${m.label}: title bar bottom`).toBeLessThanOrEqual(m.viewport.height);
    // Height 36, every title bar button one line and inside the bar and the viewport. Holds on Linux
    // xvfb; on Windows and macOS CI “打开 ▾” wraps at the minimum width — a product bug, kept red on purpose.
    expect(m.titlebar!.height, `${m.label}: title bar height`).toBe(36);
    for (const b of m.titlebarButtons) {
      expect(b.textLines, `${m.label}: “${b.label}” wraps`).toBeLessThanOrEqual(1);
      expect(b.insideBar, `${m.label}: “${b.label}” inside the title bar`).toBe(true);
      expect(b.insideViewport, `${m.label}: “${b.label}” inside the window`).toBe(true);
    }
  }
});
