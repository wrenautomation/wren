/**
 * Journeys on the spine, on a real Postgres (designs/2026-10-18-journeys.md): the generated
 * funnel workflows walk with the real store and the real steps, no Restate. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { resolveProfile } from "@wren/core/profiles";
import { profileEvents } from "@wren/core/profiles-schema";
import { events } from "@wren/core/schema";
import {
  type Fired,
  hearersOf,
  pgSpineStore,
  type SpineEvent,
  type Walk,
  walk,
} from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { carryJourneys } from "../../src/carry.js";
import { dropJourney, funnelWorkflowsOf } from "../../src/journeys.js";
import type { FunnelBody } from "../../src/model.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
} from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { appendFunnel } from "../../src/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const body = (over: Partial<FunnelBody> = {}): FunnelBody => ({
  name: "Test funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
    { key: "booked", label: "Booked", on: [{ trigger: "trigger.booking" }] },
    { key: "proposal", label: "Proposal", on: [] },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [{ id: "mail", kind: "outbound", channel: "email" }],
  ...over,
});

async function funnel(id: string, b: FunnelBody, status: "live" | "off" = "live") {
  await pg.db.insert(funnels).values({ id, name: b.name, status });
  await pg.db
    .insert(funnelVersions)
    .values({ funnel: id, number: 1, body: b, why: "first", createdBy: "t" });
}

async function person(email: string) {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name: "Ada" });
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

/** The workspace's funnel workflows for these funnels only. */
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
  // Each call to the spine is its own invocation: a claim by another owner is refused.
  const w: Walk = { ...r.w, by: randomUUID(), flows: new Map(flows.map((f) => [f.id, f])) };
  const tallies = [];
  for (const h of hearersOf(flows, facts)) tallies.push(await walk(w, h.workflow, h.from, [event]));
  return tallies;
}

const reply = (n: number, email: string): SpineEvent => ({
  subject: `reply:email:${n}`,
  kind: "reply",
  data: { email, channel: "email" },
});
const REPLY = { trigger: "trigger.reply", channel: "email" } as const;
const BOOKING = { trigger: "trigger.booking", change: "booked" } as const;
const SIGNED = { trigger: "trigger.document", change: "signed", kind: "contract" } as const;

const journeyOf = async (profile: number, id: string) => {
  const [j] = await pg.db
    .select()
    .from(journeys)
    .where(and(eq(journeys.profileId, profile), eq(journeys.funnel, id)));
  return j;
};
const arrivals = (workflow: string, node: string) =>
  pg.db
    .select()
    .from(events)
    .where(and(eq(events.workflow, workflow), eq(events.node, node)));

