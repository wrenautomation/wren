/**
 * The browser steps every lane shares. Each takes a launched chromium; who launches it (this
 * Mac, the render Lambda in `apps/render`) is the caller's. `renderLambda` runs the same steps
 * in that Lambda (designs/2026-11-09-render-lambda.md).
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { Browser } from "playwright-core";

const SETTLE_MS = 1200;
/** WebGL and intro motion need longer than text before a poster */
const SHOT_SETTLE_MS = 3000;
const SHOT_LOAD_MS = 6000;
export const PAGE_TIMEOUT_MS = 20_000;
/** the words are the payload */
const BLOCKED = new Set(["image", "media", "font"]);
/** Lambda's sync response cap is 6 MB; room for the JSON around it */
const MAX_RESULT_BYTES = 5_800_000;

export interface PageOut {
  html: string;
  finalUrl: string;
  statusCode: number | null;
}

export interface SlidesOut {
  images: Uint8Array[];
  pdf: Uint8Array;
}

/** One URL in a fresh context (no cookies carry), the caller's User-Agent, images/media/fonts blocked. */
export async function readInBrowser(
  browser: Browser,
  url: string,
  userAgent: string,
): Promise<PageOut> {
  const context = await browser.newContext({ userAgent });
  try {
    await context.route("**/*", (route) =>
      BLOCKED.has(route.request().resourceType()) ? route.abort() : route.continue(),
    );
    const page = await context.newPage();
    let statusCode: number | null = null;
    try {
      const resp = await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
      statusCode = resp?.status() ?? null;
      await page.waitForTimeout(SETTLE_MS);
    } catch (err) {
      // slow site: take what has rendered so far
      if ((err as Error)?.name !== "TimeoutError") throw err;
    }
    return { html: await page.content(), finalUrl: page.url(), statusCode };
  } finally {
    await context.close();
  }
}

/** `count` square slides (`.slide[data-n]`) as JPEGs, and the page as one PDF. */
export async function paintInBrowser(
  browser: Browser,
  html: string,
  count: number,
  px: number,
): Promise<SlidesOut> {
  const context = await browser.newContext({
    viewport: { width: px, height: px },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // runs in the page: fonts loaded before the shots
    await page.evaluate("document.fonts.ready.then(() => true)");
    const images: Uint8Array[] = [];
    for (let n = 1; n <= count; n++)
      images.push(
        await page
          .locator(`.slide[data-n="${n}"]`)
          .screenshot({ type: "jpeg", quality: 92, animations: "disabled" }),
      );
    const pdf = await page.pdf({
      width: `${px}px`,
      height: `${px}px`,
      printBackground: true,
      pageRanges: `1-${count}`,
    });
    return { images, pdf };
  } finally {
    await context.close();
  }
}

/** A live page's first screen as one JPEG (a poster): images on, time for WebGL to draw. */
export async function shotInBrowser(
  browser: Browser,
  url: string,
  size = { width: 1280, height: 800 },
): Promise<Uint8Array> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS })
      // slow page: shoot what has drawn
      .catch((err: Error) => {
        if (err?.name !== "TimeoutError") throw err;
      });
    // a looping video or stream holds `load` back for good (11-09: 20 s on every live page)
    await page.waitForLoadState("load", { timeout: SHOT_LOAD_MS }).catch(() => {});
    await page.waitForTimeout(SHOT_SETTLE_MS);
    return await page.screenshot({ type: "jpeg", quality: 82 });
  } finally {
    await context.close();
  }
}

// --- the render Lambda's wire ---

export type RenderRequest =
  | { op: "read"; url: string; userAgent: string }
  | { op: "paint"; html: string; count: number; px: number }
  | { op: "shot"; url: string };

/** `gz`: base64 gzip of the result JSON; `error`: why there is none. */
export type RenderResponse = { gz: string } | { error: string };

interface WirePage extends PageOut {}
interface WireSlides {
  images: string[];
  pdf: string;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export function encodeResult(out: PageOut | SlidesOut | Uint8Array): RenderResponse {
  const wire: WirePage | WireSlides | { jpeg: string } =
    out instanceof Uint8Array
      ? { jpeg: b64(out) }
      : "images" in out
        ? { images: out.images.map(b64), pdf: b64(out.pdf) }
        : out;
  const gz = gzipSync(JSON.stringify(wire)).toString("base64");
  if (gz.length > MAX_RESULT_BYTES)
    return {
      error: `result is ${(gz.length / 1e6).toFixed(1)} MB; the Lambda answers 6 MB at most`,
    };
  return { gz };
}

function decode<T>(res: RenderResponse): T {
  if ("error" in res) throw new RenderLambdaError(res.error);
  return JSON.parse(gunzipSync(Buffer.from(res.gz, "base64")).toString("utf8")) as T;
}

export class RenderLambdaError extends Error {
  override name = "RenderLambdaError";
}

/** Sends one request, returns the function's JSON answer; throws on a Lambda error. */
export type InvokeRender = (req: RenderRequest) => Promise<RenderResponse>;

export interface RenderLambda {
  read(url: string, userAgent: string): Promise<PageOut>;
  paint(html: string, count: number, px: number): Promise<SlidesOut>;
  /** A live page's poster (JPEG). */
  shot(url: string): Promise<Uint8Array>;
}

/** The render Lambda by name or ARN; `invoke` is a test seam. */
export function renderLambda(fn: string, invoke: InvokeRender = awsInvoke(fn)): RenderLambda {
  return {
    read: async (url, userAgent) => decode<WirePage>(await invoke({ op: "read", url, userAgent })),
    paint: async (html, count, px) => {
      const w = decode<WireSlides>(await invoke({ op: "paint", html, count, px }));
      return { images: w.images.map(bytes), pdf: bytes(w.pdf) };
    },
    shot: async (url) => bytes(decode<{ jpeg: string }>(await invoke({ op: "shot", url })).jpeg),
  };
}

function awsInvoke(fn: string): InvokeRender {
  let client: import("@aws-sdk/client-lambda").LambdaClient | null = null;
  return async (req) => {
    const { InvokeCommand, LambdaClient } = await import("@aws-sdk/client-lambda");
    client ??= new LambdaClient({});
    const out = await client.send(
      new InvokeCommand({
        FunctionName: fn,
        Payload: new TextEncoder().encode(JSON.stringify(req)),
      }),
    );
    const text = out.Payload ? new TextDecoder().decode(out.Payload) : "";
    // a crash or timeout: the payload is Lambda's own error JSON
    if (out.FunctionError)
      throw new RenderLambdaError(`render Lambda ${out.FunctionError}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as RenderResponse;
  };
}
