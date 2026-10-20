/** Platform objects: one write path, one lookup, one link. Synthetic rows only. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  findObject,
  ITEM_HOMES,
  LinkRefusedError,
  linkRefs,
  OBJECT_ROLES,
  resolveObject,
  resolveObjects,
  roleRowsOf,
} from "../../src/objects/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const T = (day: number) => new Date(Date.UTC(2026, 9, day, 12));

beforeEach(async () => {
  await truncate(pg.db, [
    "platform_object_refs",
    "platform_objects",
    "comments",
    "comment_proofs",
    "send_attempts",
    "comment_threads",
    "comment_keywords",
    "reach_posts",
    "reach_passes",
    "reddit_threads",
    "reddit_places",
    "reach_accounts",
    "draft_events",
    "draft_accounts",
    "touches",
    "social_handles",
  ]);
});

/** The parent rows that a reddit thread and a comment thread need. */
async function reddit(): Promise<void> {
  await run(sql`insert into reddit_places (subreddit, name, found_by) values ('example', 'Example', 'named')
    on conflict do nothing`);
}
async function account(platform: string): Promise<string> {
  const [r] = await run(sql`insert into reach_accounts (platform, account, started_on)
    values (${platform}, ${`${platform}@test`}, current_date) returning id`);
  return String(r?.id);
}

const objects = () => run(sql`select * from platform_objects order by platform, ref`);
const aliases = () =>
  run(sql`select platform, alias, ref from platform_object_refs order by platform, alias`);

async function comment(o: {
  platform: string;
  ref: string;
  post: string;
  parent?: string;
  state?: string;
  answer?: string;
}): Promise<number> {
  const [r] = await run(sql`
    insert into comments (platform, channel, ref, post, parent, kind, author, body, url, at, raw, state, answer, answer_ref, answered_at)
    values (${o.platform}, 'content', ${o.ref}, ${o.post}, ${o.parent ?? o.post}, 'post_reply', 'example-author', 'a comment',
      'https://example.com/c', ${T(2).toISOString()}, '{}', ${o.state ?? "new"}, ${o.answer ?? null},
      ${o.answer ? `${o.ref}-ours` : null}, ${o.answer ? T(3).toISOString() : null})
    returning id`);
  return Number(r?.id);
}

async function reachPost(platform: string, ref: string): Promise<number> {
  const [r] = await run(sql`
    insert into reach_posts (platform, ref, author, text, url, found_by, account, raw)
    values (${platform}, ${ref}, 'Example Author', 'a post', 'https://example.com/p', 'topic: test', ${`${platform}@test`}, '{}')
    returning id`);
  return Number(r?.id);
}

async function proof(item: string, platform: string) {
  await run(sql`insert into comment_proofs (item, platform) values (${item}, ${platform})`);
}
async function attempt(item: string, platform: string) {
  await run(sql`insert into send_attempts (item, state, platform, words, target, started_at, updated_at)
    values (${item}, 'sent', ${platform}, 'our words', 'target-1', ${T(3).toISOString()}, ${T(3).toISOString()})`);
}
async function touch(ref: string, answers: number | null = null): Promise<number> {
  await run(sql`insert into social_handles (platform, handle) values ('linkedin', 'example-handle')
    on conflict do nothing`);
  const [r] = await run(sql`
    insert into touches (handle_id, kind, direction, at, source, ref, answers)
    values ((select id from social_handles where handle = 'example-handle'), 'comment', 'ours',
      ${T(3).toISOString()}, 'comments', ${ref}, ${answers})
    returning id`);
  return Number(r?.id);
}
const items = async (table: string, col = "item") =>
  (await run(sql`select ${sql.identifier(col)} i from ${sql.identifier(table)}`))
    .map((r) => r.i as string)
    .sort();

