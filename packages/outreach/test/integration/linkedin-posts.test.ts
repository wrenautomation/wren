/**
 * Comments on others' LinkedIn posts, end to end on Postgres and Restate with fakes: the watch's
 * daily pass reads as linkedin@wren (topics, companies), keeps and ranks the posts, drafts the
 * day's cap and queues them. Nothing posts until his Comment: then `Content.reply` on the post's
 * urn, once. Skip drops it with his why. Off, or on his own login, nothing is read. Job ads,
 * posts outside the audience's world and posts under the minimum fit get no draft; a draft that
 * makes things up is asked for again, then dropped; redraft rewrites queued drafts from the kept
 * post.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { setWrenSettings } from "@wren/core/clients";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { siteCallErrorFrom } from "@wren/core/content/restate";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  COMMENTS_COMPONENT,
  commentsSettingsSchema,
  type FeedPost,
  isJobAd,
  MIN_FIT,
  rankPost,
} from "../../src/linkedin-posts.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import {
  makeReachDesk,
  makeReachWatch,
  type ReachDeps,
  type ReachDeskService,
  WATCH_KEY,
  type WatchStats,
} from "../../src/restate/index.js";
import { linkedinPosts } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";

const NOW = new Date("2026-10-07T15:00:00Z");
/** The watch's clock: a test that needs a new day moves it on. */
let now = NOW;
const ago = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();
const HOUR = 3_600_000;

const post = (n: number, o: Partial<FeedPost> = {}): FeedPost => ({
  urn: `urn:li:activity:${7_000 + n}`,
  author: `Author ${n}`,
  authorUrl: `https://www.linkedin.com/in/author-${n}`,
  headline: "Recruiter",
  text: `Post ${n}: our recruiting agency spends hours chasing candidates for interview slots every week.`,
  at: ago(5),
  reactions: 10,
  comments: 2,
  url: `https://www.linkedin.com/feed/update/urn:li:activity:${7_000 + n}/`,
  ...o,
});

