/**
 * Our posts and comments are platform objects (designs/2026-10-20-platform-objects.md, brief O2),
 * against Postgres. Each writer puts the canonical ref on its row and the object under it; the
 * reach reader and the content reader meet on one comment row; a raw insert in another spelling
 * fails on the key. Synthetic rows only.
 */
import { recordDraft } from "@wren/core/draft-record";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { addAccount, keepComments } from "@wren/outreach";
import { comments } from "@wren/outreach/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { markPublished } from "../../src/index.js";
import { commentKeywords, contentDrafts, contentIdeas } from "../../src/schema.js";
import { addKeyword } from "../../src/social/keywords.js";
import { keepPostComments } from "../../src/social/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "content_ideas",
    "content_drafts",
    "comment_keywords",
    "comments",
    "draft_events",
    "comment_threads",
    "reach_accounts",
    "platform_object_refs",
    "platform_objects",
  ]);
});

const AT = "2026-10-01T15:00:00Z";

async function draft(platform: "reddit" | "linkedin") {
  const [idea] = await pg.db
    .insert(contentIdeas)
    .values({ text: "synthetic idea", source: "cli" })
    .returning();
  const [d] = await pg.db
    .insert(contentDrafts)
    .values({
      ideaId: idea!.id,
      platform,
      text: "Synthetic words.",
      status: "publishing",
      promptVersion: "t",
    })
    .returning();
  return d!;
}

const objects = async () =>
  (
    await pg.db.execute<{ platform: string; ref: string; kind: string }>(
      sql`select platform, ref, kind from platform_objects order by platform, ref`,
    )
  ).map((r) => `${r.platform} ${r.ref} ${r.kind}`);

const rows = async () =>
  pg.db
    .select({
      ref: comments.ref,
      post: comments.post,
      parent: comments.parent,
      channel: comments.channel,
    })
    .from(comments)
    .orderBy(comments.ref);

/** What Postgres said, not drizzle's wrapper. */
async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (e) {
    return String((e as { cause?: { message?: string } }).cause?.message ?? e);
  }
}

describe("a published draft", () => {
  it("keeps a bare Reddit id as the post's fullname, with the object and the send's id", async () => {
    const d = await draft("reddit");
    await markPublished(pg.db, d.id, {
      id: "1abc23",
      url: "https://www.reddit.com/r/sub/comments/1abc23/synthetic/",
      publishedAt: AT,
      fetchedWith: "api",
    });
    const [row] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, d.id));
    expect(row).toMatchObject({ status: "published", publishedId: "t3_1abc23" });
    expect(await objects()).toEqual(["reddit t3_1abc23 post"]);
    const [sent] = await pg.db.execute<{ external_id: string }>(
      sql`select external_id from draft_events where item = ${`draft:${d.id}`} and event = 'sent'`,
    );
    expect(sent?.external_id).toBe("t3_1abc23");
    // The bare id and the page are other spellings of the same post.
    const aliases = await pg.db.execute<{ alias: string }>(
      sql`select alias from platform_object_refs where ref = 't3_1abc23' order by alias`,
    );
    expect(aliases.map((a) => a.alias)).toContain("1abc23");
  });

  it("stays published when no rule reads the id, with no id and a note", async () => {
    const d = await draft("linkedin");
    await markPublished(pg.db, d.id, {
      id: "not a share id",
      url: null,
      publishedAt: AT,
      fetchedWith: "api",
    } as never);
    const [row] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, d.id));
    expect(row?.status).toBe("published");
    expect(row?.publishedId).toBeNull();
    expect(row?.error).toContain("is not one we read");
    expect(await objects()).toEqual([]);
  });
});

describe("the draft record", () => {
  it("keeps the id a send made as an object, in its one spelling", async () => {
    await recordDraft(pg.db, {
      item: "thread:abc123",
      kind: "thread",
      platform: "reddit",
      event: "sent",
      via: "person",
      externalId: "9zz01",
    });
    await recordDraft(pg.db, {
      item: "onpost:1",
      kind: "post_comment",
      platform: "reddit",
      event: "sent",
      via: "person",
      externalId: "https://www.reddit.com/r/sub/comments/1abc23/synthetic/",
    });
    const sent = await pg.db.execute<{ kind: string; external_id: string }>(
      sql`select kind, external_id from draft_events order by kind`,
    );
    expect(sent.map((s) => [s.kind, s.external_id])).toEqual([
      ["post_comment", "t3_1abc23"],
      ["thread", "t1_9zz01"],
    ]);
    expect(await objects()).toEqual(["reddit t1_9zz01 comment", "reddit t3_1abc23 post"]);
  });

  it("keeps a message id in meta: a DM is no post or comment", async () => {
    await recordDraft(pg.db, {
      item: "dm:7",
      kind: "dm",
      platform: "reddit",
      event: "sent",
      via: "person",
      externalId: "msg-77",
    });
    const [dm] = await pg.db.execute<{ external_id: string | null; meta: { external_id: string } }>(
      sql`select external_id, meta from draft_events where item = 'dm:7'`,
    );
    expect(dm?.external_id).toBeNull();
    expect(dm?.meta.external_id).toBe("msg-77");
    expect(await objects()).toEqual([]);
  });

  it("keeps the step when no rule reads the id", async () => {
    await recordDraft(pg.db, {
      item: "draft:lost",
      kind: "post",
      platform: "linkedin",
      event: "sent",
      via: "wren",
      externalId: "not a share id",
    });
    const [s] = await pg.db.execute<{ external_id: string | null; meta: { external_id: string } }>(
      sql`select external_id, meta from draft_events where item = 'draft:lost'`,
    );
    expect(s?.external_id).toBeNull();
    expect(s?.meta.external_id).toBe("not a share id");
  });
});

