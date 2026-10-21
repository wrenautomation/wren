/**
 * The pipeline schema on a real Postgres (designs/2026-10-19-business-map.md): version rows are
 * never edited or deleted, a journey names a shape version and a node that exist, and a person
 * holds one open journey (migration 0307 dropped the old funnel columns). Synthetic data only.
 */
import { profiles } from "@wren/core/profiles-schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { depthOf } from "../../src/model.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
  shapeDrafts,
  shapeVersions,
  termsVersions,
} from "../../src/schema.js";
import { asMetro, shape } from "../fixtures.js";

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

/** The old funnel body, as its history table holds it. */
const old: Record<string, unknown> = {
  name: "Test",
  offer: "offer-a",
  stages: [{ key: "engaged", label: "Engaged", on: [] }],
  entries: [],
};

describe("version rows", () => {
  it("refuse an update and a delete", async () => {
    await pg.db.insert(funnels).values({ id: "test", name: "Test" });
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "test", number: 1, body: old, why: "first", createdBy: "t" });
    await pg.db.insert(shapeVersions).values({
      number: 1,
      body: asMetro(shape()),
      run: shape(),
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
  it("names a shape version that exists, and has a node", async () => {
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
    // The legacy columns are gone.
    expect(Object.keys(row ?? {})).not.toEqual(
      expect.arrayContaining(["funnel", "funnelVersion", "stage"]),
    );
    expect(
      await refusal(pg.db.insert(journeys).values({ ...open(1), node: null as never })),
    ).toMatch(/"node" .*not-null/);
    expect(
      await refusal(pg.db.insert(journeys).values({ ...open(1), version: null as never })),
    ).toMatch(/"version" .*not-null/);
  });

  it("holds one open journey per person", async () => {
    const [b, c] = await pg.db
      .insert(profiles)
      .values([{ name: "Bo" }, { name: "Cy" }])
      .returning();
    if (!b || !c) throw new Error("no profiles");
    const open = (profileId: number) => ({
      profileId,
      version: 1,
      node: "engaged",
      entry: "manual",
    });

    const [first] = await pg.db.insert(journeys).values(open(b.id)).returning();
    if (!first) throw new Error("no journey");
    expect(await refusal(pg.db.insert(journeys).values(open(b.id)))).toMatch(/"uq_journeys_open"/);

    // Another person is fine.
    await pg.db.insert(journeys).values(open(c.id));

    // Once it is closed, the person can open a new one.
    await pg.db.update(journeys).set({ status: "done" }).where(eq(journeys.id, first.id));
    await pg.db.insert(journeys).values(open(b.id));
  });

  it("holds a deal at each offer node, not one deal in all", async () => {
    const [d] = await pg.db
      .insert(profiles)
      .values([{ name: "Di" }])
      .returning();
    if (!d) throw new Error("no profile");
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: d.id, version: 1, node: "engaged", entry: "manual" })
      .returning();
    if (!j) throw new Error("no journey");
    const deal = (node: string) => ({
      journey: j.id,
      node,
      profileId: d.id,
      offer: "offer-a",
      offerVersion: 1,
    });
    await pg.db.insert(pipelineDeals).values(deal("o1"));
    await pg.db.insert(pipelineDeals).values(deal("o2"));
    expect(await refusal(pg.db.insert(pipelineDeals).values(deal("o1")))).toMatch(
      /"uq_deals_journey_node"/,
    );
  });
});

describe("metro only (0315)", () => {
  const SAID = "Convert first: wren shape convert.";
  const row = (body: unknown) => ({
    number: 2,
    body: body as never,
    run: shape(),
    depths: depthOf(shape()),
    note: "second",
    createdBy: "t",
  });
  const draft = (body: unknown) => ({
    id: "d1",
    name: "D1",
    body: body as never,
    base: 1,
    createdBy: "t",
  });

  it("refuses a new version whose body is a graph, or has no model", async () => {
    expect(await refusal(pg.db.insert(shapeVersions).values(row(shape())))).toBe(SAID);
    expect(await refusal(pg.db.insert(shapeVersions).values(row({ model: "graph" })))).toBe(SAID);
    expect(await refusal(pg.db.insert(shapeVersions).values(row({})))).toBe(SAID);
  });

  it("refuses a draft whose body is a graph, on insert and on a new body", async () => {
    expect(await refusal(pg.db.insert(shapeDrafts).values(draft(shape())))).toBe(SAID);
    await pg.db.insert(shapeDrafts).values(draft(asMetro(shape())));
    expect(
      await refusal(
        pg.db
          .update(shapeDrafts)
          .set({ body: shape() as never })
          .where(eq(shapeDrafts.id, "d1")),
      ),
    ).toBe(SAID);
    // A change of state is not a new body: a draft stored before 0315 can still be dropped.
    await pg.db.execute(
      sql`alter table pipeline.shape_drafts disable trigger shape_drafts_metro_only`,
    );
    await pg.db
      .update(shapeDrafts)
      .set({ body: shape() as never })
      .where(eq(shapeDrafts.id, "d1"));
    await pg.db.execute(
      sql`alter table pipeline.shape_drafts enable trigger shape_drafts_metro_only`,
    );
    await pg.db.update(shapeDrafts).set({ state: "dropped" }).where(eq(shapeDrafts.id, "d1"));
  });
});
