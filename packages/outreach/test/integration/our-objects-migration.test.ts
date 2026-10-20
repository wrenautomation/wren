/**
 * Migration 0312 (designs/2026-10-20-platform-objects.md, brief O2) on rows shaped as 0311 left
 * them: bare Reddit post ids in a draft, its events and its comments, a thread kept under two
 * spellings, a DM with a message id. The test database already has 0312, so the test takes its
 * keys and indexes off, puts the old check back, clears the objects, inserts the old rows and
 * runs the file's statements. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { normalUrl } from "@wren/core/objects";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAccount } from "../../src/accounts.js";

const FILE = new URL("../../../db/drizzle/0312_our_platform_objects.sql", import.meta.url);
const STATEMENTS = readFileSync(FILE, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const KEYS = [
  ["draft_events", "fk_draft_events_platform_external_id_platform_objects"],
  ["comment_keywords", "fk_comment_keywords_platform_post_platform_objects"],
  ["content_drafts", "fk_content_drafts_platform_published_id_platform_objects"],
  ["comment_threads", "fk_comment_threads_platform_post_platform_objects"],
  ["comments", "fk_comments_platform_ref_platform_objects"],
  ["comments", "fk_comments_platform_post_platform_objects"],
  ["comments", "fk_comments_platform_parent_platform_objects"],
  ["comments", "fk_comments_platform_answer_ref_platform_objects"],
] as const;
const INDEXES = [
  "ix_draft_events_platform_external_id",
  "ix_comment_keywords_platform_post",
  "ix_content_drafts_platform_published_id",
  "ix_comments_platform_post",
  "ix_comments_platform_parent",
  "ix_comments_platform_answer_ref",
];

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  const run = (q: string) => pg.db.execute(sql.raw(q));
  for (const [table, name] of KEYS) await run(`alter table ${table} drop constraint ${name}`);
  for (const name of INDEXES) await run(`drop index ${name}`);
  await run(
    `alter table comments add constraint ck_comments_reddit_ref check (platform <> 'reddit' or ref ~ '^t1_')`,
  );
  await run(`truncate platform_object_refs, platform_objects`);
  await seed();
  for (const statement of STATEMENTS) await run(statement);
});
afterAll(async () => {
  await pg?.stop();
});

const AT = "2026-10-01T15:00:00Z";
/** The drafts: [platform, published id, url]. */
const DRAFTS = [
  ["reddit", "1abc23", "https://www.Reddit.com/r/sub/comments/1abc23/synthetic/?utm_source=x#top"],
  ["reddit", "2def45", null],
  ["reddit", "t3_3ghi67", "https://old.reddit.com/r/sub/comments/3ghi67/other/"],
  ["linkedin", "urn:li:share:11", "https://www.linkedin.com/feed/update/urn:li:share:11/"],
  ["youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=9s"],
  ["youtube", "aaaaaaaaaaa", "https://www.youtube.com/@channel"],
  ["x", "1710000000000000001", "https://x.com/someone/status/1710000000000000001?s=20"],
] as const;

async function seed() {
  const { db } = pg;
  const [idea] = await db.execute<{ id: number }>(
    sql`insert into content_ideas (text, source) values ('synthetic', 'cli') returning id`,
  );
  for (const [platform, id, url] of DRAFTS)
    await db.execute(sql`insert into content_drafts
      (idea_id, platform, text, status, prompt_version, published_at, published_id, url)
      values (${idea?.id}, ${platform}, 'words', 'published', 't', ${AT}, ${id}, ${url})`);
  // The sent steps. A thread or comment reply names a comment, a post names a post, a DM names
  // a message.
  const events = [
    [
      "draft:a",
      "post",
      "reddit",
      "1abc23",
      "https://www.reddit.com/r/sub/comments/1abc23/synthetic/",
    ],
    ["draft:b", "video", "youtube", "dQw4w9WgXcQ", null],
    ["onpost:1", "post_comment", "reddit", "2def45", null],
    ["thread:t3_x", "thread", "reddit", "9zz01", null],
    ["comment:7", "comment", "reddit", "t1_8yy02", null],
    ["dm:5", "dm", "reddit", "msg-55", null],
    ["invite:6", "invite", "linkedin", "inv-66", null],
    ["post:none", "post", "reddit", null, null],
  ] as const;
  for (const [item, kind, platform, ext, url] of events)
    await db.execute(sql`insert into draft_events (item, kind, platform, event, via, external_id, url)
      values (${item}, ${kind}, ${platform}, 'sent', 'person', ${ext}, ${url})`);

  const a = await addAccount(db, { platform: "reddit", account: "reddit@a", now: new Date(AT) });
  // Comments: a root comment and a reply on a bare post, a reply with a bare parent and answer,
  // one the reach reader kept under a fullname, and other platforms' rows.
  const rows = [
    ["reddit", "content", "t1_c1", "1abc23", "1abc23", null, "reader1"],
    ["reddit", "content", "t1_c2", "1abc23", "t1_c1", "a9z01", "reader2"],
    ["reddit", "content", "t1_c3", "1abc23", "c2", null, "reader3"],
    ["reddit", "reach", "t1_c4", "t3_other1", "t3_other1", null, "reader4"],
    ["youtube", "content", "yc1", "dQw4w9WgXcQ", "dQw4w9WgXcQ", null, "reader5"],
    ["youtube", "content", "yc2", "dQw4w9WgXcQ", "yc1", "yr1", "reader6"],
    ["linkedin", "content", "700", "urn:li:share:11", "urn:li:share:11", null, "reader7"],
  ] as const;
  for (const [platform, channel, ref, post, parent, answer, author] of rows)
    await db.execute(sql`insert into comments
      (platform, channel, account_id, ref, post, parent, answer_ref, kind, author, body, url, at, raw)
      values (${platform}, ${channel}, ${channel === "reach" ? a.id : null}, ${ref}, ${post}, ${parent},
        ${answer}, 'post_reply', ${author}, 'body', '', ${AT}, '{}'::jsonb)`);

  // A thread kept under both spellings, and one under the bare id only.
  for (const post of ["1abc23", "t3_1abc23", "4jkl89"])
    await db.execute(sql`insert into comment_threads (platform, post, account_id, post_title, active_at, until)
      values ('reddit', ${post}, ${a.id}, ${post}, ${AT}, ${AT})`);

  await db.execute(sql`insert into comment_keywords (keyword, dm, platform, post, updated_by) values
    ('link', 'dm', 'instagram', '1790001', 't'), ('guide', 'dm', null, null, 't')`);
}

