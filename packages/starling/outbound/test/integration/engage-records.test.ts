/**
 * Engage and Explore against Postgres (designs/2026-10-16-outreach-app.md): Engage holds others'
 * posts with our comment drafted and what we sent with its proof; Explore lists what the searches
 * found that nobody picked yet, best fit first. Synthetic rows only.
 */
import { resolveObjects } from "@wren/core/objects";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engageRecordOf, exploreRecord, reachKinds } from "../../src/index.js";

// Reach's kinds alone: no own post, no proof shots.
const engageRecord = engageRecordOf({ kinds: reachKinds });

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

describe("marketing.engage: outbound comments in one queue", () => {
  it("holds others' posts with our comment drafted; a post draft waits elsewhere", async () => {
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:9901" },
    ]);
    const [p] = (await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url,
        found_by, account, fit, why, state, draft, queued_at, raw)
      values ('linkedin', 'urn:li:activity:9901', 'Synthetic Author', 'their synthetic post',
        'https://www.linkedin.com/feed/update/urn:li:activity:9901/', 'pasted', 'linkedin@wren',
        100, 'you pasted it', 'queued', 'our synthetic comment', now(), '{}')
      returning id`)) as unknown as { id: number }[];
    const api = serveRecords([engageRecord], pg.db);
    for (const v of engageRecord.views)
      await api.list({ record: engageRecord.id, view: v.id, limit: 50 });
    const waiting = (await api.list({ record: engageRecord.id, view: "waiting", limit: 50 })).rows;
    expect(waiting).toContainEqual(
      expect.objectContaining({
        id: `onpost:${p!.id}`,
        type: "onpost",
        state: "waiting",
        why: "you pasted it",
        draft: "our synthetic comment",
      }),
    );
    // Outreach's: what we write on their ground. Comments to us and DMs live elsewhere.
    expect(waiting.every((r) => ["thread", "onpost"].includes(String(r.type)))).toBe(true);
    const all = (await api.list({ record: engageRecord.id, view: "all", limit: 50 })).rows;
    expect(all.some((r) => r.type === "dm")).toBe(false);
    expect(all.every((r) => r.type !== "comment" || r.state === "answered")).toBe(true);
    const posts = (await api.list({ record: engageRecord.id, view: "posts", limit: 50 })).rows;
    expect(posts.map((r) => r.id)).toContain(`onpost:${p!.id}`);
    expect(await engageRecord.load?.(pg.db, `onpost:${p!.id}`)).toMatchObject({ ask: [] });
  });
});

describe("marketing.engage: Posted and Not live (comment proofs)", () => {
  it("lists sent comments newest first with their proof; Not live keeps hidden and missing", async () => {
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:9921" },
    ]);
    const [p] = (await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url,
        found_by, account, state, comment, commented_at, raw)
      values ('linkedin', 'urn:li:activity:9921', 'Proof Author', 'a synthetic post',
        'https://www.linkedin.com/feed/update/urn:li:activity:9921/', 'pasted', 'linkedin@wren',
        'commented', 'our synthetic words', now(), '{}')
      returning id`)) as unknown as { id: number }[];
    const item = `onpost:${p?.id}`;
    await pg.db.execute(sql`insert into comment_proofs (item, platform, state, url, note, checked_at)
      values (${item}, 'linkedin', 'hidden', 'https://example.com/c', 'not on the public page', now())`);
    const api = serveRecords([engageRecord], pg.db);
    const posted = (await api.list({ record: engageRecord.id, view: "posted", limit: 50 })).rows;
    expect(posted).toContainEqual(
      expect.objectContaining({
        id: item,
        state: "sent",
        proof: "hidden",
        draft: "our synthetic words",
      }),
    );
    const notLive = (await api.list({ record: engageRecord.id, view: "notlive", limit: 50 })).rows;
    expect(notLive.map((r) => r.id)).toContain(item);
    // A sent comment is no longer one to write.
    const waiting = (await api.list({ record: engageRecord.id, view: "waiting", limit: 50 })).rows;
    expect(waiting.map((r) => r.id)).not.toContain(item);
  });
});

describe("marketing.explore: found, not followed or picked yet", () => {
  it("found posts and ranked threads, best fit first; picked and old ones stay out", async () => {
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:9911" },
      ...["t3_syn1", "t3_syn2", "t3_syn3"].map((raw) => ({
        platform: "reddit" as const,
        kind: "post" as const,
        raw,
      })),
    ]);
    const [p] = (await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url,
        found_by, account, fit, why, state, raw)
      values ('linkedin', 'urn:li:activity:9911', 'Found Author', 'a found synthetic post',
        'https://www.linkedin.com/feed/update/urn:li:activity:9911/', 'topic', 'linkedin@wren',
        70, 'synthetic topic', 'found', '{}')
      returning id`)) as unknown as { id: number }[];
    await pg.db.execute(
      sql`insert into reddit_places (subreddit, name, found_by) values ('syntheticsub', 'syntheticsub', 'test')`,
    );
    await pg.db.execute(sql`insert into reddit_threads (id, subreddit, title, body, author, url,
        posted_at, comments, raw, fit, angle, state)
      values ('t3_syn1', 'syntheticsub', 'A ranked thread', 'its words', 'someone',
          'https://www.reddit.com/r/syntheticsub/comments/syn1/', now(), 3, '{}', 9, 'fits', 'ranked'),
        ('t3_syn2', 'syntheticsub', 'An old one', '', 'someone',
          'https://www.reddit.com/r/syntheticsub/comments/syn2/', now() - interval '5 days', 3, '{}',
          9, 'fits', 'ranked'),
        ('t3_syn3', 'syntheticsub', 'Queued', '', 'someone',
          'https://www.reddit.com/r/syntheticsub/comments/syn3/', now(), 3, '{}', 9, 'fits', 'queued')`);
    const api = serveRecords([exploreRecord], pg.db);
    for (const v of exploreRecord.views)
      await api.list({ record: exploreRecord.id, view: v.id, limit: 50 });
    const best = (await api.list({ record: exploreRecord.id, view: "best", limit: 50 })).rows;
    expect(best.map((r) => r.id)).toEqual([`onpost:${p!.id}`, "thread:t3_syn1"]);
    expect(best[1]).toMatchObject({ where: "r/syntheticsub", why: "fits", platform: "reddit" });
    expect(await exploreRecord.load?.(pg.db, "thread:t3_syn1")).toMatchObject({
      body: "A ranked thread\n\nits words",
    });
  });
});
