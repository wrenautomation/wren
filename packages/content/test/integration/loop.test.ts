/**
 * The whole loop against Postgres and a Restate test environment: an idea is
 * drafted per platform (fake LLM, one journaled step each), a person approves,
 * the scheduler posts through a stand-in `Content` service and stamps the row;
 * a refusal lands on the row as `failed`; a scheduled draft waits its turn.
 */
import { randomUUID } from "node:crypto";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { runs } from "@wren/core";
import { MAY_HAVE_POSTED, type Platform, type Post } from "@wren/core/content";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import type { Seen } from "@wren/core/maybe-sent";
import { FakeLlm } from "@wren/llm";
import { sendAttempt } from "@wren/outreach";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chapterIdea } from "../../src/ideas/chapters.js";
import {
  addIdea,
  approveDrafts,
  collectStatus,
  contentDrafts,
  contentIdeas,
  contentMetrics,
  draftCosts,
  editDraft,
  getDraft,
  listDrafts,
  planFor,
  playbookFor,
  postMetricDays,
  pushPlaybook,
  respreadApproved,
  slotsOf,
  tomorrowOf,
  whatWorked,
} from "../../src/index.js";
import { PLATFORM_SPECS } from "../../src/platforms.js";
import { DESK_KEY, makeContentDesk, SCHEDULER_KEY } from "../../src/restate/index.js";
import { METRICS_KEY, type MetricsStats, makeContentMetrics } from "../../src/restate/metrics.js";
import { makeContentPlanner, PLANNER_KEY, type PlannerStats } from "../../src/restate/planner.js";
import { makeContentScheduler, type PublishStats } from "../../src/restate/scheduler.js";

const posted: { platform: Platform; post: Post }[] = [];
/** Comments the scheduler left under posts (a LinkedIn video's funnel link). */
const replied: { platform: Platform; commentId: string; text: string }[] = [];
const refuse = new Set<Platform>();
/** Platforms whose publish hangs on an awakeable, and the awakeables, until the test ends them. */
const hang = new Set<Platform>();
const hung: string[] = [];
const views = new Map<string, number>();
const notes: string[] = [];
let calls = 0;
let reportPlatforms: Platform[] = [];
let reportReads = 0;
/** What the loop handed `insights` as `read`, one per look. */
const insightReads: unknown[] = [];
/** Whether the stand-in channels have a batch read, the batches asked, and the posts read alone. */
let batching = false;
let batchFails = false;
/** Platforms whose desk browser stays busy past autobrowse's wait. */
const browserBusy = new Set<Platform>();
const leftOut = new Set<string>();
const batches: { platform: Platform; ids: string[] }[] = [];
const singles: string[] = [];
/** Posts whose counts read never answers. */
const hangMetrics = new Set<string>();
/** Platforms whose next publishes lose their answer after the post went out (autobrowse's words). */
const lose = new Map<Platform, number>();
/** Every publish asked, answered or not. */
const tried: Platform[] = [];
/** What a look at our own listing answers, and the looks asked. */
let listing: Seen["kind"] = "unclear";
const looks: { platform: Platform; words: string[]; since: string }[] = [];
const fakeContent = restate.service({
  name: "Content",
  handlers: {
    publish: async (ctx: restate.Context, req: { platform: Platform; post: Post }) => {
      await ctx.run("tried", () => {
        tried.push(req.platform);
      });
      const lost = await ctx.run("lose", () => {
        const left = lose.get(req.platform) ?? 0;
        if (left > 0) lose.set(req.platform, left - 1);
        return left > 0;
      });
      if (lost) {
        throw new restate.TerminalError(
          `${req.platform} POST /web/posts: 500 "post the video" already went through on an earlier try of this step; check it before running again; ${MAY_HAVE_POSTED}`,
          { errorCode: 500 },
        );
      }
      if (hang.has(req.platform)) {
        const { id, promise } = ctx.awakeable<string>();
        await ctx.run("hung", () => {
          hung.push(id);
        });
        const verdict = await promise;
        return {
          id: `${req.platform}-late`,
          url: `https://${req.platform}.test/p/${verdict}`,
          publishedAt: new Date().toISOString(),
          fetchedWith: "api" as const,
        };
      }
      if (refuse.has(req.platform))
        throw new restate.TerminalError(`no ${req.platform} channel configured`, {
          errorCode: 404,
        });
      if (browserBusy.has(req.platform))
        throw new restate.TerminalError(
          `${req.platform} POST /web/posts: 503 not sent: profile google@test is busy (explore:9092); waited 5 min for it, try again`,
          { errorCode: 503 },
        );
      posted.push(req);
      return {
        id: `${req.platform}-${posted.length}`,
        url: `https://${req.platform}.test/p/${posted.length}`,
        publishedAt: new Date().toISOString(),
        fetchedWith: "api" as const,
      };
    },
    reply: async (
      _ctx: restate.Context,
      req: { platform: Platform; commentId: string; text: string },
    ) => {
      replied.push(req);
    },
    metricsMany: async (
      _ctx: restate.Context,
      req: { platform: Platform; posts: { id: string }[] },
    ) => {
      if (!batching) return null;
      if (batchFails) throw new restate.TerminalError("batch down");
      batches.push({ platform: req.platform, ids: req.posts.map((p) => p.id) });
      return req.posts
        .filter((p) => !leftOut.has(p.id))
        .map((p) => ({
          id: p.id,
          views: views.get(p.id) ?? 0,
          reactions: 0,
          comments: 0,
          shares: 0,
          read: { batch: p.id },
          asOf: new Date().toISOString(),
          fetchedWith: "api" as const,
        }));
    },
    metrics: async (ctx: restate.Context, req: { platform: Platform; id: string }) => {
      singles.push(req.id);
      if (hangMetrics.has(req.id)) await ctx.awakeable<void>().promise;
      if (refuse.has(req.platform))
        throw new restate.TerminalError(`no ${req.platform} channel configured`, {
          errorCode: 404,
        });
      const v = views.get(req.id) ?? 0;
      return {
        id: req.id,
        views: v,
        reactions: Math.floor(v / 10),
        comments: 1,
        shares: 0,
        read: { seen: req.id },
        asOf: new Date().toISOString(),
        fetchedWith: "api" as const,
      };
    },
    // Deeper numbers: saves on every post, and no accounts to read.
    insights: async (
      _ctx: restate.Context,
      req: { platform: Platform; id: string; read?: unknown },
    ) => {
      insightReads.push(req.read);
      return {
        values: [{ metric: "saves", value: (views.get(req.id) ?? 0) / 50 }],
        gaps: [{ metric: "retention", state: "needs_scope", why: "a synthetic refusal" }],
        asOf: new Date().toISOString(),
      };
    },
    findPost: async (
      ctx: restate.Context,
      req: { platform: Platform; words: string[]; since: string },
    ): Promise<Seen> => {
      await ctx.run("look", () => {
        looks.push(req);
      });
      if (listing === "found")
        return {
          kind: "found",
          ref: `${req.platform}-listed`,
          at: new Date().toISOString(),
          url: `https://${req.platform}.test/p/listed`,
        };
      if (listing === "absent") return { kind: "absent" };
      return { kind: "unclear", why: "the read failed: a synthetic outage" };
    },
    platforms: async () => reportPlatforms,
    accountInsights: async () => null,
    // A platform with a report that has nothing new.
    reportDays: async () => {
      reportReads += 1;
      return { rows: [], gaps: [], cursor: null, asOf: new Date().toISOString() };
    },
  },
});

