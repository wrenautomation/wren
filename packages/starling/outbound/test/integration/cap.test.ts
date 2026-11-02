/**
 * The workspace's per-person cap (B4) on DMs: a follow-up DM waits for room and counts when it
 * goes; a cold sequence step is never counted or held by it. Synthetic contacts; the fake
 * channel sends nothing.
 */
import { fakeOutreachChannel } from "@wren/core/outreach";
import { resolveProfile } from "@wren/core/profiles";
import { marketingSends } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { addContact } from "../../src/contacts.js";
import { enroll } from "../../src/enroll.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { type ReachAccount, reachMessages } from "../../src/schema.js";
import { REACH_SEQUENCES, slotsOf, stepKey, subjectKey } from "../../src/sequences.js";
import { setTemplate } from "../../src/store.js";
import { tick } from "../../src/tick.js";

const POLICY = { ...DEFAULT_POLICY, gapSeconds: 0 };
// Thursday 14:00 New York.
const OPEN = new Date("2026-10-01T18:00:00Z");
const HOUR = 3_600_000;
const SLOTS = slotsOf(REACH_SEQUENCES.values());
const REDDIT = REACH_SEQUENCES.get("reddit-dm");
if (!REDDIT) throw new Error("reddit-dm");

let pg: TestPostgres;
let channel: ReturnType<typeof fakeOutreachChannel>;
let contactId: number;
let accountId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "reach_messages",
    "reach_contacts",
    "reach_accounts",
    "templates",
    "template_versions",
    "marketing_sends",
    "message_settings",
    "profiles",
  ]);
  channel = fakeOutreachChannel("reddit", { account: "reddit@alt", connects: false });
  channel.setHealth({
    handle: "alt",
    createdAt: new Date(OPEN.getTime() - 45 * 86_400_000).toISOString(),
    karma: 200,
    suspended: false,
  });
  const a = await addAccount(pg.db, {
    platform: "reddit",
    account: "reddit@alt",
    now: new Date(OPEN.getTime() - 40 * 86_400_000),
  });
  accountId = a.id;
  await refreshHealth(pg.db, [a], () => channel, new Date(OPEN.getTime() - 40 * 86_400_000));
  await setAccountState(pg.db, a.id, "active", { reason: null, now: OPEN });
  const c = await addContact(pg.db, { platform: "reddit", handle: "u/dana_dev", name: "Dana Lee" });
  contactId = c.id;
});

const KEY = "handle:reddit:dana_dev";

const run = (now = OPEN) =>
  tick(pg.db, {
    channelFor: (_a: ReachAccount) => channel,
    policy: POLICY,
    sequences: REACH_SEQUENCES,
    sender: "William",
    live: true,
    now,
  });

const seed = (hoursAgo: number[], key = KEY, kind: "email" | "sms" | "dm" = "email") =>
  pg.db.insert(marketingSends).values(
    hoursAgo.map((h) => ({
      personKey: key,
      channel: kind,
      sentAt: new Date(OPEN.getTime() - h * HOUR),
    })),
  );
const ledger = () => pg.db.select().from(marketingSends);

async function followUp(): Promise<number> {
  const [m] = await pg.db
    .insert(reachMessages)
    .values({
      contactId,
      accountId,
      direction: "out",
      kind: "follow_up",
      body: "Following up: https://example.test/guide",
      state: "queued",
      dueAt: new Date(OPEN.getTime() - 60_000),
      provenance: { follow: "keep_warm/follow.dm1" },
    })
    .returning({ id: reachMessages.id });
  return m?.id as number;
}
const row = async (id: number) =>
  (await pg.db.select().from(reachMessages).where(eq(reachMessages.id, id)))[0];

describe("the cap on follow-up DMs", () => {
  it("counts a follow-up DM it sends, under the workflow's name", async () => {
    const id = await followUp();
    await run();
    expect(channel.sent).toHaveLength(1);
    expect((await row(id))?.state).toBe("sent");
    expect(await ledger()).toMatchObject([
      { personKey: KEY, channel: "dm", campaign: "keep_warm" },
    ]);
  });

  it("holds a follow-up DM until the person has room, then sends it", async () => {
    await seed([1, 5]);
    const id = await followUp();
    await run();
    expect(channel.sent).toEqual([]);
    const held = await row(id);
    expect(held).toMatchObject({ state: "queued", stateReason: "over the frequency cap" });
    expect(held?.dueAt?.toISOString()).toBe(new Date(OPEN.getTime() + 19 * HOUR).toISOString());
    expect(await ledger()).toHaveLength(2);
    // 20 hours on is Friday 10:00 New York: it goes, and counts.
    await run(new Date(OPEN.getTime() + 20 * HOUR));
    expect(channel.sent).toHaveLength(1);
    expect(await ledger()).toHaveLength(3);
  });

  it("shares the cap with the person's email and text through People", async () => {
    const p = await resolveProfile(
      pg.db,
      [
        { kind: "handle:reddit", value: "u/dana_dev" },
        { kind: "email", value: "dana@example.test" },
      ],
      "test",
    );
    await seed([1, 2], `profile:${p?.id}`);
    const id = await followUp();
    await run();
    expect((await row(id))?.state).toBe("queued");
    expect(channel.sent).toEqual([]);
  });
});

describe("what the cap leaves alone", () => {
  it("never holds or counts a cold sequence step", async () => {
    await seed([1, 2, 3, 4, 5]);
    const set = (key: string, body: string) =>
      setTemplate(pg.db, { slots: SLOTS, sender: "William" }, { key, body, by: "test" });
    await set(subjectKey(REDDIT, 1), "the guide");
    await set(stepKey(REDDIT, 1), "Hi {first_name|there}, the guide.");
    await set(stepKey(REDDIT, 2), "Bumping this.");
    await enroll(pg.db, { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    await run();
    expect(channel.sent).toHaveLength(1);
    expect(await ledger()).toHaveLength(5);
  });
});
