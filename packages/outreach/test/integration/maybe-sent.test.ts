/**
 * A send whose outcome autobrowse's verdict tells (designs/2026-10-16-send-verdicts.md), on
 * Postgres with a fake desk that keeps a verdict per send key, as autobrowse does. Sent is
 * recorded once with its ref and never sent again. Not sent releases the item, and the next pass
 * sends under a new key. Unknown parks it unsure with no second write. A take-over after a lost
 * invocation runs under the same key, so the desk answers its stored verdict. Then the Reddit
 * comment the whole way (`commentThread`), the sender's DMs, "Not sent, drop" for each item kind,
 * and a client's send on its connected account: the same verdict path, and nothing reads the
 * site for words.
 */
import * as restate from "@restatedev/restate-sdk";
import { SiteCallError } from "@wren/core/content";
import { DESK, restateSites } from "@wren/core/content/restate";
import { fakeOutreachChannel } from "@wren/core/outreach";
import {
  currentSendKey,
  NotSent,
  SendUnknown,
  type SendVerdict,
  SentFound,
} from "@wren/core/send-verdict";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { commentById } from "../../src/comments.js";
import { addContact } from "../../src/contacts.js";
import { enroll } from "../../src/enroll.js";
import { addPlaces, keepPlace, keepThreads, watchPlace } from "../../src/index.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { COMMENTS_SETTINGS } from "../../src/reach-posts.js";
import { discoveryHandlers } from "../../src/restate/discovery.js";
import type { ReachDeps } from "../../src/restate/index.js";
import {
  isSendNotSent,
  isSendTaken,
  isSendUnsure,
  sendAtMostOnce,
} from "../../src/restate/maybe-sent.js";
import { schedulePosts } from "../../src/scheduled.js";
import {
  comments,
  type ReachAccount,
  reachContacts,
  reachMessages,
  reachPosts,
  redditThreads,
  sendAttempts,
} from "../../src/schema.js";
import { claimSend, KEYLESS_TRY, parkUnsure, sendAttempt } from "../../src/send-attempts.js";
import { REACH_SEQUENCES, slotsOf, stepKey, subjectKey } from "../../src/sequences.js";
import { dropItem, markPosted, requeueDm, SETTLE_OUTCOMES } from "../../src/settle-send.js";
import { setTemplate } from "../../src/store.js";
import { tick } from "../../src/tick.js";

let pg: TestPostgres;
const db = () => pg.db;
const NOW = new Date("2026-10-01T18:00:00Z");
const AT = "2026-10-01T18:00:03.000Z";

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
    "reddit_threads",
    "reddit_places",
    "reddit_people",
    "templates",
    "template_versions",
    "social_handles",
    "profiles",
    "comments",
    "touches",
    "draft_events",
  ]);
});

/** The verdicts autobrowse answers (`SendVerdict`), as values. */
const sentV = (id: string, how: "answer" | "verified" = "verified"): SendVerdict =>
  how === "verified"
    ? { verdict: "sent", id, url: `https://www.reddit.com/comments/p1/_/${id}`, at: AT, how }
    : {
        verdict: "sent",
        id,
        url: null,
        at: AT,
        how,
        output: { json: { data: { things: [{ data: { name: id } }] } } },
      };
const unknownV = (reason = "the page did not confirm the comment"): SendVerdict => ({
  verdict: "unknown",
  reason,
  since: AT,
});
const notSentV = (
  how: "refused" | "before_submit" | "verified_absent",
  reason: string,
  status?: number,
): SendVerdict => ({ verdict: "not_sent", how, reason, ...(status ? { status } : {}) });

/**
 * Autobrowse's `desk` service as a Restate client sees it. A keyed write answers a verdict and
 * the desk keeps it per key: a final verdict answers again and writes nothing; an `unknown` one
 * runs only the verify read (`verify`). A GET answers the thread listing.
 */
