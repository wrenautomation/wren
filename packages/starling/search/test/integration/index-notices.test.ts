/**
 * The daily index read's notices: a page seen for the first time is no news (the loop submits
 * the sitemap); a flip is; a new page still out `STALE_DAYS` after its first check is, once.
 * Synthetic site only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SearchConsoleClient, submitSitemap } from "../../src/console.js";
import { formatChanges, STALE_DAYS, syncSearch } from "../../src/sync.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 120_000);
afterAll(async () => {
  await pg?.stop();
});

const OLD = "https://site.example/";
const NEW = "https://site.example/blog/new";
const DAY_MS = 86_400_000;
const day = (n: number) =>
  new Date(Date.parse("2026-01-01T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

/** Search Console with no rows and each URL's verdict from `state`; records every call. */
function fakeConsole(state: Map<string, boolean>) {
  const asked: { method: string; url: string }[] = [];
  const c: SearchConsoleClient = {
    token: async () => "t",
    fetch: async (url, init) => {
      asked.push({ method: init?.method ?? "GET", url });
      if (url.includes("searchAnalytics")) return new Response(JSON.stringify({ rows: [] }));
      if (url.includes("index:inspect")) {
        const page = JSON.parse(String(init?.body)).inspectionUrl as string;
        const ok = state.get(page) ?? false;
        return new Response(
          JSON.stringify({
            inspectionResult: {
              indexStatusResult: ok
                ? { verdict: "PASS", coverageState: "Submitted and indexed" }
                : { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" },
            },
          }),
        );
      }
      return new Response("");
    },
  };
  return { c, asked };
}

describe("index notices", () => {
  it("new pages are added, not news; a page still out after STALE_DAYS is, once; a flip is", async () => {
    const state = new Map([[OLD, true]]);
    const { c, asked } = fakeConsole(state);
    const pass = (n: number, urls: string[]) =>
      syncSearch(pg.db, {
        console: c,
        site: "sc-domain:site.example",
        urls,
        today: day(n),
        runId: null,
      });

    expect(await pass(0, [OLD])).toMatchObject({ added: [OLD], changes: [] });
    // The page goes up on day 1, unknown to Google: added, no notice.
    expect(await pass(1, [OLD, NEW])).toMatchObject({ added: [NEW], changes: [] });
    expect(await pass(2, [OLD, NEW])).toMatchObject({ added: [], changes: [] });
    for (let n = 3; n < STALE_DAYS + 1; n++)
      expect((await pass(n, [OLD, NEW])).changes).toEqual([]);
    const stale = await pass(STALE_DAYS + 1, [OLD, NEW]);
    expect(stale.changes).toMatchObject([{ url: NEW, stale: true, indexed: false }]);
    expect(formatChanges(stale.changes)).toEqual([
      `/blog/new is still not indexed ${STALE_DAYS} days after it went up: URL is unknown to Google`,
    ]);
    expect((await pass(STALE_DAYS + 2, [OLD, NEW])).changes).toEqual([]);
    // Then it gets in, and the old page drops out: two flips.
    state.set(NEW, true);
    state.set(OLD, false);
    expect(formatChanges((await pass(STALE_DAYS + 3, [OLD, NEW])).changes)).toEqual([
      "/ left the index: URL is unknown to Google",
      "/blog/new is in the index",
    ]);
    expect(asked.every((a) => a.method !== "PUT")).toBe(true);
  });

  it("submits the sitemap with one PUT on the property", async () => {
    const { c, asked } = fakeConsole(new Map());
    await submitSitemap(c, "sc-domain:site.example", "https://site.example/sitemap.xml");
    expect(asked).toEqual([
      {
        method: "PUT",
        url: "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Asite.example/sitemaps/https%3A%2F%2Fsite.example%2Fsitemap.xml",
      },
    ]);
  });
});
