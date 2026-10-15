/**
 * A reply goes out as the account a person picked (designs/2026-10-15-accounts-first-class.md):
 * two synthetic Reddit logins on fake channels, the thread on one, the pick on the other, the
 * send from the pick. Postgres, a fixed clock.
 */
import { fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { addContact, contactById } from "../../src/contacts.js";
import { accountPickFor, pickAccount, pickedAccount } from "../../src/draft-accounts.js";
import { queueDraft } from "../../src/drafts.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { ReachRefusal } from "../../src/refusal.js";
import { type ReachAccount, reachContacts } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";
import { tick } from "../../src/tick.js";

const TABLES = [
  "draft_accounts",
  "reach_messages",
  "reach_contacts",
  "reach_accounts",
  "social_handles",
  "profiles",
];
const OPEN = new Date("2026-10-01T18:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(OPEN.getTime() + days * DAY);

let pg: TestPostgres;
const db = () => pg.db;
type Fake = ReturnType<typeof fakeOutreachChannel>;
let fakes: Map<string, Fake>;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  fakes = new Map();
});

const channelFor = (a: ReachAccount) => {
  let f = fakes.get(a.account);
  if (!f) {
    f = fakeOutreachChannel(a.platform, { account: a.account, connects: false });
    fakes.set(a.account, f);
  }
  return f;
};

async function account(platform: "reddit" | "linkedin", key: string, handle: string) {
  const a = await addAccount(db(), { platform, account: key, now: at(-40) });
  if (platform === "reddit")
    channelFor(a).setHealth({
      handle,
      createdAt: at(-45).toISOString(),
      karma: 200,
      suspended: false,
    });
  await refreshHealth(db(), [a], channelFor, at(-40));
  return setAccountState(db(), a.id, "active", { reason: null, now: at(-40) });
}

const tickAt = (now: Date) =>
  tick(db(), {
    channelFor,
    policy: { ...DEFAULT_POLICY, gapSeconds: 0 },
    sequences: REACH_SEQUENCES,
    sender: "William",
    live: true,
    now,
  });

describe("a reply's account", () => {
  it("defaults to the one they spoke to; a pick sends from the pick", async () => {
    const one = await account("reddit", "reddit@one", "synthetic_one");
    const two = await account("reddit", "reddit@two", "synthetic_two");
    await account("linkedin", "linkedin@one", "Synthetic Co");
    const c = await addContact(db(), { platform: "reddit", handle: "synthetic_lead" });
    await db().update(reachContacts).set({ accountId: one.id });
    const item = `dm:${c.id}`;

    const before = await accountPickFor(db(), item, at(0));
    expect(before?.platform).toBe("reddit");
    expect(before?.fallback).toBe("reddit@one");
    expect(before?.current).toBe("reddit@one");
    expect(before?.picked).toBe(false);
    expect(before?.options.map((o) => o.key).sort()).toEqual(["reddit@one", "reddit@two"]);

    await expect(pickAccount(db(), { item, account: "linkedin@one" })).rejects.toThrow(
      ReachRefusal,
    );
    const after = await pickAccount(db(), { item, account: "reddit@two", by: "test" });
    expect(after).toMatchObject({ current: "reddit@two", fallback: "reddit@one", picked: true });

    const msg = await queueDraft(
      db(),
      await contactById(db(), c.id),
      "From the other one",
      null,
      at(0),
    );
    expect(msg.accountId).toBe(two.id);
    const t = await tickAt(at(0.01));
    expect(t.sent).toBe(1);
    expect(fakes.get("reddit@two")?.sent.at(-1)?.text).toBe("From the other one");
    expect(fakes.get("reddit@one")?.sent ?? []).toHaveLength(0);

    await pickAccount(db(), { item, account: "" });
    expect(await pickedAccount(db(), item)).toBeNull();
  });

  it("a platform with one account has nothing to pick", async () => {
    const a = await account("linkedin", "linkedin@one", "Synthetic Co");
    const c = await addContact(db(), { platform: "linkedin", handle: "synthetic-lead" });
    await db().update(reachContacts).set({ accountId: a.id });
    expect(await accountPickFor(db(), `dm:${c.id}`)).toBeNull();
  });
});
