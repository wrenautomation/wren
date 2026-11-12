/**
 * What a subreddit asks of an account before our comment stays up (designs/2026-10-14-reddit-gates.md).
 *
 * Learned three ways: a removal whose words state the floor ("account must be 10+ days old with
 * 50+ karma", `learnFromProof`), the rules the place read names (`keepRulesNeed`), or by hand
 * (`setNeed`). A removal that states nothing is an unknown gate: held for every account until
 * he clears it. The account's standing is the health read already stored on `reach_accounts`
 * (age, karma, comment karma), refreshed by the watch pass; no new Reddit reads.
 *
 * The floor math and `gatesFor` are acts' (`@wren/starling-acts` gates.ts); this file learns,
 * sets and clears the floors, and applies the gates to the thread schedule.
 */

import type { Queryable } from "@wren/db";
import {
  effectiveNeed,
  type Gate,
  gatesFor,
  hasNumbers,
  maxOf,
  type Need,
  type PlaceJudged,
  parseNeed,
  ReachRefusal,
  type RequirementSource,
  redditPlaces,
  redditRequirements,
} from "@wren/starling-acts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { redditThreads } from "../schema.js";

/** Raised at the send: the comment stays queued; the message is the hold reason. */
export class ThreadHeld extends ReachRefusal {}

/** Keep the sub's place on the account that qualifies: its queued threads move with it. */
async function moveToQualifying(db: Queryable, sub: string, accountId: string): Promise<void> {
  await db.update(redditPlaces).set({ accountId }).where(eq(redditPlaces.subreddit, sub));
  await db
    .update(redditThreads)
    .set({ accountId })
    .where(and(eq(redditThreads.subreddit, sub), eq(redditThreads.state, "queued")));
}

/** A thread someone picked an account for (`draft_accounts`): it goes out as picked. */
const pickedSql = sql`exists (select 1 from draft_accounts da where da.item = 'thread:' || ${redditThreads.id})`;

/** Whether a gate holds a thread: a pick passes a karma or age floor, never an unexplained removal. */
export const holdsThread = (g: Gate | undefined, picked: boolean): boolean =>
  Boolean(g && !g.ok && (!picked || g.hold));

/**
 * Before the scheduler slots anything: a gated sub's queued comments leave the schedule, and a
 * sub whose own account doesn't qualify but another does moves to that one. Answers every gate.
 */
export async function applyGates(db: Queryable, now: Date): Promise<Map<string, Gate>> {
  const gates = await gatesFor(db, null, now);
  for (const [sub, g] of gates) {
    if (g.ok && g.switched && g.accountId) await moveToQualifying(db, sub, g.accountId);
    // A person's pick keeps its slot (the shortfall was warned on the picker), unless the sub
    // removed our last comment without saying why: that holds every account.
    if (!g.ok)
      await db
        .update(redditThreads)
        .set({ sendAt: null })
        .where(
          and(
            eq(redditThreads.subreddit, sub),
            eq(redditThreads.state, "queued"),
            sql`${redditThreads.sendAt} is not null`,
            ...(g.hold ? [] : [sql`not ${pickedSql}`]),
          ),
        );
  }
  return gates;
}

const EVIDENCE = 300;
const trim = (s: string | null) => (s ? s.replace(/\s+/g, " ").trim().slice(0, EVIDENCE) : null);

async function rowOf(db: Queryable, sub: string, source: RequirementSource) {
  return (
    await db
      .select()
      .from(redditRequirements)
      .where(and(eq(redditRequirements.subreddit, sub), eq(redditRequirements.source, source)))
  )[0];
}

async function keep(
  db: Queryable,
  sub: string,
  source: RequirementSource,
  v: Partial<typeof redditRequirements.$inferInsert>,
): Promise<void> {
  await db
    .insert(redditRequirements)
    .values({ subreddit: sub, source, ...v })
    .onConflictDoUpdate({
      target: [redditRequirements.subreddit, redditRequirements.source],
      set: v,
    });
}

const placeExists = async (db: Queryable, sub: string) =>
  (
    await db
      .select({ s: redditPlaces.subreddit })
      .from(redditPlaces)
      .where(eq(redditPlaces.subreddit, sub))
  ).length > 0;

/** The subreddit a thread proof item (`thread:t3_x`) was sent in; null for other items. */
async function subOfItem(db: Queryable, item: string): Promise<string | null> {
  const m = /^thread:(t3_[a-z0-9]+)$/i.exec(item);
  if (!m) return null;
  const [t] = await db
    .select({ s: redditThreads.subreddit })
    .from(redditThreads)
    .where(eq(redditThreads.id, m[1] as string));
  return t?.s ?? null;
}

