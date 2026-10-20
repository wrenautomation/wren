/** Which posts get a look: young ones on free reads every 6 hours, X and browser reads daily; all weekly after a week. */
import { seedObjects, startTestPostgres, type TestPostgres } from "@wren/db/testing";
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
  await seedObjects(pg.db, [{ platform, ref: id, kind: "post" }]);
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
  it("tiers the look by age; free reads look more often, X and browsers less", async () => {
    await post("youtube", "yt-new-stale", 10, 7); // first two days: every 6 h, 7 h old look: due
    await post("youtube", "yt-new-fresh", 10, 5);
    await post("youtube", "yt-week-stale", 72, 21); // 3 days old: daily, 21 h old look: due
    await post("youtube", "yt-week-fresh", 72, 7);
    await post("youtube", "yt-old-fresh", 24 * 10, 30); // past a week: weekly
    await post("youtube", "yt-old-stale", 24 * 10, 24 * 6 + 1);
    await post("x", "x-new", 10, 2); // X bills reads: daily even when new
    await post("x", "x-new-stale", 10, 21);
    await post("x", "x-old", 24 * 10, 30); // and weekly after the first week
    await post("x", "x-old-stale", 24 * 10, 24 * 6 + 1);

    const due = (await metricsDue(pg.db, NOW)).map((d) => d.publishedId).sort();
    expect(due).toEqual([
      "x-new-stale",
      "x-old-stale",
      "yt-new-stale",
      "yt-old-stale",
      "yt-week-stale",
    ]);

    // An explicit interval is one rule for every post.
    const flat = (await metricsDue(pg.db, NOW, { lookEveryMs: HOUR })).map((d) => d.publishedId);
    expect(flat).toHaveLength(10);
  });

  it("looks per post over its 30 days, the loop passing every hour", async () => {
    const looks = async (platform: "youtube" | "x") => {
      const [idea] = await pg.db
        .insert(contentIdeas)
        .values({ text: "synthetic idea", source: "cli" })
        .returning();
      const born = new Date("2026-09-01T00:00:00Z");
      await seedObjects(pg.db, [{ platform, ref: `sim-${platform}`, kind: "post" }]);
      const [d] = await pg.db
        .insert(contentDrafts)
        .values({
          ideaId: idea!.id,
          platform,
          text: "synthetic post",
          status: "published",
          promptVersion: "t",
          publishedAt: born,
          publishedId: `sim-${platform}`,
        })
        .returning();
      let n = 0;
      for (let h = 0; h <= 31 * 24; h++) {
        const at = new Date(born.getTime() + h * HOUR);
        const due = await metricsDue(pg.db, at, { limit: 1000 });
        if (!due.some((x) => x.id === d!.id)) continue;
        n++;
        await pg.db.insert(contentMetrics).values({
          draftId: d!.id,
          asOf: at,
          createdAt: at,
          views: 1,
          reactions: 0,
          comments: 0,
          shares: 0,
          fetchedWith: "api",
        });
      }
      return n;
    };
    // Before the tiers were thinned: 67 and 35.
    expect({ youtube: await looks("youtube"), x: await looks("x") }).toEqual({
      youtube: 15,
      x: 11,
    });
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
