/**
 * The causes that move journeys (designs/2026-10-18-journeys.md, "Causes"), on a real Postgres:
 * a touch through the feed's reads into a funnel, a merge of two open journeys, and payments
 * folded into a deal. The walks use the real store and steps, no Restate. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { mergeProfiles, resolveProfile } from "@wren/core/profiles";
import { profileEvents } from "@wren/core/profiles-schema";
import {
  type Fired,
  hearersOf,
  pgSpineStore,
  type SpineEvent,
  type Walk,
  walk,
} from "@wren/core/spine";
import { touchFired, touchPass, touchRows } from "@wren/core/touch-feed";
import { recordTouch } from "@wren/core/touches";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLLECT_STEP, collectSteps, MONEY_WORKFLOW } from "../../src/collect.js";
import { funnelWorkflowsOf } from "../../src/journeys.js";
import type { FunnelBody } from "../../src/model.js";
import { funnels, funnelVersions, journeys, pipelineDeals } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const body = (over: Partial<FunnelBody> = {}): FunnelBody => ({
  name: "Cause funnel",
  offer: "offer-a",
  stages: [
    {
      key: "engaged",
      label: "Engaged",
      on: [
        { trigger: "trigger.touch", with: { kind: "dm", direction: "theirs", platform: "x" } },
        { trigger: "trigger.reply" },
      ],
    },
    { key: "booked", label: "Booked", on: [{ trigger: "trigger.booking" }] },
    { key: "signed", label: "Signed", sale: true, on: [] },
  ],
  entries: [{ id: "dm", kind: "outbound", channel: "x" }],
  ...over,
});

async function funnel(id: string, b: FunnelBody) {
  await pg.db.insert(funnels).values({ id, name: b.name, status: "live" });
  await pg.db
    .insert(funnelVersions)
    .values({ funnel: id, number: 1, body: b, why: "first", createdBy: "t" });
}

const person = async (email: string) => {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name: "Ada" });
  if (!r) throw new Error("no profile");
  return r.id;
};

function rig() {
  const fired: Fired[] = [];
  const w: Walk = {
    flows: new Map(),
    parts: new Map(),
    steps: {
      ...journeySteps({ db: () => pg.db }),
      ...collectSteps({ db: () => pg.db }),
    },
    store: pgSpineStore(pg.db),
    client: null,
    by: "test",
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: (req) => fired.push(req),
  };
  return { w, fired };
}

async function flowsOf(...ids: string[]): Promise<Workflow[]> {
  const all = await funnelWorkflowsOf(pg.db, "wren");
  return all.filter((f) => ids.some((id) => f.id.startsWith(`funnel.${id}.`)));
}

/** What `Spine/fire` does: walk the event from every trigger node that hears the facts. */
async function hear(
  r: ReturnType<typeof rig>,
  flows: Workflow[],
  facts: Fired["facts"],
  event: SpineEvent,
) {
  const w: Walk = { ...r.w, by: randomUUID(), flows: new Map(flows.map((f) => [f.id, f])) };
  const tallies = [];
  for (const h of hearersOf(flows, facts)) tallies.push(await walk(w, h.workflow, h.from, [event]));
  return tallies;
}

const REPLY = { trigger: "trigger.reply", channel: "email" } as const;
const reply = (n: number, email: string): SpineEvent => ({
  subject: `reply:email:${n}`,
  kind: "reply",
  data: { email, channel: "email" },
});
const BOOKING = { trigger: "trigger.booking", change: "booked" } as const;

const journeyOf = async (profile: number, id: string) => {
  const [j] = await pg.db
    .select()
    .from(journeys)
    .where(and(eq(journeys.profileId, profile), eq(journeys.funnel, id)));
  return j;
};

