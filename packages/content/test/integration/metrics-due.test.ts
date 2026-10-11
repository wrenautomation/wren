/** Which posts get a look: young ones on free reads hourly, X and browser reads daily. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lessonsFor } from "../../src/lessons.js";
import { metricsDue } from "../../src/metrics.js";
import { contentDrafts, contentIdeas, contentMetrics } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const HOUR = 3_600_000;
const NOW = new Date("2026-10-11T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);

/** A post published `ageH` hours ago, last looked at `lookedH` hours ago. */
async function post(
  platform: "youtube" | "x",
  id: string,
  ageH: number,
  lookedH: number,
  views = 1,
) {
  const [idea] = await pg.db
    .insert(contentIdeas)
    .values({ text: "synthetic idea", source: "cli" })
    .returning();
  const [d] = await pg.db
    .insert(contentDrafts)
    .values({
      ideaId: idea!.id,
      platform,
      text: `synthetic post ${id}`,
      status: "published",
      promptVersion: "t",
      publishedAt: ago(ageH),
      publishedId: id,
    })
    .returning();
  await pg.db.insert(contentMetrics).values({
    draftId: d!.id,
    asOf: ago(lookedH),
    createdAt: ago(lookedH),
    views,
    reactions: 0,
    comments: 0,
    shares: 0,
    fetchedWith: "api",
  });
  return id;
}

describe("metricsDue", () => {
  it("tiers the look by age on free reads; X stays daily", async () => {
    await post("youtube", "yt-new-stale", 10, 2); // first two days, 2 h old look: due
    await post("youtube", "yt-new-fresh", 10, 0.5); // looked half an hour ago
    await post("youtube", "yt-week-stale", 72, 7); // 3 days old, 7 h old look: due
    await post("youtube", "yt-week-fresh", 72, 3);
    await post("youtube", "yt-old-fresh", 24 * 10, 7); // past a week: daily
    await post("youtube", "yt-old-stale", 24 * 10, 21);
    await post("x", "x-new", 10, 2); // X bills reads: daily even when new
    await post("x", "x-new-stale", 10, 21);

    const due = (await metricsDue(pg.db, NOW)).map((d) => d.publishedId).sort();
    expect(due).toEqual(["x-new-stale", "yt-new-stale", "yt-old-stale", "yt-week-stale"]);

    // An explicit interval is one rule for every post.
    const flat = (await metricsDue(pg.db, NOW, { lookEveryMs: HOUR })).map((d) => d.publishedId);
    expect(flat).toHaveLength(7);
  });

  it("lessons read each post's latest look, however many looks a post has", async () => {
    await post("x", "x-old-winner", 24 * 5, 30, 500);
    const [young] = await pg.db
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.publishedId, "x-new"));
    // A young post's hourly looks, more than the old 500-row cap.
    await pg.db.insert(contentMetrics).values(
      Array.from({ length: 600 }, (_, i) => ({
        draftId: young!.id,
        asOf: ago(i / 100),
        createdAt: ago(i / 100),
        views: 30 + i,
        reactions: 0,
        comments: 0,
        shares: 0,
        fetchedWith: "api" as const,
      })),
    );
    const { winners } = await lessonsFor(pg.db, "x");
    expect(winners.map((w) => w.views)).toEqual([500, 30]);
  });
});
