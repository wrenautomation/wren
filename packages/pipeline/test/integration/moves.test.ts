/**
 * Hand moves, the numbers views and the pipeline records, on a real Postgres
 * (designs/2026-10-19-business-map.md): a move is the event `Journeys` sends, walked here on the
 * real store and steps, no Restate. One shape per database, so the tests run in order and later
 * ones build on the journeys of earlier ones. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { resolveProfile } from "@wren/core/profiles";
import { serveRecords } from "@wren/core/records/serve";
import { type Fired, pgSpineStore, type Walk, walk } from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import type { Terms } from "@wren/offers";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropJourney, shapeWorkflowsOf } from "../../src/journeys.js";
import type { ShapeBody, ShapeNode } from "../../src/model.js";
import {
  type Emit,
  moveEmit,
  openEmit,
  personByKey,
  rebuildJourney,
  signDeal,
} from "../../src/moves.js";
import {
  dealScheduleOf,
  edgeFlowOf,
  type NumberRow,
  nodeCountsOf,
  numberRows,
  planNumbersOf,
} from "../../src/numbers.js";
import {
  dealRows,
  entryRows,
  journeyRows,
  offerRows,
  PIPELINE_RECORDS,
  readTerms,
  trailOf,
} from "../../src/records.js";
import { journeys, offerVersions, pipelineDeals } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { addTerms, newestShape, Refused, saveShape } from "../../src/store.js";
import { flow, grown, loop, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(offerVersions).values({
    offer: "offer-a",
    number: 1,
    hash: "2".repeat(64),
    body: {} as never,
    why: "t",
    createdBy: "t",
  });
  for (const [plan, setup] of [
    ["standard", 100_000],
    ["flat", 50_000],
  ] as const)
    await addTerms(pg.db, {
      offer: "offer-a",
      plan,
      from: "2020-01-01",
      body: terms(setup),
      why: "t",
      by: "t",
    });
});
afterAll(() => pg.stop());

const terms = (setupCents: number): Terms => ({
  currency: "USD",
  setupCents,
  monthlyCents: 10_000,
  perUnitCents: null,
  unit: null,
  capCents: null,
  days: 90,
  payDays: 7,
});

/**
 * The shape the tests use: the fixture path, plus an ads source, a parked source, a branch
 * `nurture` nothing else reaches, and idle limits on two steps.
 */
const body = (): ShapeBody => {
  const base = grown(
    [
      { id: "ads1", kind: "source", name: "Ads", via: "ads", campaign: "cmp-1" },
      { id: "old", kind: "source", name: "Old", via: "manual", parked: true },
      { id: "nurture", kind: "step", name: "Nurture", action: "email", advance: [] },
    ],
    [flow("ads1", "engaged"), flow("old", "engaged"), flow("engaged", "nurture")],
  );
  const idle: Record<string, number> = { engaged: 3, booked: 30 };
  return {
    ...base,
    nodes: base.nodes.map((n) => (idle[n.id] ? ({ ...n, idleDays: idle[n.id] } as ShapeNode) : n)),
  };
};

const save = (b: ShapeBody, note: string) =>
  saveShape(pg.db, { body: b, note, by: "t", triggers: TRIGGERS });

async function person(email: string, name = "Ada") {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name });
  if (!r) throw new Error("no profile");
  return r.id;
}

const OP = "op@example.test";
const MISSING = randomUUID();

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

const open = (email: string, more: { at?: string; entry?: string } = {}) =>
  openEmit(pg.db, { person: email, by: OP, ...more });
const move = (id: string, to: string, reason?: string) =>
  moveEmit(pg.db, { journey: id, to, by: OP, ...(reason ? { reason } : {}) });
