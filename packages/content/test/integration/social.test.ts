/**
 * SocialWatch against Postgres and a Restate test environment, through the real `Content` service
 * over fake channels: comments on recent posts kept once as content rows (ours closed), each new
 * one on the spine, activity since the newest kept row, one follower count a day, one ping per
 * pass that kept something (a text only when a comment asks). Then the Inbox records, mark seen,
 * a content comment's answer plan, and the comment guide.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import {
  type ActivityRow,
  type ContentChannel,
  fakeContentChannel,
  SiteCallError,
} from "@wren/core/content";
import { makeContent } from "@wren/core/content/restate";
import type { Notifier } from "@wren/core/notify";
import { resolveObjects } from "@wren/core/objects";
import { fakeOutreachChannel } from "@wren/core/outreach";
import type { PassOutcome } from "@wren/core/restate";
import type { SpineEvent } from "@wren/core/spine";
import { askPublish, saveDraft } from "@wren/core/templates";
import { startTestRestate } from "@wren/core/testing";
import { seedObjects, startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import {
  answerComment,
  comments,
  parkUnsure,
  planAnswer,
  reachContacts,
  reachMessages,
  reachPosts,
  redditPlaces,
  redditRequirements,
  redditThreads,
  sendAttempts,
} from "@wren/outreach";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addIdea,
  COMMENTS_SOP,
  commentGuide,
  contentDrafts,
  DM_SOP,
  dmGuide,
  playbookFor,
  pushPlaybook,
  socialActivity,
  socialDays,
} from "../../src/index.js";
import type { SocialStats } from "../../src/restate/social.js";
import { makeSocialDesk, makeSocialWatch, SOCIAL_KEY } from "../../src/restate/social.js";
import { makeSocialPush, socialPushed } from "../../src/restate/social-push.js";
import {
  activityRecord,
  approvalRecord,
  audienceRecord,
  inboxRecord,
} from "../../src/social/records.js";

const DAY = 86_400_000;
const ytReads: string[] = [];
let li = fakeContentChannel("linkedin");
let yt = fakeContentChannel("youtube");
let channels: Record<string, ContentChannel> = {};
const emitted: SpineEvent[] = [];
const fakeSpine = restate.service({
  name: "Spine",
  handlers: {
    emit: async (_ctx: restate.Context, req: { events: SpineEvent[] }) => {
      emitted.push(...req.events);
      return {};
    },
  },
});
/** ReachWatch stands in: a DM push wakes it. */
const reachWakes: number[] = [];
const fakeReachWatch = restate.object({
  name: "ReachWatch",
  handlers: {
    wake: async () => {
      reachWakes.push(Date.now());
    },
  },
});
/** `reach` is ingress private: ask it the way ReachWatch does, from a handler. */
const askReach = restate.service({
  name: "AskReach",
  handlers: {
    reach: async (ctx: restate.Context) =>
      ctx
        .objectClient<{ reach: (c: restate.ObjectContext) => Promise<unknown> }>(
          { name: "SocialPushed" },
          SOCIAL_KEY,
        )
        .reach(),
  },
});
const pings: string[] = [];
const texts: string[] = [];
const sink = (into: string[]): Notifier => ({
  name: "test",
  notify: async (title) => {
    into.push(title);
    return true;
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      fakeSpine,
      makeContent(() => channels),
      socialPushed,
      fakeReachWatch,
      askReach,
      makeSocialPush({ db: pg.db, ours: {} }),
      makeSocialWatch({
        db: pg.db,
        platforms: ["linkedin", "youtube"],
        zone: "America/New_York",
        notifier: sink(pings),
        texter: sink(texts),
      }),
      makeSocialDesk({ db: pg.db, zone: "America/New_York" }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "content_ideas",
    "content_drafts",
    "content_playbooks",
    "comments",
    "social_activity",
    "social_days",
    "reach_messages",
    "reach_contacts",
    "reach_posts",
    "reddit_requirements",
    "reddit_threads",
    "reddit_places",
    "send_attempts",
    "touches",
    "social_handles",
  ]);
  emitted.length = 0;
  pings.length = 0;
  texts.length = 0;
  ytReads.length = 0;
  li = fakeContentChannel("linkedin");
  yt = fakeContentChannel("youtube");
  const ytFake = yt;
  channels = {
    linkedin: li,
    youtube: {
      ...ytFake,
      comments: async (id, q) => {
        ytReads.push(id);
        return ytFake.comments(id, q);
      },
    },
  };
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const watch = () =>
  ingress().objectClient<ReturnType<typeof makeSocialWatch>>({ name: "SocialWatch" }, SOCIAL_KEY);
const sync = () => watch().sync() as Promise<PassOutcome<SocialStats>>;

/** A published draft of `platform` post `id`, `days` old. */
async function published(platform: "linkedin" | "youtube", id: string, days: number) {
  const idea = await addIdea(pg.db, `idea ${id}`, "cli");
  await seedObjects(pg.db, [{ platform, ref: id, kind: "post" }]);
  await pg.db.insert(contentDrafts).values({
    ideaId: idea.id,
    platform,
    text: `Post ${id}\nmore`,
    status: "published",
    publishedId: id,
    publishedAt: new Date(Date.now() - days * DAY),
    url: `https://${platform}.test/p/${id}`,
    promptVersion: "test",
  });
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const follow = (id: string, msAgo: number | null): ActivityRow => ({
  id,
  kind: "follow",
  actor: `Reader ${id}`,
  actorUrl: null,
  text: `Reader ${id} followed you`,
  url: null,
  at: msAgo === null ? null : iso(msAgo),
  raw: { id },
});

describe("SocialWatch", () => {
  it("keeps comments, activity and followers once; pings once; texts only when one asks", async () => {
    const desk = ingress().serviceClient<ReturnType<typeof makeSocialDesk>>({ name: "SocialDesk" });
    await published("linkedin", "urn:li:share:1", 1);
    await published("youtube", "yt-p1", 5);
    li.receive({
      id: "7001",
      postId: "urn:li:share:1",
      author: "Ana",
      text: "Nice one",
      at: iso(60_000),
    });
    li.receive({
      id: "7002",
      postId: "urn:li:share:1",
      author: "Wren Automation",
      text: "Thanks!",
      at: iso(30_000),
      mine: true,
    });
    yt.receive({
      id: "yt-c1",
      postId: "yt-p1",
      parentId: "yt-c0",
      author: "Bo",
      text: "Would love the template, dm me",
      at: iso(120_000),
    });
    li.happen(follow("f1", 10_000));
    li.happen(follow("f2", null));
    li.follow(120);
    // A channel followed by hand on YouTube: our follow list keeps it as ours.
    yt.followOut({ handle: "@maker_synth", name: "Maker", url: null, at: iso(DAY) });
    // A count that throws is no reading this pass, not a failed pass.
    const yc = channels.youtube as ContentChannel;
    yc.audience = async () => {
      throw new Error("no profile");
    };

    const first = await sync();
    expect(first.stats).toMatchObject({
      posts: 2,
      comments: 2,
      asked: 1,
      activity: 2,
      following: 1,
      unfollowed: [],
    });
    // LinkedIn's count is never the loop's: it waits for Read now.
    expect(first.stats?.audience).toEqual([]);
    expect(first.stats?.missed).toEqual(["youtube audience: no profile"]);
    expect(await pg.db.select().from(socialDays)).toHaveLength(0);
    expect(await desk.readAudience({ platform: "linkedin" })).toMatchObject({
      platform: "linkedin",
      followers: 120,
    });
    expect(first.error).toBeNull();
    expect(pings).toEqual(["social: 2 comments (1 LinkedIn, 1 YouTube), 2 follows"]);
    expect(texts).toEqual(pings);
    expect(emitted.map((e) => e.kind)).toEqual(["comment", "comment"]);

    const rows = await pg.db.select().from(comments).orderBy(comments.ref);
    expect(rows.map((r) => [r.ref, r.channel, r.accountId, r.kind, r.state])).toEqual([
      ["7001", "content", null, "post_reply", "new"],
      ["7002", "content", null, "post_reply", "dropped"],
      ["yt-c1", "content", null, "comment_reply", "new"],
    ]);
    expect(rows[0]).toMatchObject({
      postTitle: "Post urn:li:share:1",
      url: "https://linkedin.test/p/urn:li:share:1",
    });
    const [undated] = await pg.db.select().from(socialActivity).where(eq(socialActivity.ref, "f2"));
    expect(undated?.at.getTime()).toBeGreaterThan(Date.now() - 600_000);
    expect(await pg.db.select().from(socialDays)).toHaveLength(1);

    // A second pass keeps nothing, says nothing, and reads neither post: LinkedIn's comments wait
    // 2 hours (its page read is capped), the old YouTube post as long.
    li.follow(130);
    const second = await sync();
    expect(second.stats).toMatchObject({ posts: 0, comments: 0, activity: 0, audience: [] });
    expect(ytReads).toEqual(["yt-p1"]);
    expect(pings).toHaveLength(1);
    const days = () => pg.db.select().from(socialDays).where(eq(socialDays.platform, "linkedin"));
    expect((await days()).map((d) => d.followers)).toEqual([120]);
    // A second read on demand replaces the day's count.
    await desk.readAudience({ platform: "linkedin" });
    expect((await days()).map((d) => d.followers)).toEqual([130]);

    // Follows alone ping Discord, never a text. LinkedIn's activity waits 2 hours (its daily cap).
    li.happen(follow("f4", 0));
    yt.happen(follow("f3", null));
    // Our follow lists wait a day.
    yt.followOut({ handle: "@other_synth", name: null, url: null, at: null });
    const third = await sync();
    expect(third.stats?.activity).toBe(1);
    expect(third.stats?.following).toBe(0);
    expect(pings.at(-1)).toBe("social: 1 follow");
    expect(texts).toHaveLength(1);
    // An undated row comes back every read, whatever the since; it is kept once.
    yc.activity = async () => [follow("f3", null)];
    expect((await sync()).stats?.activity).toBe(0);
  });

  it("reads a post's comments again only when its count moved; a failed count reads as before", async () => {
    await published("youtube", "yt-p4", 1);
    const counts: Record<string, number> = { "yt-p4": 0 };
    let down = false;
    const base = channels.youtube as ContentChannel;
    channels.youtube = {
      ...base,
      commentCounts: async (ids) => {
        if (down) throw new Error("counts down");
        return Object.fromEntries(
          ids.flatMap((id) => (counts[id] === undefined ? [] : [[id, counts[id] as number]])),
        );
      },
    };
    // Never read: read in full.
    expect((await sync()).stats).toMatchObject({ posts: 1, skipped: 0 });
    expect(ytReads).toEqual(["yt-p4"]);
    // The count held: due, but nothing to read.
    expect((await sync()).stats).toMatchObject({ posts: 0, skipped: 1 });
    expect(ytReads).toHaveLength(1);
    // A comment came in: the count moved, so the post is read and the comment kept.
    yt.receive({ id: "yt-c4", postId: "yt-p4", author: "Ed", text: "Great", at: iso(1000) });
    counts["yt-p4"] = 1;
    expect((await sync()).stats).toMatchObject({ posts: 1, skipped: 0, comments: 1 });
    expect((await sync()).stats).toMatchObject({ posts: 0, skipped: 1, comments: 0 });
    expect(ytReads).toHaveLength(2);
    // The count read fails: said in `missed`, not a failed pass, and the post is read as before.
    down = true;
    const failed = await sync();
    expect(failed.stats).toMatchObject({ posts: 1, skipped: 0 });
    expect(failed.stats?.missed).toEqual(["youtube comment counts: counts down"]);
    expect(failed.error).toBeNull();
    // A post the count read leaves out is read too.
    down = false;
    delete counts["yt-p4"];
    expect((await sync()).stats).toMatchObject({ posts: 1, skipped: 0 });
    expect(ytReads).toHaveLength(4);
  });

  it("Inbox lists every type; mark seen; followers per platform", async () => {
    await published("linkedin", "urn:li:share:2", 1);
    li.receive({
      id: "7009",
      postId: "urn:li:share:2",
      author: "Cy",
      text: "Question?",
      at: iso(1000),
    });
    // YouTube: LinkedIn activity waits 2 hours from the last test's read.
    yt.happen(follow("f9", 1000));
    yt.happen(follow("f10", 2000));
    await sync();
    const idea = await addIdea(pg.db, "idea waiting", "cli");
    const [d] = await pg.db
      .insert(contentDrafts)
      .values({ ideaId: idea.id, platform: "linkedin", text: "A draft", promptVersion: "test" })
      .returning();
    const inbox = (await inboxRecord.rows?.(pg.db)) ?? [];
    expect(inbox.map((r) => r.id).sort()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^comment:\d+$/),
        expect.stringMatching(/^activity:\d+$/),
      ]),
    );
    // A post draft waits on a yes in To approve, its id the draft's own after the colon.
    expect(inbox.find((r) => r.id === `draft:${d?.id}`)).toBeUndefined();
    // A template version asked to go live waits there too, by its template and version.
    const opener = { kind: "email" as const, system: "demo", name: "opener" };
    await saveDraft(pg.db, opener, "Subject: Hi\n\nHello {first_name}.", { by: "cli" });
    const asked = await askPublish(pg.db, opener, { by: "cli" });
    // An invite the sweep proposed waits by its contact, with the why.
    const [c] = await pg.db
      .insert(reachContacts)
      .values({
        platform: "linkedin",
        handle: "ana-b",
        url: "https://www.linkedin.com/in/ana-b/",
        foundIn: "people",
        name: "Ana B",
        fit: {
          why: "Founder at Acme, 50-249 people.",
          title: "Founder",
          company: "Acme",
          employees: 249,
          size: "50 - 249",
          engaged: null,
        },
      })
      .returning();
    if (!c) throw new Error("contact");
    await pg.db
      .insert(reachMessages)
      .values({ contactId: c.id, direction: "out", kind: "connect", body: "", state: "proposed" });
    const approvals = (await approvalRecord.rows?.(pg.db)) ?? [];
    expect(approvals.find((r) => r.id === `connect:${c.id}`)).toMatchObject({
      type: "connect",
      who: "Ana B",
      platform: "linkedin",
      state: "waiting",
      body: "Founder at Acme, 50-249 people.",
      post_title: "Acme",
    });
    expect(inbox.find((r) => String(r.id).startsWith("connect:"))).toBeUndefined();
    // A comment drafted on someone else's LinkedIn post: the post, why, and our draft.
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:1" },
      { platform: "reddit", kind: "post", raw: "t3_q1" },
    ]);
    const [lp] = await pg.db
      .insert(reachPosts)
      .values({
        ref: "urn:li:activity:1",
        author: "Ben C",
        text: "Hiring is slow this quarter.",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        foundBy: "topic: hiring",
        account: "linkedin@wren",
        why: 'Founder at Acme. On "hiring".',
        state: "queued",
        draft: "We cut it to a week by texting.",
        raw: {},
      })
      .returning();
    const again = (await approvalRecord.rows?.(pg.db)) ?? [];
    expect(again.find((r) => r.id === `onpost:${lp?.id}`)).toMatchObject({
      type: "onpost",
      kind: "onpost",
      who: "Ben C",
      platform: "linkedin",
      state: "waiting",
      body: "Hiring is slow this quarter.",
      why: 'Founder at Acme. On "hiring".',
      draft: "We cut it to a week by texting.",
    });
    // Reddit discovery's queued thread: To approve's "Thread to answer", the draft to post.
    await pg.db
      .insert(redditPlaces)
      .values({ subreddit: "agency", name: "agency", foundBy: "test" });
    await pg.db.insert(redditThreads).values({
      id: "t3_q1",
      subreddit: "agency",
      title: "How do you chase invoices?",
      body: "We lose a day a week.",
      author: "cfo_jane",
      url: "https://www.reddit.com/r/agency/comments/q1/",
      postedAt: new Date(),
      comments: 3,
      raw: {},
      state: "queued",
      draft: "We send them from the CRM.",
    });
    const third = (await approvalRecord.rows?.(pg.db)) ?? [];
    expect(third.find((r) => r.id === "thread:t3_q1")).toMatchObject({
      type: "thread",
      kind: "thread",
      state: "waiting",
      draft: "We send them from the CRM.",
    });
    // A subreddit's karma rule we don't meet holds it: queued, with the reason, no slot.
    await pg.db
      .insert(redditRequirements)
      .values({ subreddit: "agency", source: "removal", minKarma: 50, item: "thread:t3_old" });
    const heldRows = (await approvalRecord.rows?.(pg.db)) ?? [];
    expect(heldRows.find((r) => r.id === "thread:t3_q1")).toMatchObject({
      state: "held",
      held: "r/agency needs 50 karma: no account to send from",
      send_at: null,
    });
    await pg.db.delete(redditRequirements);
    // A comment that may have gone out takes its thread's place, with the link to check it.
    await parkUnsure(pg.db, {
      item: "thread:t3_q1",
      platform: "reddit",
      account: "reddit@alt",
      words: "We send them from the CRM.",
      target: "t3_q1",
      url: "https://www.reddit.com/r/agency/comments/q1/",
      why: "our words are not in the account's comments as read",
      tries: 1,
      now: new Date(),
    });
    const unsure = (await approvalRecord.rows?.(pg.db)) ?? [];
    expect(unsure.find((r) => r.id === "thread:t3_q1")).toBeUndefined();
    expect(unsure.find((r) => r.id === "unsure:thread:t3_q1")).toMatchObject({
      type: "unsure",
      kind: "unsure",
      state: "waiting",
      who: "cfo_jane",
      body: "We send them from the CRM.",
      on_site: "https://www.reddit.com/r/agency/comments/q1/",
    });
    await pg.db.delete(sendAttempts);
    const inboxAfter = (await inboxRecord.rows?.(pg.db)) ?? [];
    expect(inboxAfter.find((r) => String(r.id).startsWith("thread:"))).toBeUndefined();
    expect(inboxAfter.find((r) => String(r.id).startsWith("onpost:"))).toBeUndefined();
    expect(approvals.find((r) => r.id === `draft:${d?.id}`)).toMatchObject({
      type: "draft",
      state: "waiting",
      body: "A draft",
    });
    expect(approvals.find((r) => r.id === `template:${asked.id}:1`)).toMatchObject({
      type: "template",
      who: "email:demo/opener",
      platform: "email",
      state: "waiting",
      body: "Subject: Hi\n\nHello {first_name}.",
    });
    expect(inbox.find((r) => r.type === "comment")).toMatchObject({
      platform: "linkedin",
      channel: "content",
      account: null,
      state: "new",
    });
    const acts = (await activityRecord.rows?.(pg.db)) ?? [];
    const desk = ingress().serviceClient<ReturnType<typeof makeSocialDesk>>({ name: "SocialDesk" });
    expect(await desk.markSeen({ ids: [Number(acts[0]?.id)] })).toEqual({ seen: 1 });
    expect(await desk.markAllSeen()).toEqual({ seen: 1 });
    expect(await desk.markAllSeen()).toEqual({ seen: 0 });
    await desk.readAudience({ platform: "linkedin" });
    const audience = (await audienceRecord.rows?.(pg.db)) ?? [];
    expect(audience.find((r) => r.id === "linkedin")).toMatchObject({ site: "LinkedIn" });
  });

  it("a content comment plans with no account and refuses the reach answer and DM", async () => {
    await published("linkedin", "urn:li:share:3", 1);
    li.receive({ id: "7003", postId: "urn:li:share:3", author: "Di", text: "How?", at: iso(1000) });
    await sync();
    const [c] = await pg.db.select().from(comments).where(eq(comments.ref, "7003"));
    const plan = await planAnswer(pg.db, c?.id as number, new Date());
    expect(plan).toMatchObject({ account: null, others: [] });
    await expect(
      answerComment(pg.db, fakeOutreachChannel("linkedin", { account: "linkedin@x" }), {
        id: c?.id as number,
        body: "Like this",
        now: new Date(),
      }),
    ).rejects.toThrow(/Content.reply/);
  });

  it("Refresh on a comment on our post reads that post again and keeps only what's new", async () => {
    await published("linkedin", "urn:li:share:4", 1);
    li.receive({
      id: "7004",
      postId: "urn:li:share:4",
      author: "Ed",
      text: "First",
      at: iso(5000),
    });
    await sync();
    const [c] = await pg.db.select().from(comments).where(eq(comments.ref, "7004"));
    li.receive({
      id: "7005",
      postId: "urn:li:share:4",
      author: "Ed",
      text: "Then this",
      at: iso(1000),
    });
    const desk = ingress().serviceClient<ReturnType<typeof makeSocialDesk>>({ name: "SocialDesk" });
    expect(await desk.readPost({ id: c?.id as number })).toEqual({ read: true, kept: 1 });
    expect(await desk.readPost({ id: c?.id as number })).toEqual({ read: true, kept: 0 });
    const kept = await pg.db.select().from(comments).where(eq(comments.ref, "7005"));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ channel: "content", post: "urn:li:share:4" });
  });

  // Last here: the hold outlives the test, on the loop's state.
  it("a used daily cap holds the platform's comment reads until it resets: no error", async () => {
    await published("youtube", "yt-p5", 0);
    let asked = 0;
    channels.youtube = {
      ...(channels.youtube as ContentChannel),
      comments: async () => {
        asked++;
        throw new SiteCallError(
          "youtube",
          "GET",
          "/comments",
          429,
          "search cap is used (50/50 today); retry after 7200s",
        );
      },
    };
    const capped = await sync();
    expect(capped.error).toBeNull();
    expect(capped.stats).toMatchObject({ posts: 0, held: ["youtube comments"], errors: [] });
    const again = await sync();
    expect(again.error).toBeNull();
    expect(again.stats?.held).toEqual(["youtube comments"]);
    expect(asked).toBe(1);
  });
});

