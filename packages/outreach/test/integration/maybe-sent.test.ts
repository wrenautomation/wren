/**
 * A send whose outcome is unknown, on Postgres with fake channels (designs/2026-10-16-maybe-sent.md):
 * our words found after an unknown outcome are recorded once and never sent again; not found is
 * sent once more; unreadable parks unsure with no send; a second invocation meanwhile sends
 * nothing. The sender's DMs, a person's Mark posted and the scheduler's hands-off follow.
 */
import type * as restate from "@restatedev/restate-sdk";
import { SiteCallError } from "@wren/core/content";
import { fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { addContact } from "../../src/contacts.js";
import { enroll } from "../../src/enroll.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { COMMENTS_SETTINGS } from "../../src/reach-posts.js";
import { isSendUnsure, sendAtMostOnce } from "../../src/restate/maybe-sent.js";
import { schedulePosts } from "../../src/scheduled.js";
import { type ReachAccount, reachMessages, reachPosts, sendAttempts } from "../../src/schema.js";
import { parkUnsure, sendAttempt } from "../../src/send-attempts.js";
import { REACH_SEQUENCES, slotsOf, stepKey, subjectKey } from "../../src/sequences.js";
import { markPosted, requeueDm } from "../../src/settle-send.js";
import { setTemplate } from "../../src/store.js";
import { tick } from "../../src/tick.js";

let pg: TestPostgres;
const db = () => pg.db;
const NOW = new Date("2026-10-01T18:00:00Z");
const WENT =
  'reddit@alt: "save the comment" already went through on an earlier try of this step; check it before running again';
const maybe = () => new SiteCallError("reddit", "POST", "/api/comment", 502, WENT);

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "send_attempts",
    "reach_messages",
    "reach_contacts",
    "reach_accounts",
    "reach_posts",
    "templates",
    "template_versions",
    "social_handles",
    "profiles",
  ]);
});

/** A stand-in Context: steps run inline, sleeps are counted, each one its own invocation. */
let invocations = 0;
function ctxOf() {
  const id = `inv_${++invocations}`;
  const sleeps: number[] = [];
  const ctx = {
    run: async (_name: string, fn: () => Promise<unknown>) => fn(),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    date: { now: async () => NOW.getTime() },
    request: () => ({ id }),
  };
  return { ctx: ctx as unknown as restate.Context, sleeps };
}

const comment = (ch: ReturnType<typeof fakeOutreachChannel>, again = false) => {
  const { ctx } = ctxOf();
  const findSent = ch.findSent;
  return sendAtMostOnce(ctx, db(), {
    item: "thread:t3_p1",
    platform: "reddit",
    account: "reddit@alt",
    words: "Our words in the thread.",
    target: "t3_p1",
    url: "https://www.reddit.com/r/x/comments/p1/",
    again,
    look: findSent
      ? (since) =>
          findSent({ kind: "comment", to: "t3_p1", text: "Our words in the thread.", since })
      : undefined,
    send: () => ch.comment?.("t3_p1", "Our words in the thread.") ?? Promise.reject(),
  });
};

describe("sendAtMostOnce", () => {
  it("unknown outcome and our comment found: marked once, no second send", async () => {
    const ch = fakeOutreachChannel("reddit");
    ch.faults.push({ err: maybe(), landed: true });
    const r = await comment(ch);
    expect(r).toMatchObject({ ref: "fake_1", found: true });
    expect(ch.sent).toHaveLength(1);
    expect(await sendAttempt(db(), "thread:t3_p1")).toMatchObject({
      state: "sent",
      ref: "fake_1",
      settledBy: "found",
    });
    // A later click finds it settled: nothing is sent.
    expect(await comment(ch)).toMatchObject({ ref: "fake_1", found: true });
    expect(ch.sent).toHaveLength(1);
  });

  it("not found after the settle: sent once more", async () => {
    const ch = fakeOutreachChannel("reddit");
    ch.faults.push({ err: maybe(), landed: false });
    const r = await comment(ch);
    expect(r.found).toBe(false);
    expect(ch.sent).toHaveLength(1);
    expect(await sendAttempt(db(), "thread:t3_p1")).toMatchObject({
      state: "sent",
      settledBy: "sent",
    });
  });

  it("unreadable: unsure, terminal, nothing sent again until a person says so", async () => {
    const ch = fakeOutreachChannel("reddit");
    ch.sight.blind = true;
    ch.faults.push({ err: maybe(), landed: true });
    const err = await comment(ch).catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    expect(ch.sent).toHaveLength(1);
    expect(await sendAttempt(db(), "thread:t3_p1")).toMatchObject({ state: "unsure" });
    // A scheduled pass or a stray click is refused.
    await expect(comment(ch)).rejects.toThrow(/may have gone out/);
    expect(ch.sent).toHaveLength(1);
    // Send again: it reads first, and the read still can't tell, so it sends.
    ch.sight.blind = false;
    expect(await comment(ch, true)).toMatchObject({ found: true });
    expect(ch.sent).toHaveLength(1);
  });

  it("a double invocation sends once", async () => {
    const ch = fakeOutreachChannel("reddit");
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const send = ch.comment?.bind(ch);
    ch.comment = async (p, t) => {
      await held;
      return (send as NonNullable<typeof send>)(p, t);
    };
    const first = comment(ch);
    // Let the first claim before the second asks.
    await new Promise((r) => setTimeout(r, 50));
    await expect(comment(ch)).rejects.toThrow(/already being sent/);
    release();
    await first;
    expect(ch.sent).toHaveLength(1);
  });

  it("a refusal releases the item: it sends as if never tried", async () => {
    const ch = fakeOutreachChannel("reddit");
    ch.faults.push({
      err: new SiteCallError("reddit", "POST", "/api/comment", 403, "banned"),
      landed: false,
    });
    await expect(comment(ch)).rejects.toThrow(/banned/);
    expect(await sendAttempt(db(), "thread:t3_p1")).toBeNull();
  });
});

