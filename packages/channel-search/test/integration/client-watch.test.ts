/**
 * Search watch per client (designs/2026-10-07-per-client-runs.md): a client's pass reads only
 * with the part installed and its Search Console property connected, and writes into its own
 * database. Synthetic properties only.
 */
import { addClient } from "@wren/core/clients";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SearchConsoleClient } from "../../src/console.js";
import { clientSearch, originOf } from "../../src/restate/watch.js";
import { searchDays, searchPages } from "../../src/schema.js";
import { syncSearch } from "../../src/sync.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "kappa",
    name: "Kappa",
    accounts: { search_console: "sc-domain:kappa.example" },
    products: { "search.watch": {} },
  });
  await addClient(pg.db, pg.url, {
    id: "lambda",
    name: "Lambda",
    products: { "search.watch": { origin: "https://www.lambda.example" } },
  });
  await addClient(pg.db, pg.url, {
    id: "mu",
    name: "Mu",
    accounts: { search_console: "sc-domain:mu.example" },
  });
}, 120_000);
afterAll(async () => {
  await pg?.stop();
});

describe("originOf", () => {
  it("reads a domain property and a URL property", () => {
    expect(originOf("sc-domain:Example.com")).toBe("https://example.com");
    expect(originOf("https://www.example.com/")).toBe("https://www.example.com");
    expect(originOf("not a property")).toBeNull();
  });
});

describe("a client's search pass", () => {
  it("works with the part installed and the property connected; stops otherwise", async () => {
    expect(await clientSearch(pg.db, "kappa")).toEqual({
      kind: "work",
      site: "sc-domain:kappa.example",
      origin: "https://kappa.example",
    });
    expect(await clientSearch(pg.db, "lambda")).toMatchObject({
      kind: "gone",
      why: "no Search Console property connected",
    });
    expect(await clientSearch(pg.db, "mu")).toMatchObject({
      kind: "gone",
      why: "search watch is not installed",
    });
    expect(await clientSearch(pg.db, "nu")).toMatchObject({ kind: "gone", why: "no such client" });
  });

  it("writes the numbers into the client's own database", async () => {
    const asked: string[] = [];
    const fake: SearchConsoleClient = {
      token: async () => "t",
      fetch: async (url) => {
        asked.push(url);
        const body = url.includes("searchAnalytics")
          ? {
              rows: [
                {
                  keys: ["2026-10-05", "kappa widgets", "https://kappa.example/"],
                  clicks: 3,
                  impressions: 40,
                  ctr: 0.075,
                  position: 4.2,
                },
              ],
            }
          : { inspectionResult: { indexStatusResult: { verdict: "PASS" } } };
        return new Response(JSON.stringify(body), { status: 200 });
      },
    };
    const kappa = cachedDb(clientDatabaseUrl(pg.url, "wren_client_kappa"));
    await syncSearch(kappa, {
      console: fake,
      site: "sc-domain:kappa.example",
      urls: ["https://kappa.example/"],
      today: "2026-10-07",
      runId: null,
    });
    expect(asked.every((u) => u.startsWith("https://"))).toBe(true);
    expect(await kappa.select().from(searchDays)).toEqual([
      expect.objectContaining({ query: "kappa widgets", clicks: 3 }),
    ]);
    expect((await kappa.select().from(searchPages)).length).toBe(1);
    // Main holds none of it.
    expect(await pg.db.select().from(searchDays)).toEqual([]);
  });
});