describe("a touch", () => {
  const dm = (ref: string, over: Partial<Parameters<typeof recordTouch>[1]> = {}) => ({
    platform: "x",
    handle: "sam_synth",
    kind: "dm" as const,
    direction: "theirs" as const,
    at: new Date("2026-10-19T09:00:00Z"),
    source: "reach_messages",
    ref,
    ...over,
  });

  it("is read past the cursor once it has settled, and moves a journey through a funnel", async () => {
    await funnel("touchy", body());
    const flows = await flowsOf("touchy");
    const r = rig();

    // The first pass starts at the newest touch and tells none.
    const first = await touchPass(pg.db, undefined, new Date());
    expect(first).toEqual({ ids: [], next: 0 });

    const mine = await recordTouch(pg.db, dm("t:1"));
    const ours = await recordTouch(pg.db, dm("t:2", { direction: "ours", at: new Date() }));
    if (!mine || !ours) throw new Error("no touch");

    // Just written: not settled, so not read yet.
    expect((await touchPass(pg.db, 0, new Date()))?.ids).toEqual([]);

    const later = new Date(Date.now() + 120_000);
    const got = await touchPass(pg.db, 0, later);
    expect(got).toEqual({ ids: [mine.id, ours.id], next: ours.id });
    // Told: the cursor past them reads nothing again.
    expect(await touchPass(pg.db, got?.next, later)).toEqual({ ids: [], next: ours.id });

    const rows = await touchRows(pg.db, got?.ids ?? []);
    expect(rows.map((t) => [t.id, t.platform, t.handle, t.direction])).toEqual([
      [mine.id, "x", "sam_synth", "theirs"],
      [ours.id, "x", "sam_synth", "ours"],
    ]);
    // The handle keys a profile (the touch made it), so the event names it.
    expect(rows[0]?.profile).toEqual(expect.any(Number));

    // Ours does not match "theirs": nothing moves. Theirs opens the journey.
    const [theirs, back] = [rows[0], rows[1]];
    if (!theirs || !back) throw new Error("rows");
    const t1 = touchFired(null, back);
    expect((await hear(r, flows, t1.facts, t1.event)).length).toBe(0);
    const t2 = touchFired(null, theirs);
    await hear(r, flows, t2.facts, t2.event);
    const j = await journeyOf(theirs.profile as number, "touchy");
    expect(j).toMatchObject({ stage: "engaged", status: "open" });
    expect(j?.entryRef).toMatchObject({ subject: `touch:${mine.id}`, cause: { kind: "touch" } });
  });

  it("names the person by the handle key when no profile is on the event", async () => {
    await funnel("handles", body());
    const flows = await flowsOf("handles");
    const r = rig();
    const t = await recordTouch(pg.db, dm("t:3", { handle: "kim_synth", at: new Date() }));
    if (!t) throw new Error("no touch");
    const [row] = await touchRows(pg.db, [t.id]);
    if (!row?.profile) throw new Error("no profile");
    // The profile left off: `handle:x` alone finds the same person.
    const f = touchFired(null, { ...row, profile: null });
    expect(f.event.data).not.toHaveProperty("profile");
    await hear(r, flows, f.facts, f.event);
    expect((await journeyOf(row.profile, "handles"))?.stage).toBe("engaged");
  });
});

describe("a profile merge", () => {
  it("keeps the journey at the later stage and drops the other as merged", async () => {
    await funnel("merge", body());
    const flows = await flowsOf("merge");
    const r = rig();
    const a = await person("mia@example.test");
    const b = await person("max@example.test");
    // A (the profile merged into) is only engaged; B has booked.
    await hear(
      r,
      flows,
      { trigger: "trigger.touch", kind: "dm", direction: "theirs", platform: "x" },
      {
        subject: "touch:9001",
        kind: "person",
        data: { email: "mia@example.test", platform: "x" },
      },
    );
    await hear(r, flows, REPLY, reply(70, "max@example.test"));
    await hear(r, flows, BOOKING, {
      subject: "call:70",
      kind: "call",
      data: { email: "max@example.test" },
    });
    expect((await journeyOf(a, "merge"))?.stage).toBe("engaged");
    expect((await journeyOf(b, "merge"))?.stage).toBe("booked");
    const keep = await journeyOf(b, "merge");
    const lose = await journeyOf(a, "merge");

    const at = new Date("2026-10-19T12:00:00Z");
    await mergeProfiles(pg.db, a, b, "test", "test", at);

    const rows = await pg.db.select().from(journeys).where(eq(journeys.funnel, "merge"));
    expect(rows).toHaveLength(2);
    const open = rows.filter((x) => x.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: keep?.id, profileId: a, stage: "booked" });
    const dropped = rows.find((x) => x.id === lose?.id);
    expect(dropped).toMatchObject({ status: "dropped", dropReason: "merged", profileId: a });
    expect(dropped?.closedAt).toEqual(at);
  });

  it("moves a lone journey and a deal to the profile it merged into", async () => {
    await funnel("lone", body());
    const flows = await flowsOf("lone");
    const r = rig();
    const a = await person("lou@example.test");
    const b = await person("liv@example.test");
    await hear(r, flows, REPLY, reply(71, "liv@example.test"));
    const j = await journeyOf(b, "lone");
    await pg.db
      .insert(pipelineDeals)
      .values({ journey: j?.id as string, profileId: b, offer: "offer-a", offerVersion: 1 });
    await mergeProfiles(pg.db, a, b, "test", "test");
    expect(await journeyOf(a, "lone")).toMatchObject({ id: j?.id, status: "open" });
    const [deal] = await pg.db
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.journey, j?.id as string));
    expect(deal?.profileId).toBe(a);
  });
});

