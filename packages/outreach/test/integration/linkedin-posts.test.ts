/**
 * Comments on others' LinkedIn posts, end to end on Postgres and Restate with fakes: the watch's
 * daily pass reads as linkedin@wren (topics, companies), keeps and ranks the posts, drafts the
 * day's cap and queues them. Nothing posts until his Comment: then `Content.reply` on the post's
 * urn, once. Skip drops it with his why. Off, or on his own login, nothing is read.
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
const llm = new FakeLlm({ default: JSON.stringify({ comment: "We moved scheduling to texts." }) });

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
    sql`select item, kind, event, via, text, reason from draft_events order by id`,
  ) as unknown as Promise<
    { item: string; kind: string; event: string; via: string; text: string; reason: string }[]
  >;
const statsOf = (o: PassOutcome<WatchStats>) => {
  if (o.error) throw new Error(o.error);
  return o.stats;
};

describe("settings", () => {
  it("off by default; never his own login or the research alt", () => {
    expect(commentsSettingsSchema.parse({})).toMatchObject({ account: "", perDay: 10 });
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
    const founder = rankPost(post(1, { headline: "Founder at Acme" }), { ...o, key: false });
    const vp = rankPost(post(1, { headline: "Vice President, Sales" }), { ...o, key: false });
    const known = rankPost(post(1), { ...o, key: true });
    expect(topic.fit).toBeGreaterThan(plain.fit);
    expect(founder.fit).toBeGreaterThan(vp.fit);
    expect(vp.fit).toBeGreaterThan(topic.fit);
    expect(known.fit).toBeGreaterThan(founder.fit);
    expect(founder.why).toContain('On "recruiting agency".');
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
    expect(by(1)).toMatchObject({
      draft: "We moved scheduling to texts.",
      account: "linkedin@wren",
    });
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
    expect(ev.map((e) => [e.event, e.reason, e.text])).toEqual([
      ["rejected", "voice", "Draft words."],
    ]);
    await expect(desk().commentPost({ id: p.id })).rejects.toThrow(/that post is skipped/);
    expect(replies).toEqual([]);
  });
});
