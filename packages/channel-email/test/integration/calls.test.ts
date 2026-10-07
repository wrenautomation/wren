/**
 * A booked call's brief and outcome on Postgres, synthetic leads only: the brief cites every line
 * with a date and keeps it per call, the model's questions pass code's checks, and an outcome
 * marks only a started, booked call. A client with the outcome part reads its own calls.
 */
import { loadSettings } from "@wren/config";
import { addClient } from "@wren/core/clients";
import { atomic, cachedDb, clientDatabaseUrl, setAuditActor } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import type { LlmClient } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { briefOf, buildBrief, markSent, saveBrief } from "../../src/calls/brief.js";
import { setCallOutcome } from "../../src/calls/outcome.js";
import { emailConsoleApi } from "../../src/restate/console.js";
import { callBookings, threadEvents } from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { makeCompany, makeEnrollment, makePerson, TABLES } from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "people", "thread_events", "call_bookings", "call_briefs"]);
});

const NOW = new Date("2026-10-07T12:00:00Z");
const START = new Date("2026-10-08T15:00:00Z");

const fake = (text: string): LlmClient =>
  ({
    name: "fake-model",
    provider: "fake",
    complete: async () => ({ text }),
  }) as unknown as LlmClient;

async function bookedCall(over: Partial<typeof callBookings.$inferInsert> = {}) {
  const company = await makeCompany(pg.db, { name: "Acme Example", domain: "acme.example" });
  const person = await makePerson(pg.db, company, { full: "Ana Example", first: "Ana" });
  const e = await makeEnrollment(pg.db, company, { toEmail: "ana@acme.example", person });
  await pg.db.insert(threadEvents).values({
    enrollmentId: e.id,
    kind: "reply",
    receivedAt: new Date("2026-10-03T10:00:00Z"),
    bodyText: "Happy to talk. We lose leads on weekends.\n\nOn Fri, Will wrote:\n> hello",
  });
  const [call] = await pg.db
    .insert(callBookings)
    .values({
      uid: "cal-synthetic-1",
      state: "booked",
      start: START,
      email: "ana@acme.example",
      name: "Ana Example",
      enrollmentId: e.id,
      bookedAt: new Date("2026-10-04T09:00:00Z"),
      ...over,
    })
    .returning();
  return call as typeof callBookings.$inferSelect;
}

