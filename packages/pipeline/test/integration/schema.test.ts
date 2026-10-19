/**
 * The pipeline schema on a real Postgres (designs/2026-10-19-business-map.md): version rows are
 * never edited or deleted, a journey names a shape version that exists, and the old funnel
 * columns still hold their one-open-journey index until M3 drops them. Synthetic data only.
 */
import { profiles } from "@wren/core/profiles-schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FunnelBody } from "../../src/migrate.js";
import { depthOf } from "../../src/model.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  shapeVersions,
  termsVersions,
} from "../../src/schema.js";
import { shape } from "../fixtures.js";

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

/** The old body as the legacy column holds it. */
const old = body as unknown as Record<string, unknown>;

describe("version rows", () => {
  it("refuse an update and a delete", async () => {
    await pg.db.insert(funnels).values({ id: "test", name: "Test" });
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "test", number: 1, body: old, why: "first", createdBy: "t" });
    await pg.db.insert(shapeVersions).values({
      number: 1,
      body: shape(),
      depths: depthOf(shape()),
      note: "first",
      createdBy: "t",
    });
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

    for (const [table, column] of [
      ["offer_versions", "why"],
      ["terms_versions", "why"],
      ["funnel_versions", "why"],
      ["shape_versions", "note"],
    ] as const) {
      const said = `pipeline.${table} rows are never edited or deleted; add a new version`;
      expect(
        await refusal(pg.db.execute(sql.raw(`UPDATE pipeline.${table} SET ${column} = 'changed'`))),
      ).toBe(said);
      expect(await refusal(pg.db.execute(sql.raw(`DELETE FROM pipeline.${table}`)))).toBe(said);
    }
  });
});

describe("journeys", () => {
  it("names a shape version that exists, and has no legacy columns", async () => {
    const [a] = await pg.db
      .insert(profiles)
      .values([{ name: "Ada" }])
      .returning();
    if (!a) throw new Error("no profile");
    const open = (version: number) => ({
      profileId: a.id,
      version,
      node: "engaged",
      entry: "yt",
    });
    expect(await refusal(pg.db.insert(journeys).values(open(9)))).toMatch(
      /"fk_journeys_shape_version"/,
    );
    const [row] = await pg.db.insert(journeys).values(open(1)).returning();
    expect(row).toMatchObject({ version: 1, node: "engaged", trail: [], status: "open" });
    // The legacy columns are null for a journey on the shape.
    expect(row).toMatchObject({ funnel: null, funnelVersion: null, stage: null });
  });

  it("keeps the old index: one open journey per person and funnel, for legacy rows", async () => {
    const [b, c] = await pg.db
      .insert(profiles)
      .values([{ name: "Bo" }, { name: "Cy" }])
      .returning();
    if (!b || !c) throw new Error("no profiles");
    await pg.db.insert(funnels).values({ id: "other", name: "Other" });
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "other", number: 1, body: old, why: "first", createdBy: "t" });
    const open = (profileId: number, funnel = "test") => ({
      profileId,
      funnel,
      funnelVersion: 1,
      stage: "engaged",
      entry: "manual",
    });

    const [first] = await pg.db.insert(journeys).values(open(b.id)).returning();
    if (!first) throw new Error("no journey");
    expect(await refusal(pg.db.insert(journeys).values(open(b.id)))).toMatch(/"uq_journeys_open"/);

    // Another person, and the same person in another funnel, are fine.
    await pg.db.insert(journeys).values(open(c.id));
    await pg.db.insert(journeys).values(open(b.id, "other"));

    // Once it is closed, the person can open a new one.
    await pg.db.update(journeys).set({ status: "done" }).where(eq(journeys.id, first.id));
    await pg.db.insert(journeys).values(open(b.id));
  });
});
