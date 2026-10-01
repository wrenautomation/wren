/** The screen over stored firms: declines by reason, fills blank countries, lifts what a rule no longer flags. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CompanyScreen, runScreen } from "../../src/ingest/screen.js";
import { companies } from "../../src/schema.js";

let pg: TestPostgres;
const db = () => pg.db;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies"]));

const screen: CompanyScreen = { countries: ["US", "CA"], chainAt: 2 };

const seed = () =>
  db()
    .insert(companies)
    .values([
      {
        domain: "solo.example",
        name: "Solo Staffing",
        niche: "recruiting",
        raw: { country: "US" },
      },
      { domain: "east.big.example", name: "Big East", niche: "recruiting", country: "US" },
      { domain: "west.big.example", name: "Big West", niche: "recruiting", country: "US" },
      { domain: "acme.co.uk", name: "Acme", niche: "recruiting", country: "US" },
      { sourceKey: "sba:1", name: "Department of Labor", niche: "recruiting", country: "US" },
      { domain: "other.example", name: "County of Elsewhere", niche: "agencies" },
    ]);

const verdicts = async () =>
  (
    await db()
      .select({ name: companies.name, country: companies.country, reason: companies.declineReason })
      .from(companies)
      .orderBy(asc(companies.id))
  ).map((r) => [r.name, r.country, r.reason]);

describe("runScreen", () => {
  it("declines by reason within the niche, fills a blank country, and leaves other niches alone", async () => {
    await seed();
    const stats = await runScreen(db(), "recruiting", screen);
    expect(stats).toEqual({
      companies: 5,
      country_filled: 1,
      declined: { chain: 2, foreign: 1, public_body: 1 },
      changed: 4,
    });
    expect(await verdicts()).toEqual([
      ["Solo Staffing", "US", null],
      ["Big East", "US", "chain"],
      ["Big West", "US", "chain"],
      ["Acme", "US", "foreign"],
      ["Department of Labor", "US", "public_body"],
      ["County of Elsewhere", null, null],
    ]);
  });

  it("a dry run writes nothing; a loosened rule lifts its declines", async () => {
    await seed();
    const dry = await runScreen(db(), "recruiting", screen, { dryRun: true });
    expect(dry.changed).toBe(4);
    expect((await verdicts()).every(([, , reason]) => reason === null)).toBe(true);
    await runScreen(db(), "recruiting", screen);
    const loose = await runScreen(db(), "recruiting", { ...screen, chainAt: 5 });
    expect(loose.changed).toBe(2);
    expect((await verdicts())[1]).toEqual(["Big East", "US", null]);
  });
});
