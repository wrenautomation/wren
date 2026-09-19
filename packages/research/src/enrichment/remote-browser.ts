/**
 * The render tier over CDP: a chromium somewhere else, for hosts with no
 * browser of their own (Lambda). Two ways to get one — `cdpRenderer` takes a
 * WebSocket URL (browserless on our own box; the token rides in the URL, so
 * the URL is a secret), `browserbaseRenderer` opens a Browserbase session
 * first. Same contract as `browserRenderer`: declared User-Agent,
 * images/media/fonts blocked, the words are the payload. One difference CDP
 * forces: a remote browser serves one default context, so isolation between
 * URLs is a fresh page plus cleared cookies rather than a fresh context.
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

export interface CdpOptions {
  /** ws(s):// endpoint of a chromium's DevTools protocol, e.g. browserless with its token. */
  connectUrl: string;
  /** Test seam: what `connectOverCDP` returns. */
  connect?: (connectUrl: string) => Promise<CdpBrowser>;
}

/** Render through a chromium already running at `connectUrl`. */
export async function cdpRenderer(userAgent: string, opts: CdpOptions): Promise<BrowserRenderer> {
  let browser: CdpBrowser;
  try {
    browser = await (opts.connect ?? connectOverCdp)(opts.connectUrl);
  } catch (err) {
    if (err instanceof RenderUnavailable) throw err;
    // The URL carries the token: never let it into the message.
    throw new RenderUnavailable(
      `could not reach the remote browser (WREN_CDP_URL): ${(err as Error).message}`,
      { cause: err },
    );
  }
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

/** Render through a fresh Browserbase session; it ends when the renderer closes. */
export async function browserbaseRenderer(
  userAgent: string,
  opts: BrowserbaseOptions,
): Promise<BrowserRenderer> {
  const session = await openSession(opts);
  return cdpRenderer(userAgent, {
    connectUrl: session.connectUrl,
    ...(opts.connect ? { connect: opts.connect } : {}),
  });
}
