/**
 * Funnels to the shape on a real Postgres (designs/2026-10-19-business-map.md, "Decisions
 * (planner)"): two old funnels become one shape, every journey keeps its place, a repeat adds
 * nothing. The old rows are written by hand, as the legacy columns hold them. Synthetic data only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { events } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FunnelBody, migrateShape, ONE_PER_PERSON } from "../../src/migrate.js";
import { rebuildJourney } from "../../src/moves.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
  shapeVersions,
} from "../../src/schema.js";
import { TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
const NOW = new Date("2026-10-19T10:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

const alpha: FunnelBody = {
  name: "Alpha funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
    { key: "booked", label: "Booked", research: "light", on: [{ trigger: "trigger.booking" }] },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [{ id: "mail", kind: "outbound", channel: "email" }],
};
const beta: FunnelBody = {
  name: "Beta funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
    { key: "proposal", label: "Proposal", on: [] },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [{ id: "yt", kind: "organic", channel: "youtube" }],
};

const ids: Record<string, string> = {};
const person = async (email: string) =>
  ((await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number) ?? 0;

/** An old journey, as the legacy columns hold it: no node, no shape version. */
async function old(
  key: string,
  email: string,
  o: { funnel: string; stage: string; entry: string; status?: "open" | "done" | "dropped" },
) {
  const [j] = await pg.db
    .insert(journeys)
    .values({
      profileId: await person(email),
      funnel: o.funnel,
      funnelVersion: 1,
      stage: o.stage,
      entry: o.entry,
      status: o.status ?? "open",
      openedAt: at(10),
      movedAt: at(3),
      ...(o.status === "done" ? { closedAt: at(3) } : {}),
    })
    .returning();
  if (!j) throw new Error("no journey");
  ids[key] = j.id;
  return j;
}

/** The old spine's arrival at a stage: `funnel.<id>.v1`, node `s_<stage>`. */
const arrival = (journey: string, funnel: string, stage: string, when: Date) =>
  pg.db.insert(events).values({
    workflow: `funnel.${funnel}.v1`,
    node: `s_${stage}`,
    port: "in",
    subject: `journey:${journey}`,
    kind: "journey",
    data: {},
    at: when,
    by: "test",
  });

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(offerVersions).values({
    offer: "offer-a",
    number: 1,
    hash: "4".repeat(64),
    body: {} as never,
    why: "t",
    createdBy: "t",
  });
  for (const [id, body] of [
    ["alpha", alpha],
    ["beta", beta],
  ] as const) {
    await pg.db.insert(funnels).values({ id, name: body.name, status: "live" });
    await pg.db.insert(funnelVersions).values({
      funnel: id,
      number: 1,
      body: body as unknown as Record<string, unknown>,
      why: "t",
      createdBy: "t",
    });
  }
  // p1 sits at booked; p2 signed (with a deal); p3 has two open journeys; p4 came from YouTube;
  // p5 is on a stage the funnel no longer has.
  const p1 = await old("p1", "p1@example.test", {
    funnel: "alpha",
    stage: "booked",
    entry: "mail",
  });
  await arrival(p1.id, "alpha", "engaged", at(9));
  await arrival(p1.id, "alpha", "booked", at(3));
  const p2 = await old("p2", "p2@example.test", {
    funnel: "alpha",
    stage: "signed",
    entry: "mail",
    status: "done",
  });
  await pg.db
    .insert(pipelineDeals)
    .values({ journey: p2.id, profileId: p2.profileId, offer: "offer-a", offerVersion: 1 });
  await old("p3a", "p3@example.test", { funnel: "alpha", stage: "engaged", entry: "mail" });
  await old("p3b", "p3@example.test", { funnel: "beta", stage: "proposal", entry: "yt" });
  await old("p4", "p4@example.test", { funnel: "beta", stage: "engaged", entry: "yt" });
  await old("p5", "p5@example.test", { funnel: "alpha", stage: "gone", entry: "mail" });
});
afterAll(() => pg.stop());

const opts = { triggers: TRIGGERS, now: NOW };
const shapeCount = async () => (await pg.db.select().from(shapeVersions)).length;
const jr = async (key: string) => {
  const [j] = await pg.db
    .select()
    .from(journeys)
    .where(eq(journeys.id, ids[key] as string));
  if (!j) throw new Error(`no journey ${key}`);
  return j;
};

describe("a dry run", () => {
  it("plans the shape and counts the journeys, and writes nothing", async () => {
    const r = await migrateShape(pg.db, { ...opts, dry: true });
    expect(r.shape).toBe("planned");
    expect(r.funnels).toEqual(["alpha", "beta"]);
    expect(r.body?.name).toBe("Business");
    expect(r.journeys).toMatchObject({ moved: 5, unplaced: 1, duplicates: 1 });
    expect(await shapeCount()).toBe(0);
    expect((await jr("p1")).node).toBeNull();
  });
});

