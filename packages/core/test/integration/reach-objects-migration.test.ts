/**
 * The migration that makes every post we may answer, and every Facebook group, a platform object
 * (designs/briefs/2026-10-20-objects-3-reach.md). The test database is already migrated, so each
 * case puts the tables back as they were before the migration (no keys, no `platform` column),
 * fills them with old-shaped rows, runs the migration file again, and checks the objects, the
 * aliases and the keys. Synthetic rows only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DIR = new URL("../../../db/drizzle/", import.meta.url);
const NAME = readdirSync(DIR).find((f) => /^\d{4}_reach_platform_objects\.sql$/.test(f));
const STATEMENTS = (NAME ? readFileSync(new URL(NAME, DIR), "utf8") : "")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);
/** The keys the migration adds: [table, constraint]. */
const KEYS = STATEMENTS.flatMap((s) => {
  const m = /^ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)" FOREIGN KEY/.exec(s);
  return m ? [[m[1] as string, m[2] as string] as const] : [];
});

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];

/** The tables as they were before the migration, empty. */
async function reset(): Promise<void> {
  for (const [table, key] of KEYS)
    await pg.db.execute(sql.raw(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${key}"`));
  // The column takes its check and its two indexes with it.
  await run(sql`alter table reddit_threads drop column if exists platform`);
  await run(sql`truncate platform_object_refs, platform_objects, reddit_threads, reach_posts,
    social_posts, social_groups restart identity cascade`);
  await run(sql`insert into reddit_places (subreddit, name, found_by) values ('example', 'Example', 'named')
    on conflict do nothing`);
}

/** Run the migration file, a statement at a time, as the migrator does. */
async function migrate(): Promise<void> {
  for (const s of STATEMENTS) await pg.db.execute(sql.raw(s));
}

/** The migration's keys that exist, each on platform_objects. */
const keysHeld = () =>
  run(sql`select conname from pg_constraint where contype = 'f'
    and confrelid = 'platform_objects'::regclass
    and conname in (${sql.join(
      KEYS.map(([, k]) => sql`${k}`),
      sql`, `,
    )})`);

const objects = async () =>
  Object.fromEntries(
    (
      await run(sql`select platform || ':' || ref as k, kind, url, post, parent, author, at
      from platform_objects order by 1`)
    ).map((r) => [r.k, r]),
  );
const aliases = async () =>
  (await run(sql`select platform, alias, ref from platform_object_refs order by 1, 2`)).map(
    (r) => `${r.platform} ${r.alias} -> ${r.ref}`,
  );

describe("the reach objects migration", () => {
  it("is in the journal and adds one key for each role column", () => {
    expect(NAME).toBeDefined();
    expect(KEYS.map(([t]) => t).sort()).toEqual([
      "reach_posts",
      "reddit_threads",
      "reddit_threads",
      "reddit_threads",
      "social_groups",
      "social_posts",
    ]);
    // The data steps come before the first key.
    const firstKey = STATEMENTS.findIndex((s) => s.includes("ADD CONSTRAINT"));
    const lastInsert = STATEMENTS.findLastIndex((s) => /INSERT INTO "platform_object/.test(s));
    expect(lastInsert).toBeGreaterThan(-1);
    expect(lastInsert).toBeLessThan(firstKey);
  });

  it("runs on empty tables, as a new client's database has them", async () => {
    await reset();
    await migrate();
    expect(await run(sql`select 1 from platform_objects`)).toEqual([]);
    expect(await keysHeld()).toHaveLength(KEYS.length);
  });

  it("makes an object for every ref the role columns hold, then holds each to it", async () => {
    await reset();
    // A comment an earlier migration made keeps its row.
    await run(sql`insert into platform_objects (platform, ref, kind, post, parent, author)
      values ('reddit', 't1_ours1', 'comment', 't3_other', 't3_other', 'kept-author')`);
    await run(sql`insert into reddit_threads
      (id, subreddit, title, body, author, url, posted_at, comments, raw, target, answer_ref, answered_at)
      values
      ('t3_aaa', 'example', 't', 'b', 'alice_x', 'https://www.reddit.com/r/example/comments/aaa/x/',
        '2026-10-01T10:00:00Z', 0, '{}', 't1_c1', 't1_ours1', '2026-10-02T10:00:00Z'),
      ('t3_bbb', 'example', 't', 'b', '[deleted]', 'https://www.reddit.com/r/example/comments/bbb/x/',
        '2026-10-01T11:00:00Z', 0, '{}', 't3_bbb', null, null),
      ('t3_ccc', 'example', 't', 'b', '', 'https://www.reddit.com/r/example/comments/ccc/x/',
        '2026-10-01T12:00:00Z', 0, '{}', 't1_c1', 't1_ours2', '2026-10-02T11:00:00Z')`);
    await run(sql`insert into reach_posts (platform, ref, author, handle, text, url, found_by, account, raw, posted_at)
      values
      ('linkedin', 'urn:li:activity:111', 'Pat One', 'pat-one', 'a',
        'https://www.linkedin.com/feed/update/urn:li:activity:111/', 'topic', 'li@test', '{}', '2026-10-01T09:00:00Z'),
      ('linkedin', 'urn:li:share:222', 'Pat Two', null, 'b',
        'https://www.linkedin.com/feed/update/urn:li:activity:999/', 'topic', 'li@test', '{}', null),
      ('x', '333', 'Sam', '@sam', 'c', 'https://X.com/sam/status/333?s=20', 'topic', 'x@test', '{}', null),
      ('instagram', 'AAA111', 'Kim', null, 'd', 'https://www.instagram.com/p/AAA111/', 'topic', 'ig@test', '{}', null)`);
    await run(sql`insert into social_groups (network, ref, niche, keyword, url, hit)
      values ('facebook', '123456789', 'n', 'k', 'https://www.facebook.com/groups/123456789/', '{}')`);
    await run(sql`insert into social_posts (network, group_id, ref, url, raw)
      values ('facebook', (select id from social_groups limit 1), '5550001',
        'https://www.facebook.com/groups/123456789/posts/5550001/', '{}')`);

    await migrate();

    const o = await objects();
    expect(Object.keys(o)).toEqual([
      "facebook:123456789",
      "facebook:5550001",
      "instagram:AAA111",
      "linkedin:urn:li:activity:111",
      "linkedin:urn:li:share:222",
      "reddit:t1_c1",
      "reddit:t1_ours1",
      "reddit:t1_ours2",
      "reddit:t3_aaa",
      "reddit:t3_bbb",
      "reddit:t3_ccc",
      "x:333",
    ]);
    // A thread is a post, with its address, its author (a deleted or empty one is none) and its time.
    expect(o["reddit:t3_aaa"]).toMatchObject({
      kind: "post",
      url: "https://www.reddit.com/r/example/comments/aaa/x/",
      author: "alice_x",
      post: null,
    });
    expect(o["reddit:t3_bbb"]).toMatchObject({ kind: "post", author: null });
    expect(o["reddit:t3_ccc"]).toMatchObject({ kind: "post", author: null });
    // The comment we answer sits under the first thread that names it.
    expect(o["reddit:t1_c1"]).toMatchObject({ kind: "comment", post: "t3_aaa", parent: "t3_aaa" });
    // Our reply sits under what it answered; the one an earlier migration made is not touched.
    expect(o["reddit:t1_ours2"]).toMatchObject({
      kind: "comment",
      post: "t3_ccc",
      parent: "t1_c1",
    });
    expect(o["reddit:t1_ours1"]).toMatchObject({
      kind: "comment",
      post: "t3_other",
      author: "kept-author",
    });
    // The handle is the author when there is one, else the name.
    expect(o["x:333"]).toMatchObject({ kind: "post", author: "@sam" });
    expect(o["linkedin:urn:li:share:222"]).toMatchObject({ kind: "post", author: "Pat Two" });
    expect(o["facebook:123456789"]).toMatchObject({ kind: "group" });
    expect(o["facebook:5550001"]).toMatchObject({ kind: "post" });

    // Aliases spell each address the link way; a LinkedIn address that names a different
    // object than the ref (a share seen as an activity) is no alias.
    expect(await aliases()).toEqual([
      "facebook https://facebook.com/groups/123456789 -> 123456789",
      "facebook https://facebook.com/groups/123456789/posts/5550001 -> 5550001",
      "instagram https://instagram.com/p/AAA111 -> AAA111",
      "linkedin https://linkedin.com/feed/update/urn:li:activity:111 -> urn:li:activity:111",
      "reddit https://reddit.com/r/example/comments/aaa/x -> t3_aaa",
      "reddit https://reddit.com/r/example/comments/bbb/x -> t3_bbb",
      "reddit https://reddit.com/r/example/comments/ccc/x -> t3_ccc",
      "x https://x.com/sam/status/333 -> 333",
    ]);

    // The keys hold now, and a row naming nothing still fails.
    expect(await keysHeld()).toHaveLength(KEYS.length);
    await expect(
      run(sql`insert into reach_posts (platform, ref, author, text, url, found_by, account, raw)
        values ('linkedin', 'urn:li:share:404', 'a', 'b', 'https://example.com', 'topic', 'li@test', '{}')`),
    ).rejects.toMatchObject({
      cause: { constraint_name: "fk_reach_posts_platform_ref_platform_objects" },
    });
    // The role column on reddit_threads reads reddit for every old row.
    expect(
      (await run(sql`select distinct platform from reddit_threads`)).map((r) => r.platform),
    ).toEqual(["reddit"]);
  });
});