/** The person's newest journey. */
const journeyOf = async (profile: number) => {
  const rows = await pg.db
    .select()
    .from(journeys)
    .where(eq(journeys.profileId, profile))
    .orderBy(asc(journeys.openedAt));
  return rows.at(-1);
};
const row = async (id: string) => {
  const [j] = await pg.db.select().from(journeys).where(eq(journeys.id, id));
  return j;
};
/** A person with a journey open at the first opening node, then moved along `to`. */
async function start(
  email: string,
  o: { name?: string; entry?: string; to?: string[] } = {},
): Promise<{ profile: number; id: string }> {
  const profile = await person(email, o.name);
  await play(await open(email, o.entry ? { entry: o.entry } : {}));
  const id = (await journeyOf(profile))?.id as string;
  for (const to of o.to ?? []) await play(await move(id, to));
  return { profile, id };
}
const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

let walkProfile = 0;

describe("open", () => {
  it("refuses while there is no shape yet", async () => {
    await person("early@example.test");
    expect(await reasons(open("early@example.test"))).toEqual(["No shape yet."]);
    await save(body(), "first");
  });

  it("leaves no owner when the opener is not an address (an agent, a shell name)", async () => {
    const profile = await person("agent-open@example.test");
    await play(await openEmit(pg.db, { person: "agent-open@example.test", by: "agent:claude" }));
    expect(await journeyOf(profile)).toMatchObject({ status: "open", owner: null });
  });

  it("refuses a node no source feeds, a source that feeds nothing there, an unknown person", async () => {
    await person("open@example.test");
    expect((await reasons(open("open@example.test", { at: "booked" })))[0]).toMatch(
      /booked is no opening node. Opening nodes: engaged/,
    );
    expect(await reasons(open("open@example.test", { entry: "zzz" }))).toEqual([
      "No live source zzz feeds engaged.",
    ]);
    // A parked source opens nothing.
    expect(await reasons(open("open@example.test", { entry: "old" }))).toEqual([
      "No live source old feeds engaged.",
    ]);
    expect(await reasons(open("ghost@example.test"))).toEqual(["No person ghost@example.test."]);
  });

  it("finds a person by profile id, email or kind:value", async () => {
    const id = await person("key@example.test");
    expect(await personByKey(pg.db, String(id))).toBe(id);
    expect(await personByKey(pg.db, "KEY@example.test")).toBe(id);
    expect(await personByKey(pg.db, "nobody@example.test")).toBeNull();
    expect(await personByKey(pg.db, "")).toBeNull();
  });

  it("opens through the shape's own step, with the operator as the cause", async () => {
    walkProfile = await person("walk@example.test");
    const fired = await play(await open("walk@example.test", { entry: "ads1" }));
    const j = await journeyOf(walkProfile);
    expect(j).toMatchObject({ node: "engaged", status: "open", entry: "ads1", version: 1 });
    expect(j?.entryRef).toMatchObject({ cause: { kind: "manual", ref: OP } });
    // The opener owns it.
    expect(j?.owner).toBe(OP);
    expect(j?.trail).toMatchObject([{ edge: "ads1_to_engaged", from: "ads1", to: "engaged" }]);
    expect(fired.map((f) => f.facts)).toEqual([
      { trigger: "trigger.journey", node: "engaged", change: "entered" },
    ]);
    // A second open is refused while one is open.
    expect((await reasons(open("walk@example.test")))[0]).toMatch(/Already open at engaged/);
  });
});