describe("resolveObject", () => {
  it("makes one row, moves last_seen, keeps first_seen, and keeps the raw spelling and URL", async () => {
    const url = "https://www.reddit.com/r/example/comments/p1/a_title/abc/?context=3";
    const ref = await resolveObject(pg.db, {
      platform: "reddit",
      kind: "comment",
      raw: "abc",
      url,
      post: "p1",
      parent: "t3_p1",
    });
    expect(ref).toBe("t1_abc");
    const [first] = await objects();
    expect(first).toMatchObject({
      platform: "reddit",
      ref: "t1_abc",
      kind: "comment",
      post: "t3_p1",
      parent: "t3_p1",
      url,
      author: null,
    });
    expect((await aliases()).map((a) => a.alias)).toEqual([
      "abc",
      "https://reddit.com/r/example/comments/p1/a_title/abc",
    ]);

    const again = await resolveObject(pg.db, {
      platform: "reddit",
      kind: "comment",
      raw: "t1_abc",
      author: "example-author",
      at: T(5),
    });
    expect(again).toBe("t1_abc");
    const rows = await objects();
    expect(rows).toHaveLength(1);
    const [second] = rows;
    expect(second?.first_seen).toEqual(first?.first_seen);
    expect(new Date(second?.last_seen as string).getTime()).toBeGreaterThan(
      new Date(first?.last_seen as string).getTime(),
    );
    // It fills what was empty and keeps what was there.
    expect(second).toMatchObject({ author: "example-author", url, post: "t3_p1" });
    expect(new Date(second?.at as string).getTime()).toBe(T(5).getTime());
  });

  it("answers from a known alias before it reads the spelling", async () => {
    const shot = "https://www.instagram.com/p/Cshort1/";
    expect(
      await resolveObject(pg.db, {
        platform: "instagram",
        kind: "post",
        raw: "1789000001",
        url: shot,
      }),
    ).toBe("1789000001");
    // The shortcode URL carries no id: the rules refuse it, the alias knows it.
    expect(
      await resolveObject(pg.db, {
        platform: "instagram",
        kind: "post",
        raw: "https://instagram.com/p/Cshort1/?igsh=zz",
      }),
    ).toBe("1789000001");
    expect(
      await resolveObject(pg.db, {
        platform: "instagram",
        kind: "post",
        raw: "other",
        url: `${shot}?x=1`,
      }),
    ).toBe("1789000001");
    expect(await objects()).toHaveLength(1);
    await expect(
      resolveObject(pg.db, {
        platform: "instagram",
        kind: "post",
        raw: "https://www.instagram.com/p/Cnew1/",
      }),
    ).rejects.toThrow(/does not carry/);
    expect(await objects()).toHaveLength(1);
  });

  it("does not keep a comment's post URL as the comment's alias", async () => {
    await resolveObject(pg.db, {
      platform: "linkedin",
      kind: "comment",
      raw: "7000000000000000009",
      url: "https://www.linkedin.com/posts/example-person_words-activity-7000000000000000001-aB1c",
      post: "urn:li:activity:7000000000000000001",
    });
    expect(await aliases()).toEqual([]);
  });

  it("is safe when 20 callers resolve one object at once", async () => {
    const refs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        resolveObject(pg.db, {
          platform: "linkedin",
          kind: "post",
          raw: "urn:li:activity:700",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:700/",
          author: i % 2 ? "example-author" : null,
        }),
      ),
    );
    expect(new Set(refs)).toEqual(new Set(["urn:li:activity:700"]));
    expect(await objects()).toHaveLength(1);
    expect(await aliases()).toHaveLength(1);
  });

  it("works inside the caller's transaction and rolls back with it", async () => {
    await expect(
      pg.db.transaction(async (tx) => {
        await resolveObject(tx, { platform: "x", kind: "post", raw: "1700000000000000001" });
        throw new Error("undo");
      }),
    ).rejects.toThrow("undo");
    expect(await objects()).toHaveLength(0);
  });
});

describe("resolveObjects", () => {
  it("resolves 2,000 mixed new and known items in one call", async () => {
    const known = Array.from({ length: 600 }, (_, i) => ({
      platform: "x" as const,
      kind: "post" as const,
      raw: `17000${i}`,
    }));
    await resolveObjects(pg.db, known);
    const mixed = [
      ...known,
      ...Array.from({ length: 700 }, (_, i) => ({
        platform: "x" as const,
        kind: "post" as const,
        raw: `18000${i}`,
        url: `https://x.com/example/status/18000${i}`,
      })),
      ...Array.from({ length: 700 }, (_, i) => ({
        platform: "reddit" as const,
        kind: "comment" as const,
        raw: `c${i.toString(36)}`,
        post: "p1",
        parent: i % 2 ? "p1" : "t1_c0",
      })),
    ];
    expect(mixed).toHaveLength(2000);
    const out = await resolveObjects(pg.db, mixed);
    expect(out.size).toBe(2000);
    expect(out.get("170005")).toBe("170005");
    expect(out.get("c1z")).toBe("t1_c1z");
    const [n] = await run(sql`select count(*)::int n from platform_objects`);
    expect(n?.n).toBe(2000);
    const [kids] = await run(
      sql`select count(*)::int n from platform_objects where parent = 't3_p1' and post = 't3_p1'`,
    );
    expect(kids?.n).toBe(350);
  });

  it("refuses a batch with one unreadable spelling and writes nothing", async () => {
    await expect(
      resolveObjects(pg.db, [
        { platform: "x", kind: "post", raw: "1" },
        { platform: "linkedin", kind: "post", raw: "300" },
      ]),
    ).rejects.toThrow(/URN/);
    expect(await objects()).toHaveLength(0);
  });
});

