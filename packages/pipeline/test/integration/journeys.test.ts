/**
 * Journeys on the executor, on a real Postgres (designs/2026-10-19-business-map.md): the shape
 * workflows walk with the real store and the real steps, no Restate. One shape per database, so
 * the tests run in order and each new version builds on the one before. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import {
  type ExecutorEvent,
  type Fired,
  heardAs,
  hearersOf,
  pgExecutorStore,
  type Walk,
  walk,
} from "@wren/core/executor";
import { resolveProfile, setTraits } from "@wren/core/profiles";
import { profileEvents } from "@wren/core/profiles-schema";
import { events } from "@wren/core/schema";
import { type Rule, recomputeLive, saveSegment, segmentMembers } from "@wren/core/segments";
import { segmentsPass } from "@wren/core/segments-pass";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropJourney, shapeWorkflowsOf } from "../../src/journeys.js";
import { moveEmit, openEmit } from "../../src/moves.js";
import { instances, offerVersions, pipelineDeals } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { addTerms, saveShape } from "../../src/store.js";
import { asMetro, flow, grown, shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
let group: number;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(offerVersions).values({
    offer: "offer-a",
    number: 1,
    hash: "1".repeat(64),
    body: {} as never,
    why: "t",
    createdBy: "t",
  });
  await addTerms(pg.db, {
    offer: "offer-a",
    plan: "standard",
    from: "2026-01-01",
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
    why: "t",
    by: "t",
  });
  group = (
    await saveSegment(
      pg.db,
      {
        name: "Pro grp",
        kind: "live",
        rule: groupRule({ kind: "trait", key: "plan", op: "is", value: "grp-pro" }),
      },
      "t",
      NOW,
    )
  ).segment.id;
  await save(shape(), "first");
});
afterAll(() => pg.stop());

const NOW = new Date("2026-10-19T12:00:00Z");
const groupRule = (...of: Rule["of"]): Rule => ({ kind: "group", match: "all", of });

const save = (body = shape(), note = "next", moves?: Record<string, string>) =>
  saveShape(pg.db, {
    body: asMetro(body),
    note,
    by: "t",
    triggers: TRIGGERS,
    ...(moves ? { moves } : {}),
  });

async function person(email: string, name = "Ada") {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name });
  if (!r) throw new Error("no profile");
  return r.id;
}

/** A walk on the real store and steps. Fired events are collected, not sent. */
function rig() {
  const fired: Fired[] = [];
  const w: Walk = {
    flows: new Map(),
    parts: new Map(),
    steps: journeySteps({ db: () => pg.db }),
    store: pgExecutorStore(pg.db),
    client: null,
    by: "test",
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: (req) => fired.push(req),
  };
  return { w, fired };
}

/** The workspace's shape workflows. */
const flowsOf = () => shapeWorkflowsOf(pg.db, "wren");

/** What `Executor/fire` does: walk the event from every trigger node that hears the facts. */
async function hear(
  r: ReturnType<typeof rig>,
  flows: Workflow[],
  facts: Fired["facts"],
  event: ExecutorEvent,
) {
  // Each call to the executor is its own invocation: a claim by another owner is refused.
  const w: Walk = { ...r.w, by: randomUUID(), flows: new Map(flows.map((f) => [f.id, f])) };
  const tallies = [];
  for (const h of hearersOf(flows, facts))
    tallies.push(await walk(w, h.workflow, h.from, [heardAs(h, event)]));
  return tallies;
}

/** Walk an event that starts at a workflow input (`Executor/emit`). */
async function emit(
  r: ReturnType<typeof rig>,
  flows: Workflow[],
  e: { workflow: string; from: string; events: ExecutorEvent[] },
) {
  const w: Walk = { ...r.w, by: randomUUID(), flows: new Map(flows.map((f) => [f.id, f])) };
  return walk(w, e.workflow, e.from, e.events);
}

