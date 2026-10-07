/**
 * Client health on a fixed clock (designs/2026-10-07-health.md): the four parts from delivery's
 * own rows, weights that add to 100, the override beside the model, health's flags, a person's
 * flags, one urgent message and one digest a day by owner, and the spine's outbox. Synthetic only.
 */
import { addMember, clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import type { Viewer } from "@wren/core/portal";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { healthConsoleApi } from "../../src/health/console.js";
import {
  addressFlag,
  clearFlag,
  clearOverride,
  combine,
  FlagRefusal,
  flagsToFire,
  healthDays,
  healthPass,
  overrideHealth,
  ownFlag,
  raiseFlag,
  rateClient,
  readHealth,
  syncFlags,
  tellFlags,
} from "../../src/health/index.js";
import { HEALTH_RECORDS } from "../../src/health/records.js";
import { addInvoice, engagementOf, startEngagement } from "../../src/index.js";

let pg: TestPostgres;
const told: { title: string; body: string }[] = [];
const notifier: Notifier = {
  name: "test",
  notify: async (title, body = "") => {
    told.push({ title, body });
    return true;
  },
};
const NOW = new Date("2026-11-02T12:00:00Z");
const OPS = "ops@wren.example";

const open = async () =>
  (
    await pg.db.execute<{ cause: string; side: string }>(
      sql`select cause, side from delivery.flags where cleared_at is null order by id`,
    )
  ).map((r) => `${r.side} ${r.cause}`);

const quietFind = (e: { id: number }) =>
  ({
    clientId: "acme",
    engagementId: e.id,
    side: "risk",
    cause: "quiet",
    what: "nothing new",
  }) as const;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Demo Talent", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  for (const clientId of ["acme", "demo"])
    await startEngagement(pg.db, {
      clientId,
      offerId: "reactivation",
      startsOn: "2026-10-01",
      by: "seed",
      status: "active",
    });
  const e = await engagementOf(pg.db, "acme");
  // Day 32 of 90, counting from day 14: 20 × 18 / 76 ≈ 4.7 meetings expected.
  await pg.db.execute(sql`insert into delivery.results (engagement_id, key, value, updated_by, updated_at)
    values (${e.id}, 'meetings', 3, 'seed', '2026-10-30T10:00:00Z')`);
  await pg.db.execute(sql`update delivery.asks set due_on = null, answered_at = null`);
  await pg.db.execute(sql`update client_members set last_seen_at = '2026-11-01T15:00:00Z'
    where email = 'amy@acme.example'`);
  await pg.db.execute(sql`insert into delivery.pulses (engagement_id, email, week, score, at)
    values (${e.id}, 'amy@acme.example', '2026-10-26', 4, '2026-10-28T09:00:00Z')`);
  await addInvoice(pg.db, e, {
    number: "T-1",
    description: "Setup",
    cents: 100_000,
    issuedOn: "2026-10-06",
    dueOn: "2026-10-20",
    by: OPS,
  });
});

afterAll(async () => {
  await pg?.stop();
});