describe("move and drop", () => {
  it("moves along edges, tells skips, refuses a revisit; the offer node makes the deal", async () => {
    const { profile, id } = await start("fwd@example.test");

    expect(await reasons(move(id, "nope"))).toEqual([
      expect.stringMatching(/No node nope. Nodes: engaged, booked, proposal, signed, standard/),
    ]);
    // A source holds nobody.
    expect(await reasons(move(id, "ads1"))).toEqual([expect.stringMatching(/No node ads1/)]);
    expect(await reasons(move(id, "engaged"))).toEqual(["It is already at Engaged."]);
    expect(await reasons(moveEmit(pg.db, { journey: "not-an-id", to: "booked", by: OP }))).toEqual([
      "No journey not-an-id.",
    ]);
    expect(await reasons(moveEmit(pg.db, { journey: MISSING, to: "booked", by: OP }))).toEqual([
      `No journey ${MISSING}.`,
    ]);

    await play(await move(id, "booked"));
    expect((await journeyOf(profile))?.node).toBe("booked");
    // Back to a node on the trail: refused, with no loop edge to cross.
    expect(await reasons(move(id, "engaged"))).toEqual([
      expect.stringMatching(
        /Engaged is already on this journey's trail.*drop it and open a new one/,
      ),
    ]);

    const fired = await play(await move(id, "signed"));
    expect(fired.map((f) => (f.facts as unknown as { node: string }).node)).toEqual([
      "signed",
      "proposal",
    ]);
    expect(await journeyOf(profile)).toMatchObject({ node: "signed", status: "open" });
    expect(
      await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.journey, id)),
    ).toHaveLength(1);

    await play(await move(id, "standard"));
    expect(await journeyOf(profile)).toMatchObject({ node: "standard", status: "done" });
    expect(await reasons(move(id, "nurture"))).toEqual(["Journey is done."]);

    const trail = await trailOf(pg.db, id);
    expect(trail.map((t) => [t.node, t.cause, t.ref])).toEqual([
      ["s_engaged", "manual", OP],
      ["s_booked", "manual", OP],
      ["s_signed", "manual", OP],
      ["s_standard", "manual", OP],
    ]);
    const [r] = await journeyRows(pg.db, { id });
    expect(r).toMatchObject({
      name: "Ada",
      node: "standard",
      node_name: "Standard",
      status: "done",
      owner: OP,
      trail: "Engaged > Booked > Proposal > Signed > Standard",
    });
    // The person's addresses ride along, so Today can group a move under this journey.
    expect(r).toMatchObject({ profile, email: "fwd@example.test" });
  });

  it("forces a move with no path only when a reason is given", async () => {
    const { profile, id } = await start("force@example.test", { to: ["booked"] });
    expect(await reasons(move(id, "nurture"))).toEqual([
      "No path from booked to nurture. Give a reason to force the move.",
    ]);
    await play(await move(id, "nurture", "asked to be nurtured"));
    const j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "nurture", status: "done" });
    expect(j?.trail.at(-1)).toMatchObject({ edge: null, from: "booked", to: "nurture" });
    // Rebuild reads the same row back from the events.
    expect((await rebuildJourney(pg.db, id)).changed).toBe(false);
  });

  it("drops, and rebuild puts a damaged row right from its events", async () => {
    const { profile, id } = await start("drop@example.test", { name: "Bo" });
    const drop = await dropJourney(pg.db, { journey: id, reason: "no fit", by: OP });
    expect(drop).not.toBeNull();
    await play(drop as Emit);
    expect(await journeyOf(profile)).toMatchObject({ status: "dropped", dropReason: "no fit" });
    expect(await dropJourney(pg.db, { journey: id, reason: "again" })).toBeNull();
    expect(await reasons(move(id, "booked"))).toEqual(["Journey is dropped."]);

    // Damage the row; the events still say dropped at engaged.
    await pg.db
      .update(journeys)
      .set({ status: "open", dropReason: null, closedAt: null, node: "booked" })
      .where(eq(journeys.id, id));
    const r = await rebuildJourney(pg.db, id);
    expect(r.changed).toBe(true);
    expect(r.after).toMatchObject({ node: "engaged", status: "dropped", dropReason: "no fit" });
    expect(await journeyOf(profile)).toMatchObject({
      node: "engaged",
      status: "dropped",
      dropReason: "no fit",
    });
    expect((await rebuildJourney(pg.db, id)).changed).toBe(false);
    expect(await reasons(rebuildJourney(pg.db, MISSING))).toEqual([`No journey ${MISSING}.`]);
  });

  it("rebuild marks a node with no way on done", async () => {
    const { profile, id } = await start("done@example.test");
    await play(await move(id, "standard"));
    await pg.db
      .update(journeys)
      .set({ status: "open", closedAt: null, node: "engaged" })
      .where(eq(journeys.id, id));
    const r = await rebuildJourney(pg.db, id);
    expect(r.after).toMatchObject({ node: "standard", status: "done" });
    expect((await journeyOf(profile))?.trail.map((c) => c.to)).toEqual([
      "engaged",
      "booked",
      "proposal",
      "signed",
      "standard",
    ]);
  });
});

