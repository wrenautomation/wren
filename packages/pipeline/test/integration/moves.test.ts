/**
 * Hand moves, the numbers views and the pipeline records, on a real Postgres
 * (designs/2026-10-18-journeys.md): a move is the event `Journeys` sends, walked here on the real
 * store and steps, no Restate. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { resolveProfile } from "@wren/core/profiles";
import { serveRecords } from "@wren/core/records/serve";
import { type Fired, pgSpineStore, type Walk, walk } from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import type { Terms } from "@wren/offers";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropJourney, funnelWorkflowsOf } from "../../src/journeys.js";
import type { FunnelBody } from "../../src/model.js";
import {
  type Emit,
  moveEmit,
  openEmit,
  personByKey,
  rebuildJourney,
  signDeal,
} from "../../src/moves.js";
import { dealScheduleOf, numberRows, stageCountsOf, stageFlowOf } from "../../src/numbers.js";
import {
  dealRows,
  entryRows,
  journeyRows,
  offerRows,
  PIPELINE_RECORDS,
  readTerms,
  trailOf,
} from "../../src/records.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
} from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { addTerms, Refused } from "../../src/store.js";

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

const body = (over: Partial<FunnelBody> = {}): FunnelBody => ({
  name: "Test funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
    { key: "booked", label: "Booked", on: [{ trigger: "trigger.booking" }] },
    { key: "proposal", label: "Proposal", on: [] },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [
    { id: "mail", kind: "outbound", channel: "email" },
    { id: "ads1", kind: "ads", campaign: "cmp-1" },
  ],
  ...over,
});

async function funnel(id: string, b: FunnelBody, status: "live" | "off" = "live") {
  await pg.db.insert(funnels).values({ id, name: b.name, status });
  await pg.db
    .insert(funnelVersions)
    .values({ funnel: id, number: 1, body: b, why: "first", createdBy: "t" });
}

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
  const flows: Workflow[] = await funnelWorkflowsOf(pg.db, "wren");
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

const open = (funnelId: string, email: string, more: { at?: string; entry?: string } = {}) =>
  openEmit(pg.db, { funnel: funnelId, person: email, by: OP, ...more });
const journeyOf = async (profile: number, id: string) => {
  const [j] = await pg.db
    .select()
    .from(journeys)
    .where(and(eq(journeys.profileId, profile), eq(journeys.funnel, id)));
  return j;
};
const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

describe("open", () => {
  it("refuses an unknown or off funnel, a non-entry stage, an unknown entry or person", async () => {
    await funnel("o-off", body(), "off");
    await funnel("o-live", body());
    await person("open@example.test");
    expect(await reasons(open("nope", "open@example.test"))).toEqual(["No funnel nope."]);
    expect(await reasons(open("o-off", "open@example.test"))).toEqual(["Funnel o-off is off."]);
    expect((await reasons(open("o-live", "open@example.test", { at: "booked" })))[0]).toMatch(
      /no entry stage. Entry stages: engaged/,
    );
    expect(await reasons(open("o-live", "open@example.test", { entry: "zzz" }))).toEqual([
      "Funnel o-live has no entry zzz.",
    ]);
    expect(await reasons(open("o-live", "ghost@example.test"))).toEqual([
      "No person ghost@example.test.",
    ]);
  });

  it("finds a person by profile id, email or kind:value", async () => {
    const id = await person("key@example.test");
    expect(await personByKey(pg.db, String(id))).toBe(id);
    expect(await personByKey(pg.db, "KEY@example.test")).toBe(id);
    expect(await personByKey(pg.db, "nobody@example.test")).toBeNull();
    expect(await personByKey(pg.db, "")).toBeNull();
  });

  it("opens through the funnel's own step, with the operator as the cause", async () => {
    await funnel("o-walk", body());
    const profile = await person("walk@example.test");
    const fired = await play(await open("o-walk", "walk@example.test", { entry: "ads1" }));
    const j = await journeyOf(profile, "o-walk");
    expect(j).toMatchObject({ stage: "engaged", status: "open", entry: "ads1", version: 1 });
    expect(j?.entryRef).toMatchObject({ cause: { kind: "manual", ref: OP } });
    expect(fired.map((f) => f.facts)).toEqual([
      { trigger: "trigger.journey", funnel: "o-walk", stage: "engaged", change: "entered" },
    ]);
    // A second open is refused while one is open.
    expect((await reasons(open("o-walk", "walk@example.test")))[0]).toMatch(
      /Already open at engaged/,
    );
  });
});

describe("move and drop", () => {
  it("moves forward only, skips are told, the sale stage makes the deal", async () => {
    await funnel("m-fwd", body());
    const profile = await person("fwd@example.test");
    await play(await open("m-fwd", "fwd@example.test"));
    const j = await journeyOf(profile, "m-fwd");
    const id = j?.id as string;

    const to = (stage: string) => moveEmit(pg.db, { journey: id, to: stage, by: OP });
    expect(await reasons(to("nope"))).toEqual([expect.stringMatching(/No stage nope/)]);
    expect(await reasons(to("engaged"))).toEqual([expect.stringMatching(/only moves forward/)]);
    expect(await reasons(moveEmit(pg.db, { journey: "not-an-id", to: "booked", by: OP }))).toEqual([
      "No journey not-an-id.",
    ]);
    expect(await reasons(moveEmit(pg.db, { journey: MISSING, to: "booked", by: OP }))).toEqual([
      `No journey ${MISSING}.`,
    ]);

    await play(await to("booked"));
    expect((await journeyOf(profile, "m-fwd"))?.stage).toBe("booked");
    await play(await to("signed"));
    expect(await journeyOf(profile, "m-fwd")).toMatchObject({ stage: "signed", status: "done" });
    expect(
      await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.journey, id)),
    ).toHaveLength(1);
    expect(await reasons(to("signed"))).toEqual(["Journey is done."]);

    const trail = await trailOf(pg.db, id);
    expect(trail.map((t) => [t.node, t.cause, t.ref])).toEqual([
      ["s_engaged", "manual", OP],
      ["s_booked", "manual", OP],
      ["s_signed", "manual", OP],
    ]);
    const [row] = await journeyRows(pg.db, { id });
    expect(row).toMatchObject({ name: "Ada", stage: "signed", status: "done", owner: OP });
  });

  it("drops, and rebuild puts a damaged row right from its events", async () => {
    await funnel("m-drop", body());
    const profile = await person("drop@example.test", "Bo");
    await play(await open("m-drop", "drop@example.test"));
    const id = (await journeyOf(profile, "m-drop"))?.id as string;
    const drop = await dropJourney(pg.db, { journey: id, reason: "no fit", by: OP });
    expect(drop).not.toBeNull();
    await play(drop as Emit);
    expect(await journeyOf(profile, "m-drop")).toMatchObject({
      status: "dropped",
      dropReason: "no fit",
    });
    expect(await dropJourney(pg.db, { journey: id, reason: "again" })).toBeNull();

    // Damage the row; the events still say dropped at engaged.
    await pg.db
      .update(journeys)
      .set({ status: "open", dropReason: null, closedAt: null, stage: "booked" })
      .where(eq(journeys.id, id));
    const r = await rebuildJourney(pg.db, id);
    expect(r.changed).toBe(true);
    expect(r.after).toMatchObject({ stage: "engaged", status: "dropped", dropReason: "no fit" });
    expect(await journeyOf(profile, "m-drop")).toMatchObject({
      stage: "engaged",
      status: "dropped",
      dropReason: "no fit",
    });
    expect((await rebuildJourney(pg.db, id)).changed).toBe(false);
    expect(await reasons(rebuildJourney(pg.db, MISSING))).toEqual([`No journey ${MISSING}.`]);
  });

  it("rebuild marks the last stage done", async () => {
    await funnel("m-done", body());
    const profile = await person("done@example.test");
    await play(await open("m-done", "done@example.test"));
    const id = (await journeyOf(profile, "m-done"))?.id as string;
    await play(await moveEmit(pg.db, { journey: id, to: "signed", by: OP }));
    await pg.db
      .update(journeys)
      .set({ status: "open", closedAt: null, stage: "engaged" })
      .where(eq(journeys.id, id));
    const r = await rebuildJourney(pg.db, id);
    expect(r.after).toMatchObject({ stage: "signed", status: "done" });
  });
});

describe("sign", () => {
  it("sets terms once, a repeat is no change, a change needs force", async () => {
    await funnel("s-deal", body());
    const profile = await person("sign@example.test");
    await play(await open("s-deal", "sign@example.test"));
    const id = (await journeyOf(profile, "s-deal"))?.id as string;
    await play(await moveEmit(pg.db, { journey: id, to: "signed", by: OP }));
    const [deal] = await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.journey, id));
    const d = deal?.id as string;

    expect((await dealScheduleOf(pg.db, d))?.signed).toBe(false);
    expect(await reasons(signDeal(pg.db, { deal: d, plan: "none" }))).toEqual([
      "No live none terms for offer-a.",
    ]);
    const first = await signDeal(pg.db, { deal: d, plan: "standard" });
    expect(first.changed).toBe(true);
    expect((await signDeal(pg.db, { deal: d, plan: "standard" })).changed).toBe(false);
    expect((await reasons(signDeal(pg.db, { deal: d, plan: "flat" })))[0]).toMatch(/set once/);
    const forced = await signDeal(pg.db, { deal: d, plan: "flat", force: true });
    expect(forced).toMatchObject({ changed: true });
    expect(forced.termsVersion).not.toBe(first.termsVersion);
    expect(await reasons(signDeal(pg.db, { deal: MISSING, plan: "flat" }))).toEqual([
      `No deal ${MISSING}.`,
    ]);

    const sched = await dealScheduleOf(pg.db, d);
    expect(sched?.signed).toBe(true);
    expect(sched?.lines.some((l) => l.kind === "setup" && l.cents === 50_000)).toBe(true);
    const [row] = await dealRows(pg.db, { id: d });
    expect(row).toMatchObject({ plan: "flat", offer: "offer-a", status: "open" });
    expect(row?.scheduled).toBeGreaterThan(500);
  });
});

describe("the numbers views", () => {
  it("counts arrivals per stage, conversion between stages, and entries with cost", async () => {
    await funnel("n-vw", body());
    const names = ["a", "b", "c"].map((x) => `${x}-vw@example.test`);
    const ids: string[] = [];
    for (const [i, email] of names.entries()) {
      const profile = await person(email, `P${i}`);
      await play(await open("n-vw", email, { entry: i === 0 ? "ads1" : "mail" }));
      ids.push((await journeyOf(profile, "n-vw"))?.id as string);
    }
    // a: engaged, booked, signed (skips proposal). b: engaged, booked. c: engaged.
    await play(await moveEmit(pg.db, { journey: ids[0] as string, to: "booked", by: OP }));
    await play(await moveEmit(pg.db, { journey: ids[1] as string, to: "booked", by: OP }));
    await play(await moveEmit(pg.db, { journey: ids[0] as string, to: "signed", by: OP }));
    await pg.db.execute(sql`insert into ad_days
      (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
      values (current_date, 'as1', 'cmp-1', 'c', 'a', 'USD', 12.5, 1, 1, 1, 1, 1),
             (current_date, 'as2', 'cmp-1', 'c', 'b', 'USD', 7.5, 1, 1, 1, 1, 1)`);

    const counts = await stageCountsOf(pg.db, { funnel: "n-vw" });
    const by = Object.fromEntries(counts.map((c) => [c.stage, [c.entered, c.skipped]]));
    expect(by).toEqual({
      engaged: [3, 0],
      booked: [2, 0],
      signed: [1, 0],
      proposal: [0, 1],
    });
    expect(await stageCountsOf(pg.db, { funnel: "n-vw", from: "2999-01-01" })).toEqual([]);

    const flow = await stageFlowOf(pg.db, { funnel: "n-vw" });
    const at = (s: string) => flow.find((f) => f.stage === s);
    expect(at("engaged")).toMatchObject({ nextStage: "booked", reached: 3, advanced: 2 });
    expect(at("engaged")?.conversion).toBeCloseTo(2 / 3);
    expect(at("engaged")?.medianSeconds).toBeGreaterThanOrEqual(0);
    // Proposal counts as reached for a, who skipped past it.
    expect(at("booked")).toMatchObject({ nextStage: "proposal", reached: 2, advanced: 1 });
    expect(at("proposal")).toMatchObject({ reached: 1, advanced: 1 });

    const rows = await numberRows(pg.db, { funnel: "n-vw" });
    const stage = rows
      .filter((r) => r.kind === "stage")
      .map((r) => [r.label, r.entered, r.skipped]);
    expect(stage).toEqual([
      ["engaged", 3, 0],
      ["booked", 2, 0],
      ["proposal", 0, 1],
      ["signed", 1, 0],
    ]);
    const ads = rows.find((r) => r.id === "entry:n-vw:ads1");
    const mail = rows.find((r) => r.id === "entry:n-vw:mail");
    expect(ads).toMatchObject({ opened: 1, deals: 1, cost: 20 });
    expect(mail).toMatchObject({ opened: 2, deals: 0, cost: null });

    const byOffer = await numberRows(pg.db, { offer: "offer-a", funnel: "n-vw" });
    expect(byOffer.find((r) => r.kind === "offer")).toMatchObject({ label: "offer-a", deals: 1 });
    expect(await numberRows(pg.db, { offer: "other", funnel: "n-vw" })).toEqual([]);
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
    // Mine: the journeys the operator moved by hand.
    expect((await list("mine")).rows.length).toBeGreaterThan(0);
    // Old rows are stale.
    await pg.db.execute(
      sql`update pipeline.journeys set moved_at = now() - interval '20 days' where funnel = 'o-walk'`,
    );
    const fresh = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    const stale = await fresh.list({ record: "pipeline.journey", view: "stale" });
    expect(stale.rows.some((r) => r.funnel === "o-walk")).toBe(true);
  });

  it("lists offers, funnels, deals and numbers", async () => {
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    expect((await api.list({ record: "pipeline.offer", view: "all" })).rows[0]).toMatchObject({
      id: "offer-a",
    });
    const f = await api.list({ record: "pipeline.funnel", view: "off" });
    expect(f.rows.map((r) => r.id)).toContain("o-off");
    const deals = await api.list({ record: "pipeline.deal", view: "all" });
    expect(deals.rows.length).toBeGreaterThan(0);
    const nums = await api.list({ record: "pipeline.number", view: "stage" });
    expect(nums.rows.some((r) => r.funnel === "n-vw")).toBe(true);
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

  it("gives each offer its live plans and open journeys", async () => {
    const [a] = (await offerRows(pg.db)).filter((r) => r.id === "offer-a");
    // standard, flat and rec-plan have started; the 2999 version does not make a fourth.
    expect(a?.live_plans).toBe(3);
    const open = (await journeyRows(pg.db)).filter(
      (j) => j.status === "open" && j.funnel_name === "Test funnel",
    ).length;
    expect(a?.open_journeys).toBeGreaterThanOrEqual(open);
    expect(a?.open_journeys).toBeGreaterThan(0);
    // A date far ahead is not live.
    expect((await offerRows(pg.db, { now: new Date("2019-01-01") }))[0]?.live_plans).toBe(0);
  });

  it("lists each funnel's entries with journeys and the last arrival", async () => {
    const rows = await entryRows(pg.db);
    const mail = rows.filter((r) => r.entry === "mail" && r.kind === "outbound");
    expect(mail.length).toBeGreaterThan(0);
    expect(mail[0]).toMatchObject({ channel: "email", campaign: null });
    const ads = rows.find((r) => r.entry === "ads1");
    expect(ads).toMatchObject({ kind: "ads", campaign: "cmp-1" });
    // Some entry has opened a journey: its count and arrival are set.
    const used = rows.find((r) => r.journeys > 0);
    expect(used?.last_arrival).toBeInstanceOf(Date);
    expect(used?.open_journeys).toBeLessThanOrEqual(used?.journeys ?? 0);
    const api = serveRecords(PIPELINE_RECORDS, pg.db, undefined, undefined, ME);
    const page = await api.list({
      record: "pipeline.entry",
      view: "all",
      where: { funnel: used?.funnel },
      limit: 100,
    });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.funnel === used?.funnel)).toBe(true);
  });
});