function fakeDesk() {
  const journal = new Map<string, SendVerdict>();
  const d = {
    /** The verdicts the next new keyed writes answer; a default `sent` after that. */
    next: [] as SendVerdict[],
    /** What the verify read finds for a key stored `unknown`; null = it still cannot tell. */
    verify: null as SendVerdict | null,
    writes: [] as Array<{ sendKey: string; idem: string | null; path: string }>,
    /** Keys that came again and were answered from the journal. */
    replays: [] as string[],
    verifies: 0,
    plain: 0,
    /** A write waits on this before it answers. */
    hold: null as Promise<void> | null,
    /** Who commented in the thread. */
    thread: [] as Array<{ id: string; author: string }>,
    recheck(key: string, kept: SendVerdict): SendVerdict {
      d.verifies += 1;
      const v = d.verify ?? kept;
      journal.set(key, v);
      return v;
    },
    client: {
      status: async () => ({ routes: [] }),
      call: async (
        req: { method: string; path: string; sendKey?: string },
        opts?: { getOpts(): { idempotencyKey?: string } },
      ): Promise<unknown> => {
        if (req.method === "GET") {
          const kids = d.thread.map((c) => ({
            kind: "t1",
            data: { name: c.id, author: c.author, body: "hi", parent_id: "t3_p1" },
          }));
          return [
            { data: { children: [{ kind: "t3", data: { name: "t3_p1", author: "owner1" } }] } },
            { data: { children: kids } },
          ];
        }
        if (!req.sendKey) {
          d.plain += 1;
          return { json: { data: { things: [{ data: { name: "t1_plain" } }] } } };
        }
        const kept = journal.get(req.sendKey);
        if (kept && kept.verdict !== "unknown") {
          d.replays.push(req.sendKey);
          return kept;
        }
        if (kept) return d.recheck(req.sendKey, kept);
        if (d.hold) await d.hold;
        d.writes.push({
          sendKey: req.sendKey,
          idem: opts?.getOpts().idempotencyKey ?? null,
          path: req.path,
        });
        const v = d.next.shift() ?? sentV(`t1_${d.writes.length}`);
        journal.set(req.sendKey, v);
        return v;
      },
      verdict: async (req: { sendKey: string }): Promise<SendVerdict> => {
        const kept = journal.get(req.sendKey);
        if (!kept) return notSentV("before_submit", "no record of that key");
        return kept.verdict === "unknown" ? d.recheck(req.sendKey, kept) : kept;
      },
    },
  };
  return d;
}

