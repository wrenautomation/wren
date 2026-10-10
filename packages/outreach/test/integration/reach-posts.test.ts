/**
 * Comments on others' posts, end to end on Postgres and Restate with fakes: the watch's daily
 * pass reads as each platform's account (LinkedIn topics and companies, X and Instagram searches
 * and accounts), keeps and ranks the posts, drafts the day's cap and queues them. Nothing posts
 * until his Comment: then `Content.reply` on the post (LinkedIn, X) or Instagram's comment route,
 * once, with the like and follow the settings ask for, each a touch. Skip drops it with his why. Off, or on his own login, nothing is read. Job ads,
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
import { companies, people } from "@wren/core/schema";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/policy.js";
import {
  COMMENTS_COMPONENTS,
  COMMENTS_SETTINGS,
  type FeedPost,
  isJobAd,
  MIN_FIT,
  rankPost,
} from "../../src/reach-posts.js";
import {
  makeReachDesk,
  makeReachWatch,
  type ReachDeps,
  type ReachDeskService,
  WATCH_KEY,
  type WatchStats,
} from "../../src/restate/index.js";
import { type ReachPostPlatform, reachPosts } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";

const NOW = new Date("2026-10-07T15:00:00Z");
/** The watch's clock: a test that needs a new day moves it on. */
let now = NOW;
const ago = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();
const HOUR = 3_600_000;

