/**
 * The render tier on Browserbase: a remote chromium reached over CDP, for hosts
 * with no browser of their own (Lambda). Same contract as `browserRenderer` —
 * declared User-Agent, images/media/fonts blocked, the words are the payload —
 * with one difference forced by CDP: Browserbase serves one default context per
 * session, so isolation between URLs is a fresh page plus cleared cookies rather
 * than a fresh context. One session per renderer; it ends when the browser
 * disconnects (`close`).
 */
import type { BrowserRenderer, RenderedPage, Renderer } from "./render.js";
import { RenderUnavailable } from "./render.js";

const API = "https://api.browserbase.com/v1/sessions";
const SETTLE_MS = 1200;
const PAGE_TIMEOUT_MS = 20_000;

export interface BrowserbaseOptions {
  apiKey: string;
  projectId: string;
  /** Test seam: the HTTP client that opens the session. */
  fetch?: typeof fetch;
  /** Test seam: what `connectOverCDP` returns. */
  connect?: (connectUrl: string) => Promise<CdpBrowser>;
}

/** The slice of a Playwright `Browser` this module touches. */
export interface CdpBrowser {
  contexts(): CdpContext[];
  newContext(opts: { userAgent: string }): Promise<CdpContext>;
  close(): Promise<void>;
}
export interface CdpContext {
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  route(url: string, handler: (route: CdpRoute) => Promise<void> | void): Promise<void>;
  newPage(): Promise<CdpPage>;
  clearCookies(): Promise<void>;
}
export interface CdpRoute {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
export interface CdpPage {
  goto(
    url: string,
    opts: { waitUntil: "load"; timeout: number },
  ): Promise<{ status(): number } | null>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

interface SessionResponse {
  id: string;
  connectUrl: string;
}

/** Open a session; the key travels in a header, never in a URL or an error. */
export async function openSession(
  opts: Pick<BrowserbaseOptions, "apiKey" | "projectId" | "fetch">,
): Promise<SessionResponse> {
  const doFetch = opts.fetch ?? fetch;
  const resp = await doFetch(API, {
    method: "POST",
    headers: { "X-BB-API-Key": opts.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: opts.projectId }),
  });
  if (!resp.ok) {
    const hint = resp.status === 401 ? " — BROWSERBASE_API_KEY refused" : "";
    throw new RenderUnavailable(`Browserbase session refused: HTTP ${resp.status}${hint}`);
  }
  const body = (await resp.json()) as Partial<SessionResponse>;
  if (typeof body.id !== "string" || typeof body.connectUrl !== "string") {
    throw new RenderUnavailable("Browserbase session response lacks id/connectUrl");
  }
  return { id: body.id, connectUrl: body.connectUrl };
}

async function connectOverCdp(connectUrl: string): Promise<CdpBrowser> {
  let playwright: typeof import("playwright-core");
  try {
    playwright = await import("playwright-core");
  } catch (err) {
    throw new RenderUnavailable("the Browserbase render tier needs playwright-core", {
      cause: err,
    });
  }
  return (await playwright.chromium.connectOverCDP(connectUrl)) as unknown as CdpBrowser;
}

export async function browserbaseRenderer(
  userAgent: string,
  opts: BrowserbaseOptions,
): Promise<BrowserRenderer> {
  const session = await openSession(opts);
  const browser = await (opts.connect ?? connectOverCdp)(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext({ userAgent }));
  await context.setExtraHTTPHeaders({ "User-Agent": userAgent });
  await context.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
  const render: Renderer = async (url): Promise<RenderedPage> => {
    const page = await context.newPage();
    try {
      let statusCode: number | null = null;
      try {
        const resp = await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
        statusCode = resp?.status() ?? null;
        await page.waitForTimeout(SETTLE_MS);
      } catch (err) {
        // Slow site: keep what rendered. Anything else is the page's failure.
        if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
      }
      return { html: await page.content(), finalUrl: page.url(), statusCode };
    } finally {
      await page.close();
      await context.clearCookies();
    }
  };
  return { render, close: () => browser.close() };
}
