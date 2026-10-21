/**
 * `convertShape` end to end, on a real Postgres (designs/2026-10-20-design-language.md, area C1):
 * a graph shape with journeys, a deal and events becomes a metro version, and every number the
 * SQL views and readers give is the same as before. The graph rows are seeded with the metro-only
 * trigger off (`seedGraph`), as a database from before the guard holds them. The store refuses a
 * graph body (`CONVERT_FIRST`), and a second convert. The walks use the real store and steps, no Restate.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { resolveProfile } from "@wren/core/profiles";
import { journeyShape } from "@wren/core/segments";
import { type Fired, pgSpineStore, type Walk, walk } from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import type { Terms } from "@wren/offers";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertShape } from "../../src/convert-shape.js";
import { shapeWorkflowsOf } from "../../src/journeys.js";
import { isMetro } from "../../src/metro.js";
import type { ShapeNode } from "../../src/model.js";
import { type Emit, moveEmit, openEmit, signDeal } from "../../src/moves.js";
import {
  edgeFlowOf,
  type NumberRow,
  nodeCountsOf,
  numberRows,
  sourceNumbersOf,
} from "../../src/numbers.js";
import { journeys, offerVersions, pipelineDeals } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { addTerms, CONVERT_FIRST, Refused, saveShape, shapeVersionsOf } from "../../src/store.js";
import { undoShape } from "../../src/undo.js";
import { seedGraph, shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(offerVersions).values({
    offer: "offer-a",
    number: 1,
    hash: "3".repeat(64),
    body: {} as never,
    why: "t",
    createdBy: "t",
  });
  await addTerms(pg.db, {
    offer: "offer-a",
    plan: "standard",
    from: "2020-01-01",
    body: terms(),
    why: "t",
    by: "t",
  });
});
afterAll(() => pg.stop());

const terms = (): Terms => ({
  currency: "USD",
  setupCents: 100_000,
  monthlyCents: 10_000,
  perUnitCents: null,
  unit: null,
  capCents: null,
  days: 90,
  payDays: 7,
});

const OP = "op@example.test";

const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

/** What `Spine/emit` does with an Emit: walk it from its node, as its own invocation. */
async function play(e: Emit) {
  const fired: Fired[] = [];
  const flows: Workflow[] = await shapeWorkflowsOf(pg.db, "wren");
  const w: Walk = {
    flows: new Map(flows.map((f) => [f.id, f])),
    parts: new Map(),
    steps: journeySteps({ db: () => pg.db }),
    store: pgSpineStore(pg.db),
    client: null,
    by: randomUUID(),
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: (req) => fired.push(req),
  };
  await walk(w, e.workflow, e.from, e.events);
  return fired;
}

/** A person with a journey open at the first opening node, then moved along `to`. */
async function start(email: string, o: { entry?: string; to?: string[] } = {}): Promise<string> {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name: "Ada" });
  if (!r) throw new Error("no profile");
  await play(
    await openEmit(pg.db, { person: email, by: OP, ...(o.entry ? { entry: o.entry } : {}) }),
  );
  const [j] = await pg.db
    .select()
    .from(journeys)
    .where(eq(journeys.profileId, r.id))
    .orderBy(asc(journeys.openedAt));
  const id = j?.id as string;
  for (const to of o.to ?? []) await play(await moveEmit(pg.db, { journey: id, to, by: OP }));
  return id;
}

const rowsOf = async (query: ReturnType<typeof sql>) =>
  (await pg.db.execute(query)) as unknown as Record<string, unknown>[];

/** Everything the SQL readers say about the shape, without the shape version's own number. */
async function readers() {
  return {
    edgeFlow: await edgeFlowOf(pg.db),
    sources: await sourceNumbersOf(pg.db),
    nodes: await nodeCountsOf(pg.db),
    stageFlow: await rowsOf(sql`select * from pipeline.stage_flow order by 1, 2, 3`),
    entryNumbers: await rowsOf(sql`select * from pipeline.entry_numbers order by 1, 2, 3`),
    shape: await journeyShape(pg.db),
  };
}

