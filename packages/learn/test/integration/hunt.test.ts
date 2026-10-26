/**
 * The hunt on a real Postgres: a followed channel's archived items come back as candidates, the
 * topic's search is saved with the SOP's kind, tag, creator and numbers, what Learn has is left
 * alone, and the day's cap holds. The search and the desk are fakes; every address is made up.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Find,
  huntSop,
  IN_FEED_BEFORE,
  items,
  itemTags,
  sources,
  type TopicSearch,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql`TRUNCATE learn.item_tags, learn.items, learn.sources, decision_calls RESTART IDENTITY CASCADE`,
  );
});

const find = (id: string, views: number | null, creator = "Acme"): Find => ({
  url: `https://youtube.com/watch?v=${id}`,
  title: `${creator} film ${id}`,
  creator,
  views,
  publishedAt: new Date("2026-10-01T00:00:00Z"),
  duration: 48,
});

const SCOPE = {
  kinds: ["film"],
  platforms: ["youtube"],
  topic: "launch film, demo film",
  set: ["linear", "acme"],
};

describe("wren sop hunt", () => {
  it("takes a followed channel's seen items back, saves the most viewed finds, and keeps the day's cap", async () => {
    const [linear] = await pg.db
      .insert(sources)
      .values({
        client: "wren",
        url: "https://youtube.com/feeds/linear",
        name: "Linear",
        kind: "youtube",
      })
      .returning({ id: sources.id });
    if (!linear) throw new Error("no source");
    const seen = (n: number, publishedAt: string) => ({
      client: "wren",
      sourceId: linear.id,
      url: `https://youtube.com/watch?v=seen${n}`,
      kind: "video" as const,
      type: "youtube" as const,
      title: `Seen ${n}`,
      why: IN_FEED_BEFORE,
      archivedAt: new Date(),
      publishedAt: new Date(publishedAt),
    });
    await pg.db.insert(items).values([
      seen(1, "2026-09-01T00:00:00Z"),
      seen(2, "2026-09-20T00:00:00Z"),
      seen(3, "2026-09-10T00:00:00Z"),
      // Read already: not a candidate.
      { ...seen(4, "2026-09-25T00:00:00Z"), readAt: new Date(), archivedAt: null, why: null },
      // His archive of a find: stays archived.
      {
        client: "wren",
        url: "https://youtube.com/watch?v=known",
        kind: "film",
        type: "youtube",
        title: "Known",
        archivedAt: new Date("2026-10-02T00:00:00Z"),
      },
    ]);
    const asked: string[] = [];
    const search: TopicSearch = async (q) => {
      asked.push(q);
      return q === "launch film"
        ? [find("a", 10), find("known", 99_000), find("b", 5_000)]
        : [find("c", 70_000, "Beta"), find("a", 12), find("d", null)];
    };
    const hunt = await huntSop(pg.db, {
      client: "wren",
      name: "launch-films",
      scope: SCOPE,
      search,
      catalog: null,
      cap: 4,
      now: new Date("2026-10-25T12:00:00Z"),
    });
    expect(asked).toEqual(["launch film", "demo film"]);
    expect(hunt.unfollowed).toEqual(["acme"]);
    expect(hunt.before).toBe(0);
    expect(hunt.revived).toHaveLength(3);
    expect(hunt.found).toBe(5);
    expect(hunt.known).toBe(1);
    expect(hunt.saved).toHaveLength(1);
    expect(hunt.left).toBe(0);

    const revived = await pg.db
      .select({
        title: items.title,
        kind: items.kind,
        archivedAt: items.archivedAt,
        needsMac: items.needsMac,
        why: items.why,
      })
      .from(items)
      .where(sql`${items.id} = any(array[${sql.raw(hunt.revived.join(","))}]::int[])`)
      .orderBy(asc(items.id));
    expect(revived.map((r) => r.title)).toEqual(["Seen 1", "Seen 2", "Seen 3"]);
    for (const r of revived) {
      expect(r.kind).toBe("film");
      expect(r.archivedAt).toBeNull();
      expect(r.needsMac).not.toBeNull();
      expect(r.why).toBeNull();
    }
    const [saved] = await pg.db
      .select({
        url: items.url,
        kind: items.kind,
        creator: items.creator,
        stats: items.stats,
        duration: items.duration,
        savedBy: items.savedBy,
        needsMac: items.needsMac,
      })
      .from(items)
      .where(eq(items.id, hunt.saved[0] as number));
    expect(saved).toMatchObject({
      url: "https://youtube.com/watch?v=c",
      kind: "film",
      creator: "Beta",
      stats: { views: 70_000 },
      duration: 48,
      savedBy: null,
    });
    expect(saved?.needsMac).not.toBeNull();
    const [known] = await pg.db
      .select({ archivedAt: items.archivedAt })
      .from(items)
      .where(eq(items.url, "https://youtube.com/watch?v=known"));
    expect(known?.archivedAt).not.toBeNull();
    const tagged = await pg.db
      .select({ itemId: itemTags.itemId })
      .from(itemTags)
      .where(eq(itemTags.tag, "launch-films"));
    expect(tagged.map((t) => t.itemId).sort()).toEqual([...hunt.revived, ...hunt.saved].sort());
    const [worth] = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from decision_calls where kind = 'document'`,
    );
    expect(worth?.n).toBe(0);

    // The same day again: the cap is full, nothing more is saved or searched.
    const again = await huntSop(pg.db, {
      client: "wren",
      name: "launch-films",
      scope: SCOPE,
      search,
      catalog: null,
      cap: 4,
      now: new Date("2026-10-25T18:00:00Z"),
    });
    expect(again.before).toBe(4);
    expect(again.revived).toEqual([]);
    expect(again.saved).toEqual([]);
    expect(again.searched).toEqual([]);

    // A day later there is room: the next most viewed, the known one still skipped.
    const later = await huntSop(pg.db, {
      client: "wren",
      name: "launch-films",
      scope: SCOPE,
      search,
      catalog: null,
      cap: 4,
      now: new Date("2026-10-27T12:00:00Z"),
    });
    expect(later.before).toBe(0);
    expect(later.revived).toEqual([]);
    expect(later.known).toBe(2);
    expect(later.saved).toHaveLength(3);
    const urls = await pg.db
      .select({ url: items.url })
      .from(items)
      .where(sql`${items.id} = any(array[${sql.raw(later.saved.join(","))}]::int[])`)
      .orderBy(asc(items.id));
    expect(urls.map((u) => u.url.slice(-1))).toEqual(["b", "a", "d"]);
  });
});
