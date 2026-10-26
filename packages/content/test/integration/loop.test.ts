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
import type { Platform, Post, Published } from "@wren/core/content";
import type { PassOutcome } from "@wren/core/restate";
import type { Delivery } from "@wren/core/send-verdict";
import { startTestRestate } from "@wren/core/testing";
import {
  commentObjects,
  seedObjects,
  startTestPostgres,
  type TestPostgres,
  truncate,
} from "@wren/db/testing";
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
import {
  METRICS_KEY,
  type MetricsStats,
  makeContentMetrics,
  missWaitMs,
} from "../../src/restate/metrics.js";
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
const leftOut = new Set<string>();
const batches: { platform: Platform; ids: string[] }[] = [];
const singles: string[] = [];
/** Posts whose counts read never answers. */
const hangMetrics = new Set<string>();
/** Platforms whose counts read used its daily cap. */
const cappedMetrics = new Set<Platform>();
/**
 * Platforms whose counts read has no leg (501) or misses (502, a LinkedIn share's page), and those
 * whose insights read the counts too.
 */
const unbuilt = new Set<Platform>();
const missed = new Set<Platform>();
const deep = new Set<Platform>();
/**
 * What the next keyed publishes on a platform answer, one each (a default `sent` after that):
 * `unknown` the page did not confirm, `busy` the desk's browser stayed busy (nothing was sent),
 * `absent` the read showed it absent, `found` the read found it, `stop` the call stopped after the
 * write (a server fault with no verdict).
 */
type Fate = "sent" | "unknown" | "busy" | "absent" | "found" | "stop" | "capped";
const fates = new Map<Platform, Fate[]>();
/** What autobrowse's verify read finds for a key it holds as `unknown`. */
let verify: "unknown" | "found" | "absent" = "unknown";
/** What `pausedUnder` answers: a paused call under the publish, or null. */
let pausedCall: string | null = null;
/** autobrowse's journal: the verdict kept per send key. */
const journal = new Map<string, Delivery<Published>>();
/** Every publish asked, and how: the key it carried, a recheck, a verify-only ask (it never writes). */
const asked: {
  platform: Platform;
  sendKey: string | null;
  recheck: boolean;
  verifyOnly: boolean;
  client: string | null;
}[] = [];
/** The publishes that wrote (a key autobrowse had not seen). */
const writes: { platform: Platform; sendKey: string | null }[] = [];
/** The keys of replies (a first comment) and the platforms the posted hook ran for. */
const replyKeys: (string | null)[] = [];
/** autobrowse's journal of replies: a key it has seen answers again and writes nothing. */
const repliedKeys = new Set<string>();
const hooks = new Set<string>();
/** The id a platform gives a post, spelled the way `canonRef` reads it: a LinkedIn share URN, else
 *  `<platform>-<tag>`. A LinkedIn id is all digits, so a word maps to a number. */
const postId = (platform: string, tag: number | "found" | "late"): string =>
  platform === "linkedin"
    ? `urn:li:share:${tag === "found" ? 9001 : tag === "late" ? 9002 : tag}`
    : `${platform}-${tag}`;