/** A stand-in Context: steps run inline, sleeps are counted, each one its own invocation. */
let invocations = 0;
function ctxOf(services: Record<string, unknown> = {}, o: { lostAt?: string } = {}) {
  const id = `inv_${++invocations}`;
  const sleeps: number[] = [];
  const ctx = {
    run: async (name: string, fn: () => Promise<unknown>) => {
      // A step the invocation never reached: it was killed here.
      if (o.lostAt === name) throw new Error(`the invocation was lost at ${name}`);
      return fn();
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    date: { now: async () => NOW.getTime() },
    request: () => ({ id }),
    serviceClient: ({ name }: { name: string }) => services[name],
    serviceSendClient: () => ({ check: () => {} }),
    objectSendClient: () => ({ wake: () => {} }),
  };
  return { ctx: ctx as unknown as restate.Context, sleeps };
}

const ITEM = "thread:t3_p1";
const WORDS = "Our words in the thread.";
const refOf = (made: unknown): string | null =>
  (made as { json?: { data?: { things?: Array<{ data?: { name?: string } }> } } })?.json?.data
    ?.things?.[0]?.data?.name ?? null;

/** The comment, sent through the real `restateSites` over the fake desk, under the ledger's key. */
function comment(
  desk: ReturnType<typeof fakeDesk>,
  o: {
    again?: boolean;
    ctx?: ReturnType<typeof ctxOf>;
    before?: () => Promise<void>;
    after?: () => Promise<void>;
  } = {},
) {
  const { ctx } = o.ctx ?? ctxOf({ [DESK.name]: desk.client });
  const sites = restateSites(ctx, { caller: "test", service: DESK });
  return sendAtMostOnce(ctx, db(), {
    item: ITEM,
    platform: "reddit",
    account: "reddit@alt",
    words: WORDS,
    target: "t3_p1",
    url: "https://www.reddit.com/r/x/comments/p1/",
    again: o.again === true,
    ...(o.before ? { before: o.before } : {}),
    send: async () => {
      const made = await sites.call("reddit", "POST", "/api/comment", {
        thing_id: "t3_p1",
        text: WORDS,
      });
      await o.after?.();
      return { ref: refOf(made) };
    },
  });
}

describe("sendAtMostOnce, under the desk's verdict", () => {
  it("sent and verified: settled found once with its ref, never written again", async () => {
    const desk = fakeDesk();
    desk.next.push(sentV("t1_abc"));
    expect(await comment(desk)).toMatchObject({ ref: "t1_abc", found: true });
    expect(desk.writes).toHaveLength(1);
    const row = await sendAttempt(db(), ITEM);
    expect(row).toMatchObject({ state: "sent", ref: "t1_abc", settledBy: "found" });
    // The write ran under the ledger row's key, and Restate's idempotency key is that same key.
    const w = desk.writes[0];
    expect(w?.sendKey.startsWith(`${row?.sendKey}`)).toBe(true);
    expect(w?.idem).toBe(w?.sendKey);
    expect(w?.path).toBe("/api/comment");
    // A later click finds it settled: nothing is written.
    expect(await comment(desk)).toMatchObject({ ref: "t1_abc", found: true });
    expect(desk.writes).toHaveLength(1);
  });

  it("sent with the official answer: its ref, settled by the send", async () => {
    const desk = fakeDesk();
    desk.next.push(sentV("t1_new", "answer"));
    expect(await comment(desk)).toMatchObject({ ref: "t1_new", found: false });
    expect(await sendAttempt(db(), ITEM)).toMatchObject({
      state: "sent",
      ref: "t1_new",
      settledBy: "sent",
    });
  });

  it("not sent: released, and the next pass sends under a new key", async () => {
    for (const how of ["before_submit", "verified_absent"] as const) {
      await db().delete(sendAttempts);
      const desk = fakeDesk();
      desk.next.push(notSentV(how, "the browser was busy"), sentV("t1_2"));
      const err = await comment(desk).catch((e: unknown) => e);
      expect(isSendNotSent(err)).toBe(true);
      expect(err).toBeInstanceOf(restate.TerminalError);
      expect((err as { how: string }).how).toBe(how);
      expect(await sendAttempt(db(), ITEM)).toBeNull();
      expect(await comment(desk)).toMatchObject({ ref: "t1_2", found: true });
      const [first, second] = desk.writes;
      expect(first?.sendKey).not.toBe(second?.sendKey);
      expect(second?.sendKey.startsWith(`${ITEM} `)).toBe(true);
    }
  });

  it("unknown: unsure, terminal, nothing sleeps or writes again until a person says so", async () => {
    const desk = fakeDesk();
    desk.next.push(unknownV());
    const run = ctxOf({ [DESK.name]: desk.client });
    const err = await comment(desk, { ctx: run }).catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    // Terminal: Restate neither retries nor pauses it.
    expect(err).toBeInstanceOf(restate.TerminalError);
    expect(run.sleeps).toEqual([]);
    expect(await sendAttempt(db(), ITEM)).toMatchObject({ state: "unsure" });
    // A scheduled pass or a stray click is refused.
    await expect(comment(desk)).rejects.toThrow(/may have gone out/);
    expect(desk.writes).toHaveLength(1);
    // A person's Send again is a new send under a new key.
    desk.next.push(sentV("t1_5"));
    expect(await comment(desk, { again: true })).toMatchObject({ ref: "t1_5", found: true });
    expect(desk.writes).toHaveLength(2);
    expect(desk.writes[0]?.sendKey).not.toBe(desk.writes[1]?.sendKey);
  });

  it("a take-over after a lost invocation runs under the same key: the desk replays, nothing is written twice", async () => {
    const desk = fakeDesk();
    desk.next.push(sentV("t1_abc"));
    // The write landed and the invocation died before it settled.
    const lost = ctxOf({ [DESK.name]: desk.client }, { lostAt: "settle send" });
    await expect(comment(desk, { ctx: lost })).rejects.toThrow(/lost at settle send/);
    const left = await sendAttempt(db(), ITEM);
    expect(left).toMatchObject({ state: "sending" });
    await db()
      .update(sendAttempts)
      .set({ updatedAt: new Date(NOW.getTime() - 11 * 60_000) });
    // The take-over: our own comment is in the thread, so a guard here would refuse it.
    let guarded = 0;
    const r = await comment(desk, {
      before: async () => {
        guarded += 1;
        throw new restate.TerminalError("u/us already wrote in this thread");
      },
    });
    expect(r).toMatchObject({ ref: "t1_abc", found: true });
    expect(guarded).toBe(0);
    expect(desk.writes).toHaveLength(1);
    expect(desk.replays).toEqual([desk.writes[0]?.sendKey]);
    expect(await sendAttempt(db(), ITEM)).toMatchObject({
      state: "sent",
      ref: "t1_abc",
      sendKey: left?.sendKey,
    });
  });

  it("a take-over whose stored verdict is unknown asks the verify read; found settles it", async () => {
    const desk = fakeDesk();
    desk.next.push(unknownV());
    // Unknown settled unsure, but this invocation died first.
    const lost = ctxOf({ [DESK.name]: desk.client }, { lostAt: "unsure" });
    await expect(comment(desk, { ctx: lost })).rejects.toThrow(/lost at unsure/);
    await db()
      .update(sendAttempts)
      .set({ updatedAt: new Date(NOW.getTime() - 11 * 60_000) });
    desk.verify = sentV("t1_found");
    expect(await comment(desk)).toMatchObject({ ref: "t1_found", found: true });
    expect(desk.writes).toHaveLength(1);
    expect(desk.verifies).toBeGreaterThan(0);
  });

  it("a take-over whose verify read still cannot tell stays unsure, with no second write", async () => {
    const desk = fakeDesk();
    desk.next.push(unknownV());
    const lost = ctxOf({ [DESK.name]: desk.client }, { lostAt: "unsure" });
    await expect(comment(desk, { ctx: lost })).rejects.toThrow(/lost at unsure/);
    await db()
      .update(sendAttempts)
      .set({ updatedAt: new Date(NOW.getTime() - 11 * 60_000) });
    const err = await comment(desk).catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    expect(desk.writes).toHaveLength(1);
    expect(await sendAttempt(db(), ITEM)).toMatchObject({ state: "unsure" });
  });

  it("a take-over of a row an older wren sent with no key parks unsure, with no write", async () => {
    // The row an older wren left mid-send, from before send keys.
    await db()
      .insert(sendAttempts)
      .values({
        item: ITEM,
        state: "sending",
        platform: "reddit",
        words: "synthetic words",
        target: "a thread",
        tries: 1,
        startedAt: new Date(NOW.getTime() - 20 * 60_000),
        updatedAt: new Date(NOW.getTime() - 20 * 60_000),
      });
    const claim = {
      item: ITEM,
      platform: "reddit",
      account: null,
      words: "synthetic words",
      target: "a thread",
      url: null,
      invocation: "inv-2",
      now: NOW,
    };
    await expect(claimSend(db(), claim)).rejects.toThrow(/may have gone out/);
    expect(await sendAttempt(db(), ITEM)).toMatchObject({ state: "unsure", why: KEYLESS_TRY });
    // A person's Send again is a new send under a new key.
    const again = await claimSend(db(), { ...claim, again: true });
    expect(again).toMatchObject({ go: "send", tried: false });
  });

  it("an error after a write answered: unsure, never released for a blind second try", async () => {
    const desk = fakeDesk();
    desk.next.push(sentV("t1_abc", "answer"));
    const err = await comment(desk, {
      after: async () => {
        throw new Error("the connection to the database dropped");
      },
    }).catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    expect(await sendAttempt(db(), ITEM)).toMatchObject({ state: "unsure" });
    await expect(comment(desk)).rejects.toThrow(/may have gone out/);
    expect(desk.writes).toHaveLength(1);
  });

  it("an error before any write answered releases the item", async () => {
    const desk = fakeDesk();
    const err = await comment(desk, {
      before: async () => {
        throw new Error("the thread read failed");
      },
    }).catch((e: unknown) => e);
    expect(String(err)).toMatch(/the thread read failed/);
    expect(await sendAttempt(db(), ITEM)).toBeNull();
    expect(desk.writes).toHaveLength(0);
  });

  it("the platform said no: the refusal comes back as it was and the item is released", async () => {
    const desk = fakeDesk();
    desk.next.push(notSentV("refused", "banned from the sub", 403));
    const err = await comment(desk).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteCallError);
    expect(err).toMatchObject({ status: 403 });
    expect(await sendAttempt(db(), ITEM)).toBeNull();
  });

  it("a double invocation writes once", async () => {
    const desk = fakeDesk();
    let release = () => {};
    desk.hold = new Promise<void>((r) => {
      release = r;
    });
    const first = comment(desk);
    // Let the first claim before the second asks.
    await new Promise((r) => setTimeout(r, 50));
    await expect(comment(desk)).rejects.toThrow(/already being sent/);
    release();
    await first;
    expect(desk.writes).toHaveLength(1);
  });
});

