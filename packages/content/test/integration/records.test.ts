/**
 * `marketing.post` against Postgres: a published post with its newest numbers, never an older
 * count or an unpublished draft, and engagement pooled in the footer. Synthetic rows only.
 */
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { draftRecord, postRecord } from "../../src/records.js";
import { contentDrafts, contentIdeas, contentMetrics } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

describe("marketing.post", () => {
  it("lists published posts by their newest numbers, every view", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic idea", source: "cli" })
      .returning();
    const draft = (status: "published" | "draft", text: string) => ({
      ideaId: idea!.id,
      platform: "linkedin" as const,
      text,
      status,
      promptVersion: "t",
      publishedAt: status === "published" ? new Date() : null,
    });
    const [post] = await pg.db
      .insert(contentDrafts)
      .values([draft("published", "First line\nsecond line"), draft("draft", "not out")])
      .returning();
    const count = (views: number, reactions: number, at: string) => ({
      draftId: post!.id,
      asOf: new Date(at),
      views,
      reactions,
      comments: 1,
      shares: 0,
      fetchedWith: "api",
      createdAt: new Date(at),
    });
    await pg.db
      .insert(contentMetrics)
      .values([count(10, 1, "2026-01-01T00:00:00Z"), count(200, 9, "2026-01-02T00:00:00Z")]);

    const api = serveRecords([postRecord], pg.db);
    for (const v of postRecord.views)
      await api.list({ record: postRecord.id, view: v.id, limit: 9 });
    const week = await api.list({ record: postRecord.id, view: "week", limit: 9 });
    expect(week.rows).toEqual([
      expect.objectContaining({
        id: `${idea!.id}/linkedin/${post!.id}`,
        title: "First line",
        views: 200,
      }),
    ]);
    expect(week.totals.engagement).toEqual({ n: 10, of: 200 });
  });
});

describe("marketing.draft", () => {
  it("lists drafts not yet out by state, and loads what the preview needs", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic draft idea", source: "cli" })
      .returning();
    if (!idea) throw new Error("no idea");
    const [waiting, gone] = await pg.db
      .insert(contentDrafts)
      .values(
        (["draft", "published"] as const).map((status) => ({
          ideaId: idea.id,
          platform: "x" as const,
          text: `a ${status} post`,
          status,
          promptVersion: "t",
        })),
      )
      .returning();
    const api = serveRecords([draftRecord], pg.db);
    for (const v of draftRecord.views)
      await api.list({ record: draftRecord.id, view: v.id, limit: 9 });
    const ids = (await api.list({ record: draftRecord.id, view: "waiting", limit: 9 })).rows.map(
      (r) => r.id,
    );
    expect(ids).toContain(waiting?.id);
    expect(ids).not.toContain(gone?.id);
    const one = await api.get({ record: draftRecord.id, id: String(waiting?.id) });
    expect(one.detail).toEqual({
      post: {
        site: "X",
        title: null,
        text: "a draft post",
        max: 280,
        feed: { laptop: null, phone: null },
      },
    });
  });
});
