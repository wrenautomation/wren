/**
 * Cold outreach end to end on Postgres with fake channels and a fixed clock:
 * accounts → templates → contacts → enroll → the tick (gated, held, sent,
 * next step, finished) → replies and STOP → LinkedIn's invite-then-message
 * path → failures (429 hold, 4xx unreachable, crash mid-send) → stats.
 */

import { SiteCallError } from "@wren/core/content";
import { fakeOutreachChannel } from "@wren/core/outreach";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, listAccounts, refreshHealth, setAccountState } from "../../src/accounts.js";
import { addContact, contactById } from "../../src/contacts.js";
import { enroll } from "../../src/enroll.js";
import { DEFAULT_POLICY, type ReachPolicy } from "../../src/policy.js";
import { dmCopyRecord, dmRecord } from "../../src/records.js";
import { ReachRefusal } from "../../src/refusal.js";
import { pullReplies } from "../../src/replies.js";
import { type ReachAccount, reachMessages } from "../../src/schema.js";
import {
  CONNECT_NOTE,
  REACH_SEQUENCES,
  type ReachSequence,
  slotsOf,
  stepKey,
  subjectKey,
} from "../../src/sequences.js";
import { setTemplate } from "../../src/store.js";
import { getThread, listThreads, reachStats } from "../../src/threads.js";
import { queueManual, reconcile, STALE_SENDING_MS, tick, touch } from "../../src/tick.js";

const TABLES = ["reach_messages", "reach_contacts", "reach_accounts", "reach_templates"];
const POLICY: ReachPolicy = { ...DEFAULT_POLICY, gapSeconds: 0 };
// Thursday 14:00 New York.
const OPEN = new Date("2026-10-01T18:00:00Z");
const DAY = 86_400_000;
const at = (days: number, base = OPEN) => new Date(base.getTime() + days * DAY);
const SLOTS = slotsOf(REACH_SEQUENCES.values());
const seqOf = (name: string): ReachSequence => {
  const s = REACH_SEQUENCES.get(name);
  if (!s) throw new Error(name);
  return s;
};
const REDDIT = seqOf("reddit-dm");
const LINKEDIN = seqOf("linkedin-connect");

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
  const set = (key: string, body: string) =>
    setTemplate(db(), { slots: SLOTS, sender: "William", now: OPEN }, { key, body, by: "test" });
  await set(subjectKey(REDDIT, 1), "quick one from {found_in|reddit}");
  await set(
    stepKey(REDDIT, 1),
    "Hi {first_name|there}, saw you in {found_in|the thread}. {sender}",
  );
  await set(stepKey(REDDIT, 2), "Bumping this, {first_name|there}.");
  await set(CONNECT_NOTE, "Saw your post in {found_in|the feed}, {first_name|there}.");
  await set(stepKey(LINKEDIN, 1), "Thanks for connecting {first_name|there}.");
  await set(stepKey(LINKEDIN, 2), "One more thought.");
});

const channelFor = (a: ReachAccount) => {
  let f = fakes.get(a.account);
  if (!f) {
    f = fakeOutreachChannel(a.platform, {
      account: a.account,
      connects: a.platform === "linkedin",
    });
    fakes.set(a.account, f);
  }
  return f;
};
const fakeOf = (account: string): Fake => {
  const f = fakes.get(account);
  if (!f) throw new Error(`no fake for ${account}`);
  return f;
};

async function account(platform: "reddit" | "linkedin", key: string, now = at(-40)) {
  const a = await addAccount(db(), { platform, account: key, now });
  const ch = channelFor(a);
  if (platform === "reddit")
    ch.setHealth({ handle: "alt", createdAt: at(-45).toISOString(), karma: 200, suspended: false });
  await refreshHealth(db(), [a], channelFor, now);
  return setAccountState(db(), a.id, "active", { reason: null, now });
}

const tickAt = async (now: Date, live = true) => {
  const stats = await tick(db(), {
    channelFor,
    policy: POLICY,
    sequences: REACH_SEQUENCES,
    sender: "William",
    live,
    now,
  });
  // The spine, by hand: each sent step's next touch, as its wire's wait ends.
  for (const s of stats.stepped) {
    const next = seqOf(s.sequence).steps.find((x) => x.step === s.step + 1);
    if (!next) continue;
    const due = at(next.afterDays, now);
    await touch(db(), s.contactId, next.step, {
      sequences: REACH_SEQUENCES,
      sender: "William",
      now: due,
    });
  }
  return stats;
};

