/**
 * The render Lambda (designs/2026-11-09-render-lambda.md): one chromium per call, closed after,
 * so /tmp never fills with profiles. Answers `RenderResponse`; a step that throws is `{ error }`.
 */
import chromium from "@sparticuz/chromium";
import {
  encodeResult,
  paintInBrowser,
  type RenderRequest,
  type RenderResponse,
  readInBrowser,
} from "@wren/browser";
import { chromium as playwright } from "playwright-core";

export async function handler(req: RenderRequest): Promise<RenderResponse> {
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    if (req.op === "read")
      return encodeResult(await readInBrowser(browser, req.url, req.userAgent));
    if (req.op === "paint")
      return encodeResult(await paintInBrowser(browser, req.html, req.count, req.px));
    return { error: `unknown op ${(req as { op?: unknown }).op}` };
  } catch (err) {
    return { error: err instanceof Error ? (err.message.split("\n")[0] ?? err.name) : String(err) };
  } finally {
    await browser.close();
  }
}