/**
 * A check of our Reddit thread comment. Hidden or missing: the words that came with it may state
 * the floor (kept as numbers); if not, the gate is unknown and the sub is held. Live: a hold that
 * came from this very item lifts (a mod approved it). Pending changes nothing.
 */
/** True when a hidden or missing comment's sub now carries the removal: the gate acts on it. */
export async function learnFromProof(
  db: Queryable,
  item: string,
  proof: { state: string; note: string | null; checkedAt: string },
): Promise<boolean> {
  if (proof.state === "pending") return false;
  const sub = await subOfItem(db, item);
  if (!sub) return false;
  const was = await rowOf(db, sub, "removal");
  if (proof.state === "live") {
    if (was?.hold && was.item === item) await keep(db, sub, "removal", { hold: false });
    return false;
  }
  if (proof.state !== "hidden" && proof.state !== "missing") return false;
  // A removal he already judged by hand is not learned twice.
  if (was?.clearedAt && was.item === item) return false;
  const need = parseNeed(proof.note ?? "");
  const merged: Need = {
    minAgeDays: maxOf(was?.clearedAt ? null : (was?.minAgeDays ?? null), need.minAgeDays),
    minKarma: maxOf(was?.clearedAt ? null : (was?.minKarma ?? null), need.minKarma),
    minCommentKarma: maxOf(
      was?.clearedAt ? null : (was?.minCommentKarma ?? null),
      need.minCommentKarma,
    ),
    other: need.other ?? (was?.clearedAt ? null : (was?.other ?? null)),
  };
  await keep(db, sub, "removal", {
    ...merged,
    // A stated floor is the gate; without one the removal itself holds the sub.
    hold: !hasNumbers(merged),
    item,
    evidence: trim(proof.note) ?? `${proof.state} for strangers`,
    learnedAt: new Date(proof.checkedAt),
    clearedAt: null,
  });
  return true;
}

/** Every hidden or missing Reddit thread proof, replayed oldest first: the backfill. */
export async function backfillFromProofs(db: Queryable): Promise<number> {
  const rows = (await db.execute(sql`
    select item, state, note, checked_at from comment_proofs
    where platform = 'reddit' and item like 'thread:%' and state in ('hidden', 'missing', 'live')
    order by checked_at`)) as unknown as
    | Array<{ item: string; state: string; note: string | null; checked_at: Date | string }>
    | {
        rows: Array<{
          item: string;
          state: string;
          note: string | null;
          checked_at: Date | string;
        }>;
      };
  const list = Array.isArray(rows) ? rows : rows.rows;
  for (const r of list)
    await learnFromProof(db, r.item, {
      state: r.state,
      note: r.note,
      checkedAt: new Date(r.checked_at).toISOString(),
    });
  return list.length;
}

/**
 * The rules a place read names, as floors for a comment: the model's `karmaMin`/`ageMinDays`,
 * and any rule line about comments that states one. Replaces this source's row on every read.
 */
export async function keepRulesNeed(
  db: Queryable,
  sub: string,
  judged: PlaceJudged | null,
  rules: string,
): Promise<void> {
  if (!(await placeExists(db, sub))) return;
  const lines = rules
    .split("\n")
    .filter((l) => /comment/i.test(l))
    .map(parseNeed);
  const need: Need = {
    minAgeDays: lines.reduce(
      (a, n) => maxOf(a, n.minAgeDays),
      judged?.ageMinDays && judged.ageMinDays > 0 ? Math.round(judged.ageMinDays) : null,
    ),
    minKarma: lines.reduce(
      (a, n) => maxOf(a, n.minKarma),
      judged?.karmaMin && judged.karmaMin > 0 ? Math.round(judged.karmaMin) : null,
    ),
    minCommentKarma: lines.reduce<number | null>((a, n) => maxOf(a, n.minCommentKarma), null),
    other: lines.map((n) => n.other).find(Boolean) ?? null,
  };
  const was = await rowOf(db, sub, "rules");
  if (!hasNumbers(need) && !need.other) {
    if (was)
      await db
        .delete(redditRequirements)
        .where(and(eq(redditRequirements.subreddit, sub), eq(redditRequirements.source, "rules")));
    return;
  }
  const same =
    was &&
    was.minAgeDays === need.minAgeDays &&
    was.minKarma === need.minKarma &&
    was.minCommentKarma === need.minCommentKarma;
  await keep(db, sub, "rules", {
    ...need,
    hold: false,
    item: null,
    evidence:
      trim(
        rules
          .split("\n")
          .filter((l) => /karma|days|old|age/i.test(l))
          .join(" "),
      ) ?? "the place's rules",
    clearedAt: same ? was.clearedAt : null,
  });
}

