/**
 * The whole loop against Postgres and a Restate test environment: an idea is
 * drafted per platform (fake LLM, one journaled step each), a person approves,
 * the scheduler posts through a stand-in `Content` service and stamps the row;
 * a refusal lands on the row as `failed`; a scheduled draft waits its turn.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { runs } from "@wren/core";
import type { Platform, Post } from "@wren/core/content";
import type { PassOutcome } from "@wren/core/restate";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  whatWorked,
} from "../../src/index.js";
import { DESK_KEY, makeContentDesk, SCHEDULER_KEY } from "../../src/restate/index.js";
import { METRICS_KEY, type MetricsStats, makeContentMetrics } from "../../src/restate/metrics.js";
import { makeContentScheduler, type PublishStats } from "../../src/restate/scheduler.js";

const posted: { platform: Platform; post: Post }[] = [];
const refuse = new Set<Platform>();
const views = new Map<string, number>();
const notes: string[] = [];
let calls = 0;
const fakeContent = restate.service({
  name: "Content",
  handlers: {
    publish: async (_ctx: restate.Context, req: { platform: Platform; post: Post }) => {
      if (refuse.has(req.platform))
        throw new restate.TerminalError(`no ${req.platform} channel configured`, {
          errorCode: 404,
        });
      posted.push(req);
      return {
        id: `${req.platform}-${posted.length}`,
        url: `https://${req.platform}.test/p/${posted.length}`,
        publishedAt: new Date().toISOString(),
        fetchedWith: "api" as const,
      };
    },
    metrics: async (_ctx: restate.Context, req: { platform: Platform; id: string }) => {
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
        asOf: new Date().toISOString(),
        fetchedWith: "api" as const,
      };
    },
  },
});

const prompts: string[] = [];
const llm = new FakeLlm({
  respond: async (prompt) => {
    calls += 1;
    prompts.push(prompt);
    if (prompt.includes("The author read it and says"))
      return '{"text": "shorter. the gate asks first."}';
    if (prompt.includes("one post on X"))
      return '{"text": "the spend gate is live. every buy asks first."}';
    if (prompt.includes("YouTube title")) return '{"title": "Spend gate", "text": "what it does"}';
    return '{"text": "Shipped the spend gate.\\n\\nEvery buy asks me first."}';
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      fakeContent,
      makeContentDesk({ db: pg.db, llm, platforms: ["linkedin", "x", "youtube"] }),
      makeContentScheduler({ db: pg.db, idleMs: 60_000 }),
      makeContentMetrics({
        db: pg.db,
        notifier: {
          name: "test",
          notify: async (title) => {
            notes.push(title);
            return true;
          },
        },
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
  await truncate(pg.db, ["content_ideas", "content_drafts", "content_metrics", "runs"]);
  posted.length = 0;
  notes.length = 0;
  prompts.length = 0;
  views.clear();
  refuse.clear();
  calls = 0;
});

type Desk = ReturnType<typeof makeContentDesk>;
type Sched = ReturnType<typeof makeContentScheduler>;
const desk = () =>
  clients.connect({ url: env.baseUrl() }).objectClient<Desk>({ name: "ContentDesk" }, DESK_KEY);
const sched = () =>
  clients
    .connect({ url: env.baseUrl() })
    .objectClient<Sched>({ name: "ContentScheduler" }, SCHEDULER_KEY);
const sync = () => sched().sync() as Promise<PassOutcome<PublishStats>>;
type Met = ReturnType<typeof makeContentMetrics>;
const look = () =>
  clients
    .connect({ url: env.baseUrl() })
    .objectClient<Met>({ name: "ContentMetrics" }, METRICS_KEY)
    .sync() as Promise<PassOutcome<MetricsStats>>;

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
    expect(yt?.post).toMatchObject({
      text: "what it does",
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
    await expect(editDraft(pg.db, row.id, { text: "a".repeat(281) })).rejects.toThrow(/over 280/);
    expect((await getDraft(pg.db, row.id)).text).toBe("new text");
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