describe("a Reddit comment, the whole way (ReachDesk commentThread)", () => {
  const DAY = 86_400_000;
  const READ = {
    about: {
      display_name: "agency",
      title: "agency",
      subscribers: 40_000,
      subreddit_type: "public",
    },
    rules: { rules: [{ short_name: "Be kind", description: "" }] },
    top: [],
    latest: [],
  };
  const JUDGED = {
    fit: 8,
    why: "Owners ask about hiring",
    rules: "No self-promo",
    mayComment: true,
    mayPost: true,
    linkOnly: true,
    karmaMin: null,
    ageMinDays: null,
    postsADay: 12,
    medianComments: 6,
  };

  /** A queued thread with a draft, in a watched place, on an account that may comment. */
  async function queuedThread() {
    const a = await addAccount(db(), { platform: "reddit", account: "reddit@wren", now: NOW });
    const ch = fakeOutreachChannel("reddit", { account: "reddit@wren", now: () => NOW });
    ch.setHealth({
      handle: "WrenAutomation",
      createdAt: new Date(NOW.getTime() - 120 * DAY).toISOString(),
      karma: 300,
    });
    await refreshHealth(db(), [a], () => ch, NOW);
    await setAccountState(db(), a.id, "active", { reason: null, now: NOW });
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    await keepPlace(db(), "agency", READ, JUDGED, NOW);
    await watchPlace(db(), "agency", NOW);
    await keepThreads(
      db(),
      "agency",
      [
        {
          id: "p1",
          name: "t3_p1",
          title: "How do I stop chasing invoices",
          selftext: "We are a 10 person agency and invoices slip.",
          author: "owner1",
          permalink: "/r/agency/comments/p1/x/",
          created_utc: NOW.getTime() / 1000 - 3600,
          num_comments: 2,
        },
      ],
      { now: NOW, ours: [], judged: JUDGED },
    );
    await db()
      .update(redditThreads)
      .set({ state: "queued", draft: WORDS, target: "t1_ask" })
      .where(eq(redditThreads.id, "t3_p1"));
  }

  const run = (desk: ReturnType<typeof fakeDesk>, o: { lostAt?: string; again?: boolean } = {}) => {
    const c = ctxOf({ [DESK.name]: desk.client }, o.lostAt ? { lostAt: o.lostAt } : {});
    const deps = {
      db: db(),
      policy: DEFAULT_POLICY,
      sequences: REACH_SEQUENCES,
      live: true,
      senderName: "William",
      heldNiches: [],
      sitesFor: (ctx: restate.Context) => restateSites(ctx, { caller: "test", service: DESK }),
      clock: () => NOW,
    } as unknown as ReachDeps;
    const go = discoveryHandlers(deps).commentThread as unknown as (
      ctx: restate.Context,
      req: { id: string; again?: boolean },
    ) => Promise<{ ref: string | null }>;
    return { sleeps: c.sleeps, result: go(c.ctx, { id: "t3_p1", again: o.again === true }) };
  };
  const thread = () =>
    db()
      .select()
      .from(redditThreads)
      .where(eq(redditThreads.id, "t3_p1"))
      .then((r) => r[0]);

  it("10-15: the desk answers sent and verified: settled found once, no second write, no retry", async () => {
    await queuedThread();
    const desk = fakeDesk();
    desk.next.push(sentV("t1_abc"));
    const r = run(desk);
    expect(await r.result).toEqual({ ref: "t1_abc" });
    expect(r.sleeps).toEqual([]);
    expect(desk.writes).toHaveLength(1);
    // The call carried its key, and the desk was never asked a second time.
    expect(desk.writes[0]?.idem).toBe(desk.writes[0]?.sendKey);
    expect(desk.replays).toEqual([]);
    expect(await thread()).toMatchObject({
      state: "commented",
      answerRef: "t1_abc",
      answer: WORDS,
    });
    expect(await sendAttempt(db(), ITEM)).toMatchObject({
      state: "sent",
      ref: "t1_abc",
      settledBy: "found",
    });
  });

  it("a lost invocation is taken over under the same key: one write, the thread guard does not refuse", async () => {
    await queuedThread();
    const desk = fakeDesk();
    desk.next.push(sentV("t1_abc"));
    await expect(run(desk, { lostAt: "settle send" }).result).rejects.toThrow(/lost at/);
    expect(await thread()).toMatchObject({ state: "queued" });
    await db()
      .update(sendAttempts)
      .set({ updatedAt: new Date(NOW.getTime() - 11 * 60_000) });
    // Our own comment is in the thread now: a first send would be refused.
    desk.thread.push({ id: "t1_abc", author: "WrenAutomation" });
    expect(await run(desk).result).toEqual({ ref: "t1_abc" });
    expect(desk.writes).toHaveLength(1);
    expect(desk.replays).toHaveLength(1);
    expect(await thread()).toMatchObject({ state: "commented", answerRef: "t1_abc" });
  });

  it("the guard still refuses a first send when one of our accounts is in the thread", async () => {
    await queuedThread();
    const desk = fakeDesk();
    desk.thread.push({ id: "t1_x", author: "WrenAutomation" });
    await expect(run(desk).result).rejects.toThrow(/already wrote in this thread/);
    expect(desk.writes).toHaveLength(0);
    expect(await sendAttempt(db(), ITEM)).toBeNull();
    expect(await thread()).toMatchObject({ state: "queued" });
  });

  it("not sent: the thread stays queued and the next pass sends under a new key", async () => {
    await queuedThread();
    const desk = fakeDesk();
    desk.next.push(notSentV("before_submit", "the browser was busy"));
    const err = await run(desk).result.catch((e: unknown) => e);
    expect(isSendNotSent(err)).toBe(true);
    expect(await sendAttempt(db(), ITEM)).toBeNull();
    expect(await thread()).toMatchObject({ state: "queued" });
    expect(await run(desk).result).toMatchObject({ ref: "t1_2" });
    expect(desk.writes[0]?.sendKey).not.toBe(desk.writes[1]?.sendKey);
    expect(await thread()).toMatchObject({ state: "commented", answerRef: "t1_2" });
  });

  it("unknown: parked unsure, the thread stays queued, no sleep, no second write; drop closes it", async () => {
    await queuedThread();
    const desk = fakeDesk();
    desk.next.push(unknownV());
    const r = run(desk);
    const err = await r.result.catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    expect(r.sleeps).toEqual([]);
    expect(await thread()).toMatchObject({ state: "queued" });
    expect(await sendAttempt(db(), ITEM)).toMatchObject({ state: "unsure" });
    await expect(run(desk).result).rejects.toThrow(/may have gone out/);
    expect(desk.writes).toHaveLength(1);
    // "Not sent, drop": the thread is skipped and the ledger row goes.
    await dropItem(db(), ITEM, { by: "test@example.com", now: NOW });
    expect(await thread()).toMatchObject({ state: "skipped" });
    expect(await sendAttempt(db(), ITEM)).toBeNull();
    await expect(run(desk).result).rejects.toThrow(/that thread is skipped/);
    expect(desk.writes).toHaveLength(1);
  });

  it("a platform refusal is terminal with its status, and the item is released", async () => {
    await queuedThread();
    const desk = fakeDesk();
    desk.next.push(notSentV("refused", "banned from the sub", 403));
    const err = await run(desk).result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
    expect(err).toMatchObject({ code: 403 });
    expect(await sendAttempt(db(), ITEM)).toBeNull();
    expect(await thread()).toMatchObject({ state: "queued" });
  });
});

