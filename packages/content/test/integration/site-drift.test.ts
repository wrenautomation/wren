/**
 * Posts and comments made by hand on the site, read back (designs/2026-10-22-drift-reconcile.md):
 * a post no draft has becomes a published `site` draft once; a lost send whose words match is
 * stamped instead; a comment becomes an ours touch once, unless a writer already kept its id.
 */
import { recordTouch } from "@wren/core/touches";
import { socialHandles, touches } from "@wren/core/touches-schema";
import { seedObjects, startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentDrafts, contentIdeas } from "../../src/schema.js";
import { keepSitePosts } from "../../src/site-posts.js";
import { keepOwnComments, OWN_COMMENTS_SOURCE } from "../../src/touches.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 120_000);
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "content_drafts",
    "content_ideas",
    "platform_objects",
    "touches",
    "social_handles",
  ]);
});

const NOW = new Date("2026-10-22T12:00:00Z");
const WORDS = "One person can run a thousand touches a week with the right automation behind them.";
const post = (id: string, text: string) => ({
  id,
  url: `https://x.com/synth/status/${id}`,
  publishedAt: "2026-10-21T16:00:00.000Z",
  fetchedWith: "browser" as const,
  preview: `${text.slice(0, 119)}…`,
  text,
});
const drafts = () =>
  pg.db
    .select({
      status: contentDrafts.status,
      publishedId: contentDrafts.publishedId,
      text: contentDrafts.text,
      promptVersion: contentDrafts.promptVersion,
    })
    .from(contentDrafts)
    .orderBy(contentDrafts.text);

describe("keepSitePosts", () => {
  it("keeps a post made on the site once, as a published site draft", async () => {
    const rows = [post("1001", WORDS), post("1001", WORDS)];
    expect(await keepSitePosts(pg.db, "x", rows, NOW)).toEqual({ added: 1, settled: 0 });
    expect(await keepSitePosts(pg.db, "x", rows, NOW)).toEqual({ added: 0, settled: 0 });
    expect(await drafts()).toEqual([
      { status: "published", publishedId: "1001", text: WORDS, promptVersion: "site" },
    ]);
    const [idea] = await pg.db.select().from(contentIdeas);
    expect(idea).toMatchObject({ source: "site", status: "drafted", ref: "site:x:1001" });
  });

  it("stamps a lost send whose words match, and leaves a published post alone", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic idea", source: "cli" })
      .returning();
    const ideaId = (idea as { id: string }).id;
    await seedObjects(pg.db, [{ platform: "x", ref: "1002", kind: "post" }]);
    await pg.db.insert(contentDrafts).values([
      // Its link was appended after the words the site lists.
      {
        ideaId,
        platform: "x",
        text: `${WORDS}\n\nhttps://example.test/go`,
        status: "publishing",
        promptVersion: "v1",
      },
      {
        ideaId,
        platform: "x",
        text: "Another post entirely, already out.",
        status: "published",
        publishedId: "1002",
        promptVersion: "v1",
      },
    ]);
    const rows = [post("1001", WORDS), post("1002", "Another post entirely, already out.")];
    expect(await keepSitePosts(pg.db, "x", rows, NOW)).toEqual({ added: 0, settled: 1 });
    expect((await drafts()).map((d) => [d.status, d.publishedId, d.promptVersion])).toEqual([
      ["published", "1002", "v1"],
      ["published", "1001", "v1"],
    ]);
  });
});

describe("keepOwnComments", () => {
  const comment = (id: string, handle: string | null, reply = false) => ({
    id,
    url: `https://www.reddit.com/r/synth/comments/abc/x/${id.slice(3)}/`,
    at: "2026-10-21T10:00:00.000Z",
    text: "A synthetic comment.",
    postId: "t3_abc",
    reply,
    to: handle ? { handle, name: null } : null,
  });
  const ours = async () =>
    (
      await pg.db
        .select({ handle: socialHandles.handle, kind: touches.kind, source: touches.source })
        .from(touches)
        .innerJoin(socialHandles, eq(socialHandles.id, touches.handleId))
        .where(eq(touches.direction, "ours"))
        .orderBy(socialHandles.handle)
    ).map((r) => [r.handle, r.kind, r.source]);

  it("keeps each comment once toward whom it answers; skips one already kept and the unknown", async () => {
    await recordTouch(pg.db, {
      platform: "reddit",
      handle: "kept_synth",
      kind: "comment",
      direction: "ours",
      account: "wren",
      at: new Date("2026-10-20T00:00:00Z"),
      externalId: "t1_kept",
      source: "reddit_threads",
      ref: "rt:t3_kept",
    });
    const rows = [
      comment("t1_aaa", "Sam_Synth"),
      comment("t1_bbb", "kim_synth", true),
      comment("t1_kept", "kept_synth"),
      comment("t1_gone", null),
    ];
    expect(await keepOwnComments(pg.db, "reddit", rows)).toBe(2);
    expect(await keepOwnComments(pg.db, "reddit", rows)).toBe(0);
    expect(await ours()).toEqual([
      ["kept_synth", "comment", "reddit_threads"],
      ["kim_synth", "reply", OWN_COMMENTS_SOURCE],
      ["sam_synth", "comment", OWN_COMMENTS_SOURCE],
    ]);
  });
});