describe("sign", () => {
  it("sets terms once, a repeat is no change, a change needs force", async () => {
    const { id } = await start("sign@example.test", { to: ["signed"] });
    const [deal] = await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.journey, id));
    const d = deal?.id as string;
    const shape = (await newestShape(pg.db))?.body as ShapeBody;
    const standard = async () =>
      (await planNumbersOf(pg.db, shape)).find((p) => p.node === "standard");
    const before = await standard();

    expect((await dealScheduleOf(pg.db, d))?.signed).toBe(false);
    expect(await dealScheduleOf(pg.db, MISSING)).toBeNull();
    expect(await reasons(signDeal(pg.db, { deal: d, plan: "none" }))).toEqual([
      "No live none terms for offer-a.",
    ]);
    const first = await signDeal(pg.db, { deal: d, plan: "standard" });
    expect(first.changed).toBe(true);
    // The plan node `standard` counts the deal, with its scheduled lines.
    const after = await standard();
    expect((after?.deals ?? 0) - (before?.deals ?? 0)).toBe(1);
    expect((after?.scheduledCents ?? 0) - (before?.scheduledCents ?? 0)).toBeGreaterThan(100_000);
    expect(after?.currency).toBe("USD");

    expect((await signDeal(pg.db, { deal: d, plan: "standard" })).changed).toBe(false);
    expect((await reasons(signDeal(pg.db, { deal: d, plan: "flat" })))[0]).toMatch(/set once/);
    const forced = await signDeal(pg.db, { deal: d, plan: "flat", force: true });
    expect(forced).toMatchObject({ changed: true });
    expect(forced.termsVersion).not.toBe(first.termsVersion);
    expect(await reasons(signDeal(pg.db, { deal: MISSING, plan: "flat" }))).toEqual([
      `No deal ${MISSING}.`,
    ]);
    // The deal now sits under `flat`: `standard` loses it again.
    expect(((await standard())?.deals ?? 0) - (before?.deals ?? 0)).toBe(0);

    const sched = await dealScheduleOf(pg.db, d);
    expect(sched?.signed).toBe(true);
    expect(sched?.lines.some((l) => l.kind === "setup" && l.cents === 50_000)).toBe(true);
    const [r] = await dealRows(pg.db, { id: d });
    expect(r).toMatchObject({ plan: "flat", offer: "offer-a", status: "open", node: "signed" });
    expect(r?.scheduled).toBeGreaterThan(500);
  });
});

