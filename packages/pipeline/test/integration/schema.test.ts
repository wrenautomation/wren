/**
 * The pipeline schema on a real Postgres (designs/2026-10-18-journeys.md): version rows are never
 * edited or deleted, and one person holds one open journey per funnel. Synthetic data only.
 */
import { profiles } from "@wren/core/profiles-schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FunnelBody } from "../../src/model.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  termsVersions,
} from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

/** The database's own words for a statement it refused (drizzle wraps them). */
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "accepted",
    (e: Error) => (e.cause instanceof Error ? e.cause.message : e.message),
  );

const body: FunnelBody = {
  name: "Test",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [] },
    { key: "signed", label: "Signed", sale: true, on: [] },
  ],
  entries: [],
};

describe("version rows", () => {
  it("refuse an update and a delete", async () => {
    await pg.db.insert(funnels).values({ id: "test", name: "Test" });
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "test", number: 1, body, why: "first", createdBy: "t" });
    await pg.db.insert(termsVersions).values({
      offer: "offer-a",
      plan: "standard",
      number: 1,
      effectiveFrom: "2027-01-01",
      body: {
        currency: "USD",
        setupCents: 100,
        monthlyCents: null,
        perUnitCents: null,
        unit: null,
        capCents: null,
        days: null,
        payDays: 7,
      },
      why: "first",
      createdBy: "t",
    });
    await pg.db.insert(offerVersions).values({
      offer: "offer-a",
      number: 1,
      hash: "0".repeat(64),
      body: {} as never,
      why: "first",
      createdBy: "t",
    });

    for (const table of ["offer_versions", "terms_versions", "funnel_versions"]) {
      expect(
        await refusal(pg.db.execute(sql.raw(`UPDATE pipeline.${table} SET why = 'changed'`))),
      ).toBe(`pipeline.${table} rows are never edited or deleted; add a new version`);
      expect(await refusal(pg.db.execute(sql.raw(`DELETE FROM pipeline.${table}`)))).toBe(
        `pipeline.${table} rows are never edited or deleted; add a new version`,
      );
    }
  });
});

describe("journeys", () => {
  it("allows one open journey per person and funnel", async () => {
    const [a, b] = await pg.db
      .insert(profiles)
      .values([{ name: "Ada" }, { name: "Bo" }])
      .returning();
    if (!a || !b) throw new Error("no profiles");
    await pg.db.insert(funnels).values({ id: "other", name: "Other" });
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "other", number: 1, body, why: "first", createdBy: "t" });
    const open = (profileId: number, funnel = "test") => ({
      profileId,
      funnel,
      version: 1,
      stage: "engaged",
      entry: "manual",
    });

    const [first] = await pg.db.insert(journeys).values(open(a.id)).returning();
    if (!first) throw new Error("no journey");
    expect(await refusal(pg.db.insert(journeys).values(open(a.id)))).toMatch(/"uq_journeys_open"/);

    // Another person, and the same person in another funnel, are fine.
    await pg.db.insert(journeys).values(open(b.id));
    await pg.db.insert(journeys).values(open(a.id, "other"));

    // Once it is closed, the person can open a new one.
    await pg.db.update(journeys).set({ status: "done" }).where(eq(journeys.id, first.id));
    await pg.db.insert(journeys).values(open(a.id));
  });
});