describe("the sender's DMs", () => {
  const SEQ = REACH_SEQUENCES.get("reddit-dm");
  if (!SEQ) throw new Error("reddit-dm");
  let ch: ReturnType<typeof fakeOutreachChannel>;
  /** The key each message send ran under. */
  let keys: Array<string | null>;
  const channelFor = (_a: ReachAccount) => ch;
  const tickAt = (now: Date) =>
    tick(db(), {
      channelFor,
      policy: { ...DEFAULT_POLICY, gapSeconds: 0 },
      sequences: REACH_SEQUENCES,
      sender: "William",
      live: true,
      now,
    });
  const tickNow = () => tickAt(NOW);

  beforeEach(async () => {
    ch = fakeOutreachChannel("reddit", { account: "reddit@alt" });
    keys = [];
    const send = ch.message.bind(ch);
    ch.message = async (...a) => {
      keys.push(currentSendKey());
      return send(...a);
    };
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

  it("the desk found it after a lost answer: recorded sent, sent once", async () => {
    ch.faults.push({ err: new SentFound("msg_1", null, AT), landed: true });
    const stats = await tickNow();
    expect(stats.sent).toBe(1);
    expect(ch.sent).toHaveLength(1);
    const [m] = await db().select().from(reachMessages);
    expect(m?.state).toBe("sent");
  });

  it("unknown: the message is unknown, unsure in To approve with its key; Mark posted moves it on", async () => {
    ch.faults.push({ err: new SendUnknown("the page did not confirm", AT), landed: true });
    const stats = await tickNow();
    expect(stats.failed).toBe(1);
    const [m] = await db().select().from(reachMessages);
    expect(m?.state).toBe("unknown");
    const item = `dm:${m?.id}`;
    const row = await sendAttempt(db(), item);
    expect(row).toMatchObject({ state: "unsure", target: "dana_test" });
    expect(row?.sendKey).toBe(keys[0]);
    expect(row?.sendKey?.startsWith(`${item} `)).toBe(true);
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

  it("not sent: the row waits five minutes and goes again under a new key", async () => {
    ch.faults.push({ err: new NotSent("before_submit", "the browser was busy"), landed: false });
    const stats = await tickNow();
    expect(stats.held["not-sent"]).toBe(1);
    expect(stats.failed).toBe(0);
    const [m] = await db().select().from(reachMessages);
    expect(m).toMatchObject({ state: "queued" });
    expect(m?.dueAt?.getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(await sendAttempt(db(), `dm:${m?.id}`)).toBeNull();
    // Too soon: nothing goes. Later: it goes, under a different key.
    await tickNow();
    expect(keys).toHaveLength(1);
    expect((await tickAt(new Date(NOW.getTime() + 6 * 60_000))).sent).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("the platform said no: the message fails and the contact is unreachable", async () => {
    ch.faults.push({ err: new NotSent("refused", "blocked", 403), landed: false });
    const stats = await tickNow();
    expect(stats.failed).toBe(1);
    const [m] = await db().select().from(reachMessages);
    expect(m?.state).toBe("failed");
    const [c] = await db().select().from(reachContacts);
    expect(c?.state).toBe("unreachable");
  });

  it("Send again puts it back in the sender's queue", async () => {
    ch.faults.push({ err: new SendUnknown("the page did not confirm", AT), landed: false });
    await tickNow();
    const [m] = await db().select().from(reachMessages);
    await requeueDm(db(), m?.id ?? 0, NOW);
    expect(await sendAttempt(db(), `dm:${m?.id}`)).toBeNull();
    expect((await tickNow()).sent).toBe(1);
    expect(ch.sent).toHaveLength(1);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("Not sent, drop: the message is skipped, the contact finished, the ledger row gone", async () => {
    ch.faults.push({ err: new SendUnknown("the page did not confirm", AT), landed: false });
    await tickNow();
    const [m] = await db().select().from(reachMessages);
    const item = `dm:${m?.id}`;
    await dropItem(db(), item, { by: "test@example.com", now: NOW });
    const [after] = await db().select().from(reachMessages);
    expect(after?.state).toBe("skipped");
    const [c] = await db().select().from(reachContacts);
    expect(c?.state).toBe("finished");
    expect(await sendAttempt(db(), item)).toBeNull();
    // Nothing resends it, and a second drop finds nothing waiting.
    await tickNow();
    expect(ch.sent).toHaveLength(0);
    await expect(dropItem(db(), item, { by: "x", now: NOW })).rejects.toThrow(/nothing waits/);
  });
});

describe("Not sent, drop, for each kind of item", () => {
  const park = (item: string, platform = "linkedin") =>
    parkUnsure(db(), {
      item,
      platform,
      account: null,
      words: "Draft",
      target: "t",
      url: null,
      why: "may have gone out",
      tries: 1,
      now: NOW,
    });
  const onePost = async () => {
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
    return p?.id ?? 0;
  };
  const oneComment = async (state: "new" | "waiting" = "waiting") => {
    const [c] = await db()
      .insert(comments)
      .values({
        platform: "instagram",
        channel: "content",
        ref: "c1",
        post: "p1",
        parent: "p1",
        kind: "post_reply",
        postTitle: "Synthetic post",
        author: "reader1",
        body: "How do I set this up?",
        url: "https://example.test/c1",
        at: new Date(NOW.getTime() - 3_600_000),
        raw: {},
        sort: "asked",
        draft: "Here you go.",
        state,
      })
      .returning({ id: comments.id });
    return c?.id ?? 0;
  };

  it("the accepted outcomes are posted, again and dropped", () => {
    expect([...SETTLE_OUTCOMES]).toEqual(["posted", "again", "dropped"]);
  });

  it("an on-post comment: skipped, as a skip in To approve does", async () => {
    const id = await onePost();
    await park(`onpost:${id}`);
    await dropItem(db(), `onpost:${id}`, { by: "test@example.com", now: NOW });
    const [p] = await db().select().from(reachPosts).where(eq(reachPosts.id, id));
    expect(p).toMatchObject({ state: "skipped", stateReason: "skipped in To approve" });
    expect(await sendAttempt(db(), `onpost:${id}`)).toBeNull();
  });

  it("a comment answer: dropped, the ledger row gone", async () => {
    const id = await oneComment();
    await park(`comment:${id}`, "instagram");
    await dropItem(db(), `comment:${id}`, { by: "test@example.com", now: NOW });
    expect((await commentById(db(), id)).state).toBe("dropped");
    expect(await sendAttempt(db(), `comment:${id}`)).toBeNull();
  });

  it("a private reply: only the ledger row goes, the comment it answers stays as it was", async () => {
    const id = await oneComment();
    await park(`private:${id}`, "instagram");
    await dropItem(db(), `private:${id}`, { by: "test@example.com", now: NOW });
    expect((await commentById(db(), id)).state).toBe("waiting");
    expect(await sendAttempt(db(), `private:${id}`)).toBeNull();
  });

  it("a client's DM and a post of ours close in their own desks: here they are refused and stay", async () => {
    for (const item of ["sdm:5", "draft:9"]) {
      await park(item, "x");
      await expect(dropItem(db(), item, { by: "x", now: NOW })).rejects.toThrow(/settles in/);
      expect(await sendAttempt(db(), item)).toMatchObject({ state: "unsure" });
    }
  });

  it("an item nothing waits on is refused", async () => {
    await expect(dropItem(db(), "thread:t3_none", { by: "x", now: NOW })).rejects.toThrow(
      /nothing waits/,
    );
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
      why: "may have gone out",
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

describe("a private reply (private:), with no key to ask: the desk says unknown", () => {
  const WORDS = "Here is the setup guide.";
  async function ourComment() {
    const [c] = await db()
      .insert(comments)
      .values({
        platform: "instagram",
        channel: "content",
        ref: "c1",
        post: "p1",
        parent: "p1",
        kind: "post_reply",
        postTitle: "Synthetic post",
        author: "reader1",
        body: "How do I set this up?",
        url: "https://example.test/c1",
        at: new Date(NOW.getTime() - 3_600_000),
        raw: {},
        sort: "asked",
      })
      .returning({ id: comments.id });
    return c?.id ?? 0;
  }
  const privately = (id: number, send: () => Promise<{ ref: string | null }>) =>
    sendAtMostOnce(ctxOf().ctx, db(), {
      item: `private:${id}`,
      platform: "instagram",
      account: null,
      words: WORDS,
      target: "c1",
      url: "https://example.test/c1",
      send,
    });

  it("unknown outcome: unsure at once; Mark posted records the DM as a send would", async () => {
    const id = await ourComment();
    let sent = 0;
    const err = await privately(id, async () => {
      sent += 1;
      throw new SendUnknown("the page did not confirm", AT);
    }).catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    expect(sent).toBe(1);
    expect(await sendAttempt(db(), `private:${id}`)).toMatchObject({ state: "unsure" });
    await expect(privately(id, async () => ({ ref: "m_2" }))).rejects.toThrow(/may have gone out/);
    expect(sent).toBe(1);
    await markPosted(db(), `private:${id}`, { by: "test@example.com", now: NOW });
    const c = await commentById(db(), id);
    expect(c.contactId).toBeTruthy();
    const [m] = await db()
      .select()
      .from(reachMessages)
      .where(eq(reachMessages.contactId, c.contactId ?? 0));
    expect(m).toMatchObject({ state: "sent", body: WORDS });
    expect(await sendAttempt(db(), `private:${id}`)).toMatchObject({
      state: "sent",
      settledBy: "test@example.com",
    });
  });

  it("a double invocation sends once", async () => {
    const id = await ourComment();
    let sent = 0;
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const first = privately(id, async () => {
      await held;
      sent += 1;
      return { ref: "m_1" };
    });
    await new Promise((r) => setTimeout(r, 50));
    const second = await privately(id, async () => {
      sent += 1;
      return { ref: "m_x" };
    }).catch((e: unknown) => e);
    expect(isSendTaken(second)).toBe(true);
    release();
    expect(await first).toMatchObject({ ref: "m_1", found: false });
    expect(sent).toBe(1);
  });
});

describe("a client's send, on its connected account: the same verdict path, no word look", () => {
  const WORDS = "Our words under their post.";
  const X_MAYBE = new SiteCallError("x", "POST", "/2/tweets", 502, "timed out");
  /** The content service: a read of the site here would be a look. Nothing may call it. */
  const reads: unknown[] = [];
  const content = new Proxy(
    {},
    {
      get: (_t, name) => async (req: unknown) => {
        reads.push({ name, req });
        return { kind: "found", ref: "x_9", at: NOW.toISOString(), url: null };
      },
    },
  );
  /** The client's connected-account write answers its typed outcome under the ledger key. */
  const reply = (send: () => Promise<{ ref: string | null }>, again = false) =>
    sendAtMostOnce(ctxOf({ Content: content }).ctx, db(), {
      item: "comment:7",
      platform: "x",
      account: null,
      words: WORDS,
      target: "x_1",
      url: "https://x.com/someone_1/status/x_1",
      again,
      send,
    });
  beforeEach(() => {
    reads.length = 0;
  });

  it("a lost send is unsure: a second invocation sends nothing, and nothing reads the site", async () => {
    let sent = 0;
    const lost = async () => {
      sent += 1;
      throw new SendUnknown(X_MAYBE.message, NOW.toISOString());
    };
    expect(isSendUnsure(await reply(lost).catch((e: unknown) => e))).toBe(true);
    expect(isSendTaken(await reply(lost).catch((e: unknown) => e))).toBe(true);
    expect(sent).toBe(1);
    expect(await sendAttempt(db(), "comment:7")).toMatchObject({ state: "unsure" });
    expect(reads).toEqual([]);
  });

  it("Send again is a new send under a new key", async () => {
    await reply(async () => {
      throw new SendUnknown(X_MAYBE.message, NOW.toISOString());
    }).catch(() => {});
    const first = (await sendAttempt(db(), "comment:7"))?.sendKey;
    expect(await reply(async () => ({ ref: "x_10" }), true)).toMatchObject({ ref: "x_10" });
    const second = (await sendAttempt(db(), "comment:7"))?.sendKey;
    expect(second).not.toBe(first);
    expect(await sendAttempt(db(), "comment:7")).toMatchObject({ state: "sent", ref: "x_10" });
    expect(reads).toEqual([]);
  });

  it("not sent is released, and a refusal comes back as it was", async () => {
    const notSent = await reply(async () => {
      throw new NotSent("before_submit", "the browser was busy");
    }).catch((e: unknown) => e);
    expect(isSendNotSent(notSent)).toBe(true);
    expect(await sendAttempt(db(), "comment:7")).toBeNull();
    const err = await reply(async () => {
      throw new SiteCallError("x", "POST", "/2/tweets", 403, "forbidden");
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403 });
    expect(await sendAttempt(db(), "comment:7")).toBeNull();
    expect(reads).toEqual([]);
  });
});
