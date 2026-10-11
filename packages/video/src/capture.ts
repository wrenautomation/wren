/**
 * One still of a page, for a promo's screen scene (`@wren/studio` promo). Same Chromium as the
 * recorder; the page settles on network idle, then a short wait for its own motion.
 */
export interface CaptureOptions {
  /** CSS pixels; the file is twice that. */
  width?: number;
  height?: number;
  /** Extra settle after network idle, ms. */
  waitMs?: number;
}

/** Screenshot `url` at 2x into `file` (png). */
export async function capturePage(
  url: string,
  file: string,
  o: CaptureOptions = {},
): Promise<void> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new Error("capture needs Playwright: `pnpm exec playwright install chromium`", {
      cause: err,
    });
  }
  const browser = await playwright.chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage({
      viewport: { width: o.width ?? 1440, height: o.height ?? 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(o.waitMs ?? 800);
    await page.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}
