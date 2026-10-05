/**
 * The exaSearch stage on a real Postgres: a search's results become firms (own site first, else the
 * page Exa listed), every result is kept whole, a known firm gets a sighting, and a search is not
 * due again for 30 days. Synthetic data only.
 */
import { companies, sightings } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EXA_SEARCH_BUCKET,
  type ExaFirm,
  exaSearchesDue,
  exaSearchRoom,
  exaSearchUnit,
} from "../../src/enrichment/exa-search.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "sightings", "imports", "import_errors"]));
const db = () => pg.db;

const result = (url: string, title: string | null): ExaFirm => ({
  url,
  title,
  domain: new URL(url).hostname.replace(/^www\./, ""),
  raw: { id: url, url, title, score: 0.5 },
});
const answering = (results: ExaFirm[]): SiteClient => ({
  call: async <T>() => ({ results, via: "exa", meta: {} }) as T,
  via: async () => "api",
});

describe("exaSearchUnit", () => {
  it("keys a firm by its own site, else by its page, and keeps every result whole", async () => {
    await makeCompany(db(), { key: "known", domain: "acme.example", niche: "other" });
    const results = [
      result("https://www.acme.example/about", "Acme Staffing"),
      result("https://locations.acme.example/austin", "Acme Staffing Austin"),
      result("https://www.linkedin.com/company/bolt-talent", "Bolt Talent"),
      result("https://covesearch.example/", "Cove Search"),
    ];
    const u = await exaSearchUnit(db(), answering(results), {
      q: "staffing agency in Austin, TX",
      niche: "n",
    });
    expect(u).toMatchObject({ outcome: "read", results: 4, created: 2, seen: 2 });

    const firms = await db()
      .select({ domain: companies.domain, key: companies.sourceKey, niche: companies.niche })
      .from(companies)
      .orderBy(companies.id);
    expect(firms.slice(1)).toEqual([
      { domain: null, key: "li:bolt-talent", niche: "n" },
      { domain: "covesearch.example", key: null, niche: "n" },
    ]);
    // A known firm keeps its niche; each further result for it is a sighting.
    const seen = await db().select({ id: sightings.companyId }).from(sightings);
    expect(seen).toHaveLength(2);
    const [acme] = await db().select().from(companies).where(eq(companies.domain, "acme.example"));
    expect(seen.every((x) => x.id === acme?.id)).toBe(true);
    expect(acme?.niche).toBe("other");
    // A new firm keeps its result whole, with the search that found it.
    const [cove] = await db()
      .select()
      .from(companies)
      .where(eq(companies.domain, "covesearch.example"));
    expect(JSON.stringify(cove?.raw)).toContain("covesearch.example");
    expect(JSON.stringify(cove?.raw)).toContain("staffing agency in Austin, TX");
  });

  it("an empty answer is still a read: the search is not due again", async () => {
    const q = "recruiting firm in Denver, CO";
    const u = await exaSearchUnit(db(), answering([]), { q, niche: "n" });
    expect(u).toMatchObject({ outcome: "read", results: 0, created: 0 });
    const now = new Date();
    const due = (at: Date) => exaSearchesDue(db(), [q, "other search"], { now: at, limit: 5 });
    expect(await due(now)).toEqual(["other search"]);
    expect(await due(new Date(now.getTime() + 29 * 86_400_000))).toEqual(["other search"]);
    expect(await due(new Date(now.getTime() + 31 * 86_400_000))).toEqual(["other search", q]);
  });
});

describe("exaSearchRoom", () => {
  it("lets a burst through, then one an interval", async () => {
    const now = new Date();
    expect((await exaSearchRoom(db(), now)).room).toBe(EXA_SEARCH_BUCKET.burst);
    for (let i = 0; i < EXA_SEARCH_BUCKET.burst; i++)
      await exaSearchUnit(db(), answering([]), { q: `search ${i}`, niche: "n" });
    const after = await exaSearchRoom(db(), new Date());
    expect(after.room).toBe(0);
    expect(after.nextInMs).toBeGreaterThan(0);
    expect(after.nextInMs).toBeLessThanOrEqual(86_400_000 / EXA_SEARCH_BUCKET.perDay);
  });
});