describe("health", () => {
  it("reads each part from delivery's rows, the demo left out", async () => {
    await rateClient(pg.db, { clientId: "acme", score: 2, note: "Slow to answer", by: OPS }, NOW);
    const reads = await readHealth(pg.db, "UTC", NOW);
    expect(reads.map((r) => r.clientId)).toEqual(["acme"]);
    const [h] = reads;
    expect(h?.parts.results).toMatchObject({ score: 63, why: "3 of 4.7 expected by now" });
    // One day with a visit of four wanted; no approvals or answers due.
    expect(h?.parts.engagement).toMatchObject({ score: 25, why: "1 day with a visit" });
    // Amy's 4 and Wren's 2: (75 + 25) / 2.
    expect(h?.parts.sentiment).toMatchObject({ score: 50, stale: false });
    // T-1 is 13 days late.
    expect(h?.parts.money).toMatchObject({ score: 30 });
    expect(h?.inputs.map((i) => [i.part, i.what, i.value])).toEqual([
      ["results", "Meetings booked, Lead reactivation", "3 of 4.7 expected by day 32"],
      ["engagement", "Days with a visit", "1 in the last 30 (4 wanted)"],
      ["sentiment", "Weekly rating, amy@acme.example", "4 of 5"],
      ["sentiment", "Wren's rating", "2 of 5: Slow to answer"],
      ["money", "Invoice T-1", "13 days late"],
    ]);
    expect(h?.inputs[0]?.href).toBe("/reactivation/results?client=acme");
  });

  it("keeps one row a day with its weights, and flags a client at risk", async () => {
    const { scored, flags } = await healthPass(pg.db, "UTC", NOW);
    expect(scored).toBe(1);
    const [row] = await pg.db.select().from(healthDays).where(eq(healthDays.clientId, "acme"));
    // (63×40 + 25×20 + 50×25 + 30×15) / 100
    expect(row).toMatchObject({ day: "2026-11-02", score: 47, band: "watch", visited: false });
    expect(Object.values(row?.weights ?? {}).reduce((a, b) => a + b, 0)).toBe(100);
    expect(row?.score).toBe(
      combine({
        results: { score: 63 },
        engagement: { score: 25 },
        sentiment: { score: 50 },
        money: { score: 30 },
      }).score,
    );
    expect(flags).toEqual([]);
    // A later pass the same day rewrites the day; Amy's late visit marks yesterday's row.
    await pg.db.insert(healthDays).values({
      clientId: "acme",
      day: "2026-11-01",
      score: 70,
      band: "healthy",
      weights: { results: 40, engagement: 20, sentiment: 25, money: 15 },
    });
    await healthPass(pg.db, "UTC", new Date("2026-11-02T13:00:00Z"));
    const days = await pg.db
      .select({ day: healthDays.day, visited: healthDays.visited })
      .from(healthDays)
      .orderBy(healthDays.day);
    expect(days).toEqual([
      { day: "2026-11-01", visited: true },
      { day: "2026-11-02", visited: false },
    ]);
  });

  it("flags a fall of 15 in a week, results ahead of plan, and an override's band", async () => {
    await pg.db.insert(healthDays).values({
      clientId: "acme",
      day: "2026-10-26",
      score: 80,
      band: "healthy",
      weights: { results: 40, engagement: 20, sentiment: 25, money: 15 },
    });
    const e = await engagementOf(pg.db, "acme");
    await pg.db.execute(sql`update delivery.results set value = 9 where engagement_id = ${e.id}`);
    const { flags } = await healthPass(pg.db, "UTC", NOW);
    expect(flags.map((f) => [f.side, f.cause])).toEqual([
      ["risk", "health:drop"],
      ["opportunity", "health:ahead"],
    ]);
    await pg.db.execute(sql`update delivery.results set value = 3 where engagement_id = ${e.id}`);
    // A person's 20 stands beside the model's 47: the band is theirs.
    await overrideHealth(pg.db, { clientId: "acme", score: 20, reason: "Champion left", by: OPS });
    const again = await healthPass(pg.db, "UTC", NOW);
    await syncFlags(pg.db, "health", again.flags, NOW);
    expect(again.flags.map((f) => [f.cause, f.what])).toEqual([
      ["health:at-risk", "Health is 20, at risk (set by hand)"],
      ["health:drop", "Health fell from 80 to 20 in a week"],
    ]);
    const [row] = await pg.db
      .select()
      .from(healthDays)
      .where(sql`${healthDays.clientId} = 'acme' and ${healthDays.day} = '2026-11-02'`);
    expect(row).toMatchObject({ score: 47, override: 20 });
    await expect(
      overrideHealth(pg.db, { clientId: "acme", score: 101, reason: "x", by: OPS }),
    ).rejects.toThrow(FlagRefusal);
    await clearOverride(pg.db, "acme", OPS);
    await expect(clearOverride(pg.db, "acme", OPS)).rejects.toThrow(/No override/);
  });
});

