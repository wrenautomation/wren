/**
 * The workspace's per-person cap (B4) on texts: a follow-up or a warm sequence step counts and
 * waits for room; cold steps, answers and an operator's own texts are never counted or held.
 * Synthetic numbers; the fake provider sends nothing.
 */
import { saveMessageSettings } from "@wren/core/message-settings";
import { resolveProfile } from "@wren/core/profiles";
import { marketingSends } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tick } from "../../src/deliver.js";
import { FakeProvider } from "../../src/provider.js";
import { type SmsMessage, smsContacts, smsMessages, smsNumbers } from "../../src/schema.js";
import { numbers, OPEN, POLICY, SEQUENCES, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "marketing_sends", "message_settings", "profiles"]);
  provider = new FakeProvider();
  await numbers(pg.db, provider, ["+13125550001"]);
});

const HOUR = 3_600_000;
const PHONE = "+12125550101";
const KEY = `phone:${PHONE}`;

async function contact(o: Partial<typeof smsContacts.$inferInsert> = {}): Promise<number> {
  const [n] = await pg.db.select().from(smsNumbers).limit(1);
  const [c] = await pg.db
    .insert(smsContacts)
    .values({
      e164: PHONE,
      sourceKind: "form",
      sourceRef: "form-1",
      basis: "opt_in",
      name: "dana smith",
      numberId: n?.id ?? null,
      state: "finished",
      ...o,
      ...(o.sequence ? { enrolledAt: new Date(OPEN.getTime() - 24 * HOUR) } : {}),
    })
    .returning({ id: smsContacts.id });
  return c?.id as number;
}

async function queue(
  contactId: number,
  o: Partial<typeof smsMessages.$inferInsert> & { kind: SmsMessage["kind"] },
): Promise<number> {
  const [n] = await pg.db.select().from(smsNumbers).limit(1);
  const [m] = await pg.db
    .insert(smsMessages)
    .values({
      contactId,
      direction: "out",
      numberId: n?.id ?? null,
      toE164: PHONE,
      body: "Hi Dana, a note from Test Co.",
      state: "queued",
      dueAt: new Date(OPEN.getTime() - 60_000),
      ...o,
    })
    .returning({ id: smsMessages.id });
  return m?.id as number;
}

const run = (now = OPEN, linkSource?: string) =>
  tick(pg.db, {
    provider,
    policy: POLICY,
    live: true,
    sequences: SEQUENCES,
    senderName: "Test Co",
    ...(linkSource ? { linkSource } : {}),
    now,
  });

const ledger = () => pg.db.select().from(marketingSends);
const seed = (key: string, hoursAgo: number[], channel: "email" | "sms" | "dm" = "email") =>
  pg.db.insert(marketingSends).values(
    hoursAgo.map((h) => ({
      personKey: key,
      channel,
      sentAt: new Date(OPEN.getTime() - h * HOUR),
    })),
  );
const rowOf = async (id: number) =>
  (await pg.db.select().from(smsMessages).where(eq(smsMessages.id, id)))[0] as SmsMessage;