describe("a journey through a funnel", () => {
  it("opens, moves forward, records a skip, and makes the deal at the sale stage", async () => {
    await funnel("alpha", body());
    await pg.db.insert(offerVersions).values({
      offer: "offer-a",
      number: 1,
      hash: "1".repeat(64),
      body: {} as never,
      why: "t",
      createdBy: "t",
    });
    const profile = await person("ada@example.test");
    const r = rig();
    const flows = await flowsOf("alpha");

    await hear(r, flows, REPLY, reply(1, "ada@example.test"));
    let j = await journeyOf(profile, "alpha");
    expect(j).toMatchObject({ stage: "engaged", status: "open", entry: "mail", version: 1 });
    expect(j?.entryRef).toMatchObject({ subject: "reply:email:1", cause: { kind: "reply" } });
    expect(r.fired.map((f) => f.facts)).toEqual([
      { trigger: "trigger.journey", funnel: "alpha", stage: "engaged", change: "entered" },
    ]);
    expect(r.fired[0]?.event.subject).toBe(`journey:${j?.id}`);

    await hear(r, flows, BOOKING, {
      subject: "call:1",
      kind: "call",
      data: { email: "ada@example.test", name: "Ada" },
    });
    j = await journeyOf(profile, "alpha");
    expect(j?.stage).toBe("booked");

    // Signed passes over "proposal": the skip is told once.
    await hear(r, flows, SIGNED, {
      subject: "doc:1",
      kind: "document",
      data: { email: "ada@example.test" },
    });
    j = await journeyOf(profile, "alpha");
    expect(j).toMatchObject({ stage: "signed", status: "done" });
    expect(j?.closedAt).toBeInstanceOf(Date);
    expect(
      r.fired
        .slice(-2)
        .map((f) => [
          f.facts.trigger,
          "stage" in f.facts && f.facts.stage,
          "change" in f.facts && f.facts.change,
        ]),
    ).toEqual([
      ["trigger.journey", "signed", "entered"],
      ["trigger.journey", "proposal", "skipped"],
    ]);

    // One arrival per stage reached, none for the skipped one.
    for (const [node, n] of [
      ["s_engaged", 1],
      ["s_booked", 1],
      ["s_proposal", 0],
      ["s_signed", 1],
    ] as const)
      expect(await arrivals("funnel.alpha.v1", node)).toHaveLength(n);
    const moved = await arrivals("funnel.alpha.v1", "s_signed");
    expect(moved[0]?.subject).toBe(`journey:${j?.id}`);
    expect(moved[0]?.data).toMatchObject({ from: "booked", to: "signed", skipped: ["proposal"] });

    // The Executions list titles the journey by person, funnel and stage (migration 0297).
    const [row] = await pg.db.execute<{ title: string; person: string }>(
      sql`select title, person from spine_executions where subject = ${`journey:${j?.id}`} and workflow = 'funnel.alpha.v1'`,
    );
    expect(row).toEqual({ title: "Ada: alpha at signed", person: "Ada" });

    // The deal: the offer's newest version, once.
    const deals = await pg.db
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.journey, j?.id as string));
    expect(deals).toMatchObject([
      { offer: "offer-a", offerVersion: 1, profileId: profile, status: "open" },
    ]);

    // The timeline shows each stage.
    const lines = await pg.db
      .select()
      .from(profileEvents)
      .where(and(eq(profileEvents.profileId, profile), eq(profileEvents.kind, "journey")));
    expect(lines.map((l) => l.summary).sort()).toEqual([
      "Booked in Test funnel",
      "Engaged in Test funnel",
      "Signed in Test funnel",
    ]);
  });

  it("makes no second arrival or move for the same cause, or for another at the same stage", async () => {
    await funnel("beta", body());
    const profile = await person("bo@example.test");
    const r = rig();
    const flows = await flowsOf("beta");

    await hear(r, flows, REPLY, reply(1, "bo@example.test"));
    const first = await journeyOf(profile, "beta");
    const told = r.fired.length;

    // The same cause: the spine refuses the arrival.
    const again = await hear(r, flows, REPLY, reply(1, "bo@example.test"));
    expect(again[0]).toMatchObject({ arrived: 0, seen: 1 });
    // Another cause for the stage it is at: the guard holds it still.
    await hear(r, flows, REPLY, reply(2, "bo@example.test"));

    expect(await pg.db.select().from(journeys).where(eq(journeys.profileId, profile))).toHaveLength(
      1,
    );
    expect(await journeyOf(profile, "beta")).toEqual(first);
    expect(await arrivals("funnel.beta.v1", "s_engaged")).toHaveLength(1);
    expect(r.fired).toHaveLength(told);
  });

  it("does not move backward, and opens only at an entry stage", async () => {
    await funnel("gamma", body());
    const profile = await person("cy@example.test");
    const r = rig();
    const flows = await flowsOf("gamma");

    // A booking for someone with no journey: "booked" is no entry stage, so nothing opens.
    const booking = (n: number): SpineEvent => ({
      subject: `call:${n}`,
      kind: "call",
      data: { email: "cy@example.test" },
    });
    await hear(r, flows, BOOKING, booking(10));
    expect(await journeyOf(profile, "gamma")).toBeUndefined();

    await hear(r, flows, REPLY, reply(10, "cy@example.test"));
    await hear(r, flows, BOOKING, booking(11));
    expect((await journeyOf(profile, "gamma"))?.stage).toBe("booked");
    // A later reply points at an earlier stage: still booked.
    await hear(r, flows, REPLY, reply(11, "cy@example.test"));
    expect((await journeyOf(profile, "gamma"))?.stage).toBe("booked");
  });

  it("opens nothing in a funnel that is off, nor for someone it cannot find", async () => {
    await funnel("eta", body(), "off");
    const profile = await person("di@example.test");
    const r = rig();
    const flows = await flowsOf("eta");
    await hear(r, flows, REPLY, reply(20, "di@example.test"));
    expect(await journeyOf(profile, "eta")).toBeUndefined();

    await funnel("theta", body());
    const live = await flowsOf("theta");
    // No key names a person: the arrival is the only record.
    const t = await hear(r, live, REPLY, {
      subject: "reply:email:21",
      kind: "reply",
      data: { channel: "email" },
    });
    expect(t[0]).toMatchObject({ arrived: 1 });
    expect(await pg.db.select().from(journeys).where(eq(journeys.funnel, "theta"))).toHaveLength(0);
  });

  it("makes no deal while the offer has no version", async () => {
    await funnel("iota", body({ offer: "offer-none" }));
    const profile = await person("ed@example.test");
    const r = rig();
    const flows = await flowsOf("iota");
    await hear(r, flows, REPLY, reply(30, "ed@example.test"));
    await hear(r, flows, SIGNED, {
      subject: "doc:30",
      kind: "document",
      data: { email: "ed@example.test" },
    });
    const j = await journeyOf(profile, "iota");
    expect(j).toMatchObject({ stage: "signed", status: "done" });
    expect(
      await pg.db
        .select()
        .from(pipelineDeals)
        .where(eq(pipelineDeals.journey, j?.id as string)),
    ).toHaveLength(0);
  });
});

