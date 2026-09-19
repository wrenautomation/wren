/**
 * Open tracking end to end against the migrated schema (C-D12).
 *
 * Three things have to hold: the sync is idempotent by the host's own row id,
 * a fetch we cannot attach to a message is counted and dropped rather than
 * stored, and `open_outcomes` counts only messages that actually carried a
 * pixel — never a campaign that ran before the flag was flipped.
 */
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenSyncError, syncOpens } from "../../src/inbox/opens.js";
import { enrollments, type Message, messages, openEvents, openSyncs } from "../../src/schema.js";
import { openOutcomes } from "../../src/views.js";
import { makeCompany, makePerson, runCompose, TABLES } from "./compose-fixtures.js";

const NOW = new Date(Date.UTC(2026, 8, 9, 15, 0));
const BASE = "https://t.wrenautomation.com";
const SECRET = "not-the-real-one";
const MIN = 60_000;
const HOUR = 60 * MIN;
const plus = (ms: number) => new Date(NOW.getTime() + ms);

interface Hit {
  id: number;
  token: string;
  seen_at: string;
  user_agent: string;
}

/** A stand-in for the worker's /export: serves `pages` in order, refuses a wrong bearer the way it does. */
function host(pages: Hit[][], opts: { expectSecret?: string } = {}) {
  const calls: URL[] = [];
  const expected = opts.expectSecret ?? SECRET;
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    calls.push(parsed);
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${expected}`) return new Response("no", { status: 401 });
    const since = Number(parsed.searchParams.get("since") ?? "0");
    const hits = pages.flat().filter((hit) => hit.id > since);
    return Response.json({ hits });
  };
  return { fetch, calls };
}

const hit = (id: number, token: string, seenAt: Date, agent = "Mozilla/5.0"): Hit => ({
  id,
  token,
  seen_at: seenAt.toISOString(),
  user_agent: agent,
});

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "open_events", "open_syncs"]));
const db = (): Db => pg.db;

async function trackedMessage(opts: {
  token: string | null;
  sentAt: Date;
  domain: string;
}): Promise<Message> {
  const company = await makeCompany(db(), { domain: opts.domain });
  const address = `jane@${opts.domain}`;
  const person = await makePerson(db(), company, { email: address });
  const [enrollment] = await db()
    .insert(enrollments)
    .values({
      personId: person.id,
      companyId: company.id,
      kind: "person",
      toEmail: address,
      sender: "will@wren-automation.com",
      niche: "agencies",
      sequenceName: "pilot-days-0-3-7",
      sequenceSnapshot: {
        name: "pilot-days-0-3-7",
        steps: [{ template: "opener", day: 0 }],
      },
      state: "active",
    })
    .returning();
  if (!enrollment) throw new Error("no enrollment");
  const [message] = await db()
    .insert(messages)
    .values({
      enrollmentId: enrollment.id,
      step: 0,
      template: "opener",
      templateVersion: "v1",
      toEmail: address,
      subject: "automation at Acme",
      body: "Hi Jane,\n\nWilliam",
      provenance: {},
      state: "sent",
      openToken: opts.token,
      messageId: `<${opts.token ?? "untracked"}@wren-automation.com>`,
      gmailId: "g-sent",
      threadId: "t-sent",
      attemptedAt: opts.sentAt,
      transport: "gmail",
      sentAt: opts.sentAt,
    })
    .returning();
  if (!message) throw new Error("no message");
  return message;
}

const sync = (fetch: ReturnType<typeof host>["fetch"], baseUrl = BASE) =>
  syncOpens(db(), { baseUrl, exportToken: SECRET, fetch });

const sinceOf = (url: URL | undefined) => Number(url?.searchParams.get("since"));

describe("open tracking", () => {
  it("a second sync of the same window writes nothing new", async () => {
    const message = await trackedMessage({
      token: "a".repeat(24),
      sentAt: NOW,
      domain: "one.example",
    });
    const { fetch } = host([[hit(1, "a".repeat(24), plus(30 * MIN))]]);

    const first = await sync(fetch);
    expect(first.stored).toBe(1);

    const second = await sync(fetch);
    expect(second.fetched).toBe(0);
    expect(second.stored).toBe(0);
    const stored = await db().select().from(openEvents).where(eq(openEvents.messageId, message.id));
    expect(stored.length).toBe(1);
  });

  it("a fetch we cannot attach to a message is counted and dropped", async () => {
    await trackedMessage({ token: "b".repeat(24), sentAt: NOW, domain: "two.example" });
    const { fetch } = host([
      [hit(1, "b".repeat(24), plus(5 * MIN)), hit(2, "z".repeat(24), plus(5 * MIN))],
    ]);

    const stats = await sync(fetch);

    expect(stats.stored).toBe(1);
    expect(stats.unknown_token).toBe(1);
    const [total] = await db().select({ n: count() }).from(openEvents);
    expect(total?.n).toBe(1);
  });

  it("a refused credential is named without being printed", async () => {
    const { fetch } = host([[]], { expectSecret: "something-else" });

    const raised = await sync(fetch).catch((err: unknown) => err);

    expect(raised).toBeInstanceOf(OpenSyncError);
    expect(String(raised)).toContain("WREN_PIXEL_EXPORT_TOKEN");
    expect(String(raised)).not.toContain(SECRET);
  });

  it("the view separates a prefetch from a person", async () => {
    // Apple Mail fetches the image on delivery whether or not anyone looked.
    await trackedMessage({ token: "c".repeat(24), sentAt: NOW, domain: "fast.example" });
    await trackedMessage({ token: "d".repeat(24), sentAt: NOW, domain: "slow.example" });
    const { fetch } = host([
      [
        hit(1, "c".repeat(24), plus(3_000), "Mozilla/5.0 (Macintosh)"),
        hit(2, "d".repeat(24), plus(14 * HOUR)),
      ],
    ]);

    await sync(fetch);

    const [row] = await db().select().from(openOutcomes).where(eq(openOutcomes.niche, "agencies"));
    expect(row?.trackedSent).toBe(2);
    expect(row?.openedRaw).toBe(2);
    expect(row?.openedHumanPlausible).toBe(1);
  });

  it("untracked mail is absent from the view, not counted as unopened", async () => {
    await trackedMessage({ token: null, sentAt: NOW, domain: "dark.example" });
    expect(await db().select().from(openOutcomes)).toEqual([]);
  });

  it("compose mints no token unless tracking is on", async () => {
    const company = await makeCompany(db(), { domain: "oakbridge.example" });
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    expect((await runCompose(db())).enrolled).toBe(1);
    const tokens = (await db().select({ t: messages.openToken }).from(messages)).map((r) => r.t);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t === null)).toBe(true);
  });

  it("compose mints one distinct token per draft when tracking is on", async () => {
    const company = await makeCompany(db(), { domain: "oakbridge.example" });
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const stats = await runCompose(db(), { trackOpens: true });
    const tokens = (await db().select({ t: messages.openToken }).from(messages)).map((r) => r.t);
    expect(tokens.length).toBe(stats.messages_drafted);
    expect(tokens.length).toBeGreaterThan(1);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens.every((t) => t !== null && t.length >= 16)).toBe(true);
  });

  it("unattached hits are passed, not re-read every sync", async () => {
    // Nothing here can be stored, so a cursor derived from what we KEEP would sit at zero forever.
    const { fetch, calls } = host([[1, 2, 3, 4].map((n) => hit(n, "z".repeat(24), NOW))]);

    const first = await sync(fetch);
    expect([first.fetched, first.stored, first.unknown_token]).toEqual([4, 0, 4]);

    const second = await sync(fetch);
    expect([second.fetched, second.unknown_token]).toEqual([0, 0]);
    expect(sinceOf(calls.at(-1))).toBe(4);
  });

  it("each host carries its own cursor", async () => {
    const other = "https://t2.wrenautomation.com";
    await sync(host([[hit(9, "z".repeat(24), NOW)]]).fetch);

    const fresh = host([[hit(1, "z".repeat(24), NOW)]]);
    await sync(fresh.fetch, other);

    expect(sinceOf(fresh.calls[0])).toBe(0);
  });

  it("a cursor never moves backwards", async () => {
    await sync(host([[1, 2, 3].map((n) => hit(n, "z".repeat(24), NOW))]).fetch);

    await sync(host([[hit(1, "z".repeat(24), NOW)]]).fetch);

    const [cursor] = await db().select().from(openSyncs).where(eq(openSyncs.baseUrl, BASE));
    expect(cursor?.cursorId).toBe(3);
  });
});
