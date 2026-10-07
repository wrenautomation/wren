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
import { type ActivityRow, type ContentChannel, fakeContentChannel } from "@wren/core/content";
import { makeContent } from "@wren/core/content/restate";
import type { Notifier } from "@wren/core/notify";
import { fakeOutreachChannel } from "@wren/core/outreach";
import type { PassOutcome } from "@wren/core/restate";
import type { SpineEvent } from "@wren/core/spine";
import { askPublish, saveDraft } from "@wren/core/templates";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { answerComment, comments, planAnswer, reachContacts, reachMessages } from "@wren/outreach";
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
    await published("linkedin", "li-p1", 1);
    await published("youtube", "yt-p1", 5);
    li.receive({ id: "li-c1", postId: "li-p1", author: "Ana", text: "Nice one", at: iso(60_000) });
    li.receive({
      id: "li-c2",
      postId: "li-p1",
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
    // A count that throws is no reading this pass, not a failed pass.
    const yc = channels.youtube as ContentChannel;
    yc.audience = async () => {
      throw new Error("no profile");
    };

    const first = await sync();
    expect(first.stats).toMatchObject({ posts: 2, comments: 2, asked: 1, activity: 2 });
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
      ["li-c1", "content", null, "post_reply", "new"],
      ["li-c2", "content", null, "post_reply", "dropped"],
      ["yt-c1", "content", null, "comment_reply", "new"],
    ]);
    expect(rows[0]).toMatchObject({
      postTitle: "Post li-p1",
      url: "https://linkedin.test/p/li-p1",
    });
    const [undated] = await pg.db.select().from(socialActivity).where(eq(socialActivity.ref, "f2"));
    expect(undated?.at.getTime()).toBeGreaterThan(Date.now() - 600_000);
    expect(await pg.db.select().from(socialDays)).toHaveLength(1);

    // A second pass keeps nothing, reads the old post not at all, and says nothing.
    li.follow(130);
    const second = await sync();
    expect(second.stats).toMatchObject({ posts: 1, comments: 0, activity: 0, audience: [] });
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
    const third = await sync();
    expect(third.stats?.activity).toBe(1);
    expect(pings.at(-1)).toBe("social: 1 follow");
    expect(texts).toHaveLength(1);
    // An undated row comes back every read, whatever the since; it is kept once.
    yc.activity = async () => [follow("f3", null)];
    expect((await sync()).stats?.activity).toBe(0);
  });

  it("Inbox lists every type; mark seen; followers per platform", async () => {
    await published("linkedin", "li-p2", 1);
    li.receive({ id: "li-c9", postId: "li-p2", author: "Cy", text: "Question?", at: iso(1000) });
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
      account: "Wren",
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
    await published("linkedin", "li-p3", 1);
    li.receive({ id: "li-c3", postId: "li-p3", author: "Di", text: "How?", at: iso(1000) });
    await sync();
    const [c] = await pg.db.select().from(comments).where(eq(comments.ref, "li-c3"));
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