describe("composition", () => {
  it("opens funnel B from funnel A's sale stage through trigger.journey", async () => {
    await funnel("src", body());
    await funnel("next", {
      name: "Next funnel",
      offer: "offer-a",
      stages: [
        { key: "welcome", label: "Welcome", on: [] },
        { key: "paid", label: "Paid", sale: true, on: [] },
      ],
      entries: [{ id: "after_src", kind: "funnel", funnel: { id: "src" } }],
    });
    const profile = await person("flo@example.test");
    const r = rig();
    const flows = await flowsOf("src", "next");

    await hear(r, flows, REPLY, reply(40, "flo@example.test"));
    await hear(r, flows, SIGNED, {
      subject: "doc:40",
      kind: "document",
      data: { email: "flo@example.test" },
    });
    expect((await journeyOf(profile, "src"))?.stage).toBe("signed");
    // Nothing entered B on the first fire: B hears the sale stage only.
    expect(await journeyOf(profile, "next")).toBeUndefined();

    // Spine/fire for each journey event the stage steps told.
    for (const f of r.fired) await hear(r, flows, f.facts, f.event);
    const b = await journeyOf(profile, "next");
    expect(b).toMatchObject({ stage: "welcome", status: "open", entry: "after_src" });
    expect(b?.entryRef).toMatchObject({ cause: { kind: "funnel" } });
    // A's journey is not B's: they have their own rows and subjects.
    expect(b?.id).not.toBe((await journeyOf(profile, "src"))?.id);
    expect(await arrivals("funnel.next.v1", "s_welcome")).toHaveLength(1);
  });
});