describe("collected money", () => {
  const pay = (
    subject: string,
    change: "paid" | "refunded",
    data: Record<string, unknown>,
  ): { facts: Fired["facts"]; event: SpineEvent } => ({
    facts: { trigger: "trigger.payment", change },
    event: {
      subject,
      kind: "invoice",
      data: { source: "pay_link", change, currency: "USD", ...data },
    },
  });

  async function deal(email: string, offer = "offer-a") {
    await funnel(`pay_${email.split("@")[0]}`, body());
    const profile = await person(email);
    await hear(rig(), await flowsOf(`pay_${email.split("@")[0]}`), REPLY, reply(80, email));
    const j = await journeyOf(profile, `pay_${email.split("@")[0]}`);
    const [d] = await pg.db
      .insert(pipelineDeals)
      .values({ journey: j?.id as string, profileId: profile, offer, offerVersion: 1 })
      .returning();
    if (!d) throw new Error("no deal");
    return { profile, deal: d };
  }
  const collected = async (id: string) =>
    (await pg.db.select().from(pipelineDeals).where(eq(pipelineDeals.id, id)))[0]?.collectedCents;

  it("adds a payment and takes a refund off, each change once", async () => {
    const { deal: d } = await deal("pat@example.test");
    const r = rig();
    const flows = [MONEY_WORKFLOW];
    const paid = pay("payment:L1", "paid", { email: "pat@example.test", amount_cents: 9_800 });
    await hear(r, flows, paid.facts, paid.event);
    expect(await collected(d.id)).toBe(9_800);
    // The same change again: the spine refuses the arrival.
    const again = await hear(r, flows, paid.facts, paid.event);
    expect(again[0]).toMatchObject({ arrived: 0 });
    expect(await collected(d.id)).toBe(9_800);

    const refunded = pay("payment:L1:refunded", "refunded", {
      email: "pat@example.test",
      amount_cents: 9_800,
      refunded_cents: 3_000,
    });
    await hear(r, flows, refunded.facts, refunded.event);
    expect(await collected(d.id)).toBe(6_800);

    // The line on the timeline, once per change.
    const lines = await pg.db
      .select()
      .from(profileEvents)
      .where(and(eq(profileEvents.profileId, d.profileId), eq(profileEvents.source, "collected")));
    expect(lines.map((l) => l.summary).sort()).toEqual([
      "Collected 98.00 USD",
      "Refunded 30.00 USD",
    ]);
  });

  it("holds when a crashed step runs again: the timeline line is the claim", async () => {
    const { deal: d } = await deal("quin@example.test");
    const step = collectSteps({ db: () => pg.db })[COLLECT_STEP];
    if (!step) throw new Error("no step");
    const e: SpineEvent = pay("payment:L2", "paid", {
      email: "quin@example.test",
      amount_cents: 500,
    }).event;
    const at = { client: null, workflow: "pipeline.money", node: "collect", with: {} };
    await step("payments", e, at);
    await step("payments", e, at);
    expect(await collected(d.id)).toBe(500);
  });

  it("goes to the deal the payment names, else the newest open deal for its offer", async () => {
    const { deal: one } = await deal("rae@example.test");
    const r = rig();
    const flows = [MONEY_WORKFLOW];
    // Named: another profile's deal is the one that moves, whoever paid.
    const named = pay("payment:L3", "paid", {
      email: "rae@example.test",
      deal: one.id,
      amount_cents: 100,
    });
    await hear(r, flows, named.facts, named.event);
    expect(await collected(one.id)).toBe(100);
    // An offer that matches no open deal of theirs: nothing moves.
    const other = pay("payment:L4", "paid", {
      email: "rae@example.test",
      offer: "offer-zzz",
      amount_cents: 700,
    });
    await hear(r, flows, other.facts, other.event);
    expect(await collected(one.id)).toBe(100);
  });

  it("does nothing for an unknown deal, a stranger, another currency or a closed deal", async () => {
    const { deal: d } = await deal("sol@example.test");
    const r = rig();
    const flows = [MONEY_WORKFLOW];
    const cases = [
      pay("payment:L5", "paid", { deal: randomUUID(), amount_cents: 100 }),
      pay("payment:L6", "paid", { deal: "not-a-uuid", amount_cents: 100 }),
      pay("payment:L7", "paid", { email: "nobody@example.test", amount_cents: 100 }),
      pay("payment:L8", "paid", { email: "sol@example.test", currency: "CAD", amount_cents: 100 }),
    ];
    for (const c of cases) await hear(r, flows, c.facts, c.event);
    expect(await collected(d.id)).toBe(0);
    await pg.db.update(pipelineDeals).set({ status: "lost" }).where(eq(pipelineDeals.id, d.id));
    const open = pay("payment:L9", "paid", { email: "sol@example.test", amount_cents: 100 });
    await hear(r, flows, open.facts, open.event);
    expect(await collected(d.id)).toBe(0);
  });

  it("never goes below zero", async () => {
    const { deal: d } = await deal("tia@example.test");
    const refund = pay("payment:L10:refunded", "refunded", {
      email: "tia@example.test",
      refunded_cents: 900,
    });
    await hear(rig(), [MONEY_WORKFLOW], refund.facts, refund.event);
    expect(await collected(d.id)).toBe(0);
  });
});
