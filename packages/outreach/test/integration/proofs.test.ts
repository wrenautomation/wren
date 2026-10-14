/**
 * Comment proofs end to end on Postgres and Restate with a fake desk
 * (designs/2026-10-14-comment-proof.md): a check reads signed out, then as the account, keeps its
 * shot and overwrites the item's row, every check appended; the hour's hidden goes to Discord
 * once; a check that reads nothing keeps the verdict before it; the person's touch line shows it.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import type { Proof, SiteClient } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keepProof, proofOf, proofsSince, proofTarget, sentSince } from "../../src/proofs.js";
import { type CommentProofsService, makeCommentProofs } from "../../src/restate/proofs.js";
import { touchFromThread } from "../../src/touches.js";

const SENT = new Date("2026-10-13T15:00:00Z");
const ACCOUNT = "00000000-0000-4000-8000-000000000001";

/** Strangers see `open`; the account sees `own`. */
let open = "[deleted]";
let own = "Ask which step they drop at.";
const calls: string[] = [];
const thing = (body: string) => ({
  name: "t1_c1",
  body,
  author: body.startsWith("[") ? "[deleted]" : "example_user",
  permalink: "/r/example/comments/p1/a_title/c1/",
  link_id: "t3_p1",
});
const listing = (body: string) => ({ data: { children: [{ kind: "t1", data: thing(body) }] } });
const sites: SiteClient = {
  async call<T>(site: string, method: string, path: string, _i?: unknown, account?: string) {
    calls.push(`${site} ${method} ${path}${account ? ` as ${account}` : ""}`);
    if (path === "/api/info") return listing(site === "reddit" ? own : open) as T;
    if (path === "/comments/p1") return [listing("x"), listing(open)] as T;
    if (path === "/proof/shot")
      return { found: true, jpeg: Buffer.from("jpg").toString("base64") } as T;
    throw new Error(`no route ${site} ${path}`);
  },
  via: async () => "browser",
};
const warned: string[] = [];
const notifier: Notifier = {
  name: "test",
  async notify(title, _body, level) {
    warned.push(`${level}: ${title}`);
    return true;
  },
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const db = () => pg.db;
const proofs = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<CommentProofsService>({ name: "CommentProofs" });

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeCommentProofs({
        db: pg.db,
        sitesFor: () => sites,
        keep: async (b) => `s3://media/proof-${b.length}.jpg`,
        notifier,
      }),
    ],
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
    "comment_proofs",
    "reddit_threads",
    "reddit_places",
    "reach_posts",
    "reach_accounts",
    "touches",
    "social_handles",
  ]);
  calls.length = 0;
  warned.length = 0;
  open = "[deleted]";
  own = "Ask which step they drop at.";
  await db().execute(sql`insert into reach_accounts (id, platform, account, handle, state, started_on)
    values (${ACCOUNT}, 'reddit', 'reddit@one', 'one_handle', 'active', '2026-09-01')`);
  await db().execute(sql`insert into reddit_places (subreddit, name, found_by)
    values ('example', 'example', 'test')`);
  await db().execute(sql`insert into reddit_threads (id, subreddit, title, body, author, url,
      posted_at, comments, raw, state, target, answer, answer_ref, answered_at, account_id)
    values ('t3_p1', 'example', 'A title', 'A body', 'op_user',
      'https://www.reddit.com/r/example/comments/p1/a_title/', ${SENT.toISOString()}, 3, '{}',
      'commented', 't3_p1', 'Ask which step they drop at.', 't1_c1', ${SENT.toISOString()}, ${ACCOUNT})`);
  await db().execute(sql`insert into reach_posts (platform, ref, author, text, url, found_by,
      account, state, comment, commented_at, raw)
    values ('x', '123', 'Someone', 'A post', 'https://x.com/someone/status/123', 'topic: test',
      'x@one', 'commented', 'Our words', ${SENT.toISOString()}, '{}')`);
});

describe("comment proofs", () => {
  it("reads each sent item's target, and lists what was sent", async () => {
    expect(await proofTarget(db(), "thread:t3_p1")).toMatchObject({
      platform: "reddit",
      ref: "t1_c1",
      post: "t3_p1",
      account: "reddit@one",
    });
    expect(await proofTarget(db(), "thread:t3_none")).toBeNull();
    expect(await proofTarget(db(), "bogus")).toBeNull();
    const items = await sentSince(db(), new Date("2026-10-12T00:00:00Z"));
    expect(items).toHaveLength(2);
    expect(items[0]).toBe("thread:t3_p1");
    expect(await sentSince(db(), new Date("2026-10-14T00:00:00Z"))).toEqual([]);
  });

  it("is hidden when only the account sees it; the hour's check warns once", async () => {
    const p = (await proofs().check({ item: "thread:t3_p1", round: 2 })) as Proof;
    expect(p.state).toBe("hidden");
    expect(p.shot).toBe("s3://media/proof-3.jpg");
    expect(p.url).toBe("https://www.reddit.com/r/example/comments/p1/a_title/c1/");
    expect(calls).toContain("reddit GET /api/info as reddit@one");
    expect(calls).toContain("web GET /proof/shot");
    expect(warned).toEqual(["warning: Comment hidden after an hour: thread:t3_p1"]);

    // A day on, mods approved it: live, and the history keeps both.
    open = "Ask which step they drop at.";
    await proofs().check({ item: "thread:t3_p1", round: 3 });
    const row = await proofOf(db(), "thread:t3_p1");
    expect(row?.state).toBe("live");
    expect(row?.note).toBeNull();
    expect(row?.checks.map((c) => [c.round, c.state])).toEqual([
      [2, "hidden"],
      [3, "live"],
    ]);
    expect(warned).toHaveLength(1);
    expect((await proofsSince(db(), SENT)).map((r) => r.item)).toEqual(["thread:t3_p1"]);

    // The person's touch line says it.
    await touchFromThread(db(), "t3_p1");
    const lines = (await db().execute(
      sql`select what from person_touch_lines where person = 'reddit:op_user'`,
    )) as unknown as { what: string }[];
    expect(lines[0]?.what).toContain(" · Live");
  });

  it("keeps the verdict when a later check reads nothing", async () => {
    const at = "2026-10-14T10:00:00.000Z";
    const live: Proof = { state: "live", checkedAt: at, url: "u", shot: "s", note: null };
    await keepProof(db(), "onpost:1", "x", live, 1);
    const none: Proof = { state: "pending", checkedAt: at, url: null, shot: null, note: "down" };
    expect(await keepProof(db(), "onpost:1", "x", none, 2)).toEqual({ warn: false });
    const row = await proofOf(db(), "onpost:1");
    expect(row).toMatchObject({ state: "live", url: "u", shot: "s", note: null });
    expect(row?.checks).toHaveLength(2);
  });

  it("leaves a platform with no reader pending", async () => {
    const [id] = (await db().execute(sql`select id from reach_posts`)) as unknown as {
      id: number;
    }[];
    const p = (await proofs().check({ item: `onpost:${id?.id}` })) as Proof;
    expect(p).toMatchObject({ state: "pending", note: "no reader for x yet" });
    await expect(proofs().check({ item: "comment:999" })).rejects.toThrow(/never sent/);
  });
});
