import { expect, type Locator } from "@playwright/test";

/**
 * Clicks a button on the floating selection bar once the bar has finished its pop-in (0.12 s, transform).
 * Clicked mid-animation, Playwright finds the button "not stable" and retries with a forced scroll-into-view
 * (block end / center / start); that scrolls the reader, and a scroll closes the bar (Reader onScroll). Under CPU
 * load the scroll event lands before the retried click: "<html> intercepts pointer events … element was detached"
 * (smoke ×10 on Windows CI, region ×10 on macOS CI, 8/20 locally under load). A user clicks a bar that is there.
 */
export async function clickOnBar(bar: Locator, name: string) {
  await expect(bar).toBeVisible();
  await bar.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await bar.getByRole("button", { name }).click();
}