describe("the migration", () => {
  it("builds one shape from both funnels, sharing the stages they agree on", async () => {
    const r = await migrateShape(pg.db, opts);
    expect(r.shape).toBe("written");
    expect(await shapeCount()).toBe(1);
    const body = r.body;
    expect(body?.nodes.map((n) => n.id).sort()).toEqual([
      "booked",
      "engaged",
      "mail",
      "proposal",
      "signed",
      "yt",
    ]);
    const flows = (body?.edges ?? []).map((e) => `${e.from}>${e.to}:${e.kind}`).sort();
    expect(flows).toEqual([
      "booked>signed:flow",
      "engaged>booked:flow",
      "engaged>proposal:flow",
      "mail>engaged:flow",
      "proposal>signed:flow",
      "yt>engaged:flow",
    ]);
    // The shared stage keeps both funnels' triggers once.
    expect(body?.nodes.find((n) => n.id === "signed")).toMatchObject({
      kind: "offer",
      offer: "offer-a",
      advance: [{ trigger: "trigger.document" }],
    });
    expect(body?.nodes.find((n) => n.id === "booked")).toMatchObject({ research: "light" });
    expect(r.journeys).toMatchObject({ moved: 5, unplaced: 1, duplicates: 1, done: 1 });
    expect(r.deals).toBe(1);
  });

  it("keeps every journey where it was, with the trail its old arrivals tell", async () => {
    const p1 = await jr("p1");
    expect(p1).toMatchObject({ node: "booked", version: 1, entry: "mail", status: "open" });
    expect(p1.trail.map((c) => [c.from, c.to])).toEqual([
      ["mail", "engaged"],
      ["engaged", "booked"],
    ]);
    expect(p1.trail.map((c) => c.edge)).toEqual(["mail_to_engaged", "engaged_to_booked"]);
    expect(await jr("p2")).toMatchObject({ node: "signed", status: "done", version: 1 });
    expect(await jr("p4")).toMatchObject({ node: "engaged", entry: "yt", status: "open" });
    const [deal] = await pg.db.select().from(pipelineDeals);
    expect(deal?.node).toBe("signed");
  });

  it("keeps the deepest of two open journeys of a person, and drops the other", async () => {
    expect(await jr("p3b")).toMatchObject({ node: "proposal", status: "open" });
    expect(await jr("p3a")).toMatchObject({
      node: "engaged",
      status: "dropped",
      dropReason: ONE_PER_PERSON,
    });
    // The drop is an event, so a rebuild keeps it.
    const r = await rebuildJourney(pg.db, ids.p3a as string);
    expect(r.after).toMatchObject({
      node: "engaged",
      status: "dropped",
      dropReason: ONE_PER_PERSON,
    });
    expect(await jr("p3a")).toMatchObject({ status: "dropped", dropReason: ONE_PER_PERSON });
  });

  it("leaves a journey on a gone stage unplaced, and says so", async () => {
    expect(await jr("p5")).toMatchObject({ node: null, status: "open", stage: "gone" });
  });

  it("writes the version arrivals that a rebuild reads", async () => {
    const r = await rebuildJourney(pg.db, ids.p1 as string);
    expect(r.changed).toBe(false);
    expect(r.after).toMatchObject({ node: "booked", status: "open", version: 1 });
  });

  it("is a no op the second time", async () => {
    const before = await pg.db.select().from(journeys);
    const r = await migrateShape(pg.db, opts);
    expect(r.shape).toBe("exists");
    expect(r.journeys.moved).toBe(0);
    expect(r.journeys.duplicates).toBe(0);
    expect(r.deals).toBe(0);
    expect(await shapeCount()).toBe(1);
    const after = await pg.db.select().from(journeys);
    expect(after.map((j) => [j.id, j.node, j.status]).sort()).toEqual(
      before.map((j) => [j.id, j.node, j.status]).sort(),
    );
  });

  it("answers a dry run on a migrated database with the shape that is there", async () => {
    const r = await migrateShape(pg.db, { ...opts, dry: true });
    expect(r.shape).toBe("exists");
    expect(r.journeys.moved).toBe(0);
  });
});

describe("the old views", () => {
  const rows = async (view: string) =>
    (await pg.db.execute(sql.raw(`select * from pipeline.${view}`))) as unknown as Record<
      string,
      unknown
    >[];

  it("answer from the shape", async () => {
    const entries = await rows("entry_numbers");
    const mail = entries.filter((e) => e.entry === "mail");
    expect(mail.reduce((n, e) => n + Number(e.opened), 0)).toBe(4);
    expect(entries.every((e) => e.funnel === "shape")).toBe(true);
    const flow = await rows("stage_flow");
    expect(flow.map((f) => `${f.stage}>${f.next_stage}`).sort()).toEqual([
      "booked>signed",
      "engaged>booked",
      "engaged>proposal",
      "mail>engaged",
      "proposal>signed",
      "yt>engaged",
    ]);
    // A migrated journey is a version cause, not traffic: it adds no arrival.
    expect((await rows("stage_counts")).every((c) => c.funnel === "shape")).toBe(true);
    expect(Number((await rows("stage_counts")).reduce((n, c) => n + Number(c.entered), 0))).toBe(0);
  });
});

describe("a dry run before migration 0306", () => {
  // Last: it takes 0306's table and columns away again, as production has them before the deploy.
  it("reads the old rows without the shape table or the node columns, and writes nothing", async () => {
    await pg.db.execute(sql`drop table pipeline.shape_versions cascade`);
    await pg.db.execute(
      sql`alter table pipeline.journeys drop column shape_version cascade, drop column node cascade,
        drop column trail cascade`,
    );
    await pg.db.execute(sql`alter table pipeline.deals drop column node cascade`);
    const r = await migrateShape(pg.db, { ...opts, dry: true });
    expect(r.shape).toBe("planned");
    expect(r.funnels).toEqual(["alpha", "beta"]);
    // The earlier tests ran the real migration: p3's second journey is already dropped.
    expect(r.journeys).toMatchObject({ moved: 5, unplaced: 1, duplicates: 0 });
    expect(r.deals).toBe(1);
  });
});
