/**
 * Competitor breakdowns on a real Postgres: a followed creator's posts carry their numbers, a
 * repeat pass moves the numbers and nothing else, a read reel is scored then broken down once,
 * and the Competitors views rank reels and hook styles. The model and Instagram are fakes; every
 * address is made up.
 */
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  breakdownItem,
  breakdownRecords,
  breakdowns,
  hookRecords,
  items,
  judges,
  pullCreators,
  scoreItem,
  sitesReader,
  sources,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql`TRUNCATE learn.breakdowns, learn.items, learn.sources RESTART IDENTITY CASCADE`,
  );
});

const SCORE = { score: 6, summary: "A reel.", changes: [], why: "Because." };
const BREAKDOWN = {
  hook_style: "contrarian",
  hook: "Stop posting every day.",
  hook_why: "It says the common advice is wrong.",
  topic: "posting cadence",
  format: "talking-head",
  beats: [
    { at: "0:00", beat: "The claim" },
    { at: "0:12", beat: "Proof from three accounts" },
    { beat: "The ask" },
  ],
  cta_kind: "comment-word",
  cta: "Comment PLAN for the template.",
};

/** Scores a score prompt, breaks down a breakdown prompt; counts each. */
function model(over: Partial<typeof BREAKDOWN> = {}) {
  const asked = { score: 0, breakdown: 0 };
  const llm = new FakeLlm({
    respond: (p) => {
      if (p.startsWith("Break down")) {
        asked.breakdown++;
        return JSON.stringify({ ...BREAKDOWN, ...over });
      }
      asked.score++;
      return JSON.stringify(SCORE);
    },
  });
  return { llm, asked, judge: judges({ db: pg.db, llm, wrenPractices: async () => [] }) };
}

async function readReel(n: number, o: { kind?: "reel" | "article"; stats?: object } = {}) {
  const [src] = await pg.db
    .insert(sources)
    .values({
      client: "wren",
      kind: "instagram",
      url: `https://www.instagram.com/synth${n}/`,
      name: `@synth${n}`,
    })
    .returning();
  const [row] = await pg.db
    .insert(items)
    .values({
      client: "wren",
      sourceId: src?.id ?? null,
      url: `https://www.instagram.com/p/Synth${n}/`,
      kind: o.kind ?? "reel",
      type: "instagram",
      title: `Reel ${n}`,
      creator: `synth${n}`,
      transcript: "## Speech\n\n[0:00] Stop posting every day.\n[0:12] Here is why.",
      readAt: new Date(),
      stats: (o.stats ?? null) as never,
    })
    .returning();
  return Number(row?.id);
}

describe("competitor breakdowns", () => {
  it("keeps a followed post's numbers and moves only them on the next pass", async () => {
    await pg.db.insert(sources).values({
      client: "wren",
      kind: "instagram",
      url: "https://www.instagram.com/synth.creator/",
      name: "@synth.creator",
      fetchedAt: new Date("2026-10-01T00:00:00Z"),
    });
    let likes = 10;
    const sites = {
      via: async () => "api" as const,
      call: async () => ({
        found: true,
        profile: { username: "synth.creator" },
        media: [
          {
            caption: "A reel",
            media_type: "VIDEO",
            media_product_type: "REELS",
            permalink: "https://www.instagram.com/p/Csynth0/",
            timestamp: "2026-10-09T10:00:00+0000",
            like_count: likes,
            comments_count: 3,
          },
        ],
      }),
    } as unknown as SiteClient;
    const t0 = new Date("2026-10-09T12:00:00Z");
    const first = await pullCreators(pg.db, sitesReader(sites), t0, { kinds: ["instagram"] });
    expect(first.added).toHaveLength(1);
    await pg.db.update(items).set({ title: "Kept" });
    likes = 250;
    const t1 = new Date(t0.getTime() + 7 * 3_600_000);
    const again = await pullCreators(pg.db, sitesReader(sites), t1, { kinds: ["instagram"] });
    expect(again.added).toEqual([]);
    const [row] = await pg.db.select().from(items);
    expect(row).toMatchObject({ title: "Kept", stats: { likes: 250, comments: 3 }, statsAt: t1 });
  });

  it("breaks a read reel down once, after its score", async () => {
    const id = await readReel(1, { stats: { likes: 900, comments: 40 } });
    const m = model();
    expect(await scoreItem(pg.db, m.judge, id)).toBe("hold");
    expect(m.asked).toEqual({ score: 1, breakdown: 1 });
    const [b] = await pg.db.select().from(breakdowns).where(eq(breakdowns.itemId, id));
    expect(b).toMatchObject({
      hookStyle: "contrarian",
      ctaKind: "comment-word",
      beats: [
        { t: 0, beat: "The claim" },
        { t: 12, beat: "Proof from three accounts" },
        { t: null, beat: "The ask" },
      ],
    });
    // Done: neither a repeat score nor a direct ask asks again.
    expect(await scoreItem(pg.db, m.judge, id)).toBe("hold");
    expect(await breakdownItem(pg.db, m.judge, id)).toBe(false);
    expect(m.asked).toEqual({ score: 1, breakdown: 1 });
  });

  it("skips what has no hook to read, and a cta of none keeps no ask", async () => {
    const article = await readReel(2, { kind: "article" });
    const m = model({ cta_kind: "none", cta: "ignored" });
    expect(await breakdownItem(pg.db, m.judge, article)).toBe(false);
    const reel = await readReel(3);
    expect(await breakdownItem(pg.db, m.judge, reel)).toBe(true);
    const [b] = await pg.db.select().from(breakdowns);
    expect(b?.cta).toBeNull();
  });

  it("ranks reels by reach and hook styles by their median", async () => {
    const m = model();
    const ids = [
      await readReel(4, { stats: { likes: 100, comments: 20 } }),
      await readReel(5, { stats: { views: 5000, likes: 10 } }),
      await readReel(6),
    ];
    for (const id of ids) await breakdownItem(pg.db, m.judge, id);
    await pg.db
      .update(breakdowns)
      .set({ hookStyle: "news" })
      .where(eq(breakdowns.itemId, ids[2] ?? 0));
    const reels = await pg.db
      .select({
        id: breakdownRecords.id,
        reach: breakdownRecords.reach,
        beats: breakdownRecords.beats,
      })
      .from(breakdownRecords)
      .orderBy(asc(breakdownRecords.id));
    expect(reels.map((r) => r.reach)).toEqual([120, 5000, null]);
    expect(reels[0]?.beats).toBe("[0:00] The claim\n[0:12] Proof from three accounts\nThe ask");
    const hooks = await pg.db.select().from(hookRecords).orderBy(asc(hookRecords.id));
    expect(hooks).toMatchObject([
      { id: "contrarian", reels: 2, creators: 2, medianReach: 2560, topReach: 5000, top: "Reel 5" },
      { id: "news", reels: 1, medianReach: null },
    ]);
  });
});
