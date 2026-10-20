/**
 * A subreddit's requirements on Postgres (designs/2026-10-14-reddit-gates.md): learned from a
 * removal's words, an unknown gate held after a removal that says nothing, the rules a place read
 * names. A comment in a sub we don't qualify for stays queued with its reason, comes off the
 * schedule, and goes from the other account when only that one qualifies.
 */
import { resolveObjects } from "@wren/core/objects";
import { fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { ThreadHeld } from "../../src/discovery/requirements.js";
import {
  applyGates,
  backfillFromProofs,
  clearGate,
  gateList,
  gatesFor,
  keepPlace,
  keepRulesNeed,
  learnFromProof,
  learnText,
  planThreadComment,
  queueThreads,
  setNeed,
} from "../../src/index.js";
import { keepProof } from "../../src/proofs.js";
import { scheduleThreads } from "../../src/scheduled.js";
import { draftAccounts, type ReachAccount, redditPlaces, redditThreads } from "../../src/schema.js";

const TABLES = [
  "reddit_requirements",
  "reddit_threads",
  "reddit_places",
  "comment_proofs",
  "reach_accounts",
  "draft_accounts",
];
const NOW = new Date("2026-10-14T15:00:00Z");
const DAY = 86_400_000;
const AUTOMOD =
  'only visible signed in: [removed] for strangers; AutoModerator: "Your account must be 10+ days old with 50+ karma to comment here."';

let pg: TestPostgres;
const db = () => pg.db;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
});

async function account(key: string, handle: string, days: number, karma: number) {
  const a = await addAccount(db(), { platform: "reddit", account: key, now: NOW });
  const ch = fakeOutreachChannel("reddit", { account: key, now: () => NOW });
  ch.setHealth({ handle, createdAt: new Date(NOW.getTime() - days * DAY).toISOString(), karma });
  await refreshHealth(db(), [a], () => ch, NOW);
  return setAccountState(db(), a.id, "warming", {
    reason: null,
    now: NOW,
  }) as Promise<ReachAccount>;
}

async function place(sub: string, accountId: string | null, purpose: "reach" | "karma" = "reach") {
  await db()
    .insert(redditPlaces)
    .values({ subreddit: sub, name: sub, foundBy: "named", state: "watching", accountId, purpose });
}

async function thread(id: string, sub: string, accountId: string | null, draft = "A fact.") {
  await resolveObjects(db(), [{ platform: "reddit", kind: "post", raw: id }]);
  await db()
    .insert(redditThreads)
    .values({
      id,
      subreddit: sub,
      title: "How do you chase late invoices?",
      body: "Hours a week.",
      author: "owner1",
      url: `https://example.com/${id}`,
      postedAt: new Date(NOW.getTime() - 3_600_000),
      comments: 2,
      raw: {},
      state: "queued",
      draft,
      fit: 8,
      accountId,
    });
}

const removal = (state: "hidden" | "missing", note: string | null) => ({
  state,
  note,
  checkedAt: NOW.toISOString(),
  url: null,
  shot: null,
});