describe("the numbers views", () => {
  const snap = async (f: Parameters<typeof numberRows>[1] = {}) =>
    new Map((await numberRows(pg.db, f)).map((r) => [r.id, r] as const));
  const by = (m: Map<string, NumberRow>, id: string, k: keyof NumberRow) =>
    Number(m.get(id)?.[k] ?? 0);

  it("counts arrivals per node, crossings per edge, and sources with cost", async () => {
    const before = await snap();
    const a = await start("a-vw@example.test", { name: "P0", entry: "ads1" });
    const b = await start("b-vw@example.test", { name: "P1", entry: "mail" });
    await start("c-vw@example.test", { name: "P2", entry: "mail" });
    // a: engaged, booked, signed (skips proposal). b: engaged, booked. c: engaged.
    await play(await move(a.id, "booked"));
    await play(await move(b.id, "booked"));
    await play(await move(a.id, "signed"));
    await pg.db.execute(sql`insert into ad_days
      (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
      values (current_date, 'as1', 'cmp-1', 'c', 'a', 'USD', 12.5, 1, 1, 1, 1, 1),
             (current_date, 'as2', 'cmp-1', 'c', 'b', 'USD', 7.5, 1, 1, 1, 1, 1)`);
    const after = await snap();
    const grew = (id: string, k: keyof NumberRow) => by(after, id, k) - by(before, id, k);

    expect(
      ["arrived", "skipped", "left", "now"].map((k) => grew("node:engaged", k as never)),
    ).toEqual([3, 0, 2, 1]);
    expect(
      ["arrived", "skipped", "left", "now"].map((k) => grew("node:booked", k as never)),
    ).toEqual([2, 0, 1, 1]);
    // Proposal was passed over by a, never stopped at.
    expect(
      ["arrived", "skipped", "left", "now"].map((k) => grew("node:proposal", k as never)),
    ).toEqual([0, 1, 0, 0]);
    expect(
      ["arrived", "skipped", "left", "now"].map((k) => grew("node:signed", k as never)),
    ).toEqual([1, 0, 0, 1]);
    expect(after.get("node:engaged")).toMatchObject({ nodeKind: "step", name: "Engaged" });
    expect(after.get("node:engaged")?.medianDays).toBeGreaterThanOrEqual(0);
    expect(after.get("node:engaged")?.position).toBeLessThan(
      after.get("node:booked")?.position as number,
    );

    for (const [edge, n] of [
      ["ads1_to_engaged", 1],
      ["mail_to_engaged", 2],
      ["engaged_to_booked", 2],
      ["booked_to_proposal", 1],
      ["proposal_to_signed", 1],
    ] as const)
      expect(grew(`edge:${edge}`, "crossings"), edge).toBe(n);
    expect(after.get("edge:engaged_to_booked")).toMatchObject({
      kind: "edge",
      from: "engaged",
      to: "booked",
      name: "Engaged to Booked",
    });

    expect(after.get("node:ads1")).toMatchObject({ nodeKind: "source", cost: 20 });
    expect(grew("node:ads1", "opened")).toBe(1);
    expect(grew("node:ads1", "deals")).toBe(1);
    expect(grew("node:mail", "opened")).toBe(2);
    expect(grew("node:mail", "deals")).toBe(0);
    expect(after.get("node:mail")?.cost).toBeNull();

    const offer = (m: Map<string, NumberRow>) => [...m.values()].find((r) => r.kind === "offer");
    expect(offer(after)).toMatchObject({ label: "offer-a" });
    expect((offer(after)?.deals ?? 0) - (offer(before)?.deals ?? 0)).toBe(1);
  });

  it("cuts by window, day range, offer and source", async () => {
    expect(await nodeCountsOf(pg.db, { from: "2999-01-01" })).toEqual([]);
    expect(await nodeCountsOf(pg.db, { to: "2000-01-01" })).toEqual([]);
    expect(await edgeFlowOf(pg.db, { from: "2999-01-01" })).toEqual([]);
    // Today is inside a 7 day window.
    expect((await nodeCountsOf(pg.db, { window: 7 })).length).toBeGreaterThan(0);
    const far = await numberRows(pg.db, { from: "2999-01-01" });
    expect(
      far.filter((r) => r.kind === "node" && r.nodeKind === "step").every((r) => r.arrived === 0),
    ).toBe(true);

    expect((await numberRows(pg.db, { offer: "other" })).filter((r) => r.kind === "offer")).toEqual(
      [],
    );
    const one = await numberRows(pg.db, { source: "ads1" });
    expect(one.filter((r) => r.kind !== "offer").map((r) => r.id)).toEqual(["node:ads1"]);
    const ads = one.find((r) => r.id === "node:ads1");
    expect(one.find((r) => r.kind === "offer")?.deals).toBe(ads?.deals);
  });
});