const reply = (n: number, email: string): ExecutorEvent => ({
  subject: `reply:email:${n}`,
  kind: "reply",
  data: { email, channel: "email" },
});
const booking = (n: number, email: string): ExecutorEvent => ({
  subject: `call:${n}`,
  kind: "call",
  data: { email, name: "Ada" },
});
const signed = (n: number, email: string): ExecutorEvent => ({
  subject: `doc:${n}`,
  kind: "document",
  data: { email, change: "signed" },
});
const REPLY = { trigger: "trigger.reply", channel: "email" } as const;
const BOOKING = { trigger: "trigger.booking", change: "booked" } as const;
const SIGNED = { trigger: "trigger.document", change: "signed", kind: "contract" } as const;

/** The person's newest journey. */
const journeyOf = async (profile: number) => {
  const rows = await pg.db
    .select()
    .from(instances)
    .where(eq(instances.profileId, profile))
    .orderBy(asc(instances.openedAt));
  return rows.at(-1);
};
const arrivals = (workflow: string, node: string, journey?: string) =>
  pg.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workflow, workflow),
        eq(events.node, node),
        journey ? eq(events.subject, `journey:${journey}`) : undefined,
      ),
    );

describe("a journey through the shape", () => {
  it("opens, moves forward, records a skip, makes the deal at the offer and signs the plan", async () => {
    const profile = await person("ada@example.test");
    const r = rig();
    const flows = await flowsOf();

    await hear(r, flows, REPLY, reply(1, "ada@example.test"));
    let j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "engaged", status: "open", entry: "mail", version: 1 });
    expect(j?.trail).toMatchObject([{ edge: "mail_to_engaged", from: "mail", to: "engaged" }]);
    expect(j?.entryRef).toMatchObject({ subject: "reply:email:1", cause: { kind: "reply" } });
    expect(r.fired.map((f) => f.facts)).toEqual([
      { trigger: "trigger.journey", node: "engaged", change: "entered" },
    ]);
    expect(r.fired[0]?.event.subject).toBe(`journey:${j?.id}`);

    await hear(r, flows, BOOKING, booking(1, "ada@example.test"));
    j = await journeyOf(profile);
    expect(j?.node).toBe("booked");

    // Signed passes over "proposal": the skip is told once.
    await hear(r, flows, SIGNED, signed(1, "ada@example.test"));
    j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "signed", status: "open" });
    expect(j?.trail.map((c) => c.to)).toEqual(["engaged", "booked", "proposal", "signed"]);
    expect(
      r.fired.slice(-2).map((f) => {
        const x = f.facts as unknown as Record<string, unknown>;
        return [x.trigger, x.node, x.change];
      }),
    ).toEqual([
      ["trigger.journey", "signed", "entered"],
      ["trigger.journey", "proposal", "skipped"],
    ]);
    // Only an offer node's arrival says a deal was won; webhooks add `deal.won` for it.
    expect(r.fired.slice(-2).map((f) => (f.facts as unknown as { sale?: boolean }).sale)).toEqual([
      true,
      undefined,
    ]);
    expect(
      r.fired.slice(0, -2).some((f) => "sale" in (f.facts as unknown as Record<string, unknown>)),
    ).toBe(false);

    // One arrival per node reached, none for the skipped one.
    for (const [node, n] of [
      ["s_engaged", 1],
      ["s_booked", 1],
      ["s_proposal", 0],
      ["s_signed", 1],
    ] as const)
      expect(await arrivals("shape.v1", node, j?.id)).toHaveLength(n);
    const moved = await arrivals("shape.v1", "s_signed", j?.id);
    expect(moved[0]?.data).toMatchObject({
      from: "booked",
      to: "signed",
      skipped: ["proposal"],
      edges: ["booked_to_proposal", "proposal_to_signed"],
    });

    // The Executions list titles the journey by person and node (migration 0306).
    const [row] = await pg.db.execute<{ title: string; person: string }>(
      sql`select title, person from executions where subject = ${`journey:${j?.id}`} and workflow = 'shape.v1'`,
    );
    expect(row).toEqual({ title: "Ada: signed", person: "Ada" });

    // The deal: the offer's newest version, once, with no terms until the plan.
    const deals = await pg.db
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.journey, j?.id as string));
    expect(deals).toMatchObject([
      {
        offer: "offer-a",
        offerVersion: 1,
        node: "signed",
        profileId: profile,
        status: "open",
        termsVersion: null,
      },
    ]);

    // A hand move to the plan node signs the deal under the plan's live terms and ends the journey.
    const plan = await moveEmit(pg.db, { journey: j?.id as string, to: "standard", by: "tester" });
    await emit(r, flows, plan);
    j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "standard", status: "done" });
    expect(j?.closedAt).toBeInstanceOf(Date);
    const [deal] = await pg.db
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.journey, j?.id as string));
    expect(deal?.termsVersion).not.toBeNull();

    // The timeline shows each node reached.
    const lines = await pg.db
      .select()
      .from(profileEvents)
      .where(and(eq(profileEvents.profileId, profile), eq(profileEvents.kind, "journey")));
    expect(lines.map((l) => l.summary).sort()).toEqual([
      "Booked in Test shape",
      "Engaged in Test shape",
      "Signed in Test shape",
      "Standard in Test shape",
    ]);
  });

  it("makes no second arrival or move for the same cause, or for another at the same node", async () => {
    const profile = await person("bo@example.test");
    const r = rig();
    const flows = await flowsOf();

    await hear(r, flows, REPLY, reply(2, "bo@example.test"));
    const first = await journeyOf(profile);
    const told = r.fired.length;

    // The same cause: the executor refuses the arrival.
    const again = await hear(r, flows, REPLY, reply(2, "bo@example.test"));
    expect(again[0]).toMatchObject({ arrived: 0, seen: 1 });
    // Another cause for the node it is at: the guard holds it still.
    await hear(r, flows, REPLY, reply(3, "bo@example.test"));

    expect(
      await pg.db.select().from(instances).where(eq(instances.profileId, profile)),
    ).toHaveLength(1);
    expect(await journeyOf(profile)).toEqual(first);
    expect(await arrivals("shape.v1", "s_engaged", first?.id)).toHaveLength(1);
    expect(r.fired).toHaveLength(told);
  });

  it("does not move backward, and opens only at an entry node", async () => {
    const profile = await person("cy@example.test");
    const r = rig();
    const flows = await flowsOf();

    // A booking for someone with no journey: "booked" is no entry node, so nothing opens.
    await hear(r, flows, BOOKING, booking(10, "cy@example.test"));
    expect(await journeyOf(profile)).toBeUndefined();

    await hear(r, flows, REPLY, reply(10, "cy@example.test"));
    await hear(r, flows, BOOKING, booking(11, "cy@example.test"));
    expect((await journeyOf(profile))?.node).toBe("booked");
    // A later reply points at an earlier node: still booked.
    await hear(r, flows, REPLY, reply(11, "cy@example.test"));
    expect((await journeyOf(profile))?.node).toBe("booked");
  });

  it("opens nothing for someone it cannot find", async () => {
    const before = await pg.db.select().from(instances);
    const r = rig();
    // No key names a person: the arrival is the only record.
    const t = await hear(r, await flowsOf(), REPLY, {
      subject: "reply:email:21",
      kind: "reply",
      data: { channel: "email" },
    });
    expect(t[0]).toMatchObject({ arrived: 1 });
    expect(await pg.db.select().from(instances)).toHaveLength(before.length);
  });

  it("a journey move wakes the segments pass", async () => {
    const [t] = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from pg_trigger where tgname = 'instances_segments_wake'`,
    );
    expect(t?.n).toBe(1);
  });
});

describe("a new version", () => {
  /** v2: a node between booked and proposal, a manual source into signed, a group source into
   *  booked, and a second offer node with no offer version behind it. */
  const v2 = () => {
    const next = grown(
      [
        { id: "mid", kind: "step", name: "Mid", action: "other", advance: [] },
        { id: "partner", kind: "source", name: "Partner", via: "manual" },
        { id: "warm", kind: "source", name: "Warm", via: "group", group: String(group) },
        { id: "other", kind: "offer", name: "Other", offer: "offer-none", advance: [] },
      ],
      [
        flow("booked", "mid"),
        flow("mid", "proposal"),
        flow("partner", "signed"),
        flow("warm", "booked"),
        flow("proposal", "other"),
      ],
    );
    next.edges = next.edges.filter((e) => e.id !== "booked_to_proposal");
    return next;
  };

  it("carries open instances in the same write, and the new version moves them", async () => {
    const profile = await person("hal@example.test");
    const r = rig();
    await hear(r, await flowsOf(), REPLY, reply(51, "hal@example.test"));
    const before = await journeyOf(profile);
    expect(before).toMatchObject({ version: 1, node: "engaged" });

    const saved = await save(v2(), "add mid, partner, warm, other");
    expect(saved.number).toBe(2);

    const after = await journeyOf(profile);
    expect(after).toMatchObject({ version: 2, node: "engaged", status: "open" });
    expect(after?.movedAt).toEqual(before?.movedAt);
    const carried = await arrivals("shape.v2", "s_engaged", before?.id);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ kind: "journey", by: "carry" });
    expect(carried[0]?.data).toMatchObject({ to: "engaged", cause: { kind: "version", ref: "1" } });
    // Everything carried: version 1 left the list.
    expect((await flowsOf()).map((f) => f.id)).toEqual(["shape.v2"]);

    // A cause now moves it on version 2.
    await hear(r, await flowsOf(), BOOKING, booking(50, "hal@example.test"));
    expect(await journeyOf(profile)).toMatchObject({ version: 2, node: "booked" });
    expect(await arrivals("shape.v2", "s_booked", before?.id)).toHaveLength(1);
    expect(await arrivals("shape.v1", "s_booked", before?.id)).toHaveLength(0);
  });

  it("a manual source feeds its node only by hand, never from that node's trigger", async () => {
    const profile = await person("di@example.test");
    const r = rig();
    const flows = await flowsOf();
    await hear(r, flows, SIGNED, signed(40, "di@example.test"));
    expect(await journeyOf(profile)).toBeUndefined();

    const open = await openEmit(pg.db, {
      person: "di@example.test",
      at: "signed",
      entry: "partner",
      by: "tester",
    });
    await emit(r, flows, open);
    const j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "signed", status: "open", entry: "partner", version: 2 });
    expect(j?.trail).toMatchObject([{ edge: "partner_to_signed", from: "partner", to: "signed" }]);
    expect(j?.entryRef).toMatchObject({ cause: { kind: "manual", ref: "tester" } });
    // The offer node made its deal.
    expect(
      await pg.db
        .select()
        .from(pipelineDeals)
        .where(eq(pipelineDeals.journey, j?.id as string)),
    ).toMatchObject([{ offer: "offer-a", node: "signed" }]);
  });

  it("a group source opens a journey when a person enters the group", async () => {
    const profile = await person("moe@example.test");
    const flows = await flowsOf();
    expect(flows[0]?.nodes.some((n) => n.uses === "trigger.segment")).toBe(true);

    // First pass starts at the newest rows: history is never told.
    const first = await segmentsPass(pg.db, null, flows, NOW, null);
    await setTraits(pg.db, profile, { plan: "grp-pro" }, "t", NOW);
    const second = await segmentsPass(pg.db, null, flows, NOW, first.cursor);
    const fires = second.fires.filter((f) => f.facts.trigger === "trigger.segment");
    expect(fires).toHaveLength(1);

    const r = rig();
    for (const f of fires) await hear(r, flows, f.facts, f.event);
    const j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "booked", status: "open", entry: "warm" });
    expect(j?.entryRef).toMatchObject({ cause: { kind: "group", ref: String(group) } });

    // Told twice, it opens nothing new: the same event at the same node is heard once.
    await dropJourney(pg.db, { journey: j?.id as string, reason: "test" });
    for (const f of fires) await hear(r, flows, f.facts, f.event);
    expect((await journeyOf(profile))?.status).toBe("dropped");
  });

  it("a person who leaves the group and enters it again opens a new journey; the old one stays closed", async () => {
    const flows = await flowsOf();
    const r = rig();
    const told = async (cursor: Awaited<ReturnType<typeof segmentsPass>>["cursor"] | null) => {
      const pass = await segmentsPass(pg.db, null, flows, NOW, cursor);
      for (const f of pass.fires.filter((x) => x.facts.trigger === "trigger.segment"))
        await hear(r, flows, f.facts, f.event);
      return pass.cursor;
    };
    const all = (profile: number) =>
      pg.db
        .select()
        .from(instances)
        .where(eq(instances.profileId, profile))
        .orderBy(asc(instances.openedAt));

    // One person's first journey is dropped, the other's is done. Each leaves and comes back.
    const dropped = await person("rea@example.test");
    const done = await person("reb@example.test");
    let cursor = await told(null);
    for (const p of [dropped, done]) await setTraits(pg.db, p, { plan: "grp-pro" }, "t", NOW);
    cursor = await told(cursor);
    const [d1] = await all(dropped);
    const [n1] = await all(done);
    expect(d1).toMatchObject({ node: "booked", status: "open", entry: "warm" });
    expect(n1).toMatchObject({ node: "booked", status: "open", entry: "warm" });

    await dropJourney(pg.db, { journey: d1?.id as string, reason: "not now" });
    await emit(
      r,
      await flowsOf(),
      await moveEmit(pg.db, { journey: n1?.id as string, to: "other", by: "t" }),
    );
    expect((await all(done))[0]).toMatchObject({ node: "other", status: "done" });

    // They leave: the group's entry trigger hears entries only, so nothing opens.
    for (const p of [dropped, done]) await setTraits(pg.db, p, { plan: "grp-free" }, "t", NOW);
    cursor = await told(cursor);
    expect(await all(dropped)).toHaveLength(1);
    expect(await all(done)).toHaveLength(1);

    // They enter again: a new journey each, at the group source's node; the old ones stay closed.
    for (const p of [dropped, done]) await setTraits(pg.db, p, { plan: "grp-pro" }, "t", NOW);
    cursor = await told(cursor);
    const again = await all(dropped);
    expect(again).toHaveLength(2);
    expect(again[0]).toMatchObject({ id: d1?.id, status: "dropped" });
    expect(again[1]).toMatchObject({ node: "booked", status: "open", entry: "warm" });
    const second = await all(done);
    expect(second).toHaveLength(2);
    expect(second[0]).toMatchObject({ id: n1?.id, node: "other", status: "done" });
    expect(second[1]).toMatchObject({ node: "booked", status: "open", entry: "warm" });
    // Both journeys name the group as their cause; the second names its own entry.
    expect(again[1]?.entryRef).toMatchObject({ cause: { kind: "group", ref: String(group) } });
    expect(again[1]?.entryRef).not.toEqual(again[0]?.entryRef);

    // The same entry told twice opens nothing more: it is one entry.
    await told(cursor);
    expect(await all(dropped)).toHaveLength(2);
  });

  it("makes no deal while the offer has no version", async () => {
    const profile = await person("ed@example.test");
    const r = rig();
    const flows = await flowsOf();
    await hear(r, flows, REPLY, reply(30, "ed@example.test"));
    const open = await journeyOf(profile);
    await emit(
      r,
      flows,
      await moveEmit(pg.db, { journey: open?.id as string, to: "other", by: "t" }),
    );
    const j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "other", status: "done" });
    expect(
      await pg.db
        .select()
        .from(pipelineDeals)
        .where(eq(pipelineDeals.journey, j?.id as string)),
    ).toHaveLength(0);
  });

  it("leaves an older version to move a journey that is still on it", async () => {
    const profile = await person("gil@example.test");
    const r = rig();
    const flows = await flowsOf();
    await hear(r, flows, REPLY, reply(60, "gil@example.test"));
    const open = await journeyOf(profile);
    await emit(
      r,
      flows,
      await moveEmit(pg.db, { journey: open?.id as string, to: "mid", by: "t" }),
    );
    expect(await journeyOf(profile)).toMatchObject({ version: 2, node: "mid" });

    // v3 drops "mid": the journey cannot go with it, so it stays on version 2.
    const v3 = await save(shape(), "drop mid, partner, warm, other");
    expect(v3.number).toBe(3);
    expect(await journeyOf(profile)).toMatchObject({ version: 2, node: "mid", status: "open" });
    const both = await flowsOf();
    expect(both.map((f) => f.id)).toEqual(["shape.v2", "shape.v3"]);

    // Both versions hear the signing; only version 2's node acts for a journey on version 2.
    await hear(r, both, SIGNED, signed(60, "gil@example.test"));
    expect(await journeyOf(profile)).toMatchObject({ version: 2, node: "signed" });
    expect(await arrivals("shape.v2", "s_signed", open?.id)).toHaveLength(1);
    expect(await arrivals("shape.v3", "s_signed", open?.id)).toHaveLength(0);
  });
});

describe("a drop", () => {
  it("closes the journey, tells the executor at the dropped node, and fires a dropped change", async () => {
    const profile = await person("ivy@example.test");
    const r = rig();
    const flows = await flowsOf();
    await hear(r, flows, REPLY, reply(70, "ivy@example.test"));
    const j = await journeyOf(profile);
    expect(j?.version).toBe(3);
    r.fired.length = 0;

    const drop = await dropJourney(pg.db, {
      journey: j?.id as string,
      reason: "not a fit",
      by: "tester",
    });
    expect(drop).toMatchObject({ workflow: "shape.v3", from: "in.dropped" });
    expect(await journeyOf(profile)).toMatchObject({
      status: "dropped",
      dropReason: "not a fit",
    });
    // A closed journey cannot be dropped twice.
    expect(await dropJourney(pg.db, { journey: j?.id as string, reason: "again" })).toBeNull();

    if (!drop) throw new Error("no drop");
    await emit(r, flows, drop);
    expect(await arrivals("shape.v3", "dropped", j?.id)).toHaveLength(1);
    expect(r.fired.map((f) => f.facts)).toEqual([
      { trigger: "trigger.journey", node: "engaged", change: "dropped" },
    ]);
    const lines = await pg.db
      .select()
      .from(profileEvents)
      .where(and(eq(profileEvents.profileId, profile), like(profileEvents.summary, "Dropped%")));
    expect(lines).toMatchObject([
      { summary: "Dropped from Test shape at Engaged", body: "not a fit" },
    ]);
  });
});

describe("groups over journeys", () => {
  it("a live group over a node gains a member after a move; reached stays true after", async () => {
    const profile = await person("kim@example.test");
    const other = await person("lee@example.test");
    const rule = (c: Rule["of"][number]) => groupRule(c);
    const atBooked = (
      await saveSegment(
        pg.db,
        {
          name: "At booked",
          kind: "live",
          rule: rule({ kind: "journey", node: "booked", days: null }),
        },
        "t",
        NOW,
      )
    ).segment;
    const pastEngaged = (
      await saveSegment(
        pg.db,
        {
          name: "Through engaged",
          kind: "live",
          rule: rule({
            kind: "journey",
            node: "engaged",
            reached: true,
            status: "open",
            days: null,
          }),
        },
        "t",
        NOW,
      )
    ).segment;
    // An older saved rule names a funnel and a stage: it still reads as the node.
    const legacy = (
      await saveSegment(
        pg.db,
        {
          name: "Legacy booked",
          kind: "live",
          rule: rule({ kind: "journey", funnel: "old", stage: "booked", days: null } as never),
        },
        "t",
        NOW,
      )
    ).segment;
    const members = async (id: number) => (await segmentMembers(pg.db, id)).map((m) => m.profileId);
    // Earlier tests left people on the shape: look at these two only.
    await recomputeLive(pg.db, NOW);
    expect(await members(atBooked.id)).not.toContain(profile);

    const r = rig();
    const flows = await flowsOf();
    await hear(r, flows, REPLY, reply(80, "kim@example.test"));
    await recomputeLive(pg.db, NOW);
    expect(await members(atBooked.id)).not.toContain(profile);
    expect(await members(pastEngaged.id)).toContain(profile);

    await hear(r, flows, BOOKING, booking(80, "kim@example.test"));
    await recomputeLive(pg.db, NOW);
    expect(await members(atBooked.id)).toContain(profile);
    expect(await members(legacy.id)).toContain(profile);
    // Moving on is "reached" still; a person with no journey is in none.
    expect(await members(pastEngaged.id)).toContain(profile);
    for (const g of [atBooked, pastEngaged, legacy])
      expect(await members(g.id)).not.toContain(other);
  });
});
