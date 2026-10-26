/**
 * Competitor breakdowns on a real Postgres: a followed creator's posts carry their numbers, a
 * repeat pass moves the numbers and nothing else, a read reel is scored then broken down once,
 * and the Competitors views rank reels and hook styles. The model and Instagram are fakes; every
 * address is made up.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { documents, findings } from "@wren/research/schema";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  breakdownItem,
  breakdownRecords,
  breakdowns,
  callsOf,
  checksOf,
  FactCallRefusal,
  factCalls,
  factFindings,
  factRows,
  hookRecords,
  items,
  judges,
  ourPatterns,
  pullCreators,
  recordFactCall,
  rulesOf,
  saveOurs,
  scoreItem,
  sitesReader,
  sopSources,
  sources,
  standards,
  writeChecks,
  writeSopFiles,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql`TRUNCATE learn.breakdowns, learn.items, learn.sources, learn.sop_sources, decision_calls RESTART IDENTITY CASCADE`,
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

    // Each fact is a finding on the reel's document, keyed by its path; a second write moves nothing.
    const [item] = await pg.db.select().from(items).where(eq(items.id, id));
    const [doc] = await pg.db
      .select()
      .from(documents)
      .where(eq(documents.id, item?.documentId ?? -1));
    expect(doc).toMatchObject({ kind: "video", url: item?.url, companyId: null });
    if (!b) throw new Error("no breakdown");
    expect(await factFindings(pg.db, b)).toBe(factRows(b).length);
    const facts = await pg.db
      .select()
      .from(findings)
      .where(eq(findings.documentId, doc?.id ?? -1));
    expect(facts).toHaveLength(factRows(b).length);
    expect(facts.find((f) => f.question === "beats/1")).toMatchObject({
      kind: "fact",
      factKey: `doc:${doc?.id}/beats/1`,
      proof: { t: 12 },
      by: "model",
      personId: null,
      companyId: null,
    });
    expect(facts.find((f) => f.question === "beats/2")?.proof).toBeNull();
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

describe("his calls on the facts", () => {
  it("keeps the newest call per path with his words, and refuses a path the breakdown has not got", async () => {
    const id = await readReel(7);
    await breakdownItem(pg.db, model().judge, id);
    const call = (path: string, c: "keep" | "tune" | "drop", comment?: string) =>
      recordFactCall(pg.db, {
        client: "wren",
        id,
        path,
        call: c,
        comment,
        by: "w@example.com",
        source: "cli",
      });
    expect((await call("/", "keep")).subject).toBe(`learn:${id}`);
    expect((await call("beats/1", "tune", "  shorter proof ")).row?.label).toBe("Beat 2");
    await call("cta", "drop", "no comment-a-word asks");
    await call("cta", "tune", "a link instead");
    const calls = await factCalls(pg.db, id);
    expect(calls.map((c) => [c.path, c.call, c.comment])).toEqual([
      ["/", "keep", null],
      ["beats/1", "tune", "shorter proof"],
      ["cta", "tune", "a link instead"],
    ]);
    await expect(call("beats/9", "keep")).rejects.toThrow(FactCallRefusal);
    await expect(call("facts/chars", "keep")).rejects.toThrow(/no fact at/);
    await expect(
      recordFactCall(pg.db, {
        client: "acme",
        id,
        path: "/",
        call: "keep",
        by: null,
        source: "cli",
      }),
    ).rejects.toThrow(/Wren/);
    // An item with no breakdown takes no call.
    await expect(
      recordFactCall(pg.db, {
        client: "wren",
        id: await readReel(8),
        path: "/",
        call: "keep",
        by: null,
        source: "cli",
      }),
    ).rejects.toThrow(/no breakdown/);
  });
});

describe("the standard and his calls, as an SOP reads them", () => {
  let dir = "";
  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));
  it("flattens each breakdown into learn.standards, counts his calls, and writes standard.md and calls.md for a scope", async () => {
    const m = model();
    const ids: number[] = [];
    for (const n of [1, 2, 3]) {
      const id = await readReel(n, { stats: { views: 1000 * n } });
      await breakdownItem(pg.db, m.judge, id);
      ids.push(id);
    }
    const call = (id: number, path: string, c: "keep" | "tune" | "drop", comment?: string) =>
      recordFactCall(pg.db, {
        client: "wren",
        id,
        path,
        call: c,
        comment,
        by: null,
        source: "cli",
      });
    await call(ids[0] as number, "hook_style", "keep");
    await call(ids[1] as number, "hook_style", "keep", "says the common advice is wrong");
    await call(ids[2] as number, "hook_style", "keep");
    await call(ids[2] as number, "beats/1", "tune", "one account is enough");
    await call(ids[2] as number, "/", "keep");

    const flat = await pg.db.select().from(standards).orderBy(asc(standards.id));
    expect(
      flat.map((r) => [r.kind, r.platform, r.creator, r.reach, r.format, r.hookStyle, r.calls]),
    ).toEqual([
      ["reel", "instagram", "synth1", 1000, "talking-head", "contrarian", 1],
      ["reel", "instagram", "synth2", 2000, "talking-head", "contrarian", 1],
      ["reel", "instagram", "synth3", 3000, "talking-head", "contrarian", 3],
    ]);
    const records = await pg.db.select().from(breakdownRecords).orderBy(asc(breakdownRecords.id));
    expect(records.map((r) => [r.calls, r.called])).toEqual([
      [1, true],
      [1, true],
      [3, true],
    ]);
    // A fourth, uncalled, is "To call"; it is out of the set until "Add to SOP" asks it in.
    const extra = await readReel(4, { stats: { views: 50 } });
    await breakdownItem(pg.db, m.judge, extra);
    expect(
      (await pg.db.select().from(breakdownRecords).where(eq(breakdownRecords.id, extra)))[0]
        ?.called,
    ).toBe(false);
    await call(extra, "cta", "drop", "no comment-a-word asks");

    dir = await mkdtemp(join(tmpdir(), "sop-"));
    const notes =
      "---\nkinds: reel, film\nplatforms: instagram\nset: synth1, synth2, synth3\n---\n# Notes\n";
    const out = await writeSopFiles(pg.db, dir, "reels", notes);
    expect(out && [out.pieces, out.calls]).toEqual([3, 5]);
    const standard = await readFile(join(dir, "standard.md"), "utf8");
    expect(standard).toContain("## reel (3 pieces)");
    expect(standard).toContain("- Hook style: contrarian 3 (of 3)");
    expect(standard).toContain("- Call to action: comment-word 3 (of 3)");
    expect(standard).toContain("- Format: talking-head 3 (of 3)");
    expect(standard).not.toContain("## film");
    const calls = await readFile(join(dir, "calls.md"), "utf8");
    expect(calls).toContain(
      `- Hook style: contrarian: keep 3 → rule [learn:${ids[0]}, learn:${ids[1]}, learn:${ids[2]}] ("says the common advice is wrong" [learn:${ids[1]}])`,
    );
    expect(calls).toContain(
      `- Beat 2 "[0:12] Proof from three accounts" (Reel 3, synth3) "one account is enough" [learn:${ids[2]}]`,
    );
    expect(calls).toContain(`- Whole piece: Reel 3, synth3 [learn:${ids[2]}]`);
    expect(calls).not.toContain("no comment-a-word asks");

    await pg.db
      .insert(sopSources)
      .values({ itemId: extra, sop: "reels", state: "added", by: null });
    const again = await writeSopFiles(pg.db, dir, "reels", notes);
    expect(again?.calls).toBe(6);
    expect(await readFile(join(dir, "calls.md"), "utf8")).toContain(
      `- Call to action: comment-word: drop 1 [learn:${extra}] ("no comment-a-word asks" [learn:${extra}])`,
    );
    // The standard counts the set only: the asked-in piece lends its call, not its numbers.
    expect(await readFile(join(dir, "standard.md"), "utf8")).toContain("## reel (3 pieces)");
    // No kinds in the notes: nothing to write.
    expect(await writeSopFiles(pg.db, dir, "reels", "# Notes\n")).toBeNull();
  });

  it("counts a hunt's topic find only once he keeps it, and never once he drops or archives it", async () => {
    const id = await readReel(9);
    // A topic find: no followed creator, nobody saved it.
    await pg.db.update(items).set({ sourceId: null, savedBy: null }).where(eq(items.id, id));
    await breakdownItem(pg.db, model().judge, id);
    const counted = async () =>
      (await pg.db.select({ id: standards.id }).from(standards).where(eq(standards.id, id)))
        .length === 1;
    const call = (c: "keep" | "drop") =>
      recordFactCall(pg.db, { client: "wren", id, path: "/", call: c, by: null, source: "cli" });
    expect(await counted()).toBe(false);
    await call("keep");
    expect(await counted()).toBe(true);
    await pg.db.update(items).set({ archivedAt: new Date() }).where(eq(items.id, id));
    expect(await counted()).toBe(false);
    await pg.db.update(items).set({ archivedAt: null }).where(eq(items.id, id));
    await call("drop");
    expect(await counted()).toBe(false);
  });
});

describe("learn back", () => {
  it("keeps our pieces out of Competitors and the standard, and brings a kept pattern ours do worse with back as Check this", async () => {
    // He keeps the contrarian hook on three competitor reels: a rule.
    const theirs = [await readReel(1), await readReel(2), await readReel(3)];
    for (const id of theirs) {
      await breakdownItem(pg.db, model().judge, id);
      await recordFactCall(pg.db, {
        client: "wren",
        id,
        path: "hook_style",
        call: "keep",
        by: null,
        source: "cli",
      });
    }
    // Ten of our posts: the five contrarian ones did worse than the rest.
    const pieces = Array.from({ length: 10 }, (_, i) => ({
      draftId: `00000000-0000-4000-8000-00000000000${i}`,
      kind: "post" as const,
      platform: "threads",
      url: `https://www.threads.com/@synthwren/post/Synth${i}`,
      title: `Ours ${i}`,
      text: `Our post ${i}.`,
      outcome: i < 5 ? 0.01 * (i + 1) : 0.1 * (i - 4),
      measure: "engagement" as const,
    }));
    const { ids, saved } = await saveOurs(pg.db, "wren", pieces);
    expect(saved).toBe(10);
    expect((await saveOurs(pg.db, "wren", pieces)).saved).toBe(0);
    for (const p of pieces) {
      const over = {
        shape: "one-liner",
        ...(Number(p.draftId.slice(-1)) < 5 ? {} : { hook_style: "question" }),
      };
      await breakdownItem(pg.db, model(over as never).judge, ids.get(p.draftId) ?? -1);
    }
    const ourIds = [...ids.values()];
    const listed = await pg.db.select({ id: breakdownRecords.id }).from(breakdownRecords);
    expect(listed.map((r) => r.id).sort()).toEqual(theirs);
    const counted = await pg.db.select({ id: standards.id }).from(standards);
    expect(counted.map((r) => r.id).sort()).toEqual(theirs);

    const values = await ourPatterns(pg.db, ourIds);
    expect(values.size).toBe(10);
    const scope = { kinds: ["reel"], platforms: [], topic: "", set: [] };
    const { patterns } = rulesOf(await callsOf(pg.db, scope, "synth-sop"));
    const ours = pieces.map((p) => ({
      values: values.get(ids.get(p.draftId) ?? -1) ?? new Map(),
      outcome: p.outcome,
    }));
    const rows = checksOf("synth-sop", "post", patterns, ours, "engagement");
    expect(rows.map((r) => r.itemId).sort()).toEqual(theirs);
    expect(rows[0]).toMatchObject({ value: "contrarian", withN: 5, allN: 10 });
    await writeChecks(pg.db, "synth-sop", rows);
    const back = await pg.db
      .select({
        id: breakdownRecords.id,
        check: breakdownRecords.check,
        why: breakdownRecords.checkWhy,
      })
      .from(breakdownRecords);
    expect(back.every((r) => r.check === "check")).toBe(true);
    expect(back[0]?.why).toBe(
      "Hook style contrarian: our 5 with it engaged 3.0%, all our 10 engaged 7.5% (synth-sop)",
    );
    // Too few of ours: nothing is said.
    expect(checksOf("synth-sop", "post", patterns, ours.slice(0, 4), "engagement")).toEqual([]);
    await writeChecks(pg.db, "synth-sop", []);
    const cleared = await pg.db.select({ check: breakdownRecords.check }).from(breakdownRecords);
    expect(cleared.every((r) => r.check === null)).toBe(true);
  });
});