const prompts: string[] = [];
const llm = new FakeLlm({
  respond: async (prompt) => {
    // A draft that outlasts the planner's wait, then lands.
    if (prompt.includes("a slow idea")) await new Promise((r) => setTimeout(r, 2_500));
    calls += 1;
    prompts.push(prompt);
    const reddit = prompt.includes("a Reddit text post");
    if (prompt.includes("The author read it and says"))
      return reddit
        ? '{"title": "Shorter", "text": "shorter. the gate asks first."}'
        : '{"text": "shorter. the gate asks first."}';
    if (reddit) return '{"title": "Spend gate", "text": "Shipped the spend gate."}';
    if (prompt.includes("one post on X"))
      return '{"text": "the spend gate is live. every buy asks first."}';
    if (prompt.includes("YouTube title")) return '{"title": "Spend gate", "text": "what it does"}';
    return '{"text": "Shipped the spend gate.\\n\\nEvery buy asks me first."}';
  },
});

const notifier = {
  name: "test",
  notify: async (title: string) => {
    notes.push(title);
    return true;
  },
};
/** Stands in for ReachDesk/settleSend: `settlePost` takes calls from other services only. */
type DeskObj = ReturnType<typeof makeContentDesk>;
const settleForward = restate.service({
  name: "SettleForward",
  handlers: {
    settle: async (
      ctx: restate.Context,
      req: { id: string; outcome: "posted" | "again"; by: string },
    ) => ctx.objectClient<DeskObj>({ name: "ContentDesk" }, DESK_KEY).settlePost(req),
  },
});
let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      fakeContent,
      settleForward,
      makeContentDesk({ db: pg.db, llm, platforms: ["linkedin", "x", "youtube"], zone: "UTC" }),
      makeContentScheduler({ db: pg.db, idleMs: 60_000, publishWaitMs: 3_000, settleMs: 10 }),
      makeContentMetrics({ db: pg.db, notifier, limits: { read: 1_500, batch: 1_500 } }),
      makeContentPlanner({
        db: pg.db,
        zone: "UTC",
        notifier,
        draftWaitMs: 1_500,
      }),
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
    "content_metrics",
    "content_playbooks",
    "runs",
    "reach_accounts",
    "unit_holds",
    "send_attempts",
    "draft_events",
  ]);
  lose.clear();
  tried.length = 0;
  listing = "unclear";
  looks.length = 0;
  posted.length = 0;
  replied.length = 0;
  notes.length = 0;
  prompts.length = 0;
  views.clear();
  refuse.clear();
  hang.clear();
  hung.length = 0;
  browserBusy.clear();
  batching = false;
  batchFails = false;
  leftOut.clear();
  hangMetrics.clear();
  batches.length = 0;
  singles.length = 0;
  calls = 0;
});

type Desk = ReturnType<typeof makeContentDesk>;
type Sched = ReturnType<typeof makeContentScheduler>;
const desk = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<Desk>({ name: "ContentDesk" }, DESK_KEY);
const sched = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<Sched>({ name: "ContentScheduler" }, SCHEDULER_KEY);
const sync = () => sched().sync() as Promise<PassOutcome<PublishStats>>;
type Met = ReturnType<typeof makeContentMetrics>;
const look = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<Met>({ name: "ContentMetrics" }, METRICS_KEY)
    .sync() as Promise<PassOutcome<MetricsStats>>;

