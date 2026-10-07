/**
 * The slide painter: a chromium draws `slidesHtml`'s page, a 1080 square PNG per slide and the
 * whole page as a PDF (one square page each) for LinkedIn. A local chromium on the laptop or the
 * desk; over CDP (`WREN_CDP_URL`, browserless on the box) where none can run, the Lambda.
 * Playwright loads lazily, so a host that never draws never loads it.
 */
import { SLIDE_PX } from "@wren/core/content/slides";
import type { SlidePainter } from "./carousel.js";

export class PaintUnavailable extends Error {
  override name = "PaintUnavailable";
}

/** The painter: `connectUrl` reaches a remote chromium; without it, one launches here. */
export function slidePainter(o: { connectUrl?: string | null } = {}): SlidePainter {
  return async (html, count) => {
    let playwright: typeof import("playwright-core");
    try {
      playwright = await import("playwright-core");
    } catch (err) {
      throw new PaintUnavailable("drawing slides needs playwright-core", { cause: err });
    }
    let browser: Awaited<ReturnType<typeof playwright.chromium.launch>>;
    try {
      browser = o.connectUrl
        ? await playwright.chromium.connectOverCDP(o.connectUrl)
        : await playwright.chromium.launch({ headless: true });
    } catch (err) {
      // The CDP URL carries a token: never put it in the message.
      throw new PaintUnavailable(
        o.connectUrl
          ? `could not reach the remote browser (WREN_CDP_URL): ${(err as Error).message.split("\n")[0]}`
          : "no chromium to draw with: `pnpm exec playwright install chromium`",
        { cause: err },
      );
    }
    try {
      const context = await browser.newContext({
        viewport: { width: SLIDE_PX, height: SLIDE_PX },
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "load" });
        // Runs in the page: its fonts loaded before the shots.
        await page.evaluate("document.fonts.ready.then(() => true)");
        const images: Uint8Array[] = [];
        for (let n = 1; n <= count; n++)
          images.push(
            await page
              .locator(`.slide[data-n="${n}"]`)
              .screenshot({ type: "png", animations: "disabled" }),
          );
        const pdf = await page.pdf({
          width: `${SLIDE_PX}px`,
          height: `${SLIDE_PX}px`,
          printBackground: true,
          pageRanges: `1-${count}`,
        });
        return { images, pdf };
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  };
}