describe("flags", () => {
  it("raise once per cause, keep their words fresh, and clear when the cause goes", async () => {
    const quiet = quietFind(await engagementOf(pg.db, "acme"));
    expect(await syncFlags(pg.db, "delivery", [quiet, quiet], NOW)).toEqual({
      raised: 1,
      cleared: 0,
    });
    await syncFlags(pg.db, "delivery", [{ ...quiet, what: "nothing new in a week" }], NOW);
    const [row] = await pg.db.execute<{ what: string }>(
      sql`select what from delivery.flags where cause = 'quiet'`,
    );
    expect(row?.what).toBe("Nothing new in a week");
    expect(await syncFlags(pg.db, "delivery", [], NOW)).toEqual({ raised: 0, cleared: 1 });
    // Back again: a new flag, the old one kept as history.
    await syncFlags(pg.db, "delivery", [quiet], NOW);
    const all = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from delivery.flags where cause = 'quiet'`,
    );
    expect(all[0]?.n).toBe(2);
  });

  it("a person raises, takes, addresses and clears only what clears by hand", async () => {
    const mine = await raiseFlag(pg.db, {
      clientId: "acme",
      side: "opportunity",
      what: "they're opening a second office",
      by: OPS,
    });
    expect(mine).toMatchObject({
      cause: `person:${mine.id}`,
      what: "They're opening a second office",
    });
    await ownFlag(pg.db, mine.id, "Sam@Wren.example");
    const [quiet] = await pg.db.execute<{ id: number }>(
      sql`select id from delivery.flags where cause = 'quiet' and cleared_at is null`,
    );
    await expect(clearFlag(pg.db, quiet?.id ?? 0, OPS)).rejects.toThrow(/Mark it addressed/);
    await addressFlag(pg.db, quiet?.id ?? 0, OPS, "Posting today");
    await expect(addressFlag(pg.db, quiet?.id ?? 0, OPS, null)).rejects.toThrow(/already/);
    await expect(
      raiseFlag(pg.db, { clientId: "nope", side: "risk", what: "x", by: OPS }),
    ).rejects.toThrow(/No client/);
    expect(await open()).toEqual(
      expect.arrayContaining([
        "risk health:at-risk",
        "risk quiet",
        `opportunity person:${mine.id}`,
      ]),
    );
  });

  it("tells urgent ones at once, then one digest a day from 09:00 by owner", async () => {
    await syncFlags(
      pg.db,
      "delivery",
      [
        { ...quietFind(await engagementOf(pg.db, "acme")) },
        {
          clientId: "acme",
          engagementId: null,
          side: "risk",
          cause: "reply:u1",
          what: "amy@acme.example wrote, no reply yet",
          urgent: true,
        },
      ],
      NOW,
    );
    const at8 = new Date("2026-11-03T08:00:00Z");
    expect(await tellFlags(pg.db, notifier, "2026-11-03", 8, at8)).toEqual({
      urgent: 1,
      digest: 0,
    });
    expect(told.splice(0)).toEqual([
      { title: "Clients: 1 urgent", body: "acme: amy@acme.example wrote, no reply yet" },
    ]);
    const at9 = new Date("2026-11-03T09:10:00Z");
    const digest = await tellFlags(pg.db, notifier, "2026-11-03", 9, at9);
    // Addressed and just-told flags stay quiet; the rest are new.
    const [msg] = told.splice(0);
    expect(msg?.title).toBe(`Clients: ${digest.digest} to look at`);
    expect(msg?.body).toMatch(/^Team:\nacme: /);
    expect(msg?.body).toContain(
      "\n\nsam@wren.example:\nacme: opportunity, They're opening a second office",
    );
    expect(msg?.body).not.toContain("Nothing new");
    expect(msg?.body).not.toContain("no reply yet");
    await tellFlags(pg.db, notifier, "2026-11-03", 10, new Date("2026-11-03T10:10:00Z"));
    expect(told).toEqual([]);
  });

  it("hands each raise and clear to the spine once", async () => {
    const first = await flagsToFire(pg.db, NOW);
    expect(first.every((f) => f.client === null && f.event.kind === "client")).toBe(true);
    expect(
      first.filter((f) => f.facts.trigger === "trigger.flag" && f.facts.change === "cleared"),
    ).toHaveLength(1);
    expect(first.find((f) => f.event.data.cause === "reply:u1")).toMatchObject({
      facts: { trigger: "trigger.flag", change: "raised", side: "risk" },
      event: { subject: expect.stringMatching(/^flag:\d+$/) },
    });
    expect(await flagsToFire(pg.db, NOW)).toEqual([]);
    const [person] = await pg.db.execute<{ id: number }>(
      sql`select id from delivery.flags where source = 'person'`,
    );
    await clearFlag(pg.db, person?.id ?? 0, OPS);
    expect((await flagsToFire(pg.db, NOW)).map((f) => [f.event.subject, f.facts])).toEqual([
      [`flag:${person?.id}`, { trigger: "trigger.flag", change: "cleared", side: "opportunity" }],
    ]);
  });
});

describe("the console", () => {
  const ops: Viewer = { email: OPS, operator: true };
  it("reads health, its inputs, its days and the flags as records", async () => {
    await healthPass(pg.db, "UTC", NOW);
    const api = serveRecords(HEALTH_RECORDS, pg.db);
    const health = await api.list({ record: "console.health", view: "all" });
    expect(health.rows).toEqual([
      expect.objectContaining({ id: "acme", name: "Acme Staffing", score: 47, band: "watch" }),
    ]);
    const got = await api.get({ record: "console.health", id: "acme" });
    expect(got.row).toMatchObject({
      weights: "Results 40% · Engagement 20% · Sentiment 25% · Money 15%",
      resultsWhy: "3 of 4.7 expected by now",
      rating: 2,
      hand: "no",
    });
    // The lowest part under 70, with its why.
    expect(got.row.weakest).toMatch(/^(Results|Engagement|Sentiment|Money): \S/);
    const inputs = await api.list({
      record: "console.health_input",
      view: "all",
      where: { client: "acme" },
    });
    expect(inputs.rows.map((r) => [r.part, r.age])).toContainEqual(["results", "fresh"]);
    expect(inputs.rows.find((r) => r.part === "results")?.rows).toBe(
      "/reactivation/results?client=acme",
    );
    const days = await api.list({ record: "console.health_day", view: "all" });
    expect(days.rows.map((r) => r.id)).toContain("acme:2026-11-02");
    const flags = await api.list({ record: "console.flag", view: "open" });
    expect(flags.rows.every((r) => r.state !== "cleared")).toBe(true);
    expect(JSON.stringify(flags.rows)).not.toContain("how");
  });

  it("rates, overrides and works flags as the signed-in teammate", async () => {
    const api = healthConsoleApi(pg.db);
    await api.rate({ viewer: ops, ids: ["acme"], score: "4", note: "Better call" });
    await expect(api.rate({ viewer: ops, ids: ["acme"], score: "7" })).rejects.toThrow(/1 to 5/);
    await api.override({ viewer: ops, ids: ["acme"], score: 55, reason: "New champion" });
    const set = await serveRecords(HEALTH_RECORDS, pg.db).list({
      record: "console.health",
      view: "hand",
    });
    expect(set.rows).toEqual([expect.objectContaining({ id: "acme", score: 55, hand: "yes" })]);
    const raised = await api.flagRaise({
      viewer: ops,
      ids: ["acme"],
      side: "opportunity",
      what: "Asked about a second offer",
    });
    await api.flagTake({ viewer: ops, ids: [raised.id ?? ""] });
    await api.flagAddress({ viewer: ops, ids: [raised.id ?? ""], note: "Call booked" });
    const [row] = await pg.db.execute<{ owner: string; addressed_by: string }>(
      sql`select owner, addressed_by from delivery.flags where id = ${Number(raised.id)}`,
    );
    expect(row).toEqual({ owner: OPS, addressed_by: OPS });
    await expect(
      api.flagOwn({ viewer: ops, ids: [raised.id ?? ""], owner: "not an address" }),
    ).rejects.toThrow(/email address/);
    await api.flagClear({ viewer: ops, ids: [raised.id ?? ""] });
    await api.clearOverride({ viewer: ops, ids: ["acme"] });
    await expect(api.rate({ viewer: { demo: true }, ids: ["acme"], score: 3 })).rejects.toThrow(
      /read-only/,
    );
  });
});