/** X's single-post cap: Wren's account fact decides it (Premium posts one long post). */
const X_MAX = PLATFORM_SPECS.x.maxChars;
describe("content loop", () => {
  it("drafts one row per platform that fits, under one run, and skips a redraft", async () => {
    const out = await desk().add({ text: "shipped the spend gate today" });
    expect(out.idea.status).toBe("open");
    const r = out.drafts;
    if (!r) throw new Error("no drafts");
    expect(r.results.map((x) => [x.platform, x.ok])).toEqual([
      ["linkedin", true],
      ["x", true],
      ["youtube", false],
    ]);
    expect(r.results.find((x) => x.platform === "youtube")).toMatchObject({
      reason: "youtube needs a video",
    });
    expect(calls).toBe(2);
    const [run] = await pg.db.select().from(runs).where(eq(runs.id, r.runId));
    expect(run?.stats).toEqual({ drafted: 2, skipped: 1 });
    const rows = await listDrafts(pg.db, { ideaId: out.idea.id });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.llm).toMatchObject({ call: { provider: "fake", run_id: r.runId } });
    const again = await desk().draft({ ideaId: out.idea.id, platforms: ["x"] });
    expect(again.results[0]).toMatchObject({ ok: false, reason: "already drafted (use again)" });
    expect(calls).toBe(2);
  });

  it("posts approved drafts, stamps them, and records a refusal on the row", async () => {
    const out = await desk().add({
      text: "a short about the gate",
      media: { kind: "video", source: "https://cdn.test/gate.mp4", title: "Gate" },
    });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    expect(drafts.map((d) => d.platform).sort()).toEqual(["linkedin", "x", "youtube"]);
    expect(drafts.find((d) => d.platform === "youtube")?.title).toBe("Spend gate");
    // Every stored draft is one paid call in the cost view.
    const costs = await draftCosts(pg.db, new Date(), 1);
    expect(costs.map((c) => [c.platform, c.calls])).toEqual([
      ["linkedin", 1],
      ["x", 1],
      ["youtube", 1],
    ]);
    // Nothing posts before approval.
    expect((await sync()).stats).toMatchObject({ published: [], failed: [], remaining: 0 });
    refuse.add("x");
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    const pass = await sync();
    expect(pass.stats?.published.map((p) => p.platform).sort()).toEqual(["linkedin", "youtube"]);
    expect(pass.stats?.failed).toMatchObject([
      { platform: "x", error: expect.stringContaining("no x channel") },
    ]);
    const yt = posted.find((p) => p.platform === "youtube");
    const ytId = drafts.find((d) => d.platform === "youtube")?.id.slice(0, 8);
    // The funnel's link goes last on its own line: reach, the site (designs/2026-10-07-content-funnel.md).
    expect(yt?.post).toMatchObject({
      text: `what it does\n\nhttps://wrenautomation.com/go/yt/reach/${ytId}`,
      extra: { title: "Spend gate" },
      media: { source: "https://cdn.test/gate.mp4" },
    });
    const after = await listDrafts(pg.db, { ideaId: out.idea.id });
    const li = after.find((d) => d.platform === "linkedin");
    expect(li).toMatchObject({
      status: "published",
      publishedId: expect.stringMatching(/^linkedin-/),
      url: expect.stringContaining("linkedin.test"),
    });
    // A LinkedIn video carries no link in its text: it goes in the first comment.
    expect(posted.find((p) => p.platform === "linkedin")?.post.text).not.toContain("/go/");
    expect(replied).toEqual([
      {
        platform: "linkedin",
        commentId: li?.publishedId,
        text: `https://wrenautomation.com/go/li/reach/${li?.id.slice(0, 8)}`,
      },
    ]);
    const x = after.find((d) => d.platform === "x");
    if (!x) throw new Error("no x draft");
    expect(x.status).toBe("failed");
    // A failed draft can be re-approved and posts once the channel is back; nothing posts twice.
    refuse.delete("x");
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const again = await sync();
    expect(again.stats?.published.map((p) => p.platform)).toEqual(["x"]);
    expect(posted).toHaveLength(3);
  });

  it("a busy desk browser keeps the draft approved in its slot, says why, and posts it next pass", async () => {
    const out = await desk().add({ text: "a note on busy browsers" });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    browserBusy.add("x");
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.waiting).toMatchObject([{ platform: "x" }]);
    expect(pass.delayMs).toBe(60_000);
    const x = (await listDrafts(pg.db, { ideaId: out.idea.id })).find((d) => d.platform === "x");
    expect(x).toMatchObject({
      status: "approved",
      error: expect.stringMatching(
        /^Waiting for the browser: .*not sent: profile google@test is busy/,
      ),
    });
    expect(notes.some((n) => /failed/.test(n) && !/0 failed/.test(n))).toBe(false);
    browserBusy.clear();
    const again = await sync();
    expect(again.stats?.published.map((p) => p.platform)).toEqual(["x"]);
    const done = (await listDrafts(pg.db, { ideaId: out.idea.id })).find((d) => d.platform === "x");
    expect(done).toMatchObject({ status: "published", error: null });
  });

  it("moves on from a publish that hangs, and settles it on a later pass", async () => {
    const out = await desk().add({ text: "a post that hangs", platforms: ["x", "linkedin"] });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    hang.add("x");
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    // The hung X call no longer holds the pass: LinkedIn posts, X waits.
    const first = await sync();
    expect(first.stats?.published.map((p) => p.platform)).toEqual(["linkedin"]);
    expect(first.stats?.posting?.map((w) => w.platform)).toEqual(["x"]);
    const x = drafts.find((d) => d.platform === "x");
    if (!x) throw new Error("no x draft");
    expect((await getDraft(pg.db, x.id))?.status).toBe("publishing");
    // Still running: the next pass leaves it, and never claims the draft again.
    const second = await sync();
    expect(second.stats?.posting).toHaveLength(1);
    expect(hung).toHaveLength(1);
    const ingress = clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
    await ingress.resolveAwakeable(hung[0] as string, "late");
    const third = await sync();
    expect(third.stats?.published).toMatchObject([{ platform: "x", url: "https://x.test/p/late" }]);
    expect(third.stats?.posting).toBeUndefined();
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      url: "https://x.test/p/late",
    });
  });

  it("marks a publish failed when it ends in a refusal after the pass moved on", async () => {
    const out = await desk().add({ text: "a post that hangs then fails", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    hang.add("x");
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    expect((await sync()).stats?.posting).toHaveLength(1);
    const ingress = clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
    await ingress.rejectAwakeable(hung[0] as string, "the platform said no");
    const after = await sync();
    expect(after.stats?.failed).toMatchObject([
      { platform: "x", error: expect.stringContaining("the platform said no") },
    ]);
    expect((await getDraft(pg.db, x.id))?.status).toBe("failed");
  });

  it("a publish that may have gone through and is on our listing is published with its id, never sent again", async () => {
    const out = await desk().add({ text: "a post whose answer is lost", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    lose.set("x", 1);
    listing = "found";
    const before = Date.now();
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.published).toMatchObject([{ platform: "x", url: "https://x.test/p/listed" }]);
    expect(tried).toEqual(["x"]);
    // The look reads for the words it went out with, from the start of the send.
    expect(looks).toHaveLength(1);
    expect(looks[0]?.words).toContain(x.text);
    expect(new Date(looks[0]?.since ?? 0).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(looks[0]?.since ?? 0).getTime()).toBeGreaterThan(before - 60_000);
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      publishedId: "x-listed",
      url: "https://x.test/p/listed",
      error: expect.stringMatching(/^Found on X after the publish said it may have gone through/),
    });
    // Its words are frozen as sent, with the platform's id, as a publish that answered.
    const sent = await pg.db.execute<{ external_id: string }>(
      sql`select external_id from draft_events where item = ${`draft:${x.id}`} and event = 'sent'`,
    );
    expect([...sent]).toEqual([{ external_id: "x-listed" }]);
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toBeNull();
  });

  it("a lost publish provably not on our listing is sent once more, and only once", async () => {
    const out = await desk().add({ text: "a post that never landed", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    lose.set("x", 1);
    listing = "absent";
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const pass = await sync();
    expect(tried).toEqual(["x", "x"]);
    expect(pass.stats?.published).toMatchObject([{ platform: "x" }]);
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      publishedId: "x-1",
    });

    // Lost twice and absent twice: never a third, it waits on a person.
    const out2 = await desk().add({ text: "a post lost two times", platforms: ["x"] });
    const [y] = await listDrafts(pg.db, { ideaId: out2.idea.id });
    if (!y) throw new Error("no x draft");
    lose.set("x", 2);
    tried.length = 0;
    await approveDrafts(pg.db, [y.id], { now: new Date() });
    const second = await sync();
    expect(tried).toEqual(["x", "x"]);
    expect(second.stats?.failed).toEqual([]);
    expect(second.stats?.unsure).toMatchObject([
      { platform: "x", why: expect.stringContaining("not on X after two tries") },
    ]);
    expect(await sendAttempt(pg.db, `draft:${y.id}`)).toMatchObject({ state: "unsure", tries: 2 });
  });

  it("a lost publish no read can tell waits in To approve, never failed, and settles on his word", async () => {
    const out = await desk().add({ text: "a post nobody can see", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    lose.set("x", 1);
    listing = "unclear";
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.unsure).toMatchObject([
      { platform: "x", why: expect.stringContaining("a synthetic outage") },
    ]);
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "publishing",
      error: expect.stringMatching(/^May have gone out: .*It waits in To approve\.$/),
    });
    const row = await sendAttempt(pg.db, `draft:${x.id}`);
    expect(row).toMatchObject({
      state: "unsure",
      platform: "x",
      words: expect.stringContaining(x.text),
      tries: 1,
    });
    // An edit says where it waits, not that it is posting.
    await expect(editDraft(pg.db, x.id, { text: "changed" })).rejects.toThrow(
      /may have gone out, so it can't be edited\. Check it in To approve first/,
    );
    // No later pass takes it again while it waits.
    await sync();
    expect(tried).toEqual(["x"]);

    const ingress = clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
    const settle = (outcome: "posted" | "again") =>
      ingress
        .serviceClient<typeof settleForward>({ name: "SettleForward" })
        .settle({ id: x.id, outcome, by: "william" });
    // Send again: the look still can't find it, so it goes back to the queue and posts once.
    listing = "absent";
    expect(await settle("again")).toMatchObject({ outcome: "again", found: false });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toBeNull();
    expect((await getDraft(pg.db, x.id)).status).toBe("approved");
    await sync();
    expect(tried).toEqual(["x", "x"]);
    expect(await getDraft(pg.db, x.id)).toMatchObject({ status: "published", publishedId: "x-1" });
  });

  it("Mark posted on a lost publish: the listing's id when found, his word when not", async () => {
    const out = await desk().add({ text: "two posts he checks", platforms: ["x", "linkedin"] });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    lose.set("x", 1);
    lose.set("linkedin", 1);
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    expect((await sync()).stats?.unsure).toHaveLength(2);
    const ingress = clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
    const settle = (id: string) =>
      ingress
        .serviceClient<typeof settleForward>({ name: "SettleForward" })
        .settle({ id, outcome: "posted", by: "william" });
    const [x, li] = ["x", "linkedin"].map((p) => drafts.find((d) => d.platform === p)?.id ?? "");
    // The read is back: it finds the post, so it gets the platform's id and its numbers.
    listing = "found";
    expect(await settle(x as string)).toMatchObject({ found: true });
    expect(await getDraft(pg.db, x as string)).toMatchObject({
      status: "published",
      publishedId: "x-listed",
    });
    expect(await sendAttempt(pg.db, `draft:${x}`)).toMatchObject({
      state: "sent",
      ref: "x-listed",
      settledBy: "found",
    });
    // Still nothing to read: published on his word, with no id.
    listing = "unclear";
    expect(await settle(li as string)).toMatchObject({ found: false });
    expect(await getDraft(pg.db, li as string)).toMatchObject({
      status: "published",
      publishedId: null,
      error: expect.stringMatching(/^Marked posted by william/),
    });
    expect(await sendAttempt(pg.db, `draft:${li}`)).toMatchObject({
      state: "sent",
      settledBy: "william",
    });
    // A second word on a settled post is refused, never run twice.
    await expect(settle(li as string)).rejects.toThrow(/that send is sent/);
    expect(tried.sort()).toEqual(["linkedin", "x"]);
  });

  it("a failure that may have posted is approved again only after a person is told to check", async () => {
    const out = await desk().add({ text: "a note on retries" });
    const d = (await listDrafts(pg.db, { ideaId: out.idea.id })).find((r) => r.platform === "x");
    if (!d) throw new Error("no x draft");
    await pg.db
      .update(contentDrafts)
      .set({ status: "failed", error: `x POST /2/tweets: 504 timeout; ${MAY_HAVE_POSTED}` })
      .where(eq(contentDrafts.id, d.id));
    await expect(approveDrafts(pg.db, [d.id], { now: new Date() })).rejects.toThrow(
      /may have posted on x\. Check there first/,
    );
    const [again] = await approveDrafts(pg.db, [d.id], { now: new Date() });
    expect(again?.status).toBe("approved");
  });

  it("looks at each published post once a day and ranks the week", async () => {
    const out = await desk().add({ text: "the gate, in one line" });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    await sync();
    views.set("linkedin-1", 200);
    views.set("x-2", 50);
    refuse.add("x");
    const first = await look();
    expect(first.stats?.looked.map((l) => l.platform)).toEqual(["linkedin"]);
    expect(first.stats?.failed).toMatchObject([{ platform: "x" }]);
    // Looked at today: the next pass finds only the one that failed.
    refuse.delete("x");
    const second = await look();
    expect(second.stats?.looked.map((l) => l.platform)).toEqual(["x"]);
    expect((await look()).stats?.looked).toEqual([]);
    expect(await pg.db.select().from(contentMetrics)).toHaveLength(2);
    // Each look keeps its day's insights with the counts beside them.
    expect(first.stats?.looked[0]).toMatchObject({ insights: 5, gaps: 1 });
    // The counts read's answer goes on to insights, so a post is not read twice.
    expect(insightReads).toEqual([{ seen: "linkedin-1" }, { seen: "x-2" }]);
    const saves = await pg.db
      .select({ value: postMetricDays.value })
      .from(postMetricDays)
      .where(eq(postMetricDays.metric, "saves"));
    expect(saves.map((r) => r.value).sort()).toEqual([1, 4]);
    const ranked = await whatWorked(pg.db, new Date(), { days: 7 });
    // x: 50 views, 5+1+0 → 12/100; linkedin: 200 views, 20+1 → 10.5.
    expect(ranked.map((r) => r.platform)).toEqual(["x", "linkedin"]);
    expect(ranked[0]).toMatchObject({ views: 50, reactions: 5, looks: 1 });
    // A winner with an audience shapes the next draft on its platform.
    await desk().add({ text: "next idea", platforms: ["linkedin"] });
    expect(prompts.at(-1)).toContain("(10.5, 200 views)");
    // The Monday report goes out once per week.
    const monday = new Date().getUTCDay() === 1;
    expect(notes).toHaveLength(monday ? 1 : 0);
    expect(first.stats?.reported).toBe(monday);
    expect(second.stats?.reported).toBe(false);
  });

  it("reads a platform's due posts in one batch, and a post the batch left out alone", async () => {
    const a = await desk().add({ text: "first x post", platforms: ["x"] });
    const b = await desk().add({ text: "second x post", platforms: ["x"] });
    const c = await desk().add({ text: "a linkedin post", platforms: ["linkedin"] });
    const drafts = [
      ...(await listDrafts(pg.db, { ideaId: a.idea.id })),
      ...(await listDrafts(pg.db, { ideaId: b.idea.id })),
      ...(await listDrafts(pg.db, { ideaId: c.idea.id })),
    ];
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    await sync();
    const ids = posted.map((p, i) => `${p.platform}-${i + 1}`);
    expect(ids).toHaveLength(3);
    batching = true;
    const left = ids.find((id) => id.startsWith("x-")) as string;
    leftOut.add(left);
    insightReads.length = 0;
    const pass = await look();
    // One batch a platform, each with all its due posts; nothing else read until the leftover.
    expect(batches.map((x) => x.platform).sort()).toEqual(["linkedin", "x"]);
    expect(batches.find((x) => x.platform === "x")?.ids.sort()).toEqual(
      ids.filter((id) => id.startsWith("x-")).sort(),
    );
    expect(singles).toEqual([left]);
    expect(pass.stats?.looked).toHaveLength(3);
    expect(pass.stats?.failed).toEqual([]);
    // A batched look hands its own answer to insights, as a single one does.
    expect(insightReads).toContainEqual({ batch: ids.find((id) => id.startsWith("linkedin-")) });
    expect(await pg.db.select().from(contentMetrics)).toHaveLength(3);
  });

  it("a batch that fails is read post by post, and the look still lands", async () => {
    const a = await desk().add({ text: "first x post", platforms: ["x"] });
    const b = await desk().add({ text: "second x post", platforms: ["x"] });
    const drafts = [
      ...(await listDrafts(pg.db, { ideaId: a.idea.id })),
      ...(await listDrafts(pg.db, { ideaId: b.idea.id })),
    ];
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    await sync();
    batching = true;
    batchFails = true;
    const pass = await look();
    expect(batches).toEqual([]);
    expect(singles.sort()).toEqual(posted.map((p, i) => `${p.platform}-${i + 1}`).sort());
    expect(pass.stats?.looked).toHaveLength(2);
    expect(pass.stats?.failed).toEqual([]);
  });

  it("a platform with no batch read is read post by post, as before", async () => {
    const out = await desk().add({ text: "one post", platforms: ["linkedin"] });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    await sync();
    const pass = await look();
    expect(batches).toEqual([]);
    expect(singles).toEqual(["linkedin-1"]);
    expect(pass.stats?.looked).toHaveLength(1);
  });

  it("a read that never answers is cut at its limit, its post skipped, the rest looked at", async () => {
    const a = await desk().add({ text: "first x post", platforms: ["x"] });
    const b = await desk().add({ text: "second x post", platforms: ["x"] });
    const drafts = [
      ...(await listDrafts(pg.db, { ideaId: a.idea.id })),
      ...(await listDrafts(pg.db, { ideaId: b.idea.id })),
    ];
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    await sync();
    hangMetrics.add("x-1");
    const pass = await look();
    expect(pass.stats?.looked.map((l) => l.platform)).toEqual(["x"]);
    expect(pass.stats?.failed).toMatchObject([
      { platform: "x", error: expect.stringContaining("Content/metrics gave no answer in 2 s") },
    ]);
    const met = clients
      .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
      .objectClient<Met>({ name: "ContentMetrics" }, METRICS_KEY);
    // LoopWatch reads it off the loop's state: the call, and the post it was for.
    expect((await met.status()).last).toMatchObject({
      timeouts: [{ call: "Content/metrics", unit: "metrics x:x-1", ms: 1_500 }],
    });
  });

  it("reads a report that has nothing new once, not every pass", async () => {
    reportPlatforms = ["youtube"];
    try {
      await look();
      await look();
      await look();
      expect(reportReads).toBe(1);
    } finally {
      reportPlatforms = [];
    }
  });

  it("holds a scheduled draft until its time and sleeps toward it", async () => {
    const out = await desk().add({ text: "later", platforms: ["x"] });
    const [d] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!d) throw new Error("no draft");
    const at = new Date(Date.now() + 30_000);
    await approveDrafts(pg.db, [d.id], { now: new Date(), at });
    const pass = await sync();
    expect(pass.stats?.published).toEqual([]);
    expect(pass.delayMs).toBeGreaterThanOrEqual(1_000);
    expect(pass.delayMs).toBeLessThanOrEqual(60_000);
    expect(posted).toHaveLength(0);
    // With a zone and no time, approval lands on the platform's next slot (X: weekday noon).
    const more = await desk().add({ text: "slotted", platforms: ["x"] });
    const [s] = await listDrafts(pg.db, { ideaId: more.idea.id });
    if (!s) throw new Error("no draft");
    const now = new Date("2026-09-22T11:00:00Z");
    const [slotted] = await approveDrafts(pg.db, [s.id], { now, zone: "America/New_York" });
    expect(slotted?.scheduledFor?.toISOString()).toBe("2026-09-22T16:00:00.000Z");
  });

  it("respread puts a long queue onto faster slots, in the order it was due", async () => {
    const out = await desk().add({ text: "queue", platforms: ["x"] });
    const more = await desk().add({ text: "queue two", platforms: ["x"] });
    const [a] = await listDrafts(pg.db, { ideaId: out.idea.id });
    const [b] = await listDrafts(pg.db, { ideaId: more.idea.id });
    if (!a || !b) throw new Error("no drafts");
    const now = new Date("2026-09-22T11:00:00Z");
    // One a weekday: the second lands a day after the first.
    await approveDrafts(pg.db, [a.id, b.id], { now, zone: "UTC" });
    const twice = slotsOf({
      x: [
        { hour: 12, minute: 0 },
        { hour: 18, minute: 0 },
      ],
    });
    const moved = await respreadApproved(pg.db, "x", { now, zone: "UTC", slots: twice });
    const at = async (id: string) => (await getDraft(pg.db, id)).scheduledFor?.toISOString();
    expect(await at(a.id)).toBe("2026-09-22T12:00:00.000Z");
    expect(await at(b.id)).toBe("2026-09-22T18:00:00.000Z");
    expect(moved.map((m) => m.id)).toContain(b.id);
    expect(await respreadApproved(pg.db, "x", { now, zone: "UTC", slots: twice })).toEqual([]);
  });

  it("an edit goes back to draft and keeps the platform's limit", async () => {
    const idea = await addIdea(pg.db, "edit me", "cli");
    const [row] = await pg.db
      .insert(contentDrafts)
      .values({ ideaId: idea.id, platform: "x", text: "old", promptVersion: "v1" })
      .returning();
    if (!row) throw new Error("no row");
    await approveDrafts(pg.db, [row.id], { now: new Date() });
    const edited = await editDraft(pg.db, row.id, { text: "new text" });
    expect(edited).toMatchObject({
      status: "draft",
      edited: true,
      text: "new text",
      approvedAt: expect.any(Date),
    });
    await expect(editDraft(pg.db, row.id, { text: "a".repeat(X_MAX + 1) })).rejects.toThrow(
      new RegExp(`over the ${X_MAX}`),
    );
    expect((await getDraft(pg.db, row.id)).text).toBe("new text");
  });

  it("the console's verdicts: approve takes a slot, an edit over the cap is refused", async () => {
    const idea = await addIdea(pg.db, "console me", "cli");
    const [row] = await pg.db
      .insert(contentDrafts)
      .values({ ideaId: idea.id, platform: "x", text: "old", promptVersion: "v1" })
      .returning();
    if (!row) throw new Error("no row");
    expect(await desk().approve({ ids: [row.id] })).toEqual({ done: [row.id] });
    expect((await getDraft(pg.db, row.id)).scheduledFor).toEqual(expect.any(Date));
    await expect(desk().edit({ draftId: row.id, text: "a".repeat(X_MAX + 1) })).rejects.toThrow(
      new RegExp(`over the ${X_MAX}`),
    );
    expect(await desk().edit({ draftId: row.id, text: "new" })).toEqual({ done: [row.id] });
    expect(await desk().reject({ ids: [row.id] })).toEqual({ done: [row.id] });
    expect((await getDraft(pg.db, row.id)).status).toBe("rejected");
  });

  it("a second click is no refusal, and a refusal names the post, never its id", async () => {
    const idea = await addIdea(pg.db, "click twice", "cli");
    const [row] = await pg.db
      .insert(contentDrafts)
      .values({ ideaId: idea.id, platform: "x", text: "Twice is once", promptVersion: "v1" })
      .returning();
    if (!row) throw new Error("no row");
    expect(await desk().approve({ ids: [row.id] })).toEqual({ done: [row.id] });
    const slot = (await getDraft(pg.db, row.id)).scheduledFor;
    expect(await desk().approve({ ids: [row.id] })).toEqual({ done: [] });
    expect((await getDraft(pg.db, row.id)).scheduledFor).toEqual(slot);
    await pg.db
      .update(contentDrafts)
      .set({ status: "published" })
      .where(eq(contentDrafts.id, row.id));
    const said = await desk()
      .reject({ ids: [row.id] })
      .then(
        () => "",
        (err: Error) => err.message,
      );
    // Through ingress the words come back as JSON, their quotes escaped.
    expect(said).toMatch(/Twice is once\\?" on X is already posted, so it can't be rejected\./);
    expect(said).not.toContain(row.id);
    await expect(desk().approve({ ids: [randomUUID()] })).rejects.toThrow(/isn't here any more/);
  });

  it("a redraft takes the note, supersedes the old row, and links back", async () => {
    const out = await desk().add({ text: "redraft me", platforms: ["x"] });
    const [old] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!old) throw new Error("no draft");
    await approveDrafts(pg.db, [old.id], { now: new Date() });
    const report = await desk().redraft({ draftId: old.id, note: "shorter" });
    const r = report.results[0];
    if (!r?.ok) throw new Error(`redraft failed: ${r?.ok === false ? r.reason : "?"}`);
    expect(r.draft).toMatchObject({
      status: "draft",
      text: "shorter. the gate asks first.",
      redraftOf: old.id,
      note: "shorter",
    });
    expect((await getDraft(pg.db, old.id)).status).toBe("rejected");
    // The old row cannot be redrafted again; the note must say something.
    const again = await desk().redraft({ draftId: old.id, note: "x" });
    expect(again.results[0]).toMatchObject({
      ok: false,
      reason: "cannot redraft a rejected draft",
    });
    const blank = await desk().redraft({ draftId: r.draft.id, note: "  " });
    expect(blank.results[0]).toMatchObject({ ok: false, reason: "empty note" });
    expect((await sync()).stats?.published).toEqual([]);
    // The note is a lesson: the next idea's X draft is asked to follow it; LinkedIn's is not.
    await desk().add({ text: "next idea", platforms: ["x", "linkedin"] });
    const next = prompts.slice(-2);
    expect(next.find((p) => p.includes("one post on X"))).toContain("- shorter");
    expect(next.find((p) => !p.includes("one post on X"))).not.toContain("- shorter");
  });

  it("a pushed playbook rides that platform's prompt and is stamped on its draft", async () => {
    const first = await pushPlaybook(pg.db, {
      platform: "linkedin",
      sop: "li",
      text: "Hook in line one.",
    });
    expect(first.changed).toBe(true);
    expect(
      (await pushPlaybook(pg.db, { platform: "linkedin", sop: "li", text: "Hook in line one.\n" }))
        .changed,
    ).toBe(false);
    const second = await pushPlaybook(pg.db, {
      platform: "linkedin",
      sop: "li",
      text: "Odd numbers win.",
    });
    expect((await playbookFor(pg.db, "linkedin"))?.id).toBe(second.playbook.id);
    const out = await desk().add({ text: "shipped the spend gate", platforms: ["linkedin", "x"] });
    const li = prompts.find((p) => !p.includes("one post on X"));
    expect(li).toContain("Odd numbers win.");
    expect(li).not.toContain("Hook in line one.");
    expect(prompts.find((p) => p.includes("one post on X"))).not.toContain("playbook");
    const rows = await listDrafts(pg.db, { ideaId: out.idea.id });
    expect(Object.fromEntries(rows.map((d) => [d.platform, d.playbookId]))).toEqual({
      linkedin: second.playbook.id,
      x: null,
    });
  });

  it("status counts drafts, open ideas, and this month's drafting calls", async () => {
    await desk().add({ text: "status idea" });
    const now = new Date();
    const r = await collectStatus(pg.db, now);
    expect(r.draftsByStatus).toEqual({ draft: 2 });
    expect(r.oldestDraftDays).toBe(0);
    expect(r.draftedThisWeek).toBe(2);
    expect(r.tokensThisMonth.calls).toBe(2);
    const open = await pg.db.select().from(contentIdeas).where(eq(contentIdeas.status, "open"));
    expect(r.openIdeas).toBe(open.length);
  });
});

