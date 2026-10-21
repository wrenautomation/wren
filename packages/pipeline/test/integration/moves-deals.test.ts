/**
 * A save with `moves` sends open deals to the new node (designs/2026-10-19-business-map.md): in the
 * transaction that carries the journeys, once per deal, never onto a node the journey already has a
 * deal at. Synthetic data only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { graphOf } from "../../src/convert.js";
import { withoutNode } from "../../src/edit.js";
import type { ShapeNode } from "../../src/model.js";
import { journeys, pipelineDeals } from "../../src/schema.js";
import { newestShape, Refused, saveShape } from "../../src/store.js";
import { asMetro, flow, grown, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const offerNode = (id: string): ShapeNode => ({
  id,
  kind: "offer",
  name: id.toUpperCase(),
  offer: "offer-a",
  advance: [],
});
/** The newest body without node `id`, as the metro body a save takes. */
const without = async (id: string) =>
  asMetro(withoutNode(graphOf((await newestShape(pg.db))?.body as never), id));
const body = () =>
  grown(
    ["o1", "o2", "o3", "o4"].map(offerNode),
    ["o1", "o2", "o3", "o4"].map((id) => flow("proposal", id)),
  );

const journeyAt = async (email: string, node: string) => {
  const profile = (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))
    ?.id as number;
  const [j] = await pg.db
    .insert(journeys)
    .values({ profileId: profile, version: 1, node, entry: "yt" })
    .returning();
  if (!j) throw new Error("no journey");
  return j;
};
const dealAt = async (
  j: { id: string; profileId: number },
  node: string,
  status: "open" | "won" = "open",
) => {
  const [d] = await pg.db
    .insert(pipelineDeals)
    .values({
      journey: j.id,
      node,
      profileId: j.profileId,
      offer: "offer-a",
      offerVersion: 1,
      status,
    })
    .returning();
  if (!d) throw new Error("no deal");
  return d;
};
const nodesOf = async (journey: string) =>
  (await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.journey, journey)))
    .map((d) => d.node)
    .sort();

describe("moves and deals", () => {
  it("sends an open deal to the new node, with its journey, and leaves the rest", async () => {
    await saveShape(pg.db, { body: asMetro(body()), note: "v1", by: "t", triggers: TRIGGERS });
    const [a, b, c, d] = [
      await journeyAt("a@example.test", "o1"),
      await journeyAt("b@example.test", "o1"),
      await journeyAt("c@example.test", "o1"),
      await journeyAt("d@example.test", "o3"),
    ] as const;
    const dealA = await dealAt(a, "o1");
    const dealB = await dealAt(b, "o1", "won");
    await dealAt(c, "o1");
    await dealAt(c, "o2");
    await dealAt(d, "o3");

    const v2 = await saveShape(pg.db, {
      body: await without("o1"),
      note: "Merge o1 into o2",
      by: "t",
      triggers: TRIGGERS,
      moves: { o1: "o2" },
    });
    expect(v2.number).toBe(2);

    // The journey and its open deal both sit on o2 now.
    expect(await nodesOf(a.id)).toEqual(["o2"]);
    const [ja] = await pg.db.select().from(journeys).where(eq(journeys.id, a.id));
    expect(ja).toMatchObject({ node: "o2", version: 2 });
    const [moved] = await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.id, dealA.id));
    expect(moved).toMatchObject({ node: "o2", status: "open" });
    // A won deal keeps the node it was made at.
    const [kept] = await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.id, dealB.id));
    expect(kept).toMatchObject({ node: "o1", status: "won" });
    // A journey that already has a deal at o2 keeps its o1 deal: one deal per node.
    expect(await nodesOf(c.id)).toEqual(["o1", "o2"]);
    // A deal at a node no move names does not change.
    expect(await nodesOf(d.id)).toEqual(["o3"]);
  });

  it("changes no deal when the save is refused", async () => {
    const before = await pg.db.select().from(pipelineDeals);
    await expect(
      saveShape(pg.db, {
        body: await without("o2"),
        note: "Bad move",
        by: "t",
        triggers: TRIGGERS,
        moves: { o2: "nowhere" },
      }),
    ).rejects.toThrow(Refused);
    const after = await pg.db.select().from(pipelineDeals);
    expect(after.sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      before.sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  it("moves a deal one step per save, not along a chain", async () => {
    const [e, f] = [
      await journeyAt("e@example.test", "o2"),
      await journeyAt("f@example.test", "o3"),
    ] as const;
    const [dealE, dealF] = [await dealAt(e, "o2"), await dealAt(f, "o3")] as const;
    const v3 = await saveShape(pg.db, {
      body: await without("o2"),
      note: "Merge o2 into o3, o3 into o4",
      by: "t",
      triggers: TRIGGERS,
      moves: { o2: "o3", o3: "o4" },
    });
    expect(v3.number).toBe(3);
    const nodeOf = async (id: string) =>
      (await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.id, id)))[0]?.node;
    expect(await nodeOf(dealE.id)).toBe("o3");
    expect(await nodeOf(dealF.id)).toBe("o4");
  });
});
