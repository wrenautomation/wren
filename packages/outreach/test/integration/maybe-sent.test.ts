/**
 * A send whose outcome is unknown, on Postgres with fake channels (designs/2026-10-16-maybe-sent.md):
 * our words found after an unknown outcome are recorded once and never sent again; not found is
 * sent once more; unreadable parks unsure with no send; a second invocation meanwhile sends
 * nothing. The sender's DMs, a person's Mark posted and the scheduler's hands-off follow. Then the
 * newer keys: an X reply read back by `Content.findReply`, a private reply (`private:`) with no
 * read and read back from the Page's inbox, an Instagram comment (`onpost:`) read back off the
 * post page, and a client's DM answer (`sdm:`) read back from its conversation.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type CommentRow, SiteCallError, type SiteClient } from "@wren/core/content";
import { pageInboxOf, seenPrivateReply } from "@wren/core/content/page-inbox";
import { type Seen, seenInMessages } from "@wren/core/maybe-sent";
import { fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { commentById } from "../../src/comments.js";
import { addContact } from "../../src/contacts.js";
import { enroll } from "../../src/enroll.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { COMMENTS_SETTINGS } from "../../src/reach-posts.js";
import {
  contentLook,
  igCommentLook,
  isSendTaken,
  isSendUnsure,
  sendAtMostOnce,
} from "../../src/restate/maybe-sent.js";
import { schedulePosts } from "../../src/scheduled.js";
import {
  comments,
  type ReachAccount,
  reachMessages,
  reachPosts,
  sendAttempts,
} from "../../src/schema.js";
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
    "comments",
    "touches",
  ]);
});

/** A stand-in Context: steps run inline, sleeps are counted, each one its own invocation. */
let invocations = 0;
function ctxOf(services: Record<string, unknown> = {}) {
  const id = `inv_${++invocations}`;
  const sleeps: number[] = [];
  const ctx = {
    run: async (_name: string, fn: () => Promise<unknown>) => fn(),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    date: { now: async () => NOW.getTime() },
    request: () => ({ id }),
    serviceClient: ({ name }: { name: string }) => services[name],
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

describe("an X reply, read back by a search of our own posts", () => {
  const WORDS = "Our words under their post.";
  const X_MAYBE = new SiteCallError("x", "POST", "/2/tweets", 502, "may have gone through");
  /** X as `Content.findReply` reads it: ours once it landed, else search can't say yet. */
  const x = { landed: false, posted: 0, asked: [] as unknown[] };
  const content = {
    comments: async (): Promise<CommentRow[]> => [],
    findReply: async (req: unknown): Promise<Seen> => {
      x.asked.push(req);
      return x.landed
        ? { kind: "found", ref: "x_9", at: NOW.toISOString(), url: "https://x.com/i/status/x_9" }
        : { kind: "unclear", why: "X search may not show a fresh reply yet" };
    },
  };
  const reply = (landed: boolean, again = false) => {
    const { ctx } = ctxOf({ Content: content });
    return sendAtMostOnce(ctx, db(), {
      item: "onpost:7",
      platform: "x",
      account: null,
      words: WORDS,
      target: "x_1",
      url: "https://x.com/someone_1/status/x_1",
      again,
      look: contentLook(ctx, {
        platform: "x",
        post: "x_1",
        parent: null,
        to: "someone_1",
        text: WORDS,
      }),
      send: async () => {
        x.posted += 1;
        x.landed = landed;
        throw X_MAYBE;
      },
    });
  };
  beforeEach(() => {
    Object.assign(x, { landed: false, posted: 0, asked: [] });
  });

  it("found after an unknown outcome: marked once, with its ref, never sent again", async () => {
    expect(await reply(true)).toMatchObject({ ref: "x_9", found: true });
    expect(x.asked[0]).toMatchObject({ platform: "x", on: "x_1", to: "someone_1", text: WORDS });
    expect(await sendAttempt(db(), "onpost:7")).toMatchObject({ state: "sent", ref: "x_9" });
    expect(await reply(true)).toMatchObject({ ref: "x_9", found: true });
    expect(x.posted).toBe(1);
  });

  it("search can't see it: unsure, a second invocation sends nothing", async () => {
    expect(isSendUnsure(await reply(false).catch((e: unknown) => e))).toBe(true);
    const again = await reply(false).catch((e: unknown) => e);
    expect(isSendTaken(again)).toBe(true);
    expect(x.posted).toBe(1);
    expect(await sendAttempt(db(), "onpost:7")).toMatchObject({ state: "unsure" });
  });
});

describe("a private reply (private:), with nothing to read it back", () => {
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
  const META_MAYBE = new SiteCallError("meta", "POST", "/p1/messages", 504, "timed out");

  it("unknown outcome: unsure at once; Mark posted records the DM as a send would", async () => {
    const id = await ourComment();
    let sent = 0;
    const err = await privately(id, async () => {
      sent += 1;
      throw META_MAYBE;
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

describe("a private reply (private:), read back from the Page's inbox", () => {
  const WORDS = "Here is the setup guide you asked for.";
  const META_MAYBE = new SiteCallError("meta", "POST", "/p1/messages", 504, "timed out");
  /** The Page's inbox as `Content.findPrivateReply` reads it; null = the read fails. */
  let inbox: unknown = null;
  let sent = 0;
  const ours = (at: string) => ({
    data: [
      {
        participants: { data: [{ id: "p1" }, { id: "u1", username: "reader1" }] },
        updated_time: at,
        messages: { data: [{ id: "m_7", message: WORDS, from: { id: "p1" }, created_time: at }] },
      },
    ],
  });
  const privately = (landed: unknown) =>
    sendAtMostOnce(ctxOf().ctx, db(), {
      item: "private:9",
      platform: "instagram",
      account: null,
      words: WORDS,
      target: "c1",
      url: "https://example.test/c1",
      look: async (since) => {
        if (!inbox) throw new Error("conversations: 403");
        return seenPrivateReply(pageInboxOf(inbox, "p1"), { to: "reader1", text: WORDS, since });
      },
      send: async () => {
        sent += 1;
        inbox = landed;
        throw META_MAYBE;
      },
    });
  beforeEach(() => {
    inbox = { data: [] };
    sent = 0;
  });

  it("in their conversation after an unknown outcome: marked once with the message's id", async () => {
    expect(await privately(ours("2026-10-01T18:00:05+0000"))).toMatchObject({
      ref: "m_7",
      found: true,
    });
    expect(await sendAttempt(db(), "private:9")).toMatchObject({ state: "sent", ref: "m_7" });
    expect(sent).toBe(1);
  });

  it("a whole inbox without it: sent once more, then unsure; a failed read: unsure at once", async () => {
    expect(isSendUnsure(await privately({ data: [] }).catch((e: unknown) => e))).toBe(true);
    expect(sent).toBe(2);
    await db().delete(sendAttempts);
    sent = 0;
    expect(isSendUnsure(await privately(null).catch((e: unknown) => e))).toBe(true);
    expect(sent).toBe(1);
    expect(await sendAttempt(db(), "private:9")).toMatchObject({ state: "unsure" });
  });
});

describe("an Instagram comment (onpost:), read back off the post page", () => {
  const WORDS = "Lovely light in this one, where was it taken?";
  const IG_MAYBE = new SiteCallError(
    "instagram",
    "POST",
    "/web/p/AbC123/comments",
    504,
    "timed out",
  );
  /** The post's comments as autobrowse reads them as our account. */
  const page = {
    landed: false,
    /** Our comment shows in the read once it lands. */
    shows: true,
    viewer: "our_acct" as string | null,
    more: false,
    posted: 0,
  };
  const asked: unknown[] = [];
  const sites = {
    call: async (_site: string, method: string, path: string, input: unknown, account?: string) => {
      asked.push([method, path, input, account]);
      return {
        url: "https://www.instagram.com/p/AbC123/",
        viewer: page.viewer,
        more: page.more,
        comments: [
          { id: "1", text: "Nice", at: "2026-10-01T17:00:00.000Z", mine: false },
          ...(page.landed && page.shows
            ? [{ id: "2", text: WORDS, at: "2026-10-01T18:00:04.000Z", mine: true }]
            : []),
        ],
      };
    },
  } as unknown as SiteClient;
  const comment = () =>
    sendAtMostOnce(ctxOf().ctx, db(), {
      item: "onpost:8",
      platform: "instagram",
      account: "instagram@alt",
      words: WORDS,
      target: "AbC123",
      url: "https://www.instagram.com/p/AbC123/",
      look: igCommentLook(sites, { shortcode: "AbC123", text: WORDS, account: "instagram@alt" }),
      send: async () => {
        page.posted += 1;
        page.landed = true;
        throw IG_MAYBE;
      },
    });
  beforeEach(() => {
    Object.assign(page, { landed: false, shows: true, viewer: "our_acct", more: false, posted: 0 });
    asked.length = 0;
  });

  it("ours after an unknown outcome: marked once, read as the sending account", async () => {
    expect(await comment()).toMatchObject({ ref: "2", found: true });
    expect(asked[0]).toEqual([
      "GET",
      "/web/p/AbC123/comments",
      { shortcode: "AbC123" },
      "instagram@alt",
    ]);
    expect(await sendAttempt(db(), "onpost:8")).toMatchObject({ state: "sent", ref: "2" });
    expect(page.posted).toBe(1);
  });

  it("not in the whole list: sent once more, then unsure", async () => {
    page.shows = false;
    expect(isSendUnsure(await comment().catch((e: unknown) => e))).toBe(true);
    expect(page.posted).toBe(2);
  });

  it("a ranked list cut short, or no viewer: unsure, never a second send", async () => {
    page.shows = false;
    page.more = true;
    expect(isSendUnsure(await comment().catch((e: unknown) => e))).toBe(true);
    expect(page.posted).toBe(1);
    await db().delete(sendAttempts);
    Object.assign(page, { more: false, viewer: null, posted: 0 });
    expect(isSendUnsure(await comment().catch((e: unknown) => e))).toBe(true);
    expect(page.posted).toBe(1);
    expect(await sendAttempt(db(), "onpost:8")).toMatchObject({ state: "unsure" });
  });
});

describe("a client's DM answer (sdm:), read back from its conversation", () => {
  const WORDS = "Yes, we open at nine.";
  const SINCE_ON = NOW.toISOString();
  /** Their conversation as the account reads it, oldest first. */
  const convo = {
    readable: true,
    messages: [
      { id: "e1", text: "Are you open Saturday?", at: "2026-10-01T17:00:00Z", mine: false },
    ],
  };
  const answer = (send: () => Promise<{ ref: string | null }>, again = false) =>
    sendAtMostOnce(ctxOf().ctx, db(), {
      item: "sdm:41",
      platform: "x",
      account: "social:3",
      words: WORDS,
      target: "patient_test",
      url: "https://x.com/patient_test",
      again,
      look: async (since) => {
        if (!convo.readable) throw new Error("dm_events: 503");
        return seenInMessages(convo.messages, { text: WORDS, since });
      },
      send,
    });
  const X_MAYBE = new SiteCallError("x", "POST", "/2/dm_conversations", 502, "bad gateway");
  beforeEach(() => {
    convo.readable = true;
    convo.messages = convo.messages.slice(0, 1);
  });

  it("found after an unknown outcome: marked once, never sent again", async () => {
    let sent = 0;
    const lands = async () => {
      sent += 1;
      convo.messages.push({ id: "e2", text: WORDS, at: SINCE_ON, mine: true });
      throw X_MAYBE;
    };
    expect(await answer(lands)).toMatchObject({ ref: "e2", found: true });
    expect(await answer(lands)).toMatchObject({ ref: "e2", found: true });
    expect(sent).toBe(1);
    expect(await sendAttempt(db(), "sdm:41")).toMatchObject({ state: "sent", settledBy: "found" });
  });

  it("not there and the read reaches back past the send: sent once more", async () => {
    let sent = 0;
    const once = async () => {
      sent += 1;
      if (sent === 1) throw X_MAYBE;
      return { ref: "e3" };
    };
    expect(await answer(once)).toMatchObject({ ref: "e3", found: false });
    expect(sent).toBe(2);
  });

  it("unreadable: unsure, a second invocation sends nothing", async () => {
    convo.readable = false;
    let sent = 0;
    const err = await answer(async () => {
      sent += 1;
      throw X_MAYBE;
    }).catch((e: unknown) => e);
    expect(isSendUnsure(err)).toBe(true);
    expect(isSendTaken(await answer(async () => ({ ref: "e9" })).catch((e: unknown) => e))).toBe(
      true,
    );
    expect(sent).toBe(1);
    expect(await sendAttempt(db(), "sdm:41")).toMatchObject({ state: "unsure" });
  });
});
