/**
 * The adLibrary stage on a real Postgres: ads become firms, domain first, page-keyed when an
 * advertiser never links home; every ad is a sighting; a keyword read is not due for a week.
 */
import { companies, sightings } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Ad, adKeywordsDue, adLibraryUnit } from "../../src/enrichment/ad-library.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "sightings", "imports", "import_errors"]));
const db = () => pg.db;

const ad = (id: string, advertiser: string, page: string, url: string | null): Ad => ({
  libraryId: id,
  advertiser,
  page: `https://www.facebook.com/${page}/`,
  url,
  caption: null,
  all: `Library ID: ${id}`,
});
const answering = (ads: Ad[]): SiteClient => ({
  call: async <T>() => ({ ads }) as T,
  via: async () => "browser",
});

describe("adLibraryUnit", () => {
  it("keys a firm by its link domain, else by its page, and keeps every ad", async () => {
    await makeCompany(db(), { key: "known", domain: "acme.example", niche: "other" });
    const ads = [
      ad("1", "Acme Staffing", "AcmeStaffing", "https://lp.acme.example/jobs?utm_source=fb"),
      ad("2", "Acme Staffing", "AcmeStaffing", null),
      ad("3", "Bolt Talent", "BoltTalent", "https://www.leadconnectorhq.com/widget/form/x"),
      ad("4", "Cove Search", "CoveSearch", "https://covesearch.example/"),
    ];
    const u = await adLibraryUnit(db(), answering(ads), { q: "staffing agency", niche: "n" });
    expect(u).toMatchObject({ outcome: "read", ads: 4, created: 2, seen: 2 });

    const firms = await db()
      .select({ domain: companies.domain, key: companies.sourceKey, niche: companies.niche })
      .from(companies)
      .orderBy(companies.id);
    expect(firms.slice(1)).toEqual([
      { domain: null, key: "fb:bolttalent", niche: "n" },
      { domain: "covesearch.example", key: null, niche: "n" },
    ]);
    // A new firm keeps its first ad as `raw`; every ad after that is a sighting.
    const seen = await db().select({ id: sightings.companyId }).from(sightings);
    expect(seen).toHaveLength(2);
    const [acme] = await db().select().from(companies).where(eq(companies.domain, "acme.example"));
    expect(seen.every((x) => x.id === acme?.id)).toBe(true);
    expect(acme?.niche).toBe("other");

    const now = new Date();
    const due = (at: Date) =>
      adKeywordsDue(db(), ["staffing agency", "temp agency"], { now: at, limit: 5 });
    expect(await due(now)).toEqual(["temp agency"]);
    expect(await due(new Date(now.getTime() + 8 * 86_400_000))).toEqual([
      "temp agency",
      "staffing agency",
    ]);
  });
});