describe("the pipeline records", () => {
  const ME = { email: OP, team: true };

  it("every type loads each of its views on these rows", async () => {
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    for (const t of PIPELINE_RECORDS)
      for (const v of t.views) {
        const page = await api.list({ record: t.id, view: v.id });
        expect(Array.isArray(page.rows), `${t.id}/${v.id}`).toBe(true);
      }
  });

  it("lists journeys by status, stale, mine and shows the person's name", async () => {
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    const list = (view: string) => api.list({ record: "pipeline.journey", view });
    const open = await list("open");
    expect(open.rows.length).toBeGreaterThan(0);
    expect(open.rows.every((r) => r.status === "open")).toBe(true);
    expect((await list("dropped")).rows.some((r) => r.name === "Bo")).toBe(true);
    expect((await list("done")).rows.length).toBeGreaterThan(0);
    // Mine: the journeys the operator opened by hand (the opener owns it).
    expect((await list("mine")).rows.length).toBeGreaterThan(0);
    // Old rows are stale: the walker sits at engaged, which reads stale after 3 days.
    await pg.db.execute(
      sql`update pipeline.journeys set moved_at = now() - interval '20 days' where profile_id = ${walkProfile}`,
    );
    const fresh = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    const stale = await fresh.list({ record: "pipeline.journey", view: "stale" });
    expect(stale.rows.some((r) => r.profile === walkProfile)).toBe(true);
    // Nobody is a ghost on the one shape.
    expect((await fresh.list({ record: "pipeline.journey", view: "ghost" })).rows).toEqual([]);
    // The journey's detail names the nodes of its trail.
    const got = await fresh.get({ record: "pipeline.journey", id: String(open.rows[0]?.id) });
    const trailed = (got.detail as { trail: { to_name: string }[] }).trail;
    expect(trailed.length).toBeGreaterThan(0);
    expect(trailed.map((c) => c.to_name)).toContain("Engaged");
  });

  it("reads stale from the node's idleDays, else STALE_DAYS", async () => {
    // engaged waits 3 days, booked 30, proposal sets none (14).
    const where = { engaged: [] as string[], booked: ["booked"], proposal: ["booked", "proposal"] };
    const profiles: Record<string, number> = {};
    for (const [node, to] of Object.entries(where)) {
      const email = `idle-${node}@example.test`;
      profiles[node] = (await start(email, { to })).profile;
    }
    const flagOf = async (node: string) =>
      (await journeyRows(pg.db)).find((r) => r.profile === profiles[node])?.flag ?? null;
    const age = (days: number) =>
      pg.db.execute(
        sql`update pipeline.journeys set moved_at = now() - make_interval(days => ${days})
          where profile_id in (${sql.join(Object.values(profiles), sql`, `)})`,
      );
    await age(5);
    expect(await flagOf("engaged")).toBe("stale");
    expect(await flagOf("booked")).toBeNull();
    expect(await flagOf("proposal")).toBeNull();
    await age(15);
    expect(await flagOf("proposal")).toBe("stale");
    expect(await flagOf("booked")).toBeNull();
  });

  it("lists offers, the shape, deals and numbers", async () => {
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    expect((await api.list({ record: "pipeline.offer", view: "all" })).rows[0]).toMatchObject({
      id: "offer-a",
    });
    const shape = await api.list({ record: "pipeline.shape", view: "all" });
    expect(shape.rows).toHaveLength(1);
    expect(shape.rows[0]).toMatchObject({ id: "shape", name: "Test shape", version: 1 });
    const got = await api.get({ record: "pipeline.shape", id: "shape" });
    expect(got.detail).toMatchObject({
      depths: { engaged: 1, booked: 2, standard: 5 },
      versions: [{ number: 1, parent: null, note: "first" }],
    });
    const deals = await api.list({ record: "pipeline.deal", view: "all" });
    expect(deals.rows.length).toBeGreaterThan(0);
    const nodes = await api.list({ record: "pipeline.number", view: "node" });
    expect(nodes.rows.some((r) => r.node === "engaged")).toBe(true);
    const edges = await api.list({ record: "pipeline.number", view: "edge" });
    expect(edges.rows.some((r) => r.node === "booked_to_proposal")).toBe(true);
    const offers = await api.list({ record: "pipeline.number", view: "offer" });
    expect(offers.rows.map((r) => r.node)).toEqual(["offer-a"]);
    // The views read the whole history; the Map reads a window by its field.
    expect(nodes.rows.every((r) => r.window === "all")).toBe(true);
    for (const w of ["7", "30", "90"]) {
      const win = await api.list({
        record: "pipeline.number",
        where: { kind: "node", window: w },
        sort: "position",
        limit: 100,
      });
      expect(win.rows.map((r) => r.node)).toEqual(nodes.rows.map((r) => r.node));
      expect(win.rows.every((r) => r.window === w)).toBe(true);
    }
  });

  it("lists terms versions: live, upcoming and older, with a short read of each", async () => {
    for (const [from, setup] of [
      ["2020-01-01", 11_100],
      ["2021-06-01", 22_200],
      ["2999-01-01", 33_300],
    ] as const)
      await addTerms(pg.db, {
        offer: "offer-a",
        plan: "rec-plan",
        from,
        body: terms(setup),
        why: `from ${from}`,
        by: OP,
      });
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    const all = await api.list({ record: "pipeline.terms", view: "all", limit: 100 });
    const mine = all.rows.filter((r) => r.plan === "rec-plan");
    expect(mine.map((r) => [r.number, r.state]).sort()).toEqual([
      [1, "older"],
      [2, "live"],
      [3, "upcoming"],
    ]);
    expect(mine.find((r) => r.number === 2)).toMatchObject({
      offer: "offer-a",
      terms: "setup 222.00 USD, 100.00 USD a month, 90 days, due in 7 days",
      why: "from 2021-06-01",
      createdBy: OP,
    });
    const live = await api.list({ record: "pipeline.terms", view: "live", limit: 100 });
    expect(live.rows.filter((r) => r.plan === "rec-plan").map((r) => r.number)).toEqual([2]);
    expect(live.rows.every((r) => r.state === "live")).toBe(true);
    // The offer's detail lists its versions, and its terms are the rows that point at it.
    const got = await api.get({ record: "pipeline.offer", id: "offer-a" });
    expect(got.detail).toMatchObject({ versions: [{ number: 1 }] });
    const rel = await api.list({
      record: "pipeline.terms",
      view: "all",
      of: { record: "pipeline.offer", id: "offer-a" },
      limit: 100,
    });
    expect(rel.rows.length).toBe(all.rows.filter((r) => r.offer === "offer-a").length);
  });

  it("reads a terms body in a line, leaving out what it does not set", () => {
    expect(
      readTerms({
        ...terms(0),
        monthlyCents: null,
        perUnitCents: 5_000,
        unit: "unit",
        capCents: 20_000,
        days: null,
      }),
    ).toBe("50.00 USD per unit, up to 200.00, due in 7 days");
  });

  it("gives each offer its live plans and the open journeys that reached it", async () => {
    const [a] = (await offerRows(pg.db)).filter((r) => r.id === "offer-a");
    // standard, flat and rec-plan have started; the 2999 version does not make a fourth.
    expect(a?.live_plans).toBe(3);
    // Journeys that passed an offer node count; one still at engaged does not.
    const opens = (await journeyRows(pg.db)).filter((j) => j.status === "open");
    expect(a?.open_journeys).toBeGreaterThan(0);
    expect(a?.open_journeys).toBeLessThan(opens.length);
    // A date far back is not live.
    expect((await offerRows(pg.db, { now: new Date("2019-01-01") }))[0]?.live_plans).toBe(0);
  });

  it("lists the sources with journeys and the last arrival", async () => {
    const rows = await entryRows(pg.db);
    expect(rows.map((r) => r.id).sort()).toEqual(["ads1", "mail", "old", "yt"]);
    expect(rows.find((r) => r.id === "mail")).toMatchObject({
      via: "outbound",
      channel: "email",
      campaign: null,
      parked: null,
    });
    expect(rows.find((r) => r.id === "ads1")).toMatchObject({ via: "ads", campaign: "cmp-1" });
    expect(rows.find((r) => r.id === "old")).toMatchObject({ parked: "parked", journeys: 0 });
    // Some source has opened a journey: its count and arrival are set.
    const used = rows.find((r) => r.journeys > 0);
    expect(used?.last_arrival).toBeInstanceOf(Date);
    expect(used?.open_journeys).toBeLessThanOrEqual(used?.journeys ?? 0);
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    const page = await api.list({ record: "pipeline.entry", view: "all", limit: 100 });
    expect(page.rows.map((r) => r.id).sort()).toEqual(["ads1", "mail", "old", "yt"]);
  });
});

