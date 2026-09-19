import { describe, expect, it } from "vitest";
import {
  browserbaseRenderer,
  type CdpBrowser,
  type CdpContext,
  type CdpPage,
  openSession,
} from "./browserbase.js";
import { RenderUnavailable } from "./render.js";

const KEY = "bb_live_secret";

function fakeFetch(status: number, body: unknown): typeof fetch & { calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const f = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch & { calls: RequestInit[] };
  f.calls = calls;
  return f;
}

describe("openSession", () => {
  it("sends the key as a header and returns the connect url", async () => {
    const fetch = fakeFetch(201, { id: "s1", connectUrl: "wss://connect.example/s1" });
    const s = await openSession({ apiKey: KEY, projectId: "p1", fetch });
    expect(s).toEqual({ id: "s1", connectUrl: "wss://connect.example/s1" });
    const headers = fetch.calls[0]?.headers as Record<string, string>;
    expect(headers["X-BB-API-Key"]).toBe(KEY);
    expect(fetch.calls[0]?.body).toBe(JSON.stringify({ projectId: "p1" }));
  });

  it("names the env var, never the key, when refused", async () => {
    const fetch = fakeFetch(401, { error: "nope" });
    const err = await openSession({ apiKey: KEY, projectId: "p1", fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(RenderUnavailable);
    expect(err.message).toContain("BROWSERBASE_API_KEY");
    expect(err.message).not.toContain(KEY);
  });
});

function fakeBrowser(pages: Record<string, string>) {
  const log: string[] = [];
  const context: CdpContext = {
    setExtraHTTPHeaders: async (h) => void log.push(`ua=${h["User-Agent"]}`),
    route: async () => void log.push("route"),
    newPage: async (): Promise<CdpPage> => {
      let current = "about:blank";
      return {
        goto: async (url) => {
          current = url;
          log.push(`goto ${url}`);
          return { status: () => 200 };
        },
        waitForTimeout: async () => undefined,
        content: async () => pages[current] ?? "",
        url: () => current,
        close: async () => void log.push("page closed"),
      };
    },
    clearCookies: async () => void log.push("cookies cleared"),
  };
  const browser: CdpBrowser = {
    contexts: () => [context],
    newContext: async () => context,
    close: async () => void log.push("browser closed"),
  };
  return { browser, log };
}

describe("browserbaseRenderer", () => {
  it("renders in the session's default context, one page per url, cookies cleared after", async () => {
    const { browser, log } = fakeBrowser({ "https://a.example/": "<p>A</p>" });
    const renderer = await browserbaseRenderer("wren/1 (ops@example.com)", {
      apiKey: KEY,
      projectId: "p1",
      fetch: fakeFetch(201, { id: "s1", connectUrl: "wss://x" }),
      connect: async () => browser,
    });
    const page = await renderer.render("https://a.example/");
    expect(page).toEqual({ html: "<p>A</p>", finalUrl: "https://a.example/", statusCode: 200 });
    await renderer.close();
    expect(log).toEqual([
      "ua=wren/1 (ops@example.com)",
      "route",
      "goto https://a.example/",
      "page closed",
      "cookies cleared",
      "browser closed",
    ]);
  });
});