describe("the sender's DMs", () => {
  const SEQ = REACH_SEQUENCES.get("reddit-dm");
  if (!SEQ) throw new Error("reddit-dm");
  let ch: ReturnType<typeof fakeOutreachChannel>;
  const channelFor = (_a: ReachAccount) => ch;
  const tickNow = () =>
    tick(db(), {
      channelFor,
      policy: { ...DEFAULT_POLICY, gapSeconds: 0 },
      sequences: REACH_SEQUENCES,
      sender: "William",
      live: true,
      now: NOW,
    });

  beforeEach(async () => {
    ch = fakeOutreachChannel("reddit", { account: "reddit@alt" });
    const slots = slotsOf(REACH_SEQUENCES.values());
    const set = (key: string, body: string) =>
      setTemplate(db(), { slots, sender: "William" }, { key, body, by: "test" });
    await set(subjectKey(SEQ, 1), "quick one");
    await set(stepKey(SEQ, 1), "Hi {first_name|there}. {sender}");
    await set(stepKey(SEQ, 2), "Bumping this.");
    const a = await addAccount(db(), { platform: "reddit", account: "reddit@alt", now: NOW });
    ch.setHealth({ handle: "alt", createdAt: "2026-08-01T00:00:00Z", karma: 200 });
    await refreshHealth(db(), [a], channelFor, NOW);
    await setAccountState(db(), a.id, "active", { reason: null, now: NOW });
    await addContact(db(), { platform: "reddit", handle: "dana_test" });
    await enroll(db(), { sequence: SEQ, sender: "William", limit: 1, now: NOW });
  });

  it("found after an unknown outcome: recorded sent, sent once", async () => {
    ch.faults.push({ err: maybe(), landed: true });
    const stats = await tickNow();
    expect(stats.sent).toBe(1);
    expect(ch.sent).toHaveLength(1);
    const [m] = await db().select().from(reachMessages);
    expect(m?.state).toBe("sent");
  });

  it("unreadable: unknown, unsure in To approve; Mark posted moves it on", async () => {
    ch.sight.blind = true;
    ch.faults.push({ err: maybe(), landed: true });
    const stats = await tickNow();
    expect(stats.failed).toBe(1);
    const [m] = await db().select().from(reachMessages);
    expect(m?.state).toBe("unknown");
    const item = `dm:${m?.id}`;
    expect(await sendAttempt(db(), item)).toMatchObject({ state: "unsure", target: "dana_test" });
    // Nothing resends it.
    await tickNow();
    expect(ch.sent).toHaveLength(1);
    const after = await markPosted(db(), item, {
      sequences: REACH_SEQUENCES,
      sender: "William",
      by: "test@example.com",
      now: NOW,
    });
    expect(after.stepped).toHaveLength(1);
    const [sent] = await db()
      .select()
      .from(reachMessages)
      .where(eq(reachMessages.id, m?.id ?? 0));
    expect(sent?.state).toBe("sent");
    expect(await sendAttempt(db(), item)).toMatchObject({
      state: "sent",
      settledBy: "test@example.com",
    });
  });

  it("Send again puts it back in the sender's queue", async () => {
    ch.sight.blind = true;
    ch.faults.push({ err: maybe(), landed: false });
    await tickNow();
    const [m] = await db().select().from(reachMessages);
    await requeueDm(db(), m?.id ?? 0, NOW);
    expect(await sendAttempt(db(), `dm:${m?.id}`)).toBeNull();
    expect((await tickNow()).sent).toBe(1);
    expect(ch.sent).toHaveLength(1);
  });
});

describe("the scheduler", () => {
  it("leaves an unsure comment alone", async () => {
    const [p] = await db()
      .insert(reachPosts)
      .values({
        platform: "linkedin",
        ref: "urn:li:activity:1",
        author: "Author",
        text: "Post",
        url: "https://example.com/1",
        postedAt: new Date(NOW.getTime() - 3_600_000),
        foundBy: "topic: synthetic",
        account: "linkedin@wren",
        state: "queued",
        draft: "Draft",
        queuedAt: NOW,
        raw: {},
      })
      .returning({ id: reachPosts.id });
    await parkUnsure(db(), {
      item: `onpost:${p?.id}`,
      platform: "linkedin",
      account: null,
      words: "Draft",
      target: "urn:li:activity:1",
      url: "https://example.com/1",
      why: "may have gone through",
      tries: 1,
      now: NOW,
    });
    const settings = COMMENTS_SETTINGS.linkedin.parse({ account: "linkedin@wren", perDay: 3 });
    const at = new Date("2026-03-02T15:00:00Z");
    expect(await schedulePosts(db(), "linkedin", settings, { now: at, rand: () => 0 })).toEqual([]);
    await db().delete(sendAttempts);
    expect(
      await schedulePosts(db(), "linkedin", settings, { now: at, rand: () => 0 }),
    ).toHaveLength(1);
  });
});