const post = (n: number, o: Partial<FeedPost> = {}): FeedPost => ({
  ref: `urn:li:activity:${7_000 + n}`,
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

/** LinkedIn's posts as autobrowse answers them: the post's urn, not our ref. */
const feed = (posts: FeedPost[]) => ({
  posts: posts.map(({ ref, ...p }) => ({ ...p, urn: ref })),
  dropped: 0,
});

/** What the fake desk answers, by path; a function may throw. */
let routes: Record<string, (input: Record<string, unknown>) => unknown> = {};
const calls: {
  method: string;
  path: string;
  input: Record<string, unknown>;
  account: string | undefined;
}[] = [];
const sites: SiteClient = {
  call: async <T>(
    _site: string,
    method: string,
    path: string,
    input: Record<string, unknown> = {},
    account?: string,
  ) => {
    calls.push({ method, path, input, account });
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
/** The search words the fake model proposes next, and the prompts that asked for them. */
let proposed: string[] = [];
const topicAsks: string[] = [];
const llm = new FakeLlm({
  respond: (prompt, system) => {
    if (prompt.startsWith("Who we want to find on ")) {
      topicAsks.push(prompt);
      return JSON.stringify({ topics: proposed });
    }
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
    "reach_posts",
    "reach_accounts",
    "reach_contacts",
    "social_activity",
    "touches",
    "social_handles",
    "wren_settings",
    "draft_events",
    "runs",
  ]);
  routes = {};
  calls.length = 0;
  invent = 0;
  asked.length = 0;
  proposed = [];
  topicAsks.length = 0;
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
const settings = (o: Record<string, unknown>, platform: ReachPostPlatform = "linkedin") =>
  setWrenSettings(
    db(),
    COMMENTS_COMPONENTS[platform],
    COMMENTS_SETTINGS[platform].parse(o),
    "test",
  );
const rows = () => db().select().from(reachPosts).orderBy(reachPosts.id);
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
    expect(COMMENTS_SETTINGS.linkedin.parse({})).toMatchObject({
      account: "",
      perDay: 10,
      minFit: MIN_FIT,
    });
    expect(MIN_FIT).toBe(70);
    expect(COMMENTS_SETTINGS.linkedin.safeParse({ account: "linkedin" }).success).toBe(false);
    expect(COMMENTS_SETTINGS.linkedin.safeParse({ account: "linkedin@alt" }).success).toBe(false);
    expect(COMMENTS_SETTINGS.linkedin.safeParse({ account: "reddit@wren" }).success).toBe(false);
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

  it("off target: job posts, and posts outside the audience's world", () => {
    const o = { topics: ["client reactivation"], foundBy: "x", key: false, maxAgeHours: 72, now };
    const ads = [
      "#hiring Office Coordinator. Apply here: https://example.com/job. Job Title: Office Coordinator.",
      "WE'RE HIRING: Business Development Officer. Location: Remote. Requirements: 3 years of experience, full-time.",
      "A clinic is actively looking for a night nurse. Full-time, day shift or night shift, benefits include dental.",
      "I am currently looking for a part-time, remote role as a recruiter. Open to work.",
    ];
    for (const text of ads) {
      expect(isJobAd(text), text).toBe(true);
      expect(rankPost(post(1, { text }), o).off).toMatch(/^a job (ad|seeker)$/);
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
    expect(statsOf(out)?.posts).toEqual([]);
    expect(calls.filter((c) => c.path.includes("posts") || c.path.includes("search"))).toEqual([]);
  });

  it("reads as linkedin@wren, keeps, drafts the day's cap; nothing posts", async () => {
    await settings({
      account: "linkedin@wren",
      perDay: 2,
      topics: ["recruiting agency"],
      pages: ["acme-staffing"],
      people: false,
      minFit: 0,
    });
    routes["/search/results/content"] = () =>
      feed([
        post(1, { headline: "Founder at Acme Staffing", reactions: 80 }),
        post(2, { at: ago(100) }), // too old
        post(3, { authorUrl: "https://www.linkedin.com/company/wren-automation/" }), // ours
        post(4, { text: "Hiring!" }), // too short
        post(5, { authorUrl: post(1).authorUrl, text: `${post(1).text} Again.` }), // same author
      ]);
    routes["/company/acme-staffing/posts"] = () =>
      feed([post(6, { headline: "VP, Acme Staffing" }), post(7)]);

    const out = statsOf(await sync());
    expect(out?.posts[0]).toMatchObject({ reads: 2, kept: 4, dropped: 3, queued: 2, errors: [] });
    const reads = calls.filter((c) => c.method === "GET");
    expect(reads.map((c) => [c.path, c.account])).toEqual([
      ["/search/results/content", "linkedin@wren"],
      ["/company/acme-staffing/posts", "linkedin@wren"],
    ]);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(replies).toEqual([]);

    const got = await rows();
    const by = (n: number) => got.find((r) => r.ref === post(n).ref);
    expect(by(2)?.stateReason).toBe("older than 72 hours");
    expect(by(3)?.stateReason).toBe("ours");
    expect(by(4)?.stateReason).toBe("too short to answer");
    // The best two, one per author: the founder, then the VP; the founder's second post waits.
    expect(got.filter((r) => r.state === "queued").map((r) => r.ref)).toEqual([
      post(1).ref,
      post(6).ref,
    ]);
    expect(by(1)).toMatchObject({ draft: GOOD, account: "linkedin@wren" });
    // The prompt carries his facts.
    expect(asked[0]).toContain("- I built an interview reminder tool for recruiters.");
    expect(by(5)?.state).toBe("found");
    expect(by(1)?.why).toContain("Founder at Acme Staffing");
    const ev = await events();
    expect(ev.map((e) => [e.kind, e.event, e.via])).toEqual([
      ["post_comment", "generated", "model"],
      ["post_comment", "generated", "model"],
    ]);

    // The day's pass ran: a second sync reads nothing more.
    calls.length = 0;
    expect(statsOf(await sync())?.posts).toEqual([]);
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
    const out = statsOf(await sync())?.posts[0];
    expect(out).toMatchObject({ reads: 0, capped: true, queued: 0 });
    expect(calls.filter((c) => c.path === "/search/results/content")).toHaveLength(1);
  });
});

describe("search words", () => {
  it("rests his word that found nothing on target; adds the model's from about and yields", async () => {
    await settings({
      account: "linkedin@wren",
      topics: ["recruiting agency", "client reactivation"],
      people: false,
      about: "Owners of recruiting firms.",
      newTopics: 2,
    });
    // Last week's reads: "client reactivation" found only off-target posts.
    for (let i = 0; i < 15; i++)
      await db()
        .insert(reachPosts)
        .values({
          ref: `urn:li:activity:${9_000 + i}`,
          author: `Seller ${i}`,
          text: "Off target.",
          url: `https://www.linkedin.com/feed/update/urn:li:activity:${9_000 + i}/`,
          foundBy: "topic: client reactivation",
          account: "linkedin@wren",
          fit: 40,
          state: "dropped",
          stateReason: "not about recruit, staffing, headhunt",
          raw: {},
          createdAt: new Date(now.getTime() - 48 * HOUR),
        });
    proposed = ["our recruiting clients", "we're hiring", "recruiting agency"];
    const searched: string[] = [];
    routes["/search/results/content"] = (input) => {
      searched.push(String(input.keywords));
      return feed([]);
    };
    const out = statsOf(await sync())?.posts[0];
    expect(out).toMatchObject({
      topics: ["recruiting agency", "our recruiting clients"],
      rested: ["client reactivation"],
      reads: 2,
    });
    expect(searched).toEqual(["recruiting agency", "our recruiting clients"]);
    expect(topicAsks[0]).toContain("Owners of recruiting firms.");
    expect(topicAsks[0]).toContain('Found none of their posts: "client reactivation"');
  });

  it("newTopics 0: only his words, no model call", async () => {
    await settings({
      account: "linkedin@wren",
      topics: ["recruiting agency"],
      people: false,
      newTopics: 0,
    });
    routes["/search/results/content"] = () => feed([]);
    expect(statsOf(await sync())?.posts[0]).toMatchObject({ topics: ["recruiting agency"] });
    expect(topicAsks).toEqual([]);
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
    routes["/search/results/content"] = () =>
      feed([
        growthPost(1),
        post(2), // a recruiter's day: under 70, stays found
        post(3, {
          text: "#hiring Recruitment Administrator. Apply here: https://example.com/apply. Job Title: Recruitment Administrator.",
        }),
        post(4, {
          text: "Most contractors stop following up the day the job is done. The money is in the CRM.",
        }),
      ]);
    const out = statsOf(await sync());
    expect(out?.posts[0]).toMatchObject({ kept: 2, dropped: 2, queued: 1 });
    const got = await rows();
    const by = (n: number) => got.find((r) => r.ref === post(n).ref);
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
    routes["/search/results/content"] = () => feed([growthPost(5)]);
    invent = 1;
    expect(statsOf(await sync())?.posts[0]).toMatchObject({ queued: 1 });
    const [first] = await rows();
    expect(first).toMatchObject({ state: "queued", draft: GOOD });
    expect(asked[1]).toContain("a number from nowhere: 30");

    now = new Date(now.getTime() + 25 * HOUR);
    routes["/search/results/content"] = () => feed([growthPost(6)]);
    invent = 2;
    expect(statsOf(await sync())?.posts[0]).toMatchObject({ queued: 0 });
    const second = (await rows()).find((r) => r.ref === post(6).ref);
    expect(second?.state).toBe("dropped");
    expect(second?.stateReason).toMatch(/^made things up: "We built a scheduler/);
    expect(second?.draft).toBeNull();

    const runs = await guardRuns();
    expect(runs.map((r) => [r.argv.stage, r.stats.outcome])).toEqual([
      ["linkedin.comment_draft", "redrafted"],
      ["linkedin.comment_draft", "dropped"],
    ]);
    expect(runs[1]?.argv.item).toBe(`onpost:${second?.id}`);
    // Only the clean draft reached the training record.
    expect((await events()).map((e) => [e.event, e.text])).toEqual([["generated", GOOD]]);
  });
});

describe("redraft", () => {
  const keep = async (p: FeedPost, draft: string, state: "queued" | "found" = "queued") => {
    const [r] = await db()
      .insert(reachPosts)
      .values({
        ref: p.ref,
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
      [`onpost:${good.id}`, "generated", "model", "fake", null],
      [`onpost:${ad.id}`, "rejected", "wren", "rank", "topic"],
      [`onpost:${low.id}`, "rejected", "wren", "rank", "topic"],
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
      .insert(reachPosts)
      .values({
        ref: post(n).ref,
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
      { platform: "linkedin", commentId: post(1).ref, text: "His edited words." },
    ]);
    const [after] = await db().select().from(reachPosts).where(eq(reachPosts.id, p.id));
    expect(after).toMatchObject({ state: "commented", comment: "His edited words." });
    const ev = await events();
    expect(ev.map((e) => [e.item, e.event, e.via])).toEqual([
      [`onpost:${p.id}`, "edited", "person"],
      [`onpost:${p.id}`, "sent", "person"],
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

const TWEET_TEXT =
  "Our recruiting agency lost two retainer clients last year. Referrals dried up, so we built outbound and follow up with old clients.";
const tweet = (id: string, user: string, o: Record<string, unknown> = {}) => ({
  id,
  text: `${TWEET_TEXT} (${id})`,
  author_username: user,
  author_name: `Founder ${user}`,
  created_at: ago(5),
  public_metrics: { reply_count: 3, retweet_count: 2, like_count: 20 },
  ...o,
});

describe("X and Instagram", () => {
  it("X: searches and reads accounts as x@wren; reposts and pinned posts are left", async () => {
    await settings(
      {
        account: "x@wren",
        topics: ["recruiting agency"],
        pages: ["AcmeStaffing"],
        people: false,
        minFit: 0,
      },
      "x",
    );
    const queries: string[] = [];
    routes["/2/tweets/search/recent"] = (input) => {
      queries.push(String(input.query));
      return { data: [tweet("101", "FounderOne")] };
    };
    routes["/2/users/AcmeStaffing/tweets"] = () => ({
      data: [
        tweet("102", "AcmeStaffing"),
        tweet("103", "AcmeStaffing", { pinned: true }),
        tweet("104", "Other", { reposted_by: "AcmeStaffing" }),
      ],
    });
    const out = statsOf(await sync())?.posts;
    expect(out?.map((p) => [p.platform, p.reads, p.kept, p.queued])).toEqual([["x", 2, 2, 2]]);
    expect(queries[0]).toMatch(
      /^recruiting agency lang:en -filter:replies -filter:retweets since:\d{4}-\d{2}-\d{2}$/,
    );
    expect(calls.filter((c) => c.method === "GET").map((c) => c.account)).toEqual([
      "x@wren",
      "x@wren",
    ]);
    const got = await rows();
    expect(got.map((r) => [r.platform, r.ref, r.handle, r.url, r.state])).toEqual([
      ["x", "101", "founderone", "https://x.com/FounderOne/status/101", "queued"],
      ["x", "102", "acmestaffing", "https://x.com/AcmeStaffing/status/102", "queued"],
    ]);
    expect(asked[0]).toContain("one X comment");
    expect(asked[0]).toContain("under 250 characters");
    expect((await guardRuns()).length).toBe(0);
  });

  it("Instagram: a search's posts read one by one; an account through business discovery", async () => {
    await settings(
      {
        account: "instagram@wren",
        topics: ["recruiting agency"],
        pages: ["acmestaffing"],
        people: false,
        minFit: 0,
      },
      "instagram",
    );
    routes["/web/search"] = () => ({ shortcodes: ["AAA111", "GONE22"] });
    routes["/web/p/AAA111"] = () => ({
      shortcode: "AAA111",
      url: "https://www.instagram.com/p/AAA111/",
      username: "founder.one",
      caption: TWEET_TEXT,
      likes: 40,
      comments: 5,
      timestamp: ago(5),
    });
    routes["/web/p/GONE22"] = () => ({ found: false, reason: "no post" });
    routes["/instagram/acmestaffing"] = () => ({
      found: true,
      profile: { biography: "Founder, Acme Staffing" },
      media: [
        {
          caption: `${TWEET_TEXT} Again.`,
          permalink: "https://www.instagram.com/reel/BBB222/",
          timestamp: ago(6),
          like_count: 12,
          comments_count: 1,
        },
      ],
    });
    const out = statsOf(await sync())?.posts;
    expect(out?.map((p) => [p.platform, p.reads, p.kept])).toEqual([["instagram", 2, 2]]);
    expect(calls.find((c) => c.path === "/instagram/acmestaffing")?.account).toBeUndefined();
    expect(calls.find((c) => c.path === "/web/search")?.account).toBe("instagram@wren");
    const got = await rows();
    expect(got.map((r) => [r.platform, r.ref, r.handle, r.headline])).toEqual([
      ["instagram", "AAA111", "founder.one", null],
      ["instagram", "BBB222", "acmestaffing", "Founder, Acme Staffing"],
    ]);
  });
});

describe("his Comment, with a like and a follow", () => {
  const queuedOn = async (platform: ReachPostPlatform, ref: string, handle: string) => {
    const [r] = await db()
      .insert(reachPosts)
      .values({
        platform,
        ref,
        author: handle,
        authorUrl:
          platform === "x" ? `https://x.com/${handle}` : `https://www.instagram.com/${handle}/`,
        handle,
        text: TWEET_TEXT,
        url:
          platform === "x"
            ? `https://x.com/${handle}/status/${ref}`
            : `https://www.instagram.com/p/${ref}/`,
        foundBy: "topic: x",
        account: `${platform}@wren`,
        fit: 80,
        state: "queued",
        draft: "Draft words.",
        queuedAt: NOW,
        raw: {},
      })
      .returning();
    if (!r) throw new Error("no row");
    return r;
  };
  const touchRefs = async () =>
    (
      (await db().execute(
        sql`select t.ref, t.kind, t.account, h.handle from touches t join social_handles h on h.id = t.handle_id order by t.id`,
      )) as unknown as { ref: string; kind: string; account: string; handle: string }[]
    ).map((r) => [r.ref, r.kind, r.account, r.handle]);

  it("X: replies as Wren's page, then likes and follows as x@wren; each a touch", async () => {
    await settings({ account: "x@wren", follow: true }, "x");
    const p = await queuedOn("x", "555", "founderone");
    await desk().commentPost({ id: p.id });
    expect(replies).toEqual([{ platform: "x", commentId: "555", text: "Draft words." }]);
    expect(calls.map((c) => [c.method, c.path, c.input, c.account])).toEqual([
      ["POST", "/2/users/me/likes", { id: "555" }, "x@wren"],
      ["POST", "/2/users/me/following", { username: "founderone" }, "x@wren"],
    ]);
    const [after] = await db().select().from(reachPosts).where(eq(reachPosts.id, p.id));
    expect(after?.likedAt).not.toBeNull();
    expect(after?.followedAt).not.toBeNull();
    expect(await touchRefs()).toEqual([
      [`rp:${p.id}`, "comment", "wren", "founderone"],
      [`rp:${p.id}:like`, "like", "x@wren", "founderone"],
      [`rp:${p.id}:follow`, "follow", "x@wren", "founderone"],
    ]);
  });

  it("over X's length: refused before anything goes", async () => {
    await settings({ account: "x@wren" }, "x");
    const p = await queuedOn("x", "556", "founderone");
    await expect(desk().commentPost({ id: p.id, body: "a".repeat(281) })).rejects.toThrow(
      /280 characters/,
    );
    expect(replies).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("Instagram: comments through the page as instagram@wren; a failed like doesn't undo it", async () => {
    await settings({ account: "instagram@wren" }, "instagram");
    routes["/web/p/AAA111/like"] = () => {
      throw new SiteCallError("instagram", "POST", "/web/p/AAA111/like", 429, "like: cap");
    };
    const p = await queuedOn("instagram", "AAA111", "founder.one");
    await desk().commentPost({ id: p.id, body: "His words." });
    expect(replies).toEqual([]);
    expect(calls.map((c) => [c.path, c.input, c.account])).toEqual([
      ["/web/p/AAA111/comments", { shortcode: "AAA111", text: "His words." }, "instagram@wren"],
      ["/web/p/AAA111/like", { shortcode: "AAA111" }, "instagram@wren"],
    ]);
    const [after] = await db().select().from(reachPosts).where(eq(reachPosts.id, p.id));
    expect(after).toMatchObject({ state: "commented", comment: "His words.", likedAt: null });
    expect(await touchRefs()).toEqual([[`rp:${p.id}`, "comment", "instagram@wren", "founder.one"]]);
  });

  it("Instagram with no account set: refused", async () => {
    const p = await queuedOn("instagram", "CCC333", "founder.one");
    await expect(desk().commentPost({ id: p.id })).rejects.toThrow(/no instagram account/);
    expect(calls).toEqual([]);
  });

  it("likes or follows alone: no comment, still in To approve, once each, a touch", async () => {
    // Settings leave follow off; a click on Follow only is the yes all the same.
    await settings({ account: "x@wren" }, "x");
    const p = await queuedOn("x", "557", "foundertwo");
    await desk().actOnPost({ id: p.id, act: "follow" });
    await desk().actOnPost({ id: p.id, act: "like" });
    await expect(desk().actOnPost({ id: p.id, act: "like" })).rejects.toThrow(/already liked/);
    expect(replies).toEqual([]);
    expect(calls.map((c) => [c.path, c.input, c.account])).toEqual([
      ["/2/users/me/following", { username: "foundertwo" }, "x@wren"],
      ["/2/users/me/likes", { id: "557" }, "x@wren"],
    ]);
    const [after] = await db().select().from(reachPosts).where(eq(reachPosts.id, p.id));
    expect(after?.state).toBe("queued");
    expect(await touchRefs()).toEqual([
      [`rp:${p.id}:follow`, "follow", "x@wren", "foundertwo"],
      [`rp:${p.id}:like`, "like", "x@wren", "foundertwo"],
    ]);
  });

  it("Follow from People: the site's follow as its comments account, once, a touch", async () => {
    await settings({ account: "x@wren" }, "x");
    await settings({ account: "linkedin@wren" }, "linkedin");
    const [co] = await db()
      .insert(companies)
      .values({ domain: "firm-one.example", name: "Firm One", niche: "recruiting" })
      .returning();
    const [pe] = await db()
      .insert(people)
      .values({
        companyId: (co as { id: number }).id,
        fullName: "Pat One",
        isCompliance: false,
        origin: "website",
        originRef: "test",
        raw: {},
        linkedinUrl: "https://www.linkedin.com/in/Pat-One/",
      })
      .returning();
    await desk().followPerson({ id: `li:${(pe as { id: number }).id}` });
    await desk().followPerson({ id: "x:@founderthree" });
    await expect(desk().followPerson({ id: "x:founderthree" })).rejects.toThrow(
      /already following/,
    );
    await expect(desk().followPerson({ id: "reddit:someone" })).rejects.toThrow(
      /LinkedIn, X and Instagram only/,
    );
    await expect(desk().followPerson({ id: "instagram:founder.one" })).rejects.toThrow(
      /no instagram account/,
    );
    expect(calls.map((c) => [c.path, c.input, c.account])).toEqual([
      ["/in/pat-one/follow", { vanity: "pat-one" }, "linkedin@wren"],
      ["/2/users/me/following", { username: "founderthree" }, "x@wren"],
    ]);
    expect(await touchRefs()).toEqual([
      ["follow:linkedin:pat-one", "follow", "linkedin@wren", "pat-one"],
      ["follow:x:founderthree", "follow", "x@wren", "founderthree"],
    ]);
  });
});