describe("daily drafts (ContentPlanner with draft on)", () => {
  type Plan = ReturnType<typeof makeContentPlanner>;
  const planner = () =>
    clients
      .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
      .objectClient<Plan>({ name: "ContentPlanner" }, PLANNER_KEY);
  const settings = {
    platforms: ["linkedin", "reddit"],
    draft: true,
    slots: {
      linkedin: [{ hour: 8, minute: 30 }],
      reddit: [
        { hour: 9, minute: 30 },
        { hour: 15, minute: 0 },
      ],
    },
  };
  const at = (h: number, m: number) =>
    new Date(tomorrowOf(new Date(), "UTC").from.getTime() + (h * 60 + m) * 60_000).toISOString();
  const slotOf = (d: { scheduledFor: Date | null }) => d.scheduledFor?.toISOString();

  it("fills tomorrow's slots from ideas in order; approve keeps the slot", async () => {
    await addIdea(pg.db, "first idea", "cli");
    await addIdea(pg.db, "second idea", "cli");
    await planner().start(settings);
    await planner().stop(); // queued behind the pass the start sent
    const last = (await planner().status()).last as PassOutcome<PlannerStats> | null;
    expect(last?.stats?.drafted.map((d) => [d.platform, d.slot, d.source]).sort()).toEqual([
      ["linkedin", at(8, 30), "cli"],
      ["reddit", at(9, 30), "cli"],
      ["reddit", at(15, 0), "cli"],
    ]);
    expect(notes.at(-1)).toMatch(/drafted 3 for tomorrow: LinkedIn, Reddit$/);
    const rows = await listDrafts(pg.db, { status: "draft" });
    expect(rows.every((r) => r.scheduledFor !== null)).toBe(true);

    // A second pass finds every slot held and makes no idea.
    const again = (await planner().sync()) as PassOutcome<PlannerStats>;
    expect(again.stats?.drafted).toEqual([]);
    expect(await pg.db.select().from(contentIdeas)).toHaveLength(2);

    // Approving schedules into the slot the draft holds.
    const li = rows.find((r) => r.platform === "linkedin");
    if (!li) throw new Error("no linkedin draft");
    const [approved] = await approveDrafts(pg.db, [li.id], { now: new Date(), zone: "UTC" });
    expect(approved && slotOf(approved)).toBe(at(8, 30));

    // Two redrafts a slot a day, then it is his to edit.
    let latest = rows.find((r) => r.platform === "reddit" && slotOf(r) === at(15, 0));
    for (const note of ["shorter", "warmer"]) {
      if (!latest) throw new Error("no reddit draft");
      const r = (await desk().redraft({ draftId: latest.id, note })).results[0];
      if (!r?.ok) throw new Error("redraft refused");
      expect(slotOf({ scheduledFor: r.draft.scheduledFor && new Date(r.draft.scheduledFor) })).toBe(
        at(15, 0),
      );
      latest = r.draft;
    }
    if (!latest) throw new Error("no reddit draft");
    const third = await desk().redraft({ draftId: latest.id, note: "again" });
    expect(third.results[0]).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^2 redrafts/),
    });

    // A rejected draft frees its slot; a reader's question fills it.
    const morning = rows.find((r) => r.platform === "reddit" && slotOf(r) === at(9, 30));
    if (!morning) throw new Error("no morning draft");
    await desk().reject({ ids: [morning.id] });
    await pg.db.execute(sql`
      with a as (insert into reach_accounts (platform, account, started_on)
        values ('reddit', 'reddit@test', current_date) returning id)
      insert into comments (platform, account_id, ref, post, parent, kind, author, body, url, at, raw, sort)
      select 'reddit', a.id, 't1_q', 't3_p', 't3_p', 'post_reply', 'quiet_fox', 'how do you pick leads?',
        'https://reddit.test/c', now(), '{}', 'question' from a`);
    const asked = (await planner().sync()) as PassOutcome<PlannerStats>;
    expect(asked.stats?.drafted.map((d) => [d.platform, d.slot, d.source])).toEqual([
      ["reddit", at(9, 30), "question"],
    ]);
    expect(prompts.at(-1)).toContain('"how do you pick leads?"');
    expect(prompts.at(-1)).not.toContain("quiet_fox");
  });

  it("with approve on, each draft is approved into the slot it holds", async () => {
    await addIdea(pg.db, "an idea to post", "cli");
    await planner().start({
      platforms: ["linkedin"],
      draft: true,
      approve: true,
      slots: { linkedin: [{ hour: 8, minute: 30 }] },
    });
    await planner().stop();
    const rows = await listDrafts(pg.db, { status: "approved" });
    expect(rows.map((r) => [r.platform, slotOf(r)])).toEqual([["linkedin", at(8, 30)]]);
  });

  it("a chapter of a video that is up becomes an idea once, with what he said in it", async () => {
    const [edit] = await pg.db.execute(sql`
      insert into video_edits (title, dir, tracks, chapters, words, cuts) values ('My video', '/tmp',
        '{"main": {"fps": 30, "path": "/tmp/a.mov", "width": 1280, "height": 720, "durationS": 120}}',
        '[{"at": 0, "title": "Intro"}, {"at": 60, "title": "The point"}]',
        (select jsonb_agg(jsonb_build_object('s', i, 'e', i + 0.5, 'w', 'word' || i)) from generate_series(0, 119) i),
        '[]') returning id`);
    const id = Number(edit?.id);
    const [video] = await pg.db
      .insert(contentIdeas)
      .values({ text: "My video", source: "cli", ref: `video:${id}`, status: "drafted" })
      .returning();
    if (!video) throw new Error("no idea");
    await pg.db.insert(contentDrafts).values({
      ideaId: video.id,
      platform: "youtube",
      text: "about it",
      status: "published",
      url: "https://youtu.be/test",
      promptVersion: "t",
    });
    const first = await chapterIdea(pg.db);
    expect(first?.ref).toBe(`chapter:${id}:0`);
    expect(first?.text).toContain('the part "Intro"');
    expect(first?.text).toContain("word0 word1");
    expect(first?.text).not.toContain("word60");
    expect((await chapterIdea(pg.db))?.ref).toBe(`chapter:${id}:1`);
    expect(await chapterIdea(pg.db)).toBeNull();
    await pg.db.execute(sql`delete from video_edits`);
  });

  it("stops drafting at a draft past its wait, and holds the idea on its third", async () => {
    const slow = await addIdea(pg.db, "a slow idea", "cli");
    await addIdea(pg.db, "second idea", "cli");
    const one = {
      platforms: ["linkedin"],
      draft: true,
      slots: { linkedin: [{ hour: 8, minute: 30 }] },
    };
    await planner().start(one);
    await planner().stop();
    type Last = PassOutcome<PlannerStats> & {
      timeouts?: { call: string; unit: string | null; held?: boolean }[];
    };
    const last = async () => (await planner().status()).last as Last;
    // The late draft lands on its own; the idea is opened again, as if it had failed.
    const reopen = async () => {
      await vi.waitFor(
        async () => expect(await listDrafts(pg.db, { ideaId: slow.id })).not.toHaveLength(0),
        { timeout: 10_000, interval: 200 },
      );
      await pg.db.delete(contentDrafts).where(eq(contentDrafts.ideaId, slow.id));
      await pg.db.update(contentIdeas).set({ status: "open" }).where(eq(contentIdeas.id, slow.id));
    };
    const first = await last();
    expect(first.stats?.drafted).toEqual([]);
    expect(first.stats?.skipped).toEqual([
      expect.stringMatching(/ContentDesk\/draft gave no answer in 2 s/),
    ]);
    expect(first.timeouts).toMatchObject([{ call: "ContentDesk/draft", unit: `idea ${slow.id}` }]);
    // The next idea was never asked: it would have waited on the desk's lock.
    expect(prompts.some((p) => p.includes("second idea"))).toBe(false);
    for (let n = 2; n <= 3; n++) {
      await reopen();
      await planner().sync();
    }
    expect((await last()).timeouts).toMatchObject([{ unit: `idea ${slow.id}`, held: true }]);
    const holds = await pg.db.execute<{ stage: string; subject: string }>(
      sql`select stage, subject from unit_holds`,
    );
    expect([...holds]).toEqual([
      { stage: `loop.content-planner/${PLANNER_KEY}`, subject: `idea ${slow.id}` },
    ]);
    // Held: the next pass passes it over and drafts the next idea.
    await reopen();
    const after = (await planner().sync()) as PassOutcome<PlannerStats>;
    expect(after.stats?.drafted.map((d) => d.platform)).toEqual(["linkedin"]);
    expect(await listDrafts(pg.db, { ideaId: slow.id })).toEqual([]);
  }, 60_000);

  it("old drafts wait in To approve without filling tomorrow; approve uses the planner's slots", async () => {
    // Two unapproved drafts from earlier days: one never slotted, one on a past slot.
    const out = await desk().add({ text: "an older idea", platforms: ["linkedin"] });
    const old = out.drafts?.results[0];
    if (!old?.ok) throw new Error("no draft");
    const second = await desk().add({ text: "another older idea", platforms: ["linkedin"] });
    const past = second.drafts?.results[0];
    if (!past?.ok) throw new Error("no draft");
    await pg.db
      .update(contentDrafts)
      .set({ scheduledFor: new Date(Date.now() - 3 * 86_400_000) })
      .where(eq(contentDrafts.id, past.draft.id));
    const day = tomorrowOf(new Date(), "UTC");
    const plan = await planFor(pg.db, ["linkedin"], day, "UTC", slotsOf(settings.slots));
    expect(plan.platforms).toEqual([{ platform: "linkedin", slots: 1, filled: 0, waiting: 0 }]);
    expect(await listDrafts(pg.db, { status: "draft" })).toHaveLength(2);

    // His slots: LinkedIn once a day at 06:15. Approve lands there, not on a default.
    await planner().start({
      platforms: ["linkedin"],
      slots: { linkedin: [{ hour: 6, minute: 15 }] },
    });
    await planner().stop();
    expect(await desk().approve({ ids: [old.draft.id] })).toEqual({ done: [old.draft.id] });
    const row = await getDraft(pg.db, old.draft.id);
    expect(row?.status).toBe("approved");
    const when = row?.scheduledFor;
    expect([when?.getUTCHours(), when?.getUTCMinutes()]).toEqual([6, 15]);
  });
});
