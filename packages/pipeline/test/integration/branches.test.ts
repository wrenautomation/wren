/**
 * Branches end to end on a real Postgres (designs/2026-11-02-campaigns.md, phase 4): a split's
 * tracks move one by one, a join holds the next station until its rule is met, a race arm taken
 * by hand is named as won, a rebuild from the events gives the same row, and a new version carries
 * the branches. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { type Fired, pgExecutorStore, resume, type Walk, walk } from "@wren/core/executor";
import { resolveProfile } from "@wren/core/profiles";
import { events } from "@wren/core/schema";
import { recomputeLive, saveSegment, segmentMembers } from "@wren/core/segments";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { carryJourneys } from "../../src/carry.js";
import { shapeWorkflowsOf } from "../../src/journeys.js";
import type { ShapeBody, ShapeEdge, ShapeNode } from "../../src/model.js";
import { type Emit, moveEmit, openEmit, rebuildJourney } from "../../src/moves.js";
import { instances } from "../../src/schema.js";
import { type CampaignStop, journeySteps } from "../../src/steps.js";
import { Refused } from "../../src/store.js";
import { seedGraph } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const OP = "op@example.test";
const step = (id: string): ShapeNode => ({
  id,
  kind: "step",
  name: id,
  action: "reply",
  advance: [{ trigger: "trigger.reply" }],
});
const edge = (from: string, to: string, over: Partial<ShapeEdge> = {}): ShapeEdge => ({
  id: `${from}_to_${to}`,
  from,
  to,
  kind: "flow",
  ...over,
});

/** Onboarding, then a race: no reply in 3 days goes to `nudge`. */
const body = (): ShapeBody => ({
  name: "Branches",
  nodes: [
    { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
    ...["won", "signed", "paid", "intake", "kickoff", "sent", "replied", "nudge"].map(step),
  ],
  gates: [
    { id: "f", kind: "split" },
    { id: "j", kind: "join", rule: "all" },
    { id: "r", kind: "race" },
  ],
  edges: [
    edge("mail", "won"),
    edge("won", "f"),
    edge("f", "signed"),
    edge("f", "paid"),
    edge("f", "intake"),
    edge("signed", "j"),
    edge("paid", "j"),
    edge("intake", "j"),
    edge("j", "kickoff"),
    edge("kickoff", "sent"),
    edge("sent", "r"),
    edge("r", "replied", { cond: "a reply" }),
    edge("r", "nudge", { wait: "3 days" }),
  ],
  // The follow-up runs in its own campaign: a won race stops that campaign's acts.
  campaigns: { sent: "follow", r: "follow", replied: "follow", nudge: "follow" },
});

/** Campaign stops the move step asked for. */
const stops: CampaignStop[] = [];
/** Arrivals a wire holds, with their wait: the race clocks set. */
const held: Array<{ id: string; ms: number }> = [];

async function walker(): Promise<Walk> {
  const fired: Fired[] = [];
  const flows: Workflow[] = await shapeWorkflowsOf(pg.db, "wren");
  return {
    flows: new Map(flows.map((f) => [f.id, f])),
    parts: new Map(),
    steps: journeySteps({
      db: () => pg.db,
      stopCampaign: async (_tx, s) => {
        stops.push(s);
      },
    }),
    store: pgExecutorStore(pg.db),
    client: null,
    by: randomUUID(),
    run: (_name, fn) => fn(),
    later: (id, ms) => held.push({ id, ms }),
    rule: async () => true,
    fire: (req) => fired.push(req),
  };
}

async function play(e: Emit) {
  await walk(await walker(), e.workflow, e.from, e.events);
}

/** The clock's wait runs out now. */
async function ring(id: string) {
  await resume(await walker(), id);
}

const row = async (id: string) =>
  (await pg.db.select().from(instances).where(eq(instances.id, id)))[0];
const move = async (journey: string, to: string) =>
  play(await moveEmit(pg.db, { journey, to, by: OP }));
const refused = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );
const at = (bs: Array<{ key: string; node: string }>) => bs.map((b) => `${b.key}@${b.node}`).sort();