const fakeContent = restate.service({
  name: "Content",
  handlers: {
    publish: async (
      ctx: restate.Context,
      req: {
        platform: Platform;
        post: Post;
        client?: string;
        sendKey?: string;
        recheck?: boolean;
        verifyOnly?: boolean;
      },
    ) => {
      const key = req.sendKey ?? null;
      await ctx.run("asked", () => {
        asked.push({
          platform: req.platform,
          sendKey: key,
          recheck: req.recheck === true,
          verifyOnly: req.verifyOnly === true,
          client: req.client ?? null,
        });
      });
      const published = (id: string, url: string): Published => ({
        id,
        url,
        publishedAt: new Date().toISOString(),
        fetchedWith: "api",
      });
      // A keyed call answers what became of the write, as autobrowse does; an unkeyed one, as before.
      const sent = (out: Published): Published | Delivery<Published> =>
        key ? { kind: "sent", out } : out;
      if (hang.has(req.platform)) {
        const { id, promise } = ctx.awakeable<string>();
        await ctx.run("hung", () => {
          hung.push(id);
        });
        const verdict = await promise;
        // The platform said no after the pass moved on: a refusal, with its status.
        if (verdict === "refused")
          throw new restate.TerminalError("the platform said no", { errorCode: 403 });
        return sent(
          published(postId(req.platform, "late"), `https://${req.platform}.test/p/${verdict}`),
        );
      }
      if (refuse.has(req.platform))
        throw new restate.TerminalError(`no ${req.platform} channel configured`, {
          errorCode: 404,
        });
      if (!key) {
        posted.push(req);
        return published(
          postId(req.platform, posted.length),
          `https://${req.platform}.test/p/${posted.length}`,
        );
      }
      // autobrowse's journal: a key with a final verdict answers it and writes nothing; a key held as
      // `unknown` runs only the verify read; a key it has not seen writes.
      return ctx.run("verdict", (): Delivery<Published> => {
        const kept = journal.get(key);
        if (kept && kept.kind !== "unknown") return kept;
        const at = new Date().toISOString();
        const final = (d: Delivery<Published>) => {
          journal.set(key, d);
          return d;
        };
        if (kept) {
          if (verify === "found")
            return final({
              kind: "found",
              id: postId(req.platform, "found"),
              url: `https://${req.platform}.test/p/found`,
              at,
            });
          if (verify === "absent")
            return final({
              kind: "not_sent",
              how: "verified_absent",
              reason: "it is not on the site",
              status: null,
            });
          return kept;
        }
        // Verify only: a key it has not seen is not sent, and nothing is written.
        if (req.verifyOnly)
          return {
            kind: "not_sent",
            how: "before_submit",
            reason: "no record of that key",
            status: null,
          };
        writes.push({ platform: req.platform, sendKey: key });
        const fate = fates.get(req.platform)?.shift() ?? "sent";
        if (fate === "unknown")
          return final({ kind: "unknown", reason: "the page did not confirm the post", since: at });
        if (fate === "busy")
          return final({
            kind: "not_sent",
            how: "before_submit",
            reason: "profile google@test is busy (explore:9092); waited 5 min for it, try again",
            status: null,
          });
        if (fate === "absent")
          return final({
            kind: "not_sent",
            how: "verified_absent",
            reason: "it is not on the site",
            status: null,
          });
        if (fate === "found")
          return final({
            kind: "found",
            id: postId(req.platform, "found"),
            url: `https://${req.platform}.test/p/found`,
            at,
          });
        if (fate === "capped")
          throw new restate.TerminalError(
            `${req.platform} POST /api/submit: 429 ${req.platform} posts cap for w@test is used (3/3 today); retry after 7200s`,
            { errorCode: 429 },
          );
        if (fate === "stop")
          throw new restate.TerminalError(`${req.platform} POST /web/posts: 500 the call stopped`, {
            errorCode: 500,
          });
        posted.push(req);
        return final({
          kind: "sent",
          out: published(
            postId(req.platform, posted.length),
            `https://${req.platform}.test/p/${posted.length}`,
          ),
        });
      });
    },
    reply: async (
      ctx: restate.Context,
      req: { platform: Platform; commentId: string; text: string; sendKey?: string },
    ) => {
      await ctx.run("replied", () => {
        // A key the journal has seen answers again and writes nothing.
        if (req.sendKey && repliedKeys.has(req.sendKey)) return;
        if (req.sendKey) repliedKeys.add(req.sendKey);
        replied.push({ platform: req.platform, commentId: req.commentId, text: req.text });
        replyKeys.push(req.sendKey ?? null);
      });
      return req.sendKey ? { kind: "sent" as const } : undefined;
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
      if (cappedMetrics.has(req.platform))
        throw new restate.TerminalError("capped, retry after 36000s", { errorCode: 429 });
      if (unbuilt.has(req.platform))
        throw new restate.TerminalError("workflow not recorded", { errorCode: 501 });
      if (missed.has(req.platform))
        throw new restate.TerminalError("no counts on the page", { errorCode: 502 });
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
      if (deep.has(req.platform))
        return {
          values: [
            { metric: "impressions", value: views.get(req.id) ?? 0 },
            { metric: "comments", value: 2 },
          ],
          gaps: [],
          asOf: new Date().toISOString(),
          fetchedWith: "browser" as const,
        };
      return {
        values: [{ metric: "saves", value: (views.get(req.id) ?? 0) / 50 }],
        gaps: [{ metric: "retention", state: "needs_scope", why: "a synthetic refusal" }],
        asOf: new Date().toISOString(),
      };
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
/** What the publish pass tells William; apart from `notes`, which other loops fill. */
const posting: string[] = [];
const postingNotifier = {
  name: "test posting",
  notify: async (title: string, body: string) => {
    posting.push(`${title}\n${body}`);
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
      req: { id: string; outcome: "posted" | "again" | "dropped"; by: string },
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
      makeContentDesk({
        db: pg.db,
        llm,
        platforms: ["linkedin", "x", "youtube"],
        zone: "UTC",
        posted: (_ctx, platform, client) => {
          hooks.add(`${platform}:${client ?? ""}`);
        },
      }),
      makeContentScheduler({
        db: pg.db,
        idleMs: 60_000,
        publishWaitMs: 3_000,
        pausedUnder: async () => pausedCall,
        parkAfterMs: 0,
        notifier: postingNotifier,
        posted: (_ctx, platform, client) => {
          hooks.add(`${platform}:${client ?? ""}`);
        },
      }),
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
  fates.clear();
  verify = "unknown";
  pausedCall = null;
  journal.clear();
  asked.length = 0;
  writes.length = 0;
  replyKeys.length = 0;
  repliedKeys.clear();
  hooks.clear();
  posted.length = 0;
  replied.length = 0;
  notes.length = 0;
  posting.length = 0;
  prompts.length = 0;
  views.clear();
  refuse.clear();
  unbuilt.clear();
  missed.clear();
  deep.clear();
  hang.clear();
  hung.length = 0;
  batching = false;
  batchFails = false;
  leftOut.clear();
  hangMetrics.clear();
  cappedMetrics.clear();
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
      publishedId: expect.stringMatching(/^urn:li:share:/),
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
    expect(replyKeys).toHaveLength(1);
    expect(replyKeys[0]?.startsWith(`draft:${li?.id} `)).toBe(true);
    expect(replyKeys[0]?.endsWith(" comment")).toBe(true);
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

  it("a busy desk browser keeps the draft approved in its slot, says why, and posts it next pass under a new key", async () => {
    const out = await desk().add({ text: "a note on busy browsers" });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    await approveDrafts(
      pg.db,
      drafts.map((d) => d.id),
      { now: new Date() },
    );
    fates.set("x", ["busy"]);
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.waiting).toMatchObject([{ platform: "x" }]);
    expect(pass.delayMs).toBe(60_000);
    const x = (await listDrafts(pg.db, { ideaId: out.idea.id })).find((d) => d.platform === "x");
    expect(x).toMatchObject({
      status: "approved",
      error: expect.stringMatching(/^Waiting for the browser: profile google@test is busy/),
    });
    // Nothing went out, so nothing waits on the ledger.
    expect(await sendAttempt(pg.db, `draft:${x?.id}`)).toBeNull();
    expect(notes.some((n) => /failed/.test(n) && !/0 failed/.test(n))).toBe(false);
    const again = await sync();
    expect(again.stats?.published.map((p) => p.platform)).toEqual(["x"]);
    const done = (await listDrafts(pg.db, { ideaId: out.idea.id })).find((d) => d.platform === "x");
    expect(done).toMatchObject({ status: "published", error: null });
    // The second try is a new send: a new key.
    const keys = writes.filter((w) => w.platform === "x").map((w) => w.sendKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("a used daily cap moves the draft to the reset, never failed, and nothing waits on the ledger", async () => {
    const out = await desk().add({ text: "a post over the daily cap", platforms: ["x"] });
    const [d] = await listDrafts(pg.db, { ideaId: out.idea.id });
    await approveDrafts(pg.db, [d?.id ?? ""], { now: new Date() });
    fates.set("x", ["capped"]);
    const before = Date.now();
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.waiting).toMatchObject([{ platform: "x" }]);
    const x = await getDraft(pg.db, d?.id ?? "");
    expect(x).toMatchObject({
      status: "approved",
      error: expect.stringMatching(/^Waiting out the daily cap until /),
    });
    // The slot moves to when the cap resets: two hours on.
    const at = new Date(x?.scheduledFor ?? 0).getTime();
    expect(at).toBeGreaterThanOrEqual(before + 7_200_000 - 60_000);
    expect(await sendAttempt(pg.db, `draft:${d?.id}`)).toBeNull();
  });

  it("a publish autobrowse read back as absent goes back to approved and posts once under a new key", async () => {
    const out = await desk().add({ text: "a post that never landed", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    fates.set("x", ["absent"]);
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const first = await sync();
    expect(first.stats?.failed).toEqual([]);
    expect(first.stats?.published).toEqual([]);
    expect(await getDraft(pg.db, x.id)).toMatchObject({ status: "approved" });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toBeNull();
    const second = await sync();
    expect(second.stats?.published).toMatchObject([{ platform: "x" }]);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.sendKey).not.toBe(writes[1]?.sendKey);
    expect(await getDraft(pg.db, x.id)).toMatchObject({ status: "published", publishedId: "x-1" });
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
    await ingress.resolveAwakeable(hung[0] as string, "refused");
    const after = await sync();
    expect(after.stats?.failed).toMatchObject([
      { platform: "x", error: expect.stringContaining("the platform said no") },
    ]);
    expect((await getDraft(pg.db, x.id))?.status).toBe("failed");
  });

  it("10-19: a publish held by a paused desk call waits in To approve; the retry's answer settles it", async () => {
    const out = await desk().add({ text: "a story stuck on the desk", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    hang.add("x");
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    // Still running, nothing paused under it: it only waits.
    expect((await sync()).stats?.unsure).toBeUndefined();
    pausedCall = "desk/call: [500] connection reset";
    const parked = await sync();
    expect(parked.stats?.unsure).toMatchObject([
      { platform: "x", why: expect.stringContaining("paused in the dead-letter queue") },
    ]);
    expect(parked.stats?.posting).toHaveLength(1);
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toMatchObject({ state: "unsure" });
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "publishing",
      error: expect.stringMatching(/^May have gone out: /),
    });
    // Parked once: the next pass does not park it again.
    expect((await sync()).stats?.unsure).toBeUndefined();
    // The retry in the dead-letter queue lets the call answer: published, the ledger sent.
    const ingress = clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
    await ingress.resolveAwakeable(hung[0] as string, "late");
    const settled = await sync();
    expect(settled.stats?.published).toMatchObject([{ platform: "x" }]);
    expect(settled.stats?.posting).toBeUndefined();
    expect(await getDraft(pg.db, x.id)).toMatchObject({ status: "published" });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toMatchObject({ state: "sent" });
  });

  it("a parked publish that ends refused fails and leaves nothing in To approve; a person's word ends the look", async () => {
    const out = await desk().add({ text: "two stuck posts", platforms: ["x", "linkedin"] });
    const drafts = await listDrafts(pg.db, { ideaId: out.idea.id });
    const x = drafts.find((d) => d.platform === "x");
    const li = drafts.find((d) => d.platform === "linkedin");
    if (!x || !li) throw new Error("no drafts");
    hang.add("x");
    hang.add("linkedin");
    pausedCall = "desk/call: [500] connection reset";
    await approveDrafts(pg.db, [x.id, li.id], { now: new Date() });
    await sync();
    expect((await sync()).stats?.unsure).toHaveLength(2);
    // He drops LinkedIn in To approve: the pass stops looking at it.
    expect(await settle(li.id, "dropped")).toMatchObject({ outcome: "dropped" });
    // The next pass stops looking at LinkedIn and cancels its call; X is still looked at.
    expect((await sync()).stats?.posting?.map((w) => w.platform)).toEqual(["x"]);
    const ingress = clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
    for (const id of hung) await ingress.resolveAwakeable(id, "refused").catch(() => undefined);
    const after = await sync();
    expect(after.stats?.failed).toMatchObject([{ platform: "x" }]);
    expect(after.stats?.posting).toBeUndefined();
    expect((await getDraft(pg.db, x.id))?.status).toBe("failed");
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toBeNull();
    expect((await getDraft(pg.db, li.id))?.status).toBe("rejected");
    expect(await sendAttempt(pg.db, `draft:${li.id}`)).toBeNull();
  });

  it("a publish autobrowse found by reading the site is published with its id and first comment, never sent again", async () => {
    const out = await desk().add({
      text: "a video whose answer is lost",
      platforms: ["linkedin"],
      media: { kind: "video", source: "https://cdn.test/found.mp4", title: "Found" },
    });
    const [li] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!li) throw new Error("no linkedin draft");
    fates.set("linkedin", ["found"]);
    await approveDrafts(pg.db, [li.id], { now: new Date() });
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.published).toMatchObject([
      { platform: "linkedin", url: "https://linkedin.test/p/found" },
    ]);
    // One call, under the ledger's key, with no look of ours.
    expect(writes).toHaveLength(1);
    expect(asked).toEqual([
      {
        platform: "linkedin",
        sendKey: writes[0]?.sendKey,
        recheck: false,
        verifyOnly: false,
        client: null,
      },
    ]);
    expect(writes[0]?.sendKey?.startsWith(`draft:${li.id} `)).toBe(true);
    expect(await getDraft(pg.db, li.id)).toMatchObject({
      status: "published",
      publishedId: postId("linkedin", "found"),
      url: "https://linkedin.test/p/found",
      error: null,
    });
    // Its words are frozen as sent, with the platform's id, as a publish that answered.
    const sent = await pg.db.execute<{ external_id: string }>(
      sql`select external_id from draft_events where item = ${`draft:${li.id}`} and event = 'sent'`,
    );
    expect([...sent]).toEqual([{ external_id: postId("linkedin", "found") }]);
    expect(await sendAttempt(pg.db, `draft:${li.id}`)).toMatchObject({
      state: "sent",
      ref: postId("linkedin", "found"),
      settledBy: "found",
    });
    // The first comment and the posted hook run as for any publish; the comment has a key of its own.
    expect(replied).toMatchObject([
      {
        platform: "linkedin",
        commentId: postId("linkedin", "found"),
        text: expect.stringContaining("/go/li/"),
      },
    ]);
    expect(replyKeys).toEqual([`${writes[0]?.sendKey} comment`]);
    expect([...hooks]).toEqual(["linkedin:"]);
    // A later pass sends nothing.
    await sync();
    expect(writes).toHaveLength(1);
  });

  it("10-16: a publish autobrowse cannot tell stays publishing and waits in To approve, never failed", async () => {
    const out = await desk().add({ text: "a post nobody can see", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    fates.set("x", ["unknown"]);
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.unsure).toMatchObject([
      { platform: "x", why: expect.stringContaining("the page did not confirm the post") },
    ]);
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "publishing",
      error: expect.stringMatching(/^May have gone out: .*It waits in To approve\.$/),
    });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toMatchObject({
      state: "unsure",
      platform: "x",
      words: expect.stringContaining(x.text),
      tries: 1,
      sendKey: writes[0]?.sendKey,
    });
    expect(
      posting.some((n) => /1 may have gone out/.test(n) && /check it in To approve/.test(n)),
    ).toBe(true);
    // An edit says where it waits, not that it is posting.
    await expect(editDraft(pg.db, x.id, { text: "changed" })).rejects.toThrow(
      /may have gone out, so it can't be edited\. Check it in To approve first/,
    );
    // No later pass takes it again while it waits.
    await sync();
    expect(writes).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("a Content call that stops after the write is parked unsure, never failed", async () => {
    const out = await desk().add({ text: "a post whose call stopped", platforms: ["x"] });
    const [x] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!x) throw new Error("no x draft");
    fates.set("x", ["stop"]);
    await approveDrafts(pg.db, [x.id], { now: new Date() });
    const pass = await sync();
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.unsure).toMatchObject([{ platform: "x" }]);
    expect(await getDraft(pg.db, x.id)).toMatchObject({ status: "publishing" });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toMatchObject({ state: "unsure" });
    await sync();
    expect(writes).toHaveLength(1);
  });

  /** A draft whose first publish answered `unknown`, parked in To approve. */
  async function parked(
    text: string,
    platform: "x" | "linkedin" = "x",
    media?: { kind: "video"; source: string; title: string },
  ) {
    const out = await desk().add({ text, platforms: [platform], ...(media ? { media } : {}) });
    const [d] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!d) throw new Error(`no ${platform} draft`);
    fates.set(platform, ["unknown"]);
    await approveDrafts(pg.db, [d.id], { now: new Date() });
    expect((await sync()).stats?.unsure).toHaveLength(1);
    return d;
  }
  const settle = (id: string, outcome: "posted" | "again" | "dropped") =>
    clients
      .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
      .serviceClient<typeof settleForward>({ name: "SettleForward" })
      .settle({ id, outcome, by: "william" });

  it("Send again asks autobrowse under the same key first; still unknown, it posts once more under a new key", async () => {
    const x = await parked("a post to send again");
    const first = writes[0]?.sendKey;
    expect(await settle(x.id, "again")).toMatchObject({ outcome: "again", found: false });
    // The question went to autobrowse as a verify-only recheck of the first key: no write.
    expect(asked[1]).toEqual({
      platform: "x",
      sendKey: first,
      recheck: true,
      verifyOnly: true,
      client: null,
    });
    expect(writes).toHaveLength(1);
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toBeNull();
    expect((await getDraft(pg.db, x.id)).status).toBe("approved");
    await sync();
    expect(writes).toHaveLength(2);
    expect(writes[1]?.sendKey).not.toBe(first);
    expect(await getDraft(pg.db, x.id)).toMatchObject({ status: "published", publishedId: "x-1" });
  });

  it("Send again when autobrowse's recheck finds it: published with its id, not sent twice", async () => {
    const x = await parked("a post that did land");
    verify = "found";
    expect(await settle(x.id, "again")).toMatchObject({ outcome: "again", found: true });
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      publishedId: "x-found",
      url: "https://x.test/p/found",
    });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toMatchObject({
      state: "sent",
      ref: "x-found",
      settledBy: "found",
    });
    await sync();
    expect(writes).toHaveLength(1);
  });

  it("Mark posted: the recheck's id when it finds the post, his word when it does not", async () => {
    const x = await parked("two posts he checks");
    const out = await desk().add({ text: "the other post", platforms: ["linkedin"] });
    const [li] = await listDrafts(pg.db, { ideaId: out.idea.id });
    if (!li) throw new Error("no linkedin draft");
    fates.set("linkedin", ["unknown"]);
    await approveDrafts(pg.db, [li.id], { now: new Date() });
    expect((await sync()).stats?.unsure).toHaveLength(1);
    // The verify read finds the first: it gets the platform's id and its numbers.
    verify = "found";
    expect(await settle(x.id, "posted")).toMatchObject({ found: true });
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      publishedId: "x-found",
    });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toMatchObject({
      state: "sent",
      ref: "x-found",
      settledBy: "found",
    });
    // The read shows the second absent: published on his word, with no id.
    verify = "absent";
    expect(await settle(li.id, "posted")).toMatchObject({ found: false });
    expect(await getDraft(pg.db, li.id)).toMatchObject({
      status: "published",
      publishedId: null,
      error: expect.stringMatching(/^Marked posted by william/),
    });
    expect(await sendAttempt(pg.db, `draft:${li.id}`)).toMatchObject({
      state: "sent",
      settledBy: "william",
    });
    // A second word on a settled post is refused, never run twice.
    await expect(settle(li.id, "posted")).rejects.toThrow(/that send is sent/);
    expect(writes.map((w) => w.platform).sort()).toEqual(["linkedin", "x"]);
  });

  it("Not sent, drop: the draft is rejected, its slot goes, and nothing posts it", async () => {
    const x = await parked("a post that did not go out");
    expect(await settle(x.id, "dropped")).toMatchObject({ outcome: "dropped", found: false });
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "rejected",
      scheduledFor: null,
      error: null,
    });
    expect(await sendAttempt(pg.db, `draft:${x.id}`)).toBeNull();
    // It is recorded as a no to those words.
    const events = await pg.db.execute<{ event: string }>(
      sql`select event from draft_events where item = ${`draft:${x.id}`} and event = 'rejected'`,
    );
    expect([...events]).toHaveLength(1);
    await sync();
    expect(writes).toHaveLength(1);
    // Nothing is asked of autobrowse for a drop.
    expect(asked).toHaveLength(1);
    await expect(settle(x.id, "dropped")).rejects.toThrow(/nothing waits/);
  });

  it("a settle at any age asks verify-only and writes nothing: found is published, else his word stands", async () => {
    const x = await parked("an old unsure post");
    const first = writes[0]?.sendKey;
    await pg.db.execute(
      sql`update send_attempts set started_at = now() - interval '40 days' where item = ${`draft:${x.id}`}`,
    );
    // The ledger row is 40 days old and the question still goes, as a verify-only ask.
    verify = "found";
    expect(await settle(x.id, "posted")).toMatchObject({ found: true });
    expect(asked[1]).toMatchObject({ sendKey: first, recheck: true, verifyOnly: true });
    expect(writes).toHaveLength(1);
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      publishedId: "x-found",
    });
    // Autobrowse kept nothing for the key: not sent, so his word stands. Still no write.
    const old = await parked("an older unsure post");
    journal.delete(writes[1]?.sendKey ?? "");
    await pg.db.execute(
      sql`update send_attempts set started_at = now() - interval '40 days' where item = ${`draft:${old.id}`}`,
    );
    expect(await settle(old.id, "posted")).toMatchObject({ found: false });
    expect(asked.at(-1)).toMatchObject({ recheck: true, verifyOnly: true });
    expect(writes).toHaveLength(2);
    expect(await getDraft(pg.db, old.id)).toMatchObject({ status: "published", publishedId: null });
  });

  it("settle found runs the after-publish: the first comment once under its own key, and the hook", async () => {
    // A video carries its link as the first comment.
    const x = await parked("a linkedin post that did land", "linkedin", {
      kind: "video",
      source: "https://cdn.test/landed.mp4",
      title: "Landed",
    });
    const first = writes[0]?.sendKey;
    verify = "found";
    expect(await settle(x.id, "posted")).toMatchObject({ found: true });
    expect(await getDraft(pg.db, x.id)).toMatchObject({
      status: "published",
      publishedId: postId("linkedin", "found"),
      url: "https://linkedin.test/p/found",
    });
    expect(replied).toMatchObject([
      {
        platform: "linkedin",
        commentId: postId("linkedin", "found"),
        text: expect.stringContaining("/go/li/"),
      },
    ]);
    expect(replyKeys).toEqual([`${first} comment`]);
    expect([...hooks]).toEqual(["linkedin:"]);
    // A second word on the settled post is refused, and no second comment goes.
    await expect(settle(x.id, "posted")).rejects.toThrow();
    expect(replied).toHaveLength(1);
    expect(writes).toHaveLength(1);
  });

  it("Mark posted on his word runs the hook and posts no comment", async () => {
    const x = await parked("a linkedin post he saw up", "linkedin");
    verify = "absent";
    expect(await settle(x.id, "posted")).toMatchObject({ found: false });
    expect(replied).toEqual([]);
    expect([...hooks]).toEqual(["linkedin:"]);
  });

  it("a failed draft is approved again on the first yes: nothing is held for a read", async () => {
    const out = await desk().add({ text: "a note on retries" });
    const d = (await listDrafts(pg.db, { ideaId: out.idea.id })).find((r) => r.platform === "x");
    if (!d) throw new Error("no x draft");
    await pg.db
      .update(contentDrafts)
      .set({ status: "failed", error: "x POST /2/tweets: 403 the platform said no" })
      .where(eq(contentDrafts.id, d.id));
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
    views.set(postId("linkedin", 1), 200);
    views.set("x-2", 50);
    const first = await look();
    expect(first.stats?.looked.map((l) => l.platform).sort()).toEqual(["linkedin", "x"]);
    expect(first.stats?.failed).toEqual([]);
    // Looked at today: the next pass finds none.
    const second = await look();
    expect(second.stats?.looked).toEqual([]);
    expect(await pg.db.select().from(contentMetrics)).toHaveLength(2);
    // Each look keeps its day's insights with the counts beside them.
    expect(first.stats?.looked[0]).toMatchObject({ insights: 5, gaps: 1 });
    // The counts read's answer goes on to insights, so a post is not read twice.
    expect(insightReads).toEqual([{ seen: postId("linkedin", 1) }, { seen: "x-2" }]);
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

  it("a counts read with no leg or a miss takes its look from insights that read the counts, else fails", async () => {
    const a = await desk().add({ text: "a deep post", platforms: ["linkedin"] });
    const b = await desk().add({ text: "a shallow post", platforms: ["x"] });
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
    views.set(postId("linkedin", 1), 72);
    missed.add("linkedin");
    unbuilt.add("x");
    deep.add("linkedin");
    const pass = await look();
    expect(pass.stats?.looked.map((l) => l.platform)).toEqual(["linkedin"]);
    expect(pass.stats?.failed).toMatchObject([{ platform: "x" }]);
    expect(String(pass.stats?.failed[0]?.error)).toContain("workflow not recorded");
    const rows = await pg.db.select().from(contentMetrics);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 72, comments: 2, fetchedWith: "browser" });
    // The look counts: the post waits for its next tier, not the next hour.
    expect((await look()).stats?.looked).toEqual([]);
  });

  it("a post whose look failed waits before its next read, never read again the next pass", async () => {
    const a = await desk().add({ text: "a post whose read fails", platforms: ["x"] });
    await approveDrafts(
      pg.db,
      (await listDrafts(pg.db, { ideaId: a.idea.id })).map((d) => d.id),
      { now: new Date() },
    );
    await sync();
    unbuilt.add("x");
    expect((await look()).stats?.failed).toMatchObject([{ platform: "x" }]);
    const reads = singles.length;
    const next = await look();
    expect(next.stats?.failed).toEqual([]);
    expect(next.stats?.skipped).toBe(1);
    expect(singles).toHaveLength(reads);
  });

  it("the wait after failed looks doubles from 2 hours, at most a day", () => {
    const h = 60 * 60 * 1000;
    expect([1, 2, 3, 4, 5, 9].map((n) => missWaitMs(n) / h)).toEqual([2, 4, 8, 16, 24, 24]);
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
    const ids = posted.map((p, i) => postId(p.platform, i + 1));
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
    expect(insightReads).toContainEqual({ batch: ids.find((id) => id.startsWith("urn:li:")) });
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
    expect(singles.sort()).toEqual(posted.map((p, i) => postId(p.platform, i + 1)).sort());
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
    expect(singles).toEqual([postId("linkedin", 1)]);
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
    // An SOP scoped to films never steers a post, and pushing it again stores nothing.
    const film = { kinds: ["film"], platforms: ["linkedin"], topic: "", set: [] };
    const films = {
      platform: "linkedin" as const,
      sop: "films",
      text: "Cut every 2 s.",
      scope: film,
    };
    expect((await pushPlaybook(pg.db, films)).changed).toBe(true);
    expect((await pushPlaybook(pg.db, films)).changed).toBe(false);
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

  // Last in the loop's tests: the hold stays in the loop's state till the cap resets.
  it("a used cap skips the platform's other reads until it resets, never a failure", async () => {
    const a = await desk().add({ text: "first capped post", platforms: ["x"] });
    const b = await desk().add({ text: "second capped post", platforms: ["x"] });
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
    cappedMetrics.add("x");
    const pass = await look();
    expect(singles).toHaveLength(1);
    expect(pass.stats?.failed).toEqual([]);
    expect(pass.stats?.skipped).toBe(2);
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
    await seedObjects(pg.db, commentObjects([{ platform: "reddit", ref: "t1_q", post: "t3_p" }]));
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