describe("loop edges", () => {
  it("reopens at the edge's end as a new journey with the old source", async () => {
    const v2 = body();
    v2.edges.push(loop("booked", "engaged"));
    expect((await save(v2, "loop back")).number).toBe(2);

    const { profile, id } = await start("loop@example.test", { entry: "mail", to: ["booked"] });
    const e = await move(id, "engaged");
    expect(e.workflow).toBe("shape.v2");
    const fired = await play(e);
    expect(
      fired.map((f) => [
        (f.facts as unknown as { node: string }).node,
        (f.facts as { change: string }).change,
      ]),
    ).toEqual([
      ["engaged", "entered"],
      ["booked", "dropped"],
    ]);

    expect(await row(id)).toMatchObject({
      node: "booked",
      status: "dropped",
      dropReason: "loop booked_to_engaged",
    });
    expect((await row(id))?.closedAt).toBeInstanceOf(Date);
    const fresh = (await pg.db.select().from(journeys).where(eq(journeys.profileId, profile))).find(
      (j) => j.id !== id,
    );
    // The new journey keeps the owner.
    expect(fresh).toMatchObject({
      node: "engaged",
      status: "open",
      version: 2,
      entry: "mail",
      owner: OP,
    });
    expect(fresh?.entryRef).toMatchObject({ loop: id, cause: { kind: "manual", ref: OP } });
    expect(fresh?.trail).toMatchObject([
      { edge: "booked_to_engaged", from: "booked", to: "engaged" },
    ]);
    const freshId = fresh?.id as string;

    // The loop shows in the numbers: one crossing, and a leave from booked.
    const crossings = (await edgeFlowOf(pg.db)).filter((f) => f.edge === "booked_to_engaged");
    expect(crossings.reduce((n, f) => n + (f.crossings ?? 0), 0)).toBe(1);

    // Rebuild keeps the old journey dropped by the loop, and the new one as it is. One journey is
    // open per person, so the new one is closed while the old one is forced open.
    await pg.db
      .update(journeys)
      .set({ status: "dropped", closedAt: new Date() })
      .where(eq(journeys.id, freshId));
    await pg.db
      .update(journeys)
      .set({ status: "open", dropReason: null, closedAt: null })
      .where(eq(journeys.id, id));
    const r = await rebuildJourney(pg.db, id);
    await pg.db
      .update(journeys)
      .set({ status: "open", closedAt: null })
      .where(eq(journeys.id, freshId));
    expect(r.after).toMatchObject({
      node: "booked",
      status: "dropped",
      dropReason: "loop booked_to_engaged",
    });
    expect((await rebuildJourney(pg.db, id)).changed).toBe(false);
    expect((await rebuildJourney(pg.db, freshId)).changed).toBe(false);

    // One journey is open for the person, so the old one cannot loop again.
    expect(await reasons(move(id, "engaged"))).toEqual([`Already open at engaged: ${freshId}.`]);
    expect(await reasons(move(freshId, "engaged"))).toEqual(["It is already at Engaged."]);
  });

  it("loops out of a dropped journey and leaves its drop reason alone", async () => {
    const { profile, id } = await start("loop2@example.test", { entry: "ads1", to: ["booked"] });
    await play((await dropJourney(pg.db, { journey: id, reason: "no fit", by: OP })) as Emit);
    await play(await move(id, "engaged"));
    expect(await row(id)).toMatchObject({ status: "dropped", dropReason: "no fit" });
    const fresh = (await pg.db.select().from(journeys).where(eq(journeys.profileId, profile))).find(
      (j) => j.id !== id,
    );
    expect(fresh).toMatchObject({ node: "engaged", status: "open", entry: "ads1" });
    expect((await rebuildJourney(pg.db, id)).changed).toBe(false);
  });

  it("refuses a loop out of a journey that is done", async () => {
    const v3 = body();
    v3.edges.push(loop("booked", "engaged"), loop("standard", "engaged"));
    expect((await save(v3, "loop from the end")).number).toBe(3);
    const { id } = await start("loop3@example.test", { to: ["standard"] });
    expect(await row(id)).toMatchObject({ node: "standard", status: "done", version: 3 });
    expect(await reasons(move(id, "engaged"))).toEqual(["Journey is done."]);
  });
});