describe("a journey with branches", () => {
  it("splits, joins all, wins a race by hand and rebuilds the same", async () => {
    await seedGraph(pg.db, body());
    const r = await resolveProfile(pg.db, [{ kind: "email", value: "a@example.test" }], "test", {
      name: "Ada",
    });
    if (!r) throw new Error("no profile");
    await play(await openEmit(pg.db, { person: "a@example.test", by: OP }));
    const [j] = await pg.db.select().from(instances).where(eq(instances.profileId, r.id));
    const id = j?.id as string;
    expect(j).toMatchObject({ node: "won", branches: [] });

    // A kickoff before the join holds: refused without a reason.
    expect(await refused(moveEmit(pg.db, { journey: id, to: "kickoff", by: OP }))).toEqual([
      "No path from won to kickoff. Give a reason to force the move.",
    ]);

    await move(id, "paid");
    expect(at((await row(id))?.branches ?? [])).toEqual([
      "f_to_intake@f",
      "f_to_signed@f",
      "main@paid",
    ]);
    await move(id, "signed");
    await move(id, "intake");
    const three = await row(id);
    expect(three?.node).toBe("intake");
    expect(three?.trail.at(-1)).toMatchObject({ edge: "f_to_intake", branch: "f_to_intake" });

    await move(id, "kickoff");
    expect(await row(id)).toMatchObject({ node: "kickoff", branches: [], status: "open" });

    // The race: the wait arm is the clock's alone; a reply by hand wins the cond arm.
    await move(id, "sent");
    expect(await refused(moveEmit(pg.db, { journey: id, to: "nudge", by: OP }))).toHaveLength(1);
    expect(stops).toEqual([]);
    await move(id, "replied");
    expect(await row(id)).toMatchObject({ node: "replied", status: "done" });
    expect(stops).toEqual([
      {
        profile: r.id,
        campaign: "follow",
        gate: "r",
        cause: expect.objectContaining({ kind: "manual" }),
      },
    ]);
    const [last] = await pg.db
      .select({ data: events.data })
      .from(events)
      .where(and(eq(events.subject, `journey:${id}`), eq(events.node, "s_replied")))
      .orderBy(asc(events.at));
    expect(last?.data).toMatchObject({ won: [{ gate: "r", arm: "r_to_replied" }] });

    // Gates are crossings on the trail, never arrivals.
    const stages = await pg.db
      .select({ node: events.node })
      .from(events)
      .where(and(eq(events.subject, `journey:${id}`)));
    expect(stages.map((s) => s.node)).not.toContain("s_f");

    expect(await rebuildJourney(pg.db, id)).toMatchObject({ changed: false });
  });
});

describe("a race clock", () => {
  /** A new person, moved by hand through onboarding to `sent`: the clock is set. */
  async function toSent(email: string) {
    const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", {
      name: "Bo",
    });
    if (!r) throw new Error("no profile");
    await play(await openEmit(pg.db, { person: email, by: OP }));
    const [j] = await pg.db.select().from(instances).where(eq(instances.profileId, r.id));
    const id = j?.id as string;
    for (const to of ["paid", "signed", "intake", "kickoff"]) await move(id, to);
    const before = held.length;
    await move(id, "sent");
    expect(held.length).toBe(before + 1);
    const clock = held.at(-1);
    if (!clock) throw new Error("no clock");
    expect(clock.ms).toBe(3 * 24 * 3_600_000);
    return { id, clock: clock.id };
  }

  it("takes the wait arm when no reply came", async () => {
    const { id, clock } = await toSent("b@example.test");
    const before = stops.length;
    await ring(clock);
    expect(stops).toHaveLength(before);
    expect(await row(id)).toMatchObject({ node: "nudge", status: "done" });
    expect((await row(id))?.trail.at(-1)).toMatchObject({ edge: "r_to_nudge", to: "nudge" });
    const [stage] = await pg.db
      .select({ data: events.data })
      .from(events)
      .where(and(eq(events.subject, `journey:${id}`), eq(events.node, "s_nudge")));
    expect(stage?.data).toMatchObject({ cause: { kind: "clock", ref: "r" } });
    expect(stage?.data).not.toHaveProperty("won");
    expect(await rebuildJourney(pg.db, id)).toMatchObject({ changed: false });
  });

  it("does nothing once a reply won the race", async () => {
    const { id, clock } = await toSent("c@example.test");
    await move(id, "replied");
    await ring(clock);
    expect(await row(id)).toMatchObject({ node: "replied", status: "done" });
  });

  it("does nothing after a hand move took the wait arm first", async () => {
    const { id, clock } = await toSent("d@example.test");
    const before = stops.length;
    await play(await moveEmit(pg.db, { journey: id, to: "nudge", by: OP, reason: "called them" }));
    const moved = await row(id);
    expect(moved).toMatchObject({ node: "nudge", status: "done" });
    await ring(clock);
    expect((await row(id))?.trail).toEqual(moved?.trail);
    // A hand move with a reason forces past the race: it wins nothing, so nothing stops.
    expect(stops).toHaveLength(before);
  });
});