describe("reddit requirements", () => {
  it("learns the floor from a removal's words and holds a thread with the reason", async () => {
    const alt = await account("reddit@alt", "alt_user", 4, 1);
    await place("salestechniques", alt.id);
    await thread("t3_synth1", "salestechniques", alt.id);
    await keepProof(db(), "thread:t3_synth1", "reddit", removal("hidden", AUTOMOD), 1);

    const gate = (await gatesFor(db(), ["salestechniques"], NOW)).get("salestechniques");
    expect(gate?.ok).toBe(false);
    expect(gate?.reason).toBe(
      "r/salestechniques needs 10 days old and 50 karma, reddit@alt has 4 days and 1",
    );
    await expect(planThreadComment(db(), "t3_synth1", NOW)).rejects.toBeInstanceOf(ThreadHeld);
    // Held, not dropped.
    const [t] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_synth1"));
    expect(t?.state).toBe("queued");
  });

  it("holds the sub when a removal says nothing, until a live check or a clear", async () => {
    const wren = await account("reddit@wren", "wren_user", 90, 400);
    await place("quietmods", wren.id);
    await keepProof(
      db(),
      "thread:t3_synth2",
      "reddit",
      removal("missing", "[removed] to its author"),
      1,
    );
    // The thread is unknown here: nothing learned, nothing held.
    expect((await gatesFor(db(), null, NOW)).size).toBe(0);

    await thread("t3_synth2", "quietmods", wren.id);
    await learnFromProof(db(), "thread:t3_synth2", removal("missing", "[removed] to its author"));
    const g = (await gatesFor(db(), ["quietmods"], NOW)).get("quietmods");
    expect(g).toMatchObject({ ok: false, hold: true });
    expect(g?.reason).toContain("did not say why");
    await expect(planThreadComment(db(), "t3_synth2", NOW)).rejects.toBeInstanceOf(ThreadHeld);

    // A removal he cleared is not held again by the same item's next check.
    expect(await clearGate(db(), "quietmods", NOW)).toBe(1);
    await learnFromProof(db(), "thread:t3_synth2", removal("missing", "[removed] to its author"));
    expect((await gatesFor(db(), ["quietmods"], NOW)).size).toBe(0);
    await expect(planThreadComment(db(), "t3_synth2", NOW)).resolves.toBeDefined();
  });

  it("a held karma sub queues nothing more; a held reach sub still queues for his clear", async () => {
    const wren = await account("reddit@wren", "wren_user", 90, 400);
    await place("karmasub", wren.id, "karma");
    await place("reachsub", wren.id);
    const ids = { karmasub: "t3_karma1", reachsub: "t3_reach1" } as const;
    for (const sub of ["karmasub", "reachsub"] as const) {
      await thread(ids[sub], sub, wren.id);
      await db()
        .update(redditThreads)
        .set({ state: "ranked", draft: null })
        .where(eq(redditThreads.id, ids[sub]));
      await learnFromProof(
        db(),
        `thread:${ids[sub]}`,
        removal("missing", "[removed] to its author"),
      );
    }
    expect((await gatesFor(db(), ["karmasub"], NOW)).get("karmasub")?.hold).toBe(true);
    expect(await queueThreads(db(), "karmasub", NOW)).toEqual([]);
    expect(await queueThreads(db(), "reachsub", NOW)).toEqual([ids.reachsub]);
    // Cleared, the karma sub queues again.
    await clearGate(db(), "karmasub", NOW);
    expect(await queueThreads(db(), "karmasub", NOW)).toEqual([ids.karmasub]);
  });

  it("lifts a hold when the same comment is live again", async () => {
    const wren = await account("reddit@wren", "wren_user", 90, 400);
    await place("filtered", wren.id);
    await thread("t3_synth3", "filtered", wren.id);
    await learnFromProof(db(), "thread:t3_synth3", removal("hidden", "only visible signed in: x"));
    expect((await gatesFor(db(), ["filtered"], NOW)).get("filtered")?.ok).toBe(false);
    await learnFromProof(db(), "thread:t3_synth3", { ...removal("hidden", null), state: "live" });
    expect((await gatesFor(db(), ["filtered"], NOW)).size).toBe(0);
  });

  it("sends from the other account when only it qualifies, and moves the place", async () => {
    const alt = await account("reddit@alt", "alt_user", 4, 1);
    const wren = await account("reddit@wren", "wren_user", 90, 400);
    await place("salestechniques", alt.id);
    await thread("t3_synth1", "salestechniques", alt.id);
    await learnFromProof(db(), "thread:t3_synth1", removal("hidden", AUTOMOD));
    // No comment of ours is left to hold the sub: the floor alone decides.
    const plan = await planThreadComment(db(), "t3_synth1", NOW);
    expect(plan.account.id).toBe(wren.id);

    await applyGates(db(), NOW);
    const [p] = await db()
      .select()
      .from(redditPlaces)
      .where(eq(redditPlaces.subreddit, "salestechniques"));
    const [t] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_synth1"));
    expect(p?.accountId).toBe(wren.id);
    expect(t?.accountId).toBe(wren.id);
  });

  it("keeps a gated sub's comments off the schedule, and slots them once the floor is met", async () => {
    const alt = await account("reddit@alt", "alt_user", 30, 1);
    await place("salestechniques", alt.id);
    await place("openforall", alt.id);
    await thread("t3_synth1", "salestechniques", alt.id);
    await thread("t3_synth4", "openforall", alt.id);
    await learnFromProof(db(), "thread:t3_synth1", removal("hidden", AUTOMOD));

    const slots = await scheduleThreads(db(), { now: NOW, rand: () => 0 });
    expect(slots.map((s) => s.id)).toEqual(["t3_synth4"]);
    const [held] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_synth1"));
    expect(held).toMatchObject({ state: "queued", sendAt: null });

    // Karma arrives: the next pass slots it.
    const ch = fakeOutreachChannel("reddit", { account: "reddit@alt", now: () => NOW });
    ch.setHealth({
      handle: "alt_user",
      createdAt: new Date(NOW.getTime() - 30 * DAY).toISOString(),
      karma: 80,
    });
    await refreshHealth(db(), [alt], () => ch, NOW);
    const later = await scheduleThreads(db(), { now: NOW, rand: () => 0 });
    expect(later.map((s) => s.id)).toEqual(["t3_synth1"]);
  });

  it("a picked account short of the floor still gets its slot; an unexplained removal holds it", async () => {
    const alt = await account("reddit@alt", "alt_user", 30, 1);
    const wren = await account("reddit@wren", "wren_user", 30, 2);
    await place("salestechniques", wren.id);
    await thread("t3_synth1", "salestechniques", wren.id);
    await setNeed(db(), "salestechniques", { minKarma: 50 }, "by hand");
    await db().insert(draftAccounts).values({ item: "thread:t3_synth1", account: "reddit@alt" });

    const slots = await scheduleThreads(db(), { now: NOW, rand: () => 0 });
    expect(slots.map((s) => s.id)).toEqual(["t3_synth1"]);
    // A later gate pass leaves the pick's slot alone.
    await applyGates(db(), NOW);
    const [t] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_synth1"));
    expect(t?.sendAt).not.toBeNull();
    expect((await planThreadComment(db(), "t3_synth1", NOW)).account.id).toBe(alt.id);

    // A removal that says nothing holds every account, picked or not.
    await learnFromProof(db(), "thread:t3_synth1", removal("hidden", null));
    await applyGates(db(), NOW);
    const [held] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_synth1"));
    expect(held?.sendAt).toBeNull();
    await expect(planThreadComment(db(), "t3_synth1", NOW)).rejects.toBeInstanceOf(ThreadHeld);
  });

  it("a gate set clears a window: an already scheduled comment leaves the schedule", async () => {
    const alt = await account("reddit@alt", "alt_user", 30, 1);
    await place("openforall", alt.id);
    await thread("t3_synth4", "openforall", alt.id);
    await scheduleThreads(db(), { now: NOW, rand: () => 0 });
    const [slotted] = await db().select().from(redditThreads);
    expect(slotted?.sendAt).not.toBeNull();
    await setNeed(db(), "openforall", { minKarma: 25 }, "by hand");
    await applyGates(db(), NOW);
    const [after] = await db().select().from(redditThreads);
    expect(after?.sendAt).toBeNull();
    expect(after?.state).toBe("queued");
  });

  it("reads floors from the rules a place read names, and drops them when the rules stop", async () => {
    await account("reddit@alt", "alt_user", 30, 1);
    await place("rulesy", null);
    await keepRulesNeed(
      db(),
      "rulesy",
      null,
      "- Karma: comments need 25 comment karma.\n- Be kind: no insults, 50 words minimum",
    );
    const [row] = await gateList(db(), NOW);
    expect(row?.need).toMatchObject({ minCommentKarma: 25, minKarma: null });
    await keepRulesNeed(db(), "rulesy", null, "- Be kind: no insults");
    expect(await gateList(db(), NOW)).toEqual([]);
  });

  it("keepPlace keeps the model's karma and age floors", async () => {
    await account("reddit@alt", "alt_user", 30, 1);
    await db()
      .insert(redditPlaces)
      .values({ subreddit: "judged", name: "judged", foundBy: "named" });
    await keepPlace(
      db(),
      "judged",
      {
        about: {
          display_name: "judged",
          title: "judged",
          subscribers: 10,
          subreddit_type: "public",
        },
        rules: { rules: [] },
        top: [],
        latest: [],
      },
      {
        fit: 8,
        why: "fits",
        rules: "",
        mayComment: true,
        mayPost: true,
        linkOnly: false,
        karmaMin: 100,
        ageMinDays: 30,
        postsADay: 5,
        medianComments: 4,
      },
      NOW,
    );
    expect((await gateList(db(), NOW))[0]?.need).toMatchObject({ minKarma: 100, minAgeDays: 30 });
  });

  it("keeps the floor of words he pastes, and refuses words with none", async () => {
    await place("salestechniques", null);
    await expect(learnText(db(), "r/SalesTechniques", "removed by a mod", NOW)).rejects.toThrow(
      /no days or karma/,
    );
    expect(
      await learnText(db(), "r/SalesTechniques", "needs 10 days and 50 karma", NOW),
    ).toMatchObject({ minAgeDays: 10, minKarma: 50 });
    expect((await gateList(db(), NOW))[0]?.subreddit).toBe("salestechniques");
  });

  it("backfills from the proofs already kept", async () => {
    const alt = await account("reddit@alt", "alt_user", 4, 1);
    await place("salestechniques", alt.id);
    await thread("t3_synth1", "salestechniques", alt.id);
    await db().execute(
      sql`insert into comment_proofs (item, platform, state, note, checked_at, checks) values ('thread:t3_synth1', 'reddit', 'hidden', ${AUTOMOD}, ${NOW.toISOString()}::timestamptz, '[]'::jsonb)`,
    );
    expect(await backfillFromProofs(db())).toBe(1);
    expect((await gateList(db(), NOW))[0]).toMatchObject({
      subreddit: "salestechniques",
      need: { minAgeDays: 10, minKarma: 50 },
      hold: false,
    });
  });
});