/** What the fake desk answers, by path; a function may throw. */
let routes: Record<string, (input: Record<string, unknown>) => unknown> = {};
const calls: { method: string; path: string; account: string | undefined }[] = [];
const sites: SiteClient = {
  call: async <T>(
    _site: string,
    method: string,
    path: string,
    input: Record<string, unknown> = {},
    account?: string,
  ) => {
    calls.push({ method, path, account });
    const r = routes[path];
    return (r ? r(input) : {}) as T;
  },
  via: async () => "browser",
};
const replies: { platform: string; commentId: string; text: string }[] = [];
const fakeContent = restate.service({
  name: "Content",
  handlers: {
    reply: async (
      _ctx: restate.Context,
      req: { platform: string; commentId: string; text: string },
    ) => {
      replies.push(req);
    },
  },
});
/** The comment the fake model writes next; `invent` makes it make things up. */
const GOOD = "Which slot do candidates drop most: the first call or the reschedule?";
let invent = 0;
const asked: string[] = [];
const llm = new FakeLlm({
  respond: (prompt, system) => {
    asked.push(`${system ?? ""}\n${prompt}`);
    if (invent > 0) {
      invent--;
      return JSON.stringify({
        comment: `We built a scheduler that booked ${30 + invent} interviews.`,
      });
    }
    return JSON.stringify({ comment: GOOD });
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
const db = () => pg.db;
beforeAll(async () => {
  pg = await startTestPostgres();
  const deps: ReachDeps = {
    db: pg.db,
    policy: DEFAULT_POLICY,
    sequences: REACH_SEQUENCES,
    live: false,
    senderName: "Test",
    heldNiches: [],
    clock: () => now,
    // Journaled like the desk's calls; a site's error keeps its status, as `restateSites` does.
    sitesFor: (ctx) => ({
      call: async <T>(...a: Parameters<SiteClient["call"]>) => {
        try {
          return (await ctx.run(`site ${a[2]}`, async () => {
            try {
              return await sites.call(...a);
            } catch (err) {
              if (err instanceof SiteCallError)
                throw new restate.TerminalError(err.message, { errorCode: err.status });
              throw err;
            }
          })) as T;
        } catch (err) {
          throw siteCallErrorFrom(err, a[0], a[1], a[2]);
        }
      },
      via: sites.via,
    }),
    drafts: {
      llm,
      commentGuide: async () => "Short. One fact.",
      voice: "Plain, first person.",
      facts: async () => ["I built an interview reminder tool for recruiters."],
    },
  };
  env = await startTestRestate({
    services: [fakeContent, makeReachWatch(deps), makeReachDesk(deps)],
    alwaysReplay: true,
    disableRetries: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "linkedin_posts",
    "reach_accounts",
    "reach_contacts",
    "social_activity",
    "wren_settings",
    "draft_events",
    "runs",
  ]);
  routes = {};
  calls.length = 0;
  invent = 0;
  asked.length = 0;
  now = new Date(now.getTime() + 25 * HOUR);
  replies.length = 0;
  // Our own page, paused: its posts are never ours to answer; the watch doesn't read it.
  await db().execute(sql`insert into reach_accounts (platform, account, handle, state,
    paused_reason, started_on)
    values ('linkedin', 'linkedin@wren', 'wren-automation', 'paused', 'test', '2026-09-01')`);
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const sync = async () => {
  const w = ingress().objectClient<ReturnType<typeof makeReachWatch>>(
    { name: "ReachWatch" },
    WATCH_KEY,
  );
  return (await w.sync()) as PassOutcome<WatchStats>;
};
const desk = () => ingress().serviceClient<ReachDeskService>({ name: "ReachDesk" });
const settings = (o: Record<string, unknown>) =>
  setWrenSettings(db(), COMMENTS_COMPONENT, commentsSettingsSchema.parse(o), "test");
const rows = () => db().select().from(linkedinPosts).orderBy(linkedinPosts.id);
const events = () =>
  db().execute(
    sql`select item, kind, event, via, by, text, reason, note, meta from draft_events order by id`,
  ) as unknown as Promise<
    {
      item: string;
      kind: string;
      event: string;
      via: string;
      by: string | null;
      text: string;
      reason: string;
      note: string | null;
      meta: Record<string, unknown> | null;
    }[]
  >;
const guardRuns = () =>
  db().execute(
    sql`select argv, stats from runs where command = 'guard' order by started_at`,
  ) as unknown as Promise<{ argv: Record<string, unknown>; stats: Record<string, unknown> }[]>;
const statsOf = (o: PassOutcome<WatchStats>) => {
  if (o.error) throw new Error(o.error);
  return o.stats;
};

describe("settings", () => {
  it("off by default; never his own login or the research alt", () => {
    expect(commentsSettingsSchema.parse({})).toMatchObject({
      account: "",
      perDay: 10,
      minFit: MIN_FIT,
    });
    expect(MIN_FIT).toBe(70);
    expect(commentsSettingsSchema.safeParse({ account: "linkedin" }).success).toBe(false);
    expect(commentsSettingsSchema.safeParse({ account: "linkedin@alt" }).success).toBe(false);
    expect(commentsSettingsSchema.safeParse({ account: "reddit@wren" }).success).toBe(false);
  });

  it("ranks topic, title, people we know above a bare match", () => {
    const o = { topics: ["recruiting agency"], foundBy: "x", maxAgeHours: 72, now };
    const plain = rankPost(post(1, { text: "Nothing to see here at all, a long enough line." }), {
      ...o,
      key: false,
    });
    const topic = rankPost(post(1), { ...o, key: false });
    const founder = rankPost(post(1, { headline: "Founder, Acme Recruiting" }), {
      ...o,
      key: false,
    });
    const vp = rankPost(post(1, { headline: "Vice President, Recruiting" }), { ...o, key: false });
    const known = rankPost(post(1), { ...o, key: true });
    expect(topic.fit).toBeGreaterThan(plain.fit);
    expect(founder.fit).toBeGreaterThan(vp.fit);
    expect(vp.fit).toBeGreaterThan(topic.fit);
    expect(known.fit).toBeGreaterThan(founder.fit);
    expect(founder.why).toContain('On "recruiting agency".');
  });

  it("off target: job ads, and posts outside the audience's world", () => {
    const o = { topics: ["client reactivation"], foundBy: "x", key: false, maxAgeHours: 72, now };
    const ads = [
      "#hiring Office Coordinator. Apply here: https://example.com/job. Job Title: Office Coordinator.",
      "WE'RE HIRING: Business Development Officer. Location: Remote. Requirements: 3 years of experience, full-time.",
      "A clinic is actively looking for a night nurse. Full-time, day shift or night shift, benefits include dental.",
      "I am currently looking for a part-time, remote role as a recruiter. Open to work.",
    ];
    for (const text of ads) {
      expect(isJobAd(text), text).toBe(true);
      expect(rankPost(post(1, { text }), o).off).toBe("a job ad");
    }
    const elsewhere = rankPost(
      post(2, {
        text: "Most contractors stop following up the day the job is done. The CRM holds the money.",
      }),
      o,
    );
    expect(elsewhere.off).toMatch(/^not about recruit/);
    const ours = rankPost(post(3), o);
    expect(ours.off).toBeNull();
    expect(isJobAd(post(3).text)).toBe(false);
  });

  it("growing a recruiting firm ranks above a recruiter's day", () => {
    const o = { topics: ["recruiting agency"], foundBy: "x", key: false, maxAgeHours: 72, now };
    const growth = rankPost(
      post(1, {
        headline: "Founder, a search firm",
        text: "Our recruiting agency lost two retainer clients last year. The pipeline was all referrals and no outreach. Revenue now comes from old clients we follow up with.",
      }),
      o,
    );
    const day = rankPost(post(2, { headline: "Recruiter" }), o);
    expect(growth.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(day.fit).toBeLessThan(MIN_FIT);
    expect(growth.why).toContain("Talks");
  });
});

describe("the daily pass", () => {
  it("off: reads nothing", async () => {
    const out = await sync();
    expect(statsOf(out)?.posts).toBeNull();
    expect(calls.filter((c) => c.path.includes("posts") || c.path.includes("search"))).toEqual([]);
  });

  it("reads as linkedin@wren, keeps, drafts the day's cap; nothing posts", async () => {
    await settings({
      account: "linkedin@wren",
      perDay: 2,
      topics: ["recruiting agency"],
      companies: ["acme-staffing"],
      people: false,
      minFit: 0,
    });
    routes["/search/results/content"] = () => ({
      posts: [
        post(1, { headline: "Founder at Acme Staffing", reactions: 80 }),
        post(2, { at: ago(100) }), // too old
        post(3, { authorUrl: "https://www.linkedin.com/company/wren-automation/" }), // ours
        post(4, { text: "Hiring!" }), // too short
        post(5, { authorUrl: post(1).authorUrl, text: `${post(1).text} Again.` }), // same author
      ],
      dropped: 0,
    });
    routes["/company/acme-staffing/posts"] = () => ({
      posts: [post(6, { headline: "VP Talent" }), post(7)],
      dropped: 0,
    });

    const out = statsOf(await sync());
    expect(out?.posts).toMatchObject({ reads: 2, kept: 4, dropped: 3, queued: 2, errors: [] });
    const reads = calls.filter((c) => c.method === "GET");
    expect(reads.map((c) => [c.path, c.account])).toEqual([
      ["/search/results/content", "linkedin@wren"],
      ["/company/acme-staffing/posts", "linkedin@wren"],
    ]);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(replies).toEqual([]);

    const got = await rows();
    const by = (n: number) => got.find((r) => r.urn === post(n).urn);
    expect(by(2)?.stateReason).toBe("older than 72 hours");
    expect(by(3)?.stateReason).toBe("ours");
    expect(by(4)?.stateReason).toBe("too short to answer");
    // The best two, one per author: the founder, then the VP; the founder's second post waits.
    expect(got.filter((r) => r.state === "queued").map((r) => r.urn)).toEqual([
      post(1).urn,
      post(6).urn,
    ]);
    expect(by(1)).toMatchObject({ draft: GOOD, account: "linkedin@wren" });
    // The prompt carries his facts.
    expect(asked[0]).toContain("- I built an interview reminder tool for recruiters.");
    expect(by(5)?.state).toBe("found");
    expect(by(1)?.why).toContain("Founder at Acme Staffing");
    const ev = await events();
    expect(ev.map((e) => [e.kind, e.event, e.via])).toEqual([
      ["linkedin_comment", "generated", "model"],
      ["linkedin_comment", "generated", "model"],
    ]);

    // The day's pass ran: a second sync reads nothing more.
    calls.length = 0;
    expect(statsOf(await sync())?.posts).toBeNull();
    expect(calls).toEqual([]);
  });

  it("a 429 ends the reads for the pass", async () => {
    await settings({
      account: "linkedin@wren",
      topics: ["a topic", "another"],
      people: false,
    });
    routes["/search/results/content"] = () => {
      throw new SiteCallError("linkedin", "GET", "/search/results/content", 429, "posts: cap");
    };
    const out = statsOf(await sync())?.posts;
    expect(out).toMatchObject({ reads: 0, capped: true, queued: 0 });
    expect(calls.filter((c) => c.path === "/search/results/content")).toHaveLength(1);
  });
});

/** A recruiting firm's growth, by a founder: over the minimum fit. */
const GROWTH_TEXT =
  "Our recruiting agency lost two retainer clients last year. The pipeline was all referrals and no outreach. Revenue now comes from old clients we follow up with.";
const growthPost = (n: number) =>
  post(n, { headline: "Founder, a search firm", text: `${GROWTH_TEXT} (${n})` });

describe("what gets a draft", () => {
  const on = () =>
    settings({ account: "linkedin@wren", topics: ["recruiting agency"], people: false });

  it("under the minimum fit, or off target: no draft", async () => {
    await on();
    routes["/search/results/content"] = () => ({
      posts: [
        growthPost(1),
        post(2), // a recruiter's day: under 70, stays found
        post(3, {
          text: "#hiring Recruitment Administrator. Apply here: https://example.com/apply. Job Title: Recruitment Administrator.",
        }),
        post(4, {
          text: "Most contractors stop following up the day the job is done. The money is in the CRM.",
        }),
      ],
      dropped: 0,
    });
    const out = statsOf(await sync());
    expect(out?.posts).toMatchObject({ kept: 2, dropped: 2, queued: 1 });
    const got = await rows();
    const by = (n: number) => got.find((r) => r.urn === post(n).urn);
    expect(by(1)?.state).toBe("queued");
    expect(by(1)?.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(by(2)).toMatchObject({ state: "found", draft: null });
    expect(by(2)?.fit).toBeLessThan(MIN_FIT);
    expect(by(3)).toMatchObject({ state: "dropped", stateReason: "a job ad" });
    expect(by(4)?.state).toBe("dropped");
    expect(by(4)?.stateReason).toMatch(/^not about recruit/);
  });

  it("made up once: asked again; made up twice: dropped; both in the run ledger", async () => {
    await on();
    routes["/search/results/content"] = () => ({ posts: [growthPost(5)], dropped: 0 });
    invent = 1;
    expect(statsOf(await sync())?.posts).toMatchObject({ queued: 1 });
    const [first] = await rows();
    expect(first).toMatchObject({ state: "queued", draft: GOOD });
    expect(asked[1]).toContain("a number from nowhere: 30");

    now = new Date(now.getTime() + 25 * HOUR);
    routes["/search/results/content"] = () => ({ posts: [growthPost(6)], dropped: 0 });
    invent = 2;
    expect(statsOf(await sync())?.posts).toMatchObject({ queued: 0 });
    const second = (await rows()).find((r) => r.urn === post(6).urn);
    expect(second?.state).toBe("dropped");
    expect(second?.stateReason).toMatch(/^made things up: "We built a scheduler/);
    expect(second?.draft).toBeNull();

    const runs = await guardRuns();
    expect(runs.map((r) => [r.argv.stage, r.stats.outcome])).toEqual([
      ["linkedin.comment_draft", "redrafted"],
      ["linkedin.comment_draft", "dropped"],
    ]);
    expect(runs[1]?.argv.item).toBe(`lipost:${second?.id}`);
    // Only the clean draft reached the training record.
    expect((await events()).map((e) => [e.event, e.text])).toEqual([["generated", GOOD]]);
  });
});

describe("redraft", () => {
  const keep = async (p: FeedPost, draft: string, state: "queued" | "found" = "queued") => {
    const [r] = await db()
      .insert(linkedinPosts)
      .values({
        urn: p.urn,
        author: p.author,
        authorUrl: p.authorUrl,
        headline: p.headline ?? null,
        text: p.text,
        url: p.url,
        postedAt: new Date(p.at ?? now),
        reactions: p.reactions,
        comments: p.comments,
        foundBy: "topic: recruiting agency",
        account: "linkedin@wren",
        fit: 80,
        why: "old rank",
        state,
        draft: state === "queued" ? draft : null,
        queuedAt: state === "queued" ? now : null,
        raw: {},
      })
      .returning();
    if (!r) throw new Error("no row");
    return r;
  };

  it("rewrites from the kept post, ranks again, records the model's redraft; no LinkedIn read", async () => {
    await settings({ account: "linkedin@wren", topics: ["recruiting agency"], people: false });
    const made = "We built a scheduler that booked 40 interviews.";
    const good = await keep(growthPost(11), made);
    const ad = await keep(
      post(12, {
        text: "WE'RE HIRING: Recruitment Consultant. Location: Remote. Requirements: 2 years of experience, full-time.",
      }),
      made,
    );
    const low = await keep(post(13), made);
    const found = await keep(growthPost(14), "", "found");

    const out = await desk().redraftPosts({ ids: [good.id, ad.id, low.id, found.id, 999] });
    expect(out.redrafted).toEqual([good.id]);
    expect(out.dropped).toEqual([
      { id: ad.id, why: "a job ad" },
      { id: low.id, why: expect.stringMatching(/^fit \d+ under 70$/) },
    ]);
    expect(out.skipped).toEqual([
      { id: found.id, why: "that post is found" },
      { id: 999, why: "no such post" },
    ]);
    expect(calls).toEqual([]);

    const got = await rows();
    const by = (id: number) => got.find((r) => r.id === id);
    expect(by(good.id)).toMatchObject({ state: "queued", draft: GOOD });
    expect(by(ad.id)).toMatchObject({ state: "dropped", stateReason: "a job ad", draft: made });
    expect(by(low.id)?.state).toBe("dropped");

    // The redraft is the model's, not his no; a post off target is Wren's no, by the rank.
    const ev = await events();
    expect(ev.map((e) => [e.item, e.event, e.via, e.by, e.reason])).toEqual([
      [`lipost:${good.id}`, "generated", "model", "fake", null],
      [`lipost:${ad.id}`, "rejected", "wren", "rank", "topic"],
      [`lipost:${low.id}`, "rejected", "wren", "rank", "topic"],
    ]);
    expect(ev[0]?.meta).toMatchObject({ redraft: "facts guard" });
    expect(ev[1]?.note).toBe("a job ad");
  });

  it("the guard drops a redraft that makes things up twice: out of To approve as Wren's no", async () => {
    await settings({ account: "linkedin@wren", topics: ["recruiting agency"], people: false });
    const p = await keep(growthPost(15), "We built a scheduler that booked 40 interviews.");
    invent = 2;
    const out = await desk().redraftPosts({ ids: [p.id] });
    expect(out.redrafted).toEqual([]);
    expect(out.dropped[0]?.why).toMatch(/^made things up/);
    const ev = await events();
    expect(ev.map((e) => [e.event, e.via, e.by, e.reason])).toEqual([
      ["rejected", "wren", "guard", "facts"],
    ]);
    expect((await guardRuns()).map((r) => r.stats.outcome)).toEqual(["dropped"]);
  });
});

describe("his Comment", () => {
  const queued = async (n: number, state: "queued" | "found" = "queued") => {
    const [r] = await db()
      .insert(linkedinPosts)
      .values({
        urn: post(n).urn,
        author: post(n).author,
        authorUrl: post(n).authorUrl,
        text: post(n).text,
        url: post(n).url,
        foundBy: "topic: x",
        account: "linkedin@wren",
        fit: 50,
        why: "On x.",
        state,
        draft: state === "queued" ? "Draft words." : null,
        queuedAt: state === "queued" ? NOW : null,
        raw: {},
      })
      .returning();
    if (!r) throw new Error("no row");
    return r;
  };

  it("posts his words under their post once, then refuses", async () => {
    const p = await queued(1);
    const found = await queued(2, "found");
    await expect(desk().commentPost({ id: found.id })).rejects.toThrow(/that post is found/);
    expect(replies).toEqual([]);

    await desk().commentPost({ id: p.id, body: "His edited words." });
    expect(replies).toEqual([
      { platform: "linkedin", commentId: post(1).urn, text: "His edited words." },
    ]);
    const [after] = await db().select().from(linkedinPosts).where(eq(linkedinPosts.id, p.id));
    expect(after).toMatchObject({ state: "commented", comment: "His edited words." });
    const ev = await events();
    expect(ev.map((e) => [e.item, e.event, e.via])).toEqual([
      [`lipost:${p.id}`, "edited", "person"],
      [`lipost:${p.id}`, "sent", "person"],
    ]);

    await expect(desk().commentPost({ id: p.id })).rejects.toThrow(/already commented/);
    expect(replies).toHaveLength(1);
  });

  it("Skip drops it with his why; it can't post after", async () => {
    const p = await queued(3);
    expect(await desk().skipPost({ ids: [p.id], reason: "voice" } as never)).toEqual({
      skipped: [p.id],
    });
    const ev = await events();
    expect(ev.map((e) => [e.event, e.via, e.by, e.reason, e.text])).toEqual([
      ["rejected", "person", "console", "voice", "Draft words."],
    ]);
    await expect(desk().commentPost({ id: p.id })).rejects.toThrow(/that post is skipped/);
    expect(replies).toEqual([]);
  });

  it("Skip from the CLI names who said no, with a note", async () => {
    const p = await queued(4);
    await desk().skipPost({
      ids: [p.id],
      by: "william@example.com",
      reason: "facts",
      note: "made up a story",
    } as never);
    const ev = await events();
    expect(ev.map((e) => [e.via, e.by, e.reason, e.note])).toEqual([
      ["person", "william@example.com", "facts", "made up a story"],
    ]);
  });
});