describe("a carry to a new version", () => {
  /** A new person moved by hand to each of `to`. */
  async function opened(email: string, to: string[]) {
    const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", {
      name: "Cy",
    });
    if (!r) throw new Error("no profile");
    await play(await openEmit(pg.db, { person: email, by: OP }));
    const [j] = await pg.db.select().from(instances).where(eq(instances.profileId, r.id));
    const id = j?.id as string;
    for (const n of to) await move(id, n);
    return id;
  }

  it("takes the branches along, and leaves one on a race clock behind", async () => {
    const split = await opened("e@example.test", ["paid"]);
    const racing = await opened("f@example.test", ["paid", "signed", "intake", "kickoff", "sent"]);
    const clock = held.at(-1)?.id as string;
    const v1 = (await row(split))?.version as number;
    const v2 = await seedGraph(pg.db, body(), "same shape");
    await carryJourneys(pg.db, v2.number);

    const carried = await row(split);
    expect(carried?.version).toBe(v2.number);
    expect(at(carried?.branches ?? [])).toEqual(["f_to_intake@f", "f_to_signed@f", "main@paid"]);
    expect(await rebuildJourney(pg.db, split)).toMatchObject({ changed: false });
    // The carried journey moves on in its new version.
    await move(split, "signed");
    expect((await row(split))?.trail.at(-1)).toMatchObject({ to: "signed", branch: "f_to_signed" });
    // A group "at paid" counts the paid branch, though the front is at signed.
    const { segment } = await saveSegment(
      pg.db,
      {
        name: "At paid",
        kind: "live",
        rule: { kind: "group", match: "all", of: [{ kind: "journey", node: "paid", days: null }] },
      },
      "t",
      new Date(),
    );
    await recomputeLive(pg.db, new Date());
    const profile = (await row(split))?.profileId;
    expect((await segmentMembers(pg.db, segment.id)).map((m) => m.profileId)).toContain(profile);

    // Its clock rings in its own version: a ghost until the race is done.
    expect((await row(racing))?.version).toBe(v1);
    await ring(clock);
    expect(await row(racing)).toMatchObject({ node: "nudge", status: "done", version: v1 });
  });

  it("leaves a journey whose waiting track the new version lacks", async () => {
    const split = await opened("g@example.test", ["paid"]);
    const v = (await row(split))?.version;
    const less = body();
    less.edges = less.edges.filter((e) => e.from !== "f" || e.to !== "intake");
    const v3 = await seedGraph(pg.db, less, "no intake track");
    await carryJourneys(pg.db, v3.number);
    expect((await row(split))?.version).toBe(v);
  });

  it("leaves a journey before a race the new version adds: carry sets no clock", async () => {
    const plain = body();
    plain.gates = (plain.gates ?? []).filter((g) => g.id !== "r");
    plain.edges = [
      ...plain.edges.filter((e) => e.from !== "r" && e.to !== "r"),
      edge("sent", "replied"),
    ];
    await seedGraph(pg.db, plain, "no race");
    const waiting = await opened("h@example.test", ["paid", "signed", "intake", "kickoff", "sent"]);
    const v = (await row(waiting))?.version;
    const raced = await seedGraph(pg.db, body(), "race again");
    await carryJourneys(pg.db, raced.number);
    expect((await row(waiting))?.version).toBe(v);
  });
});