describe("findObject", () => {
  it("finds by ref, alias, URL and any spelling the rules read", async () => {
    await resolveObject(pg.db, {
      platform: "reddit",
      kind: "post",
      raw: "p1",
      url: "https://www.reddit.com/r/example/comments/p1/a_title/",
    });
    for (const s of [
      "t3_p1",
      "p1",
      "https://old.reddit.com/r/example/comments/p1/other_slug/",
      "https://reddit.com/r/example/comments/p1/a_title",
    ])
      expect((await findObject(pg.db, s))?.ref).toBe("t3_p1");
    expect((await findObject(pg.db, "p1", "reddit"))?.aliases).toEqual([
      "https://reddit.com/r/example/comments/p1/a_title",
      "p1",
    ]);
    expect(await findObject(pg.db, "p1", "x")).toBeNull();
    expect(await findObject(pg.db, "p2", "reddit")).toBeNull();
    expect(await findObject(pg.db, "  ")).toBeNull();
  });
});

describe("linkRefs", () => {
  it("renames the only object to the API URN and carries its aliases", async () => {
    await resolveObject(pg.db, {
      platform: "linkedin",
      kind: "post",
      raw: "urn:li:activity:11",
      url: "https://www.linkedin.com/posts/example-person_words-activity-11-aB1c",
      author: "example-author",
    });
    const rp = await reachPost("linkedin", "urn:li:activity:11");
    const out = await linkRefs(pg.db, "linkedin", "urn:li:activity:11", "urn:li:ugcPost:22", {
      by: "test",
    });
    expect(out).toMatchObject({ kept: "urn:li:ugcPost:22", dropped: "urn:li:activity:11" });
    expect(out.moves).toEqual([{ table: "reach_posts", column: "ref", moved: 1, folded: 0 }]);
    const rows = await objects();
    expect(rows.map((r) => r.ref)).toEqual(["urn:li:ugcPost:22"]);
    expect(rows[0]).toMatchObject({ kind: "post", author: "example-author" });
    expect((await aliases()).map((a) => [a.alias, a.ref])).toEqual([
      ["https://linkedin.com/posts/example-person_words-activity-11-aB1c", "urn:li:ugcPost:22"],
      ["urn:li:activity:11", "urn:li:ugcPost:22"],
    ]);
    expect((await run(sql`select ref from reach_posts where id = ${rp}`))[0]?.ref).toBe(
      "urn:li:ugcPost:22",
    );
    // The old spelling now resolves to the kept object and makes no second one.
    expect(
      await resolveObject(pg.db, { platform: "linkedin", kind: "post", raw: "urn:li:activity:11" }),
    ).toBe("urn:li:ugcPost:22");
    expect(await objects()).toHaveLength(1);
    expect((await findObject(pg.db, "urn:li:activity:11"))?.ref).toBe("urn:li:ugcPost:22");
  });

  it("keeps the first spelling off LinkedIn and fills its gaps from the other", async () => {
    await resolveObject(pg.db, { platform: "x", kind: "post", raw: "100", author: "first-author" });
    await resolveObject(pg.db, {
      platform: "x",
      kind: "post",
      raw: "200",
      url: "https://x.com/example/status/200",
      author: "second-author",
      at: T(4),
    });
    const out = await linkRefs(pg.db, "x", "100", "200", { by: "test" });
    expect(out).toMatchObject({ kept: "100", dropped: "200" });
    const rows = await objects();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ref: "100",
      author: "first-author",
      url: "https://x.com/example/status/200",
    });
    expect((await aliases()).map((a) => a.alias)).toEqual([
      "200",
      "https://x.com/example/status/200",
    ]);
  });

  it("folds two comment rows: the kept row wins, answer, proof, attempt and touches follow", async () => {
    const kept = await comment({
      platform: "linkedin",
      ref: "7000000000000000001",
      post: "urn:li:share:5",
    });
    const dropped = await comment({
      platform: "linkedin",
      ref: "7000000000000000002",
      post: "urn:li:share:5",
      state: "answered",
      answer: "our answer",
    });
    await proof(`comment:${dropped}`, "linkedin");
    await attempt(`comment:${dropped}`, "linkedin");
    await run(
      sql`insert into draft_accounts (item, account) values (${`comment:${dropped}`}, 'linkedin@test')`,
    );
    await run(
      sql`insert into draft_events (item, kind, event, via) values (${`comment:${dropped}`}, 'comment', 'sent', 'person')`,
    );
    const theirs = await touch(`c:${dropped}`);
    const ours = await touch(`ca:${dropped}`);
    const reply = await touch("reply:1", ours);

    const out = await linkRefs(pg.db, "linkedin", "7000000000000000001", "7000000000000000002", {
      by: "test",
    });
    expect(out.moves).toContainEqual({ table: "comments", column: "ref", moved: 0, folded: 1 });
    const rows = await run(
      sql`select id, ref, state, answer, answer_ref from comments order by id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: kept,
      ref: "7000000000000000001",
      state: "answered",
      answer: "our answer",
      answer_ref: "7000000000000000002-ours",
    });
    expect(await items("comment_proofs")).toEqual([`comment:${kept}`]);
    expect(await items("send_attempts")).toEqual([`comment:${kept}`]);
    expect(await items("draft_accounts")).toEqual([`comment:${kept}`]);
    expect(await items("draft_events")).toEqual([`comment:${kept}`]);
    // The dropped row's touches move to the kept row's refs; their replies follow.
    expect(await items("touches", "ref")).toEqual([`c:${kept}`, `ca:${kept}`, "reply:1"].sort());
    const [ca] = await run(sql`select id from touches where ref = ${`ca:${kept}`}`);
    expect(ca?.id).toBe(ours);
    expect((await run(sql`select answers from touches where id = ${reply}`))[0]?.answers).toBe(
      ours,
    );
    expect(theirs).toBeGreaterThan(0);
  });

  it("keeps the kept comment's own proof when both rows have one", async () => {
    const kept = await comment({
      platform: "linkedin",
      ref: "7000000000000000011",
      post: "urn:li:share:5",
    });
    const dropped = await comment({
      platform: "linkedin",
      ref: "7000000000000000012",
      post: "urn:li:share:5",
    });
    await proof(`comment:${kept}`, "linkedin");
    await proof(`comment:${dropped}`, "linkedin");
    await touch(`c:${kept}`);
    await touch(`c:${dropped}`);
    await linkRefs(pg.db, "linkedin", "7000000000000000011", "7000000000000000012", { by: "test" });
    expect(await items("comment_proofs")).toEqual([`comment:${kept}`]);
    expect(await items("touches", "ref")).toEqual([`c:${kept}`]);
  });

  it("folds a reach post twin: the kept row wins, its items follow", async () => {
    const act = await reachPost("linkedin", "urn:li:activity:31");
    const ugc = await reachPost("linkedin", "urn:li:ugcPost:32");
    await proof(`onpost:${act}`, "linkedin");
    await attempt(`onpost:${act}`, "linkedin");
    await run(
      sql`insert into draft_events (item, kind, event, via) values (${`onpost:${act}`}, 'post_comment', 'sent', 'person')`,
    );
    await touch(`rp:${act}`);
    await touch(`rp:${act}:like`);
    const out = await linkRefs(pg.db, "linkedin", "urn:li:activity:31", "urn:li:ugcPost:32", {
      by: "test",
    });
    expect(out.kept).toBe("urn:li:ugcPost:32");
    expect(out.moves).toEqual([{ table: "reach_posts", column: "ref", moved: 0, folded: 1 }]);
    expect((await run(sql`select id from reach_posts`)).map((r) => r.id)).toEqual([ugc]);
    expect(await items("comment_proofs")).toEqual([`onpost:${ugc}`]);
    expect(await items("send_attempts")).toEqual([`onpost:${ugc}`]);
    expect(await items("draft_events")).toEqual([`onpost:${ugc}`]);
    expect(await items("touches", "ref")).toEqual([`rp:${ugc}`, `rp:${ugc}:like`]);
  });

  it("drops a thread or keyword row that repeats the kept row, and moves the rest", async () => {
    const acct = await account("linkedin");
    for (const post of ["urn:li:share:41", "urn:li:share:42"])
      await run(sql`insert into comment_threads (platform, post, account_id, active_at, until)
        values ('linkedin', ${post}, ${acct}, ${T(2).toISOString()}, ${T(9).toISOString()})`);
    await run(sql`insert into comment_keywords (keyword, platform, post, dm) values
      ('go', 'linkedin', 'urn:li:share:41', 'dm'), ('go', 'linkedin', 'urn:li:share:42', 'dm'),
      ('more', 'linkedin', 'urn:li:share:42', 'dm')`);
    const out = await linkRefs(pg.db, "linkedin", "urn:li:share:41", "urn:li:share:42", {
      by: "test",
    });
    expect(out.moves).toEqual([
      { table: "comment_threads", column: "post", moved: 0, folded: 1 },
      { table: "comment_keywords", column: "post", moved: 1, folded: 1 },
    ]);
    expect((await run(sql`select post from comment_threads`)).map((r) => r.post)).toEqual([
      "urn:li:share:41",
    ]);
    expect(
      (await run(sql`select keyword, post from comment_keywords order by keyword`)).map((r) => [
        r.keyword,
        r.post,
      ]),
    ).toEqual([
      ["go", "urn:li:share:41"],
      ["more", "urn:li:share:41"],
    ]);
  });

  it("moves the columns that only name an object", async () => {
    await reddit();
    await run(sql`insert into reddit_threads (id, subreddit, title, body, author, url, posted_at, comments, raw, target, answer_ref)
      values ('t3_old', 'example', 't', 'b', 'example-author', 'https://example.com', ${T(2).toISOString()}, 0, '{}', 't3_old', 't1_ours')`);
    await comment({ platform: "reddit", ref: "t1_zz", post: "t3_old", parent: "t3_old" });
    await comment({ platform: "reddit", ref: "t1_yy", post: "t3_old", parent: "t1_zz" });
    await run(sql`insert into platform_objects (platform, ref, kind, post) values
      ('reddit', 't3_old', 'post', null), ('reddit', 't1_zz', 'comment', 't3_old')`);
    const out = await linkRefs(pg.db, "reddit", "t3_new", "t3_old", { by: "test" });
    expect(out.kept).toBe("t3_new");
    expect(out.moves.map((m) => `${m.table}.${m.column}:${m.moved}`)).toEqual([
      "comments.post:2",
      "comments.parent:1",
      "reddit_threads.id:1",
      "reddit_threads.target:1",
    ]);
    expect((await run(sql`select id, target from reddit_threads`))[0]).toEqual({
      id: "t3_new",
      target: "t3_new",
    });
    expect(
      (await run(sql`select post, parent from comments order by ref`)).map((r) => [
        r.post,
        r.parent,
      ]),
    ).toEqual([
      ["t3_new", "t1_zz"],
      ["t3_new", "t3_new"],
    ]);
    // Objects that name the dropped post now name the kept one.
    expect((await run(sql`select post from platform_objects where ref = 't1_zz'`))[0]?.post).toBe(
      "t3_new",
    );
    expect((await objects()).map((r) => r.ref)).toEqual(["t1_zz", "t3_new"]);
  });

  it("refuses a table that keeps one row per object, names both rows and changes nothing", async () => {
    await reddit();
    for (const id of ["t3_aaa", "t3_bbb"])
      await run(sql`insert into reddit_threads (id, subreddit, title, body, author, url, posted_at, comments, raw)
        values (${id}, 'example', 't', 'b', 'example-author', 'https://example.com', ${T(2).toISOString()}, 0, '{}')`);
    await comment({ platform: "reddit", ref: "t1_zz", post: "t3_bbb", parent: "t3_bbb" });
    await resolveObject(pg.db, { platform: "reddit", kind: "post", raw: "t3_aaa" });
    const before = await objects();
    const err = await linkRefs(pg.db, "reddit", "t3_aaa", "t3_bbb", { by: "test" }).catch((e) => e);
    expect(err).toBeInstanceOf(LinkRefusedError);
    expect(err.message).toContain("reddit_threads");
    expect(err.message).toContain("t3_aaa");
    expect(err.message).toContain("t3_bbb");
    expect((await run(sql`select id from reddit_threads order by id`)).map((r) => r.id)).toEqual([
      "t3_aaa",
      "t3_bbb",
    ]);
    expect((await run(sql`select post, parent from comments`))[0]).toEqual({
      post: "t3_bbb",
      parent: "t3_bbb",
    });
    expect(await objects()).toEqual(before);
    expect(await aliases()).toEqual([]);
  });

  it("refuses two spellings of different kinds", async () => {
    await expect(linkRefs(pg.db, "reddit", "t3_aaa", "t1_bbb", { by: "test" })).rejects.toThrow(
      LinkRefusedError,
    );
  });

  it("is a no-op for one spelling, an alias of the kept ref, or the kept ref itself", async () => {
    await resolveObject(pg.db, { platform: "reddit", kind: "post", raw: "p1" });
    const before = { objects: await objects(), aliases: await aliases() };
    for (const [a, b] of [
      ["t3_p1", "t3_p1"],
      ["p1", "t3_p1"],
      ["t3_p1", "p1"],
    ] as const) {
      const out = await linkRefs(pg.db, "reddit", a, b, { by: "test" });
      expect(out).toEqual({ platform: "reddit", kept: "t3_p1", dropped: null, moves: [] });
    }
    expect({ objects: await objects(), aliases: await aliases() }).toEqual(before);
  });

  it("makes the kept object when neither spelling has one", async () => {
    const out = await linkRefs(pg.db, "linkedin", "urn:li:activity:51", "urn:li:share:52", {
      by: "test",
    });
    expect(out.kept).toBe("urn:li:share:52");
    expect((await objects()).map((r) => [r.ref, r.kind])).toEqual([["urn:li:share:52", "post"]]);
    expect((await aliases()).map((a) => [a.alias, a.ref])).toEqual([
      ["urn:li:activity:51", "urn:li:share:52"],
    ]);
  });

  it("records the actor on the alias it writes", async () => {
    await linkRefs(pg.db, "linkedin", "urn:li:activity:61", "urn:li:share:62", {
      by: "someone@example.com",
    });
    const events = await run(sql`select actor from audit_events
      where table_name = 'platform_object_refs' and op = 'insert' order by id desc limit 1`);
    expect(events.map((e) => e.actor)).toEqual(["someone@example.com"]);
  });
});

describe("roles", () => {
  it("lists every foreign key that points at platform_objects", async () => {
    const fks = await run(sql`
      select c.conrelid::regclass::text tbl, a.attname col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'platform_objects'::regclass
        and c.conrelid <> 'platform_object_refs'::regclass`);
    const roles = new Set(OBJECT_ROLES.map((r) => `${r.table}.${r.column}`));
    expect(fks.filter((f) => !roles.has(`${f.tbl}.${f.col}`))).toEqual([]);
  });

  it("names tables and columns that exist", async () => {
    const cols = new Set(
      (
        await run(
          sql`select table_name || '.' || column_name n from information_schema.columns where table_schema = 'public'`,
        )
      ).map((r) => r.n),
    );
    const missing: string[] = [];
    for (const r of OBJECT_ROLES) {
      for (const c of [r.column, ...(r.platform ? [r.platform] : []), ...(r.key ?? []), "id"])
        if (!cols.has(`${r.table}.${c}`)) missing.push(`${r.table}.${c}`);
    }
    for (const h of ITEM_HOMES)
      if (!cols.has(`${h.table}.${h.column}`)) missing.push(`${h.table}.${h.column}`);
    expect(missing).toEqual([]);
  });

  it("finds the rows that name an object", async () => {
    const c = await comment({ platform: "reddit", ref: "t1_zz", post: "t3_p1", parent: "t3_p1" });
    await comment({ platform: "reddit", ref: "t1_yy", post: "t3_p1", parent: "t1_zz" });
    expect(await roleRowsOf(pg.db, "reddit", ["t3_p1"])).toEqual([
      { table: "comments", column: "post", count: 2, ids: [String(c), String(c + 1)] },
      { table: "comments", column: "parent", count: 1, ids: [String(c)] },
    ]);
    expect(await roleRowsOf(pg.db, "x", ["t3_p1"])).toEqual([]);
  });
});