const messagesOf = (contactId: number) =>
  db()
    .select()
    .from(reachMessages)
    .where(eq(reachMessages.contactId, contactId))
    .orderBy(reachMessages.id);

describe("accounts", () => {
  it("needs a credential key of the platform", async () => {
    await expect(
      addAccount(db(), { platform: "reddit", account: "alt", now: OPEN }),
    ).rejects.toThrow(ReachRefusal);
    await expect(
      addAccount(db(), { platform: "reddit", account: "linkedin@x", now: OPEN }),
    ).rejects.toThrow(ReachRefusal);
    const a = await addAccount(db(), { platform: "reddit", account: "reddit@alt", now: OPEN });
    expect(a.state).toBe("warming");
    const again = await addAccount(db(), { platform: "reddit", account: "reddit@alt", now: OPEN });
    expect(again.id).toBe(a.id);
  });
  it("a suspended account pauses itself on a health read", async () => {
    const a = await account("reddit", "reddit@alt");
    fakeOf("reddit@alt").setHealth({ suspended: true });
    const r = await refreshHealth(db(), [a], channelFor, OPEN);
    expect(r.frozen).toEqual(["reddit@alt"]);
    const [row] = await listAccounts(db());
    expect(row?.state).toBe("paused");
  });
});

describe("reddit sequence", () => {
  it("enrolls, holds while gated, sends in the window, queues step 2, finishes", async () => {
    await account("reddit", "reddit@alt");
    const c = await addContact(db(), {
      platform: "reddit",
      handle: "u/dana_dev",
      name: "Dana Lee",
    });
    expect(c.handle).toBe("dana_dev");
    const e = await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    expect(e).toEqual({ considered: 1, enrolled: 1, noAccount: false });
    const [first] = await messagesOf(c.id);
    expect(first?.body).toBe("Hi Dana, saw you in the thread. William");
    expect(first?.subject).toBe("quick one from reddit");

    const gated = await tickAt(OPEN, false);
    expect(gated.held).toEqual({ gated: 1 });
    const night = await tickAt(new Date("2026-10-02T03:00:00Z"));
    expect(night.held).toEqual({ window: 1 });

    const sent = await tickAt(OPEN);
    expect(sent.sent).toBe(1);
    expect(fakeOf("reddit@alt").sent).toEqual([
      { kind: "message", handle: "dana_dev", text: first?.body },
    ]);
    const rows = await messagesOf(c.id);
    expect(rows.map((r) => [r.step, r.state])).toEqual([
      [1, "sent"],
      [2, "queued"],
    ]);
    expect(rows[1]?.dueAt?.getTime()).toBe(at(5).getTime());
    expect(sent.stepped).toEqual([{ contactId: c.id, sequence: REDDIT.name, step: 1 }]);
    // A retried touch queues nothing more; a reply answers instead.
    const o = { sequences: REACH_SEQUENCES, sender: "William", now: OPEN };
    expect(await touch(db(), c.id, 2, o)).toBe("queued");
    expect(await messagesOf(c.id)).toHaveLength(2);

    expect((await tickAt(at(1))).sent).toBe(0);
    const step2 = await tickAt(at(5));
    expect(step2.sent).toBe(1);
    expect(step2.finished).toBe(1);
    expect((await contactById(db(), c.id)).state).toBe("finished");
  });

  it("one send per account per tick and the day's cap", async () => {
    await account("reddit", "reddit@alt");
    for (const h of ["alpha1", "alpha2", "alpha3", "alpha4", "alpha5", "alpha6", "alpha7"])
      await addContact(db(), { platform: "reddit", handle: h });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    const first = await tickAt(OPEN);
    expect(first.sent).toBe(1);
    expect(first.held).toEqual({ gap: 6 });
    let total = 1;
    for (let i = 0; i < 6; i++) total += (await tickAt(OPEN)).sent;
    expect(total).toBe(5);
    const capped = await tickAt(OPEN);
    expect(capped.held).toEqual({ cap: 2 });
  });

  it("a lurking account may not message yet", async () => {
    const a = await addAccount(db(), { platform: "reddit", account: "reddit@new", now: OPEN });
    channelFor(a).setHealth({ createdAt: at(-1).toISOString(), karma: 0 });
    await refreshHealth(db(), [a], channelFor, OPEN);
    await setAccountState(db(), a.id, "active", { reason: null, now: OPEN });
    await addContact(db(), { platform: "reddit", handle: "someone" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    expect((await tickAt(OPEN)).held).toEqual({ cap: 1 });
  });

  it("replies land on the thread; STOP opts out and skips the rest", async () => {
    await account("reddit", "reddit@alt");
    const c = await addContact(db(), { platform: "reddit", handle: "dana_dev" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    await tickAt(OPEN);
    const accounts = await listAccounts(db());
    fakeOf("reddit@alt").receive({
      ref: "t4_1",
      handle: "dana_dev",
      name: null,
      text: "sure, what is it?",
      at: at(0.05).toISOString(),
      threadUrl: null,
    });
    const r = await pullReplies(db(), accounts, channelFor, at(0.06));
    expect(r.received).toBe(1);
    expect((await contactById(db(), c.id)).state).toBe("replied");
    const threads = await listThreads(db(), { unread: true });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.last?.direction).toBe("in");

    const manual = await queueManual(db(), {
      contact: await contactById(db(), c.id),
      body: "Here it is",
      now: at(0.08),
    });
    expect(manual.kind).toBe("manual");
    // The sequence's step 2 is skipped once they replied; the manual one goes.
    const t = await tickAt(at(0.08));
    expect(t.sent).toBe(1);
    expect(fakeOf("reddit@alt").sent.at(-1)?.text).toBe("Here it is");

    fakeOf("reddit@alt").receive({
      ref: "t4_2",
      handle: "dana_dev",
      name: null,
      text: "please stop",
      at: at(0.1).toISOString(),
      threadUrl: null,
    });
    const again = await pullReplies(db(), accounts, channelFor, at(0.11));
    expect(again.optedOut).toBe(1);
    expect((await contactById(db(), c.id)).state).toBe("opted_out");
    const thread = await getThread(db(), c.id);
    expect(thread.messages.filter((m) => m.direction === "in")).toHaveLength(2);
    const same = await pullReplies(db(), accounts, channelFor, at(0.12));
    expect(same.received).toBe(0);
  });
});

describe("linkedin sequence", () => {
  it("invites, waits for the accept, then messages", async () => {
    await account("linkedin", "linkedin@alt", at(-30));
    const c = await addContact(db(), {
      platform: "linkedin",
      handle: "https://www.linkedin.com/in/ada-l/",
      name: "Ada Lovelace",
    });
    expect(c.handle).toBe("ada-l");
    await enroll(db(), { sequence: LINKEDIN, sender: "William", limit: 10, now: OPEN });
    const invited = await tickAt(OPEN);
    expect(invited.sent).toBe(1);
    const li = fakeOf("linkedin@alt");
    expect(li.sent[0]).toEqual({
      kind: "connect",
      handle: "ada-l",
      text: "Saw your post in the feed, Ada.",
    });
    let rows = await messagesOf(c.id);
    expect(rows.map((r) => [r.kind, r.state])).toEqual([
      ["connect", "sent"],
      ["sequence", "queued"],
    ]);

    const pending = await tickAt(at(1));
    expect(pending.held).toEqual({ pending: 1 });
    expect(li.sent).toHaveLength(1);

    li.relationships.set("ada-l", "connected");
    const went = await tickAt(at(4)); // Monday
    expect(went.connected).toBe(1);
    expect(went.sent).toBe(1);
    expect(li.sent[1]?.text).toBe("Thanks for connecting Ada.");
    expect((await contactById(db(), c.id)).state).toBe("connected");
    rows = await messagesOf(c.id);
    expect(rows.at(-1)?.step).toBe(2);
  });

  it("gives up on an invite after connectWaitDays", async () => {
    await account("linkedin", "linkedin@alt", at(-30));
    const c = await addContact(db(), { platform: "linkedin", handle: "ghost" });
    await enroll(db(), { sequence: LINKEDIN, sender: "William", limit: 10, now: OPEN });
    await tickAt(OPEN);
    const r = await tickAt(at(LINKEDIN.connectWaitDays + 5)); // a Tuesday
    expect(r.unreachable).toBe(1);
    expect((await contactById(db(), c.id)).state).toBe("unreachable");
  });

  it("ramps invites by the week", async () => {
    await account("linkedin", "linkedin@alt", OPEN);
    for (let i = 0; i < 7; i++)
      await addContact(db(), { platform: "linkedin", handle: `person-${i}` });
    await enroll(db(), { sequence: LINKEDIN, sender: "William", limit: 10, now: OPEN });
    let sent = 0;
    for (let i = 0; i < 8; i++) sent += (await tickAt(OPEN)).sent;
    expect(sent).toBe(5);
  });
});

describe("failures", () => {
  it("429 holds an hour, other 4xx ends the contact, a crash leaves unknown", async () => {
    await account("reddit", "reddit@alt");
    const c = await addContact(db(), { platform: "reddit", handle: "busy" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    const f = fakeOf("reddit@alt");
    const ok = f.message;
    f.message = async () => {
      throw new SiteCallError("reddit", "POST", "/api/compose", 429, "cap");
    };
    const held = await tickAt(OPEN);
    expect(held.held).toEqual({ retry: 1 });
    let [row] = await messagesOf(c.id);
    expect(row?.state).toBe("queued");
    expect(row?.dueAt?.getTime()).toBe(OPEN.getTime() + 3_600_000);

    f.message = async () => {
      throw new SiteCallError("reddit", "POST", "/api/compose", 403, "blocked");
    };
    const failed = await tickAt(at(0.05));
    expect(failed.failed).toBe(1);
    expect((await contactById(db(), c.id)).state).toBe("unreachable");

    const d = await addContact(db(), { platform: "reddit", handle: "other" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: at(0.1) });
    f.message = async () => {
      throw new Error("socket hung up");
    };
    const crashed = await tickAt(at(0.1));
    expect(crashed.failed).toBe(1);
    [row] = await messagesOf(d.id);
    expect(row?.state).toBe("unknown");
    f.message = ok;
    expect((await tickAt(at(0.12))).sent).toBe(0);
  });

  it("a stale sending row becomes unknown and is never resent", async () => {
    await account("reddit", "reddit@alt");
    const c = await addContact(db(), { platform: "reddit", handle: "lost" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    await db()
      .update(reachMessages)
      .set({ state: "sending", createdAt: OPEN })
      .where(eq(reachMessages.contactId, c.id));
    expect(await reconcile(db(), new Date(OPEN.getTime() + STALE_SENDING_MS / 2))).toBe(0);
    const t = await tickAt(new Date(OPEN.getTime() + STALE_SENDING_MS * 2));
    expect(t.reconciled).toBe(1);
    expect(t.sent).toBe(0);
    const [row] = await messagesOf(c.id);
    expect(row?.state).toBe("unknown");
  });

  it("enroll refuses while a step is empty", async () => {
    await account("reddit", "reddit@alt");
    await setTemplate(
      db(),
      { slots: SLOTS, sender: "W", now: OPEN },
      { key: stepKey(REDDIT, 2), body: "", by: "t" },
    );
    await addContact(db(), { platform: "reddit", handle: "xray1" });
    await expect(
      enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN }),
    ).rejects.toThrow(ReachRefusal);
  });
});

describe("console records", () => {
  it("a thread loads its messages and the reply preview's app", async () => {
    await account("reddit", "reddit@alt");
    const c = await addContact(db(), { platform: "reddit", handle: "dana_dev" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    await tickAt(OPEN);
    const api = serveRecords([dmRecord], db());
    for (const v of dmRecord.views) await api.list({ record: dmRecord.id, view: v.id, limit: 9 });
    const all = await api.list({ record: dmRecord.id, view: "all", limit: 9 });
    expect(all.rows.map((r) => r.id)).toEqual([String(c.id)]);
    const one = await api.get({ record: dmRecord.id, id: String(c.id) });
    const detail = one.detail as { messages: { body: string }[]; dm: unknown };
    expect(detail.messages[0]?.body).toContain("Hi there");
    expect(detail.dm).toEqual({ site: "Reddit", from: "alt", max: 2000 });
  });

  it("a slot loads the message around it, filled with sample facts", async () => {
    await account("reddit", "reddit@alt");
    const record = dmCopyRecord("William");
    const api = serveRecords([record], db());
    for (const v of record.views) await api.list({ record: record.id, view: v.id, limit: 9 });
    const body = await api.get({ record: record.id, id: stepKey(REDDIT, 1) });
    expect(body.detail).toMatchObject({
      sample: { first_name: "Dana", sender: "William" },
      dm: {
        site: "Reddit",
        from: "alt",
        frame: { subject: "quick one from r/recruiting", body: "WRENSLOT" },
      },
    });
    const subject = await api.get({ record: record.id, id: subjectKey(REDDIT, 1) });
    expect(subject.detail).toMatchObject({
      dm: { frame: { subject: "WRENSLOT", body: expect.stringContaining("Hi Dana") } },
    });
  });
});

describe("stats", () => {
  it("counts the week", async () => {
    await account("reddit", "reddit@alt");
    await addContact(db(), { platform: "reddit", handle: "stats1" });
    await enroll(db(), { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
    await tickAt(OPEN);
    const s = await reachStats(db(), { platform: "reddit", days: 7, now: at(0.5) });
    expect(s.out.sent).toBe(1);
    expect(s.contacts.enrolled).toBe(1);
  });
});