describe("comment guide", () => {
  it("the playbook and the comments SOP; the SOP never becomes the post playbook", async () => {
    expect(await commentGuide(pg.db, "linkedin")).toBe("");
    await pushPlaybook(pg.db, {
      platform: "linkedin",
      sop: "linkedin-posts",
      text: "Short lines.",
    });
    await pushPlaybook(pg.db, { platform: "linkedin", sop: COMMENTS_SOP, text: "Answer in kind." });
    await pushPlaybook(pg.db, { platform: "linkedin", sop: DM_SOP, text: "Two lines." });
    expect((await playbookFor(pg.db, "linkedin"))?.sop).toBe("linkedin-posts");
    expect(DM_SOP).toBe("outbound-copy");
    expect(await dmGuide(pg.db, "linkedin")).toBe("Two lines.");
    // One set of rules: a platform with none pushed reads another's.
    expect(await dmGuide(pg.db, "reddit")).toBe("Two lines.");
    await pushPlaybook(pg.db, { platform: "reddit", sop: DM_SOP, text: "Reddit lines." });
    expect(await dmGuide(pg.db, "reddit")).toBe("Reddit lines.");
    expect(await dmGuide(pg.db, "linkedin")).toBe("Two lines.");
    const guide = await commentGuide(pg.db, "linkedin");
    expect(guide).toContain("Short lines.");
    expect(guide).toContain("Answer in kind.");
    const again = await pushPlaybook(pg.db, {
      platform: "linkedin",
      sop: COMMENTS_SOP,
      text: "Answer in kind.",
    });
    expect(again.changed).toBe(false);
  });
});

// Last in the file: a watcher's activity push wakes a SocialWatch pass.
describe("SocialPushed for ReachWatch", () => {
  type Reach = { pushed: string[]; watched: string[] };
  const push = () =>
    ingress().serviceClient<ReturnType<typeof makeSocialPush>>({ name: "SocialPush" });
  const reach = () =>
    ingress().serviceClient<{ reach: () => Promise<Reach> }>({ name: "AskReach" }).reach();

  it("a watcher's rise reads its DMs now; its beat reads it cold; the pushed set empties", async () => {
    await push().watch({ owner: SOCIAL_KEY, platform: "linkedin", kind: "alive" });
    expect(await reach()).toEqual({ pushed: [], watched: ["linkedin"] });
    await push().watch({ owner: SOCIAL_KEY, platform: "linkedin", kind: "activity" });
    expect(await reach()).toEqual({ pushed: ["linkedin"], watched: ["linkedin"] });
    expect(await reach()).toEqual({ pushed: [], watched: ["linkedin"] });
    await expect.poll(() => reachWakes.length).toBeGreaterThan(0);
  });
});