describe("a new version", () => {
  it("appendFunnel carries open journeys in the same write", async () => {
    await funnel("echo", body());
    const profile = await person("hal@example.test");
    await hear(rig(), await flowsOf("echo"), REPLY, reply(51, "hal@example.test"));
    const next = body();
    next.stages.push({ key: "upsell", label: "Upsell", on: [] });
    const triggers = new Set(["trigger.reply", "trigger.booking", "trigger.document"]);
    const v2 = await appendFunnel(pg.db, "echo", next, "add upsell", "t", triggers);
    expect(v2.number).toBe(2);
    expect(await journeyOf(profile, "echo")).toMatchObject({ version: 2, stage: "engaged" });
    expect(await arrivals("funnel.echo.v2", "s_engaged")).toHaveLength(1);
  });

  it("carries open journeys to it, with a version event, and the new version moves them", async () => {
    await funnel("delta", body());
    const profile = await person("gil@example.test");
    const r = rig();
    await hear(r, await flowsOf("delta"), REPLY, reply(50, "gil@example.test"));
    const before = await journeyOf(profile, "delta");
    expect(before?.version).toBe(1);

    const next = body();
    next.stages.push({ key: "upsell", label: "Upsell", on: [] });
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "delta", number: 2, body: next, why: "add upsell", createdBy: "t" });

    // Until carried, version 1 is listed because it still holds the journey.
    expect((await flowsOf("delta")).map((f) => f.id)).toEqual([
      "funnel.delta.v1",
      "funnel.delta.v2",
    ]);
    expect(await carryJourneys(pg.db, "delta", 2)).toBe(1);
    expect(await carryJourneys(pg.db, "delta", 2)).toBe(0);
    expect((await flowsOf("delta")).map((f) => f.id)).toEqual(["funnel.delta.v2"]);

    const after = await journeyOf(profile, "delta");
    expect(after).toMatchObject({ version: 2, stage: "engaged", status: "open" });
    expect(after?.movedAt).toEqual(before?.movedAt);
    const carried = await arrivals("funnel.delta.v2", "s_engaged");
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({
      subject: `journey:${before?.id}`,
      kind: "journey",
      by: "carry",
    });
    expect(carried[0]?.data).toMatchObject({ to: "engaged", cause: { kind: "version", ref: "1" } });

    // A cause now moves it on version 2.
    await hear(r, await flowsOf("delta"), BOOKING, {
      subject: "call:50",
      kind: "call",
      data: { email: "gil@example.test" },
    });
    expect(await journeyOf(profile, "delta")).toMatchObject({ version: 2, stage: "booked" });
    expect(await arrivals("funnel.delta.v2", "s_booked")).toHaveLength(1);
    expect(await arrivals("funnel.delta.v1", "s_booked")).toHaveLength(0);
  });

  it("leaves an older version to move a journey that is still on it", async () => {
    await funnel("kappa", body());
    const profile = await person("hal@example.test");
    const r = rig();
    await hear(r, await flowsOf("kappa"), REPLY, reply(60, "hal@example.test"));
    await pg.db
      .insert(funnelVersions)
      .values({ funnel: "kappa", number: 2, body: body(), why: "same", createdBy: "t" });
    // Not carried yet: both versions hear the booking, only version 1's node acts.
    const flows = await flowsOf("kappa");
    await hear(r, flows, BOOKING, {
      subject: "call:60",
      kind: "call",
      data: { email: "hal@example.test" },
    });
    expect(await journeyOf(profile, "kappa")).toMatchObject({ version: 1, stage: "booked" });
    expect(await arrivals("funnel.kappa.v2", "s_booked")).toHaveLength(0);
  });
});

describe("a drop", () => {
  it("closes the journey, tells the spine at the dropped node, and fires a dropped change", async () => {
    await funnel("lambda", body());
    const profile = await person("ivy@example.test");
    const r = rig();
    const flows = await flowsOf("lambda");
    await hear(r, flows, REPLY, reply(70, "ivy@example.test"));
    const j = await journeyOf(profile, "lambda");
    r.fired.length = 0;

    const drop = await dropJourney(pg.db, {
      journey: j?.id as string,
      reason: "not a fit",
      by: "tester",
    });
    expect(drop).toMatchObject({ workflow: "funnel.lambda.v1", from: "in.dropped" });
    expect(await journeyOf(profile, "lambda")).toMatchObject({
      status: "dropped",
      dropReason: "not a fit",
    });
    // A closed journey cannot be dropped twice.
    expect(await dropJourney(pg.db, { journey: j?.id as string, reason: "again" })).toBeNull();

    if (!drop) throw new Error("no drop");
    const w: Walk = { ...r.w, flows: new Map(flows.map((f) => [f.id, f])) };
    await walk(w, drop.workflow, drop.from, drop.events);
    expect(await arrivals("funnel.lambda.v1", "dropped")).toHaveLength(1);
    expect(r.fired.map((f) => f.facts)).toEqual([
      { trigger: "trigger.journey", funnel: "lambda", stage: "engaged", change: "dropped" },
    ]);
    const lines = await pg.db
      .select()
      .from(profileEvents)
      .where(and(eq(profileEvents.profileId, profile), like(profileEvents.summary, "Dropped%")));
    expect(lines).toMatchObject([
      { summary: "Dropped from Test funnel at Engaged", body: "not a fit" },
    ]);
  });
});