describe("kept comments", () => {
  const post = {
    platform: "reddit" as const,
    id: "1abc23",
    url: "https://www.reddit.com/r/sub/comments/1abc23/synthetic/",
    title: "Synthetic post",
    publishedAt: AT,
  };
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    postId: "1abc23",
    author: "reader",
    text: "Nice write-up",
    at: AT,
    ...over,
  });

  it("writes fullnames for bare Reddit ids, and an object for each", async () => {
    await keepPostComments(pg.db, post, [row("c1"), row("c2", { parentId: "c1" })]);
    expect(await rows()).toEqual([
      { ref: "t1_c1", post: "t3_1abc23", parent: "t3_1abc23", channel: "content" },
      { ref: "t1_c2", post: "t3_1abc23", parent: "t1_c1", channel: "content" },
    ]);
    expect(await objects()).toEqual([
      "reddit t1_c1 comment",
      "reddit t1_c2 comment",
      "reddit t3_1abc23 post",
    ]);
  });

  it("is one row when the reach reader sees the reply first, then the content reader", async () => {
    const a = await addAccount(pg.db, {
      platform: "reddit",
      account: "reddit@a",
      now: new Date(AT),
    });
    const kept = await keepComments(
      pg.db,
      a,
      [
        {
          ref: "t1_c1",
          post: "t3_1abc23",
          parent: "t3_1abc23",
          kind: "post_reply",
          place: "sub",
          postTitle: "Synthetic post",
          handle: "reader",
          text: "Nice write-up",
          url: "https://www.reddit.com/r/sub/comments/1abc23/synthetic/c1/",
          at: AT,
          raw: {},
        },
      ],
      [],
    );
    expect(kept).toHaveLength(1);
    // The content reader meets the same comment under its bare id.
    await keepPostComments(pg.db, post, [row("c1")]);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ ref: "t1_c1", channel: "reach" });
    expect(await objects()).toEqual(["reddit t1_c1 comment", "reddit t3_1abc23 post"]);
  });

  it("skips a comment whose id no rule reads, and keeps the rest", async () => {
    await keepPostComments(
      pg.db,
      { ...post, platform: "linkedin", id: "urn:li:share:11", url: null },
      [
        { ...row("700", { postId: "urn:li:share:11" }) },
        { ...row("not a comment id", { postId: "urn:li:share:11" }) },
      ],
    );
    expect((await rows()).map((r) => r.ref)).toEqual(["700"]);
  });
});

describe("the key", () => {
  const insert = (ref: string, post = "t3_1abc23", parent = "t3_1abc23") =>
    pg.db.execute(sql`insert into comments (platform, channel, ref, post, parent, kind, author, body, url, at, raw)
      values ('reddit', 'content', ${ref}, ${post}, ${parent}, 'post_reply', 'reader', 'Nice', '', now(), '{}'::jsonb)`);

  it("refuses a ref spelled another way than its object", async () => {
    await pg.db.execute(sql`insert into platform_objects (platform, ref, kind) values
      ('reddit', 't3_1abc23', 'post'), ('reddit', 't1_c1', 'comment')`);
    // The bare id is an alias, not the object's ref.
    expect(await failure(() => insert("c1"))).toContain("fk_comments_platform_ref");
    expect(await failure(() => insert("t1_c1", "1abc23"))).toContain("fk_comments_platform_post");
    expect(await failure(() => insert("t1_c1", "t3_1abc23", "t1_c9"))).toContain(
      "fk_comments_platform_parent",
    );
    expect(await failure(() => insert("t1_c1"))).toBe("");
  });

  it("refuses a published id, a send's id and a keyword's post with no object", async () => {
    const d = await draft("reddit");
    expect(
      await failure(() =>
        pg.db.execute(sql`update content_drafts set published_id = '1abc23' where id = ${d.id}`),
      ),
    ).toContain("fk_content_drafts_platform_published_id");
    expect(
      await failure(() =>
        pg.db.execute(sql`insert into draft_events (item, kind, platform, event, via, external_id)
          values ('draft:x', 'post', 'reddit', 'sent', 'wren', '1abc23')`),
      ),
    ).toContain("fk_draft_events_platform_external_id");
    const a = await addAccount(pg.db, {
      platform: "reddit",
      account: "reddit@a",
      now: new Date(AT),
    });
    expect(
      await failure(() =>
        pg.db.execute(
          sql`insert into comment_threads (platform, post, account_id, active_at, until)
            values ('reddit', '1abc23', ${a.id}, now(), now())`,
        ),
      ),
    ).toContain("fk_comment_threads_platform_post");
  });
});

describe("a keyword", () => {
  it("names a post by its platform: the platform is required with a post", async () => {
    await expect(
      addKeyword(
        pg.db,
        { keyword: "link", dm: "Here", post: "17900000000000001" },
        "t@example.com",
      ),
    ).rejects.toThrow(/pick the platform/);
    await expect(
      addKeyword(
        pg.db,
        { keyword: "link", dm: "Here", platform: "instagram", post: "has spaces" },
        "t@example.com",
      ),
    ).rejects.toThrow(/not a post id/);
    expect(await pg.db.select().from(commentKeywords)).toEqual([]);
  });

  it("keeps the post as an object", async () => {
    await addKeyword(
      pg.db,
      { keyword: "link", dm: "Here", platform: "instagram", post: "17900000000000001" },
      "t@example.com",
    );
    const [k] = await pg.db.select().from(commentKeywords);
    expect(k).toMatchObject({ platform: "instagram", post: "17900000000000001" });
    expect(await objects()).toEqual(["instagram 17900000000000001 post"]);
  });
});
