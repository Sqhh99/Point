import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
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