describe("convertShape on a graph with journeys, a deal and events", () => {
  it("saves the metro version and every number stays the same", async () => {
    const v1 = await seedGraph(pg.db, shape());
    expect(isMetro(v1.body)).toBe(false);
    expect(v1.run).toEqual(v1.body);

    await start("a@example.test", { to: ["booked", "proposal"] });
    await start("b@example.test", { entry: "mail" });
    const signed = await start("c@example.test", { to: ["signed"] });
    const [deal] = await pg.db
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.journey, signed));
    await signDeal(pg.db, { deal: deal?.id as string, plan: "standard" });

    const before = await readers();
    const rowsBefore = await numberRows(pg.db);
    expect(before.edgeFlow.length).toBeGreaterThan(0);
    expect(before.sources.length).toBeGreaterThan(0);
    expect(before.shape.nodes.length).toBeGreaterThan(0);

    const { version, report } = await convertShape(pg.db, {
      note: "Move the shape to the metro model.",
      by: "t",
      triggers: TRIGGERS,
    });
    expect(version).toMatchObject({ number: 2, parent: 1 });
    expect(isMetro(version.body)).toBe(true);
    expect(report).toMatchObject({ notes: [], checks: [], graphEqual: true, workflowEqual: true });

    // The run column and the depths are the graph's, so no reader works the metro body out.
    expect(version.run).toEqual(v1.body);
    expect(version.depths).toEqual(v1.depths);

    // Open journeys carry to the new version where they are.
    const open = await pg.db.select().from(journeys).where(eq(journeys.status, "open"));
    expect(open.map((j) => [j.version, j.node]).sort()).toEqual([
      [2, "engaged"],
      [2, "proposal"],
      [2, "signed"],
    ]);

    // The views and readers: same rows, from the same events.
    const after = await readers();
    expect(after.edgeFlow).toEqual(before.edgeFlow);
    expect(after.sources).toEqual(before.sources);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.stageFlow).toEqual(before.stageFlow);
    expect(after.entryNumbers).toEqual(before.entryNumbers);
    expect(after.shape).toEqual(before.shape);

    // numberRows: a metro newest reads per line, station and track, with the same numbers.
    const rowsAfter = await numberRows(pg.db);
    const graph = new Map(rowsBefore.map((r) => [`${r.kind}:${r.label}`, r]));
    const same = (a: NumberRow, b: NumberRow | undefined) => {
      expect(b, a.id).toBeDefined();
      for (const k of ["arrived", "skipped", "left", "now", "crossings", "opened", "cost"] as const)
        expect(a[k], `${a.id} ${k}`).toEqual(b?.[k]);
    };
    const stations = rowsAfter.filter((r) => r.kind === "station");
    const lines = rowsAfter.filter((r) => r.kind === "line" && r.label !== "signed");
    const tracks = rowsAfter.filter(
      (r) => r.kind === "track" && r.from !== "hub" && r.to !== "hub",
    );
    // Every graph node is a station: the out lines' own stations too.
    expect(stations.map((r) => r.label).sort()).toEqual(
      shape()
        .nodes.map((n) => n.id)
        .sort(),
    );
    expect(lines.map((r) => r.label).sort()).toEqual(["mail", "yt"]);
    for (const r of stations) same(r, graph.get(`node:${r.label}`));
    for (const r of lines) same(r, graph.get(`node:${r.label}`));
    for (const r of tracks) same(r, graph.get(`edge:${r.label}`));
    // The hub's tracks add up the source edges they stand for.
    const crossed = (id: string) => graph.get(`edge:${id}`)?.crossings ?? 0;
    const track = (id: string) => rowsAfter.find((r) => r.id === `track:${id}`);
    expect(track("yt_to_hub")?.crossings).toBe(crossed("yt_to_engaged"));
    expect(track("mail_to_hub")?.crossings).toBe(crossed("mail_to_engaged"));
    expect(track("hub_to_engaged")?.crossings).toBe(
      crossed("yt_to_engaged") + crossed("mail_to_engaged"),
    );
    expect(crossed("yt_to_engaged") + crossed("mail_to_engaged")).toBeGreaterThan(0);
    expect(tracks.length).toBeGreaterThan(0);
    expect(rowsAfter.some((r) => r.kind === "node" || r.kind === "edge")).toBe(false);

    // The offer line is one row for the one currency, with the offer's numbers.
    const offerBefore = rowsBefore.find((r) => r.kind === "offer");
    const offerLines = rowsAfter.filter((r) => r.id.startsWith("line:signed"));
    expect(offerLines.map((r) => r.id)).toEqual(["line:signed:USD"]);
    expect(offerLines[0]).toMatchObject({
      currency: "USD",
      deals: offerBefore?.deals,
      collected: offerBefore?.collected,
      scheduled: offerBefore?.scheduled,
    });
    expect(offerLines[0]?.deals).toBe(1);
  });

  it("counts a move after the convert on the new version, by the same edge ids", async () => {
    const [b] = await pg.db.select().from(journeys).where(eq(journeys.node, "engaged"));
    await play(await moveEmit(pg.db, { journey: b?.id as string, to: "booked", by: OP }));
    const flow = (await edgeFlowOf(pg.db)).filter((f) => f.edge === "engaged_to_booked");
    expect(flow.map((f) => f.version).sort()).toContain(2);
    expect(flow.filter((f) => f.version === 2).reduce((n, f) => n + (f.crossings ?? 0), 0)).toBe(1);
  });

  it("refuses a graph body, and a second convert", async () => {
    expect(
      await reasons(saveShape(pg.db, { body: shape(), note: "back", by: "t", triggers: TRIGGERS })),
    ).toEqual([CONVERT_FIRST]);
    expect(
      await reasons(convertShape(pg.db, { note: "again", by: "t", triggers: TRIGGERS })),
    ).toEqual(["The shape is on the metro model already."]);
    expect((await shapeVersionsOf(pg.db)).map((v) => v.number)).toEqual([1, 2]);
  });
});

