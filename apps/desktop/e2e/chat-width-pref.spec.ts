import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Requires `pnpm build` first. The chat pane width is a user preference written only when a splitter
// drag ends: window resizes and relaunches show it clamped to the current window (reader and chat at
// their minimums) but never rewrite it, so enlarging the window again restores it.
//
// Nothing about the layout is hardcoded: the minimum window comes from getMinimumSize(), the window
// sizes fit the screen's work area (macOS CI runners are 1024 wide), the target width W lies between the
// narrowest and widest chat the splitter allows at that size, and the storage key is found by behaviour
// (the localStorage entry a drag changes to the shown width). Measurements go to
// test-results/screenshots/chat-width-pref-<platform>.json and a CHAT-WIDTH-PREF log line.

type Win = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
const shots = join(import.meta.dirname, "..", "test-results", "screenshots");
const SEP = "调整对话面板宽度";

let userData = "";
let app: ElectronApplication;
let win: Win;
const launch = async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(import.meta.dirname, "..", "out", "main", "index.js")],
    env: { ...env, POINT_USER_DATA: userData, POINT_FAKE_LLM: "1" }
  });
  win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await expect(win.getByRole("separator", { name: SEP })).toBeVisible();
};
/** Quit and start again on the same profile. Chromium writes localStorage to disk lazily, so wait first. */
const relaunch = async () => {
  await win.waitForTimeout(3_000);
  await app.close();
  await launch();
};
test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "point-e2e-chatpref-"));
  await launch();
});
test.afterAll(async () => {
  await app?.close();
});

/** Reader = the splitter's previous sibling, chat = the “AI 面板” region; widths in CSS px. */
const panes = () =>
  win.evaluate((sepName) => {
    const sep = document.querySelector(`[role="separator"][aria-label="${sepName}"]`);
    const w = (el: Element | null | undefined) => (el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : null);
    return { viewport: innerWidth, reader: w(sep?.previousElementSibling), chat: w(document.querySelector('aside[aria-label="AI 面板"]')), overflowX: document.scrollingElement!.scrollWidth > innerWidth };
  }, SEP);
const storage = () => win.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const readKeys = (keys: string[]) => win.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);