const q = async <T extends Record<string, unknown>>(text: string) => [
  ...(await pg.db.execute<T>(sql.raw(text))),
];

describe("migration 0312 on rows as 0311 left them", () => {
  it("is the file the test read: data first, keys last", () => {
    expect(STATEMENTS.length).toBeGreaterThan(20);
    expect(STATEMENTS[0]).toContain('DROP CONSTRAINT "ck_comments_reddit_ref"');
    expect(STATEMENTS.slice(-14).join("\n")).toContain("ADD CONSTRAINT");
  });

  it("spells every Reddit post as a fullname in drafts, events and comments", async () => {
    expect(
      (
        await q<{ published_id: string }>(
          `select published_id from content_drafts where platform = 'reddit' order by published_id collate "C"`,
        )
      ).map((r) => r.published_id),
    ).toEqual(["t3_1abc23", "t3_2def45", "t3_3ghi67"]);
    expect(
      (
        await q<{ item: string; external_id: string | null }>(
          `select item, external_id from draft_events where platform = 'reddit' order by item collate "C"`,
        )
      ).map((r) => [r.item, r.external_id]),
    ).toEqual([
      ["comment:7", "t1_8yy02"],
      ["dm:5", null],
      ["draft:a", "t3_1abc23"],
      ["onpost:1", "t3_2def45"],
      ["post:none", null],
      ["thread:t3_x", "t1_9zz01"],
    ]);
    expect(
      (
        await q<Record<string, string | null>>(
          `select ref, post, parent, answer_ref from comments where platform = 'reddit' order by ref collate "C"`,
        )
      ).map((r) => [r.ref, r.post, r.parent, r.answer_ref]),
    ).toEqual([
      ["t1_c1", "t3_1abc23", "t3_1abc23", null],
      ["t1_c2", "t3_1abc23", "t1_c1", "t1_a9z01"],
      ["t1_c3", "t3_1abc23", "t1_c2", null],
      ["t1_c4", "t3_other1", "t3_other1", null],
    ]);
  });

  it("keeps one thread for a post kept under two spellings", async () => {
    expect(
      (
        await q<{ post: string; post_title: string }>(
          `select post, post_title from comment_threads order by post collate "C"`,
        )
      ).map((r) => [r.post, r.post_title]),
    ).toEqual([
      ["t3_1abc23", "t3_1abc23"],
      ["t3_4jkl89", "4jkl89"],
    ]);
  });

  it("moves a DM's or invite's message id to meta, off the object column", async () => {
    expect(
      (
        await q<{ item: string; external_id: string | null; id: string | null }>(
          `select item, external_id, meta->>'external_id' as id from draft_events
         where kind in ('dm', 'invite') order by item collate "C"`,
        )
      ).map((r) => [r.item, r.external_id, r.id]),
    ).toEqual([
      ["dm:5", null, "msg-55"],
      ["invite:6", null, "inv-66"],
    ]);
  });

  it("makes one object per distinct ref, with its kind", async () => {
    expect(
      (
        await q<{ platform: string; ref: string; kind: string }>(
          `select platform, ref, kind from platform_objects order by platform collate "C", ref collate "C"`,
        )
      ).map((r) => `${r.platform} ${r.ref} ${r.kind}`),
    ).toEqual([
      "instagram 1790001 post",
      "linkedin 700 comment",
      "linkedin urn:li:share:11 post",
      "reddit t1_8yy02 comment",
      "reddit t1_9zz01 comment",
      "reddit t1_a9z01 comment",
      "reddit t1_c1 comment",
      "reddit t1_c2 comment",
      "reddit t1_c3 comment",
      "reddit t1_c4 comment",
      "reddit t3_1abc23 post",
      "reddit t3_2def45 post",
      "reddit t3_3ghi67 post",
      "reddit t3_4jkl89 post",
      "reddit t3_other1 post",
      "x 1710000000000000001 post",
      "youtube aaaaaaaaaaa post",
      "youtube dQw4w9WgXcQ post",
      "youtube yc1 comment",
      "youtube yc2 comment",
      "youtube yr1 comment",
    ]);
  });

  it("gives a comment its post, parent and author", async () => {
    const [c] = await q<{ post: string; parent: string; author: string }>(
      `select post, parent, author from platform_objects where platform = 'reddit' and ref = 't1_c2'`,
    );
    expect(c).toEqual({ post: "t3_1abc23", parent: "t1_c1", author: "reader2" });
    const [answer] = await q<{ post: string; parent: string }>(
      `select post, parent from platform_objects where platform = 'youtube' and ref = 'yr1'`,
    );
    expect(answer).toEqual({ post: "dQw4w9WgXcQ", parent: "yc2" });
  });

  it("knows each Reddit object by its bare id, and a draft by its page", async () => {
    const aliases = await q<{ platform: string; alias: string; ref: string }>(
      `select platform, alias, ref from platform_object_refs order by platform collate "C", alias collate "C"`,
    );
    const bare = aliases.filter((a) => !a.alias.startsWith("https://"));
    expect(bare.map((a) => [a.alias, a.ref])).toEqual([
      ["1abc23", "t3_1abc23"],
      ["2def45", "t3_2def45"],
      ["3ghi67", "t3_3ghi67"],
      ["4jkl89", "t3_4jkl89"],
      ["8yy02", "t1_8yy02"],
      ["9zz01", "t1_9zz01"],
      ["a9z01", "t1_a9z01"],
      ["c1", "t1_c1"],
      ["c2", "t1_c2"],
      ["c3", "t1_c3"],
      ["c4", "t1_c4"],
      ["other1", "t3_other1"],
    ]);
    // The pages: the same spelling `normalUrl` gives, and none for a page that is no post.
    const pages = aliases.filter((a) => a.alias.startsWith("https://"));
    expect(pages.map((a) => [a.alias, a.ref])).toEqual(
      [
        [DRAFTS[0][2], "t3_1abc23"],
        [DRAFTS[2][2], "t3_3ghi67"],
        [DRAFTS[3][2], "urn:li:share:11"],
        [DRAFTS[6][2], "1710000000000000001"],
        [DRAFTS[4][2], "dQw4w9WgXcQ"],
      ]
        .map(([url, ref]) => [normalUrl(url as string), ref])
        .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)),
    );
  });

  it("puts a key on each role column", async () => {
    const keys = await q<{ conname: string; confupdtype: string; confdeltype: string }>(
      `select conname, confupdtype, confdeltype from pg_constraint
       where conname like 'fk\\_%\\_platform\\_objects' order by conname`,
    );
    const names = keys.map((k) => k.conname);
    for (const [, name] of KEYS) expect(names).toContain(name);
    for (const k of keys.filter((k) => KEYS.some(([, n]) => n === k.conname))) {
      expect(k.confupdtype).toBe("c");
      expect(k.confdeltype).toBe("a");
    }
    const indexes = await q<{ indexname: string }>(
      `select indexname from pg_indexes where indexname = any(array['${INDEXES.join("','")}'])`,
    );
    expect(indexes.map((i) => i.indexname).sort()).toEqual([...INDEXES].sort());
    // The old check is gone: a Reddit comment may hold any ref its object holds.
    expect(await q(`select 1 from pg_constraint where conname = 'ck_comments_reddit_ref'`)).toEqual(
      [],
    );
  });

  it("holds after the run: a rename of an object carries every role row with it", async () => {
    await pg.db.execute(
      sql`update platform_objects set ref = 't3_1abc99' where platform = 'reddit' and ref = 't3_1abc23'`,
    );
    const [d] = await q<{ published_id: string }>(
      `select published_id from content_drafts where published_id like 't3_1abc%'`,
    );
    expect(d?.published_id).toBe("t3_1abc99");
    const [c] = await q<{ n: string }>(
      `select count(*)::text as n from comments where post = 't3_1abc99'`,
    );
    expect(c?.n).toBe("3");
  });
});