describe("convertShape on a graph with a stray field", () => {
  it("saves the metro version, notes the field and leaves the run as the graph without it", async () => {
    const own = await startTestPostgres();
    try {
      const g = shape();
      // A made-up field on a plan node, as old data can carry.
      const odd = {
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === "standard" ? ({ ...n, zzNote: null } as unknown as ShapeNode) : n,
        ),
      };
      const v1 = await seedGraph(own.db, odd);
      expect(JSON.stringify(v1.body)).toContain("zzNote");

      const { version, report } = await convertShape(own.db, {
        note: "Move the shape to the metro model.",
        by: "t",
        triggers: TRIGGERS,
      });
      expect(version).toMatchObject({ number: 2, parent: 1 });
      expect(isMetro(version.body)).toBe(true);
      expect(report).toMatchObject({
        notes: ['Node standard: field "zzNote" is not part of the model and is dropped.'],
        checks: [],
        graphEqual: true,
        workflowEqual: true,
      });
      expect(version.run).toEqual(g);
      expect((await shapeVersionsOf(own.db)).map((v) => v.number)).toEqual([1, 2]);
    } finally {
      await own.stop();
    }
  });
});

describe("convertShape refuses", () => {
  it("when there is no shape yet", async () => {
    const own = await startTestPostgres();
    try {
      const why = await reasons(convertShape(own.db, { note: "x", by: "t", triggers: TRIGGERS }));
      expect(why).toEqual(["The workspace has no shape yet."]);
    } finally {
      await own.stop();
    }
  });

  it("when a proof misses, and saves nothing", async () => {
    const own = await startTestPostgres();
    try {
      // The same parts as the fixture, listed in another order than the metro model gives back.
      const g = shape();
      const swapped = { ...g, edges: [...g.edges].reverse() };
      await seedGraph(own.db, swapped);
      const why = await reasons(convertShape(own.db, { note: "x", by: "t", triggers: TRIGGERS }));
      expect(why).toContain("The metro body does not give the same graph back.");
      expect(why.join(" ")).toMatch(/another order/);
      expect((await shapeVersionsOf(own.db)).map((v) => v.number)).toEqual([1]);

      // A trigger the workspace no longer knows is a check the metro body fails.
      const missing = await reasons(
        convertShape(own.db, { note: "x", by: "t", triggers: new Set(["trigger.reply"]) }),
      );
      expect(missing[0]).toMatch(/^The metro body fails a check: /);
      expect((await shapeVersionsOf(own.db)).map((v) => v.number)).toEqual([1]);
    } finally {
      await own.stop();
    }
  });

  it("refuses a graph undo: the undo is a graph body, and a graph body is refused", async () => {
    const own = await startTestPostgres();
    try {
      const g = shape();
      const v1 = await seedGraph(own.db, g);
      const renamed = {
        ...g,
        nodes: g.nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n)),
      };
      const v2 = await seedGraph(own.db, renamed, "rename");
      const undo = (change: string) =>
        reasons(
          undoShape(own.db, {
            a: v1.number,
            b: v2.number,
            change,
            by: "t",
            triggers: TRIGGERS,
          }),
        );
      expect(await undo("node:booked:renamed")).toEqual([CONVERT_FIRST]);
      // A metro key on a graph newest version is refused as before.
      expect(await undo("station:booked:renamed")).toEqual([
        "The shape is on the graph model. Undo by node or edge.",
      ]);
      expect((await shapeVersionsOf(own.db)).map((v) => v.number)).toEqual([1, 2]);
    } finally {
      await own.stop();
    }
  });
});