describe("the cap on follow-up texts", () => {
  it("counts a follow-up it sends, under the workflow's name", async () => {
    const id = await contact();
    await queue(id, { kind: "follow_up", ref: "keep_warm/follow.text1", template: "follow-up#1" });
    expect(await run()).toMatchObject({ sent: 1, capped: 0 });
    expect(await ledger()).toMatchObject([
      { personKey: KEY, channel: "sms", campaign: "keep_warm" },
    ]);
  });

  it("holds a follow-up until the person has room, then sends it", async () => {
    const id = await contact();
    // Two a day by default: two emails an hour and five hours ago fill today.
    await seed(KEY, [1, 5]);
    const m = await queue(id, { kind: "follow_up", ref: "keep_warm/follow.text1" });
    expect(await run()).toMatchObject({ sent: 0, capped: 1 });
    expect(provider.sent).toEqual([]);
    const held = await rowOf(m);
    expect(held.state).toBe("queued");
    // The five-hour-old send leaves the day's window 19 hours from now.
    expect(held.dueAt?.toISOString()).toBe(new Date(OPEN.getTime() + 19 * HOUR).toISOString());
    // Nothing is counted for a text that did not go.
    expect(await ledger()).toHaveLength(2);
    // Past that time it goes, and counts. A day on is the same hour, inside texting hours.
    expect(await run(new Date(OPEN.getTime() + 24 * HOUR))).toMatchObject({ sent: 1 });
    expect(await ledger()).toHaveLength(3);
  });

  it("holds for the week as well as the day", async () => {
    const id = await contact();
    // Five over the last six days (the default week), none today.
    await seed(KEY, [30, 54, 78, 102, 126]);
    const m = await queue(id, { kind: "follow_up", ref: "keep_warm/follow.text1" });
    expect(await run()).toMatchObject({ sent: 0, capped: 1 });
    // The oldest leaves the week 42 hours from now (126 hours old; the week is 168).
    expect((await rowOf(m)).dueAt?.toISOString()).toBe(
      new Date(OPEN.getTime() + 42 * HOUR).toISOString(),
    );
  });

  it("adds one person's email, text and DM when People knows them as one", async () => {
    const id = await contact();
    // No setPersonResolver: People's profiles are the default.
    const p = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "dana@example.test" },
        { kind: "phone", value: PHONE },
        { kind: "handle:linkedin", value: "dana-smith" },
      ],
      "test",
    );
    const key = `profile:${p?.id}`;
    await seed(key, [1], "email");
    await seed(key, [2], "dm");
    const m = await queue(id, { kind: "follow_up", ref: "keep_warm/follow.text1" });
    expect(await run()).toMatchObject({ sent: 0, capped: 1 });
    expect((await rowOf(m)).state).toBe("queued");
    // A stranger with the same name on another number is not held by it.
    const other = await contact({ e164: "+12125550102", sourceRef: "form-2" });
    await queue(other, {
      kind: "follow_up",
      ref: "keep_warm/follow.text2",
      toE164: "+12125550102",
    });
    expect(await run()).toMatchObject({ sent: 1 });
    expect((await ledger()).map((r) => r.personKey)).toContain("phone:+12125550102");
  });

  it("sends with no cap when the workspace has none", async () => {
    const id = await contact();
    await seed(KEY, [1, 2, 3, 4, 5, 6]);
    await saveMessageSettings(pg.db, { capPerDay: null, capPerWeek: null }, "test");
    await queue(id, { kind: "follow_up", ref: "keep_warm/follow.text1" });
    expect(await run()).toMatchObject({ sent: 1, capped: 0 });
  });
});

describe("what the cap leaves alone", () => {
  it("never holds or counts an operator's text, a text back or a cold step", async () => {
    await seed(KEY, [1, 2, 3, 4, 5]);
    const asked = await contact();
    await queue(asked, { kind: "manual", body: "Yes, Thursday works." });
    await queue(asked, { kind: "text_back", ref: "call:1", body: "Sorry we missed you." });
    const cold = await contact({
      e164: "+12125550103",
      sourceKind: "tel_link",
      sourceRef: "https://acme.example",
      basis: "published",
      state: "enrolled",
      sequence: "recruiting-sms",
    });
    expect(await run()).toMatchObject({ sent: 2, capped: 0 });
    // A number sends one cold step a pass: the cold one goes on its own.
    await queue(cold, { kind: "sequence", step: 1, toE164: "+12125550103", template: null });
    expect(await run(new Date(OPEN.getTime() + 60_000))).toMatchObject({ sent: 1, capped: 0 });
    // Only the five seeded sends are in the ledger.
    expect(await ledger()).toHaveLength(5);
  });

  it("counts a warm sequence step after the opener, not the opener", async () => {
    const id = await contact({ state: "enrolled", sequence: "recruiting-sms" });
    await queue(id, { kind: "sequence", step: 1, template: null });
    await run();
    expect(await ledger()).toEqual([]);
    await queue(id, { kind: "sequence", step: 2, template: null });
    await run(new Date(OPEN.getTime() + HOUR));
    expect(await ledger()).toMatchObject([{ personKey: KEY, channel: "sms" }]);
  });

  it("never holds the first text to someone who asked: a person at the cap still gets the answer", async () => {
    await seed(KEY, [1, 2]);
    const id = await contact({ state: "enrolled", sequence: "recruiting-sms" });
    await queue(id, { kind: "sequence", step: 1, template: null });
    expect(await run()).toMatchObject({ sent: 1, capped: 0 });
  });
});

describe("link parameters on a follow-up text", () => {
  it("tags a link with the workflow's name as it goes", async () => {
    const id = await contact();
    await queue(id, {
      kind: "follow_up",
      ref: "keep_warm/follow.text1",
      body: "Book here: https://cal.example/intro",
    });
    await run(OPEN, "Acme Co");
    expect(provider.sent.map((m) => m.text)).toEqual([
      "Book here: https://cal.example/intro?utm_source=acme-co&utm_medium=sms&utm_campaign=keep-warm",
    ]);
  });
});