async function setSize(w: number, h: number) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]!;
    if (bw.isMaximized()) bw.unmaximize();
    bw.setSize(w!, h!);
  }, [w, h]);
  await expect.poll(() => win.evaluate(() => innerWidth)).toBe(w);
  await win.waitForTimeout(300);
}
/** A real pointer drag on the splitter by dx px (dx = 0 is a click without a drag). */
async function drag(dx: number) {
  const b = (await win.getByRole("separator", { name: SEP }).boundingBox())!;
  const vw = await win.evaluate(() => innerWidth);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  if (dx) await win.mouse.move(Math.max(1, Math.min(vw - 2, x + dx)), y, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(300);
}
/** Drag the splitter until the chat pane is `target` wide (a couple of corrective drags at most). */
async function dragChatTo(target: number) {
  for (let i = 0; i < 3; i++) {
    const c = (await panes()).chat!;
    if (Math.abs(c - target) < 1) break;
    await drag(c - target); // dragging left widens the chat
  }
}

test("chat width: resize and relaunch show it clamped but never rewrite it; only a drag end writes", async () => {
  const [minW, minH] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize());
  const workArea = await app.evaluate(({ BrowserWindow, screen }) => screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).workArea);
  // The larger window: as wide as the work area allows, at most minW + 300; as tall as the minimum.
  const bigW = Math.min(workArea.width, minW + 300);
  expect(bigW, `work area ${workArea.width}px leaves room above the minimum width ${minW}`).toBeGreaterThan(minW + 40);
  const m: Record<string, unknown> = { platform: process.platform, minimumSize: [minW, minH], workArea, bigWindow: [bigW, minH] };
  const shot = (name: string) => win.screenshot({ path: join(shots, `chat-width-pref-${name}-${process.platform}.png`) });
  mkdirSync(shots, { recursive: true });

  // The splitter's range at the large window, then W in the middle of it.
  await setSize(bigW, minH);
  await drag(-2 * bigW);
  const widest = await panes();
  await drag(2 * bigW);
  const narrowest = await panes();
  const W = Math.round((widest.chat! + narrowest.chat!) / 2);
  m.range = { widest, narrowest, W };
  expect(widest.chat! - narrowest.chat!, "the splitter has a usable range at the larger window").toBeGreaterThanOrEqual(40);

  // Drag to W; find the storage key by behaviour: the entry the drag set to the shown width.
  const before = await storage();
  await dragChatTo(W);
  const atW = await panes();
  const after = await storage();
  const keys = Object.keys(after).filter((k) => after[k] === String(Math.round(atW.chat!)) && before[k] !== after[k]);
  m.drag = { panes: atW, keys, stored: keys.map((k) => after[k]) };
  expect(Math.abs(atW.chat! - W), `chat dragged to W=${W} (shown ${atW.chat})`).toBeLessThanOrEqual(1);
  expect(keys.length, "a drag end persists the shown chat width in localStorage").toBeGreaterThan(0);
  const stored = after[keys[0]!]!;
  await shot("at-W");

  // Shrink to the minimum window: clamped display, stored value untouched; enlarging restores W.
  await setSize(minW, minH);
  const atMin = await panes();
  const storedAtMin = await readKeys(keys);
  await shot("min");
  await setSize(bigW, minH);
  const back = await panes();
  const storedBack = await readKeys(keys);
  m.resize = { atMin, storedAtMin, back, storedBack };
  expect.soft(atMin.chat!, `min window: chat clamped below W (shown ${atMin.chat})`).toBeLessThan(W);
  expect.soft(atMin.overflowX, "min window: no horizontal overflow").toBe(false);
  expect.soft(storedAtMin, "shrinking the window does not rewrite the stored width").toEqual(keys.map(() => stored));
  expect.soft(back.chat, "enlarging the window again restores W").toBe(atW.chat);
  expect.soft(storedBack, "enlarging the window does not rewrite the stored width").toEqual(keys.map(() => stored));

  // A click on the splitter without a drag does not change the width.
  await drag(0);
  const storedClick = await readKeys(keys);
  m.clickWithoutDrag = { panes: await panes(), stored: storedClick };
  expect.soft(storedClick, "a click without a drag leaves the stored width").toEqual(keys.map(() => stored));

  // Relaunch: the stored width comes back unchanged and is shown again at the larger window.
  await relaunch();
  const storedRelaunch = await readKeys(keys);
  await setSize(bigW, minH);
  const relaunched = await panes();
  m.relaunch = { storedOnStart: storedRelaunch, panes: relaunched, storedAfterResize: await readKeys(keys) };
  expect.soft(storedRelaunch, "relaunch does not rewrite the stored width").toEqual(keys.map(() => stored));
  expect.soft(relaunched.chat, "relaunch restores W").toBe(atW.chat);

  // A stored width too wide for the window: shown clamped (the widest the splitter allows), never rewritten.
  const tooWide = String(Math.round(widest.chat! * 3));
  await win.evaluate(([ks, v]) => { for (const k of ks as string[]) localStorage.setItem(k, v as string); }, [keys, tooWide] as const);
  await relaunch();
  const storedWideStart = await readKeys(keys);
  await setSize(bigW, minH);
  const wide = await panes();
  await shot("too-wide-stored");
  await setSize(minW, minH);
  const wideMin = await panes();
  await setSize(bigW, minH);
  const wideBack = await panes();
  await drag(0);
  const storedWideEnd = await readKeys(keys);
  m.tooWide = { stored: tooWide, storedOnStart: storedWideStart, panes: wide, atMin: wideMin, back: wideBack, storedAfterResizeAndClick: storedWideEnd };
  expect.soft(storedWideStart, "relaunch with a too-wide stored width leaves it as stored").toEqual(keys.map(() => tooWide));
  expect.soft(wide.chat, `too-wide ${tooWide}: shown as the widest the splitter allows`).toBe(widest.chat);
  expect.soft(wide.reader, "too-wide: the reader keeps the width it has with the widest chat").toBe(widest.reader);
  expect.soft(wide.overflowX, "too-wide: no horizontal overflow").toBe(false);
  expect.soft(wideMin.chat, "too-wide at the min window: same clamp as any width").toBe(atMin.chat);
  expect.soft(wideBack.chat, "too-wide after min → larger: clamped again, not shrunk").toBe(widest.chat);
  expect.soft(storedWideEnd, "resize and click never rewrite the too-wide stored width").toEqual(keys.map(() => tooWide));

  const json = join(shots, `chat-width-pref-${process.platform}.json`);
  writeFileSync(json, JSON.stringify(m, null, 2));
  await test.info().attach(`chat-width-pref-${process.platform}.json`, { path: json, contentType: "application/json" });
  console.log(`CHAT-WIDTH-PREF ${JSON.stringify(m)}`);
});