/** `r/SalesTechniques` → `salestechniques`: how places are keyed. */
const subKey = (s: string): string =>
  s
    .replace(/^\/?r\//i, "")
    .trim()
    .toLowerCase();

/** By hand: the floors for a sub (null clears a field). */
export async function setNeed(
  db: Queryable,
  subName: string,
  need: Partial<Need>,
  note: string | null,
): Promise<void> {
  const sub = subKey(subName);
  if (!(await placeExists(db, sub))) throw new ReachRefusal(`no place r/${sub}`);
  const was = await rowOf(db, sub, "manual");
  await keep(db, sub, "manual", {
    minAgeDays: need.minAgeDays === undefined ? (was?.minAgeDays ?? null) : need.minAgeDays,
    minKarma: need.minKarma === undefined ? (was?.minKarma ?? null) : need.minKarma,
    minCommentKarma:
      need.minCommentKarma === undefined ? (was?.minCommentKarma ?? null) : need.minCommentKarma,
    other: need.other === undefined ? (was?.other ?? null) : need.other,
    hold: false,
    evidence: trim(note) ?? "set by hand",
    clearedAt: null,
  });
}

/**
 * A moderator's words he pastes: the floor they state, kept as a removal. Words with no floor in
 * them are refused (use `setNeed`, or leave the hold).
 */
export async function keepStatedFloor(
  db: Queryable,
  subName: string,
  text: string,
  now: Date,
): Promise<Need> {
  const sub = subKey(subName);
  if (!(await placeExists(db, sub))) throw new ReachRefusal(`no place r/${sub}`);
  const need = parseNeed(text);
  if (!hasNumbers(need)) throw new ReachRefusal("no days or karma in those words");
  const was = await rowOf(db, sub, "removal");
  const merged: Need = {
    minAgeDays: maxOf(was?.clearedAt ? null : (was?.minAgeDays ?? null), need.minAgeDays),
    minKarma: maxOf(was?.clearedAt ? null : (was?.minKarma ?? null), need.minKarma),
    minCommentKarma: maxOf(
      was?.clearedAt ? null : (was?.minCommentKarma ?? null),
      need.minCommentKarma,
    ),
    other: need.other,
  };
  await keep(db, sub, "removal", {
    ...merged,
    hold: false,
    evidence: trim(text),
    learnedAt: now,
    clearedAt: null,
  });
  return merged;
}

/** He lifts every hold and floor on a sub (the next removal brings them back). */
export async function clearGate(db: Queryable, subName: string, now: Date): Promise<number> {
  const sub = subKey(subName);
  const made = await db
    .update(redditRequirements)
    .set({ hold: false, clearedAt: now })
    .where(and(eq(redditRequirements.subreddit, sub), isNull(redditRequirements.clearedAt)))
    .returning({ s: redditRequirements.subreddit });
  return made.length;
}

interface GateRow {
  subreddit: string;
  name: string;
  need: Need;
  hold: boolean;
  /** Where each fact came from: "removal 2026-10-14: AutoModerator …". */
  from: string[];
  gate: Gate | null;
}

/** Every sub with a floor or a hold, for the list: its facts and the gate now. */
export async function gateList(db: Queryable, now: Date): Promise<GateRow[]> {
  const rows = await db.select().from(redditRequirements);
  const gates = await gatesFor(db, null, now);
  const names = new Map(
    (await db.select({ s: redditPlaces.subreddit, n: redditPlaces.name }).from(redditPlaces)).map(
      (p) => [p.s, p.n] as const,
    ),
  );
  const subs = [...new Set(rows.map((r) => r.subreddit))].sort();
  return subs.flatMap((s) => {
    const mine = rows.filter((r) => r.subreddit === s);
    const n = effectiveNeed(mine);
    if (!hasNumbers(n) && !n.hold && !n.other) return [];
    return [
      {
        subreddit: s,
        name: names.get(s) ?? s,
        need: {
          minAgeDays: n.minAgeDays,
          minKarma: n.minKarma,
          minCommentKarma: n.minCommentKarma,
          other: n.other,
        },
        hold: n.hold,
        from: mine
          .filter((r) => !r.clearedAt)
          .map((r) =>
            `${r.source} ${r.learnedAt.toISOString().slice(0, 10)}: ${r.evidence ?? ""}`.trim(),
          ),
        gate: gates.get(s) ?? null,
      },
    ];
  });
}
