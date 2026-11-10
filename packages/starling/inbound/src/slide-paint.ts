/**
 * The slide painter: a chromium draws `slidesHtml`'s page, a 1080 square JPEG per slide (Instagram takes JPEG only) and the
 * whole page as a PDF (one square page each) for LinkedIn. A local chromium on the laptop or the
 * desk; where none can run, the render Lambda (`WREN_RENDER_FUNCTION`).
 * Playwright loads lazily, so a host that never draws never loads it.
 */
import { paintInBrowser, type RenderLambda, renderLambda } from "@wren/browser";
import { SLIDE_PX } from "@wren/starling-core/slides";
import type { SlidePainter } from "./carousel.js";

export class PaintUnavailable extends Error {
  override name = "PaintUnavailable";
}

/** The painter: `lambda` paints in the render Lambda; without it, one launches here. */
export function slidePainter(o: { lambda?: string | RenderLambda } = {}): SlidePainter {
  if (o.lambda) {
    const lambda = typeof o.lambda === "string" ? renderLambda(o.lambda) : o.lambda;
    return async (html, count) => {
      try {
        return await lambda.paint(html, count, SLIDE_PX);
      } catch (err) {
        throw new PaintUnavailable(`render Lambda: ${(err as Error).message}`, { cause: err });
      }
    };
  }
  return async (html, count) => {
    let playwright: typeof import("playwright-core");
    try {
      playwright = await import("playwright-core");
    } catch (err) {
      throw new PaintUnavailable("drawing slides needs playwright-core", { cause: err });
    }
    let browser: Awaited<ReturnType<typeof playwright.chromium.launch>>;
    try {
      browser = await playwright.chromium.launch({ headless: true });
    } catch (err) {
      throw new PaintUnavailable(
        "no chromium to draw with: `pnpm exec playwright install chromium`",
        {
          cause: err,
        },
      );
    }
    try {
      return await paintInBrowser(browser, html, count, SLIDE_PX);
    } finally {
      await browser.close();
    }
  };
}