describe("the brief", () => {
  it("cites every line with a source and a date, and keeps their own words", async () => {
    const call = await bookedCall();
    const b = await buildBrief(pg.db, call.id, { now: NOW });
    expect(b?.call).toMatchObject({ who: "Ana Example", company: "Acme Example" });
    expect(b?.thread).toEqual([
      {
        text: "Happy to talk. We lose leads on weekends.",
        source: "Email reply",
        href: null,
        at: "2026-10-03",
      },
    ]);
    expect(b?.cameIn.at(-1)).toMatchObject({ text: "Booked on cal.com", at: "2026-10-04" });
    for (const line of [...(b?.top ?? []), ...(b?.cameIn ?? []), ...(b?.thread ?? [])]) {
      expect(line.source).toBeTruthy();
      expect(line.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(b?.model).toBeNull();
    expect(b?.questions.length).toBeGreaterThan(0);
  });

  it("keeps the model's questions only when they pass", async () => {
    const call = await bookedCall();
    const b = await buildBrief(pg.db, call.id, {
      now: NOW,
      llm: fake("Who covers weekends now?\nDid the 300 leads convert?\nSee https://x.example?"),
    });
    expect(b?.questions[0]).toEqual({ text: "Who covers weekends now?", from: "model" });
    expect(b?.questions.some((q) => q.text.includes("300"))).toBe(false);
    expect(b?.model).toBe("fake-model");
  });

  it("is kept per call, newest wins, and read live when none is kept", async () => {
    const call = await bookedCall();
    const live = await briefOf(pg.db, String(call.id), NOW);
    expect(live?.saved).toBe(false);
    const b = await buildBrief(pg.db, call.id, { now: NOW });
    if (!b) throw new Error("no brief");
    await saveBrief(pg.db, b);
    await saveBrief(pg.db, { ...b, built: new Date(NOW.getTime() + 60_000).toISOString() });
    await markSent(pg.db, call.id, NOW);
    const kept = await briefOf(pg.db, String(call.id));
    expect(kept).toMatchObject({ saved: true, sentAt: NOW.toISOString() });
    const [{ n } = { n: 0 }] = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from call_briefs`,
    );
    expect(n).toBe(1);
    expect(await briefOf(pg.db, "0")).toBeNull();
  });
});

describe("the outcome", () => {
  const mark = (ids: number[], outcome: "won" | "not_yet" | null, now: Date, reason?: string) =>
    atomic(pg.db, async (tx) => {
      await setAuditActor(tx, "rep@wren.example");
      return setCallOutcome(tx, {
        ids,
        outcome,
        reason: reason ?? null,
        by: "rep@wren.example",
        now,
      });
    });

  it("marks a started, booked call only, and Clear takes it back", async () => {
    const call = await bookedCall();
    expect(await mark([call.id], "won", NOW)).toEqual([]);
    const after = new Date(START.getTime() + 3_600_000);
    const [won] = await mark([call.id], "not_yet", after, "Budget");
    expect(won).toMatchObject({ id: call.id, outcome: "not_yet", reason: "Budget" });
    const [row] = await pg.db.select().from(callBookings);
    expect(row).toMatchObject({ outcome: "not_yet", outcomeBy: "rep@wren.example" });
    await mark([call.id], null, after);
    const [cleared] = await pg.db.select().from(callBookings);
    expect(cleared).toMatchObject({ outcome: null, outcomeReason: null, outcomeBy: null });
  });

  it("skips a cancelled call", async () => {
    const call = await bookedCall({ state: "cancelled" });
    expect(await mark([call.id], "won", new Date(START.getTime() + 3_600_000))).toEqual([]);
  });
});

describe("a client's Calls app", () => {
  const POLICY = SendPolicy.fromSettings(
    loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
  );
  const open = (c: { database: string }) => cachedDb(clientDatabaseUrl(pg.url, c.database));
  const operator = { viewer: { email: "op@example.test", operator: true } };
  const api = () =>
    emailConsoleApi({ db: pg.db, senders: [], policy: POLICY, clients: { main: pg.db, open } });

  it("reads its own calls with their brief once installed, and refuses where it isn't", async () => {
    await addClient(pg.db, pg.url, {
      id: "gamma",
      name: "Gamma",
      products: { "calls.outcome": {} },
    });
    await addClient(pg.db, pg.url, { id: "delta", name: "Delta", products: {} });
    const gamma = open({ database: "wren_client_gamma" });
    const [call] = await gamma
      .insert(callBookings)
      .values({ uid: "cal-g-1", state: "booked", start: START, name: "Bo Example", bookedAt: NOW })
      .returning();
    const types = await api().recordsTypes({ ...operator, client: "gamma" });
    expect(types.map((t) => t.id)).toEqual(["email.call"]);
    const page = await api().recordsList({ ...operator, client: "gamma", record: "email.call" });
    expect(page.rows.map((r) => r.who)).toEqual(["Bo Example"]);
    const got = await api().recordsGet({
      ...operator,
      client: "gamma",
      record: "email.call",
      id: String(call?.id),
    });
    expect((got.detail as { brief: { call: { who: string } } }).brief.call.who).toBe("Bo Example");
    await expect(api().recordsTypes({ ...operator, client: "delta" })).rejects.toMatchObject({
      status: 404,
    });
    const at = await api().callsOf({ ...operator, client: "gamma", ids: [call?.id ?? 0] });
    expect(at).toMatchObject({ client: "gamma", ids: [call?.id], by: "op@example.test" });
    await expect(api().callsOf({ ...operator, client: "delta", ids: [1] })).rejects.toMatchObject({
      status: 404,
    });
  });
});
