/**
 * What a subreddit asks of an account before our comment stays up (designs/2026-10-14-reddit-gates.md).
 *
 * Learned three ways: a removal whose words state the floor ("account must be 10+ days old with
 * 50+ karma", `learnFromProof`), the rules the place read names (`keepRulesNeed`), or by hand
 * (`setNeed`). A removal that states nothing is an unknown gate: held for every account until
 * he clears it. The account's standing is the health read already stored on `reach_accounts`
 * (age, karma, comment karma), refreshed by the watch pass; no new Reddit reads.
 *
 * `gatesFor` is the one question: may this sub's thread comment go out, and from which account.
 * It writes nothing. The scheduler and the send ask it and keep a held comment queued.
 */
import { warmupOf } from "@wren/channel-reddit";
import type { AccountHealth } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ReachRefusal } from "../refusal.js";
import {
  type PlaceJudged,
  type ReachAccount,
  type RedditRequirement,
  type RequirementSource,
  reachAccounts,
  redditPlaces,
  redditRequirements,
  redditThreads,
} from "../schema.js";

/** A floor as a message states it; null = not stated. */
export interface Need {
  minAgeDays: number | null;
  minKarma: number | null;
  minCommentKarma: number | null;
  /** A gate we can't count (a verified email): shown, never enforced. */
  other: string | null;
}

export const NO_NEED: Need = {
  minAgeDays: null,
  minKarma: null,
  minCommentKarma: null,
  other: null,
};

export const hasNumbers = (n: Need): boolean =>
  n.minAgeDays !== null || n.minKarma !== null || n.minCommentKarma !== null;

const DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const sane = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max;
const num = (s: string) => Number(s.replace(/,/g, ""));
const maxOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);

/**
 * The floors a message states: "account must be 10+ days old with 50+ karma", "at least 100
 * comment karma", "accounts under 30 days old". Post karma is not comment karma, so it lands in
 * `other`. Numbers about anything but the account (a thread's "last 7 days") are left alone.
 */
export function parseNeed(raw: string): Need {
  const text = raw.replace(/\s+/g, " ").toLowerCase();
  let minAgeDays: number | null = null;
  let minKarma: number | null = null;
  let minCommentKarma: number | null = null;
  const other: string[] = [];

  for (const m of text.matchAll(/(\d{1,4})\s*\+?\s*-?\s*(day|week|month|year)s?/g)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 40), at);
    const near = `${before} ${text.slice(at, at + m[0].length + 40)}`;
    if (/(within|in the|over the|during the|last|past|every|per|next)\s*$/.test(before)) continue;
    // About the account: it says so nearby, or the words are about karma ("10 days and 50 karma").
    if (
      !/account|\bold\b|\bage\b|member|young|created|joined|registered/.test(near) &&
      !/karma/.test(text)
    )
      continue;
    const d = num(m[1] as string) * (DAYS[m[2] as string] ?? 1);
    if (sane(d, 3650)) minAgeDays = maxOf(minAgeDays, d);
  }

  const kind = (q: string | undefined): "total" | "comment" | "post" =>
    q?.trim() === "comment"
      ? "comment"
      : q?.trim() === "post" || q?.trim() === "link"
        ? "post"
        : "total";
  const karma = (n: number, q: string | undefined) => {
    if (!sane(n, 1_000_000)) return;
    const k = kind(q);
    if (k === "comment") minCommentKarma = maxOf(minCommentKarma, n);
    else if (k === "post") other.push(`${n} post karma`);
    else minKarma = maxOf(minKarma, n);
  };
  for (const m of text.matchAll(
    /(\d[\d,]*)\s*\+?\s*(comment |post |link |total |combined )?karma/g,
  ))
    karma(num(m[1] as string), m[2]);
  for (const m of text.matchAll(
    /(comment |post |link |total |combined )?karma(?: score)?(?: of| is| at least| minimum| over| above| >=?|:)?\s+(?:of\s+)?(\d[\d,]*)(?!\s*\+?\s*-?\s*(?:day|week|month|year))/g,
  ))
    karma(num(m[2] as string), m[1]);

  if (/verified e-?mail|e-?mail (?:must be )?verif/.test(text)) other.push("verified email");
  return {
    minAgeDays,
    minKarma,
    minCommentKarma,
    other: [...new Set(other)].join(", ") || null,
  };
}

/** What an account has, read off its stored health. Null = not read yet. */
export interface AccountStanding {
  account: string;
  ageDays: number | null;
  karma: number | null;
  commentKarma: number | null;
}

export function standingOfAccount(a: ReachAccount, now: Date): AccountStanding {
  const h = a.health as AccountHealth | null;
  if (!h) return { account: a.account, ageDays: null, karma: null, commentKarma: null };
  const w = warmupOf(h, now);
  const ck = (h.raw as { comment_karma?: unknown } | null)?.comment_karma;
  return {
    account: a.account,
    ageDays: h.createdAt ? w.ageDays : null,
    karma: h.karma ?? null,
    commentKarma: typeof ck === "number" ? ck : null,
  };
}

export interface Shortfall {
  /** What is missing, as the sub states it: "10 days old", "50 karma". */
  needs: string[];
  /** What the account has for each, in the same order: "3 days", "1". */
  has: string[];
}

/** Each floor the account is under. Empty = it qualifies. A floor it can't be read for is under. */
export function shortfall(need: Need, s: AccountStanding): Shortfall {
  const out: Shortfall = { needs: [], has: [] };
  const under = (floor: number | null, have: number | null, name: string, unit: string) => {
    if (floor === null || (have !== null && have >= floor)) return;
    out.needs.push(`${floor} ${name}`);
    out.has.push(have === null ? "?" : unit ? `${have} ${unit}` : String(have));
  };
  under(need.minAgeDays, s.ageDays, "days old", "days");
  under(need.minKarma, s.karma, "karma", "");
  under(need.minCommentKarma, s.commentKarma, "comment karma", "");
  return out;
}

export interface Gate {
  /** May a thread comment go out in this sub. */
  ok: boolean;
  /** Why not, in one line: "r/X needs 50 karma, reddit@alt has 1". */
  reason: string | null;
  /** The account that qualifies (ok), or null when the place's own does or no floor is known. */
  accountId: string | null;
  /** The place's pinned account didn't qualify and this one does. */
  switched: boolean;
  need: Need;
  /** An unknown gate: our last comment was removed and said nothing. */
  hold: boolean;
}

/** The floors of a sub's rows not cleared: the highest of each. */
export function effectiveNeed(rows: readonly RedditRequirement[]): Need & { hold: boolean } {
  const live = rows.filter((r) => !r.clearedAt);
  const others = live.flatMap((r) => (r.other ? [r.other] : []));
  return {
    minAgeDays: live.reduce<number | null>((a, r) => maxOf(a, r.minAgeDays), null),
    minKarma: live.reduce<number | null>((a, r) => maxOf(a, r.minKarma), null),
    minCommentKarma: live.reduce<number | null>((a, r) => maxOf(a, r.minCommentKarma), null),
    other: [...new Set(others)].join(", ") || null,
    hold: live.some((r) => r.hold),
  };
}

const sentence = (n: Need): string =>
  [
    n.minAgeDays !== null ? `${n.minAgeDays} days old` : null,
    n.minKarma !== null ? `${n.minKarma} karma` : null,
    n.minCommentKarma !== null ? `${n.minCommentKarma} comment karma` : null,
  ]
    .filter(Boolean)
    .join(" and ");

/** The one-line answer for one sub, from its floors and the accounts that might send. Pure. */
export function decide(
  name: string,
  pinned: string | null,
  need: Need & { hold: boolean },
  pool: readonly { id: string; standing: AccountStanding }[],
): Gate {
  const base = { need: { ...need }, hold: need.hold, switched: false, accountId: null };
  if (!hasNumbers(need) && !need.hold) return { ...base, ok: true, reason: null };
  if (need.hold && !hasNumbers(need))
    return {
      ...base,
      ok: false,
      reason: `r/${name} removed our last comment and did not say why. Held until you clear it`,
    };
  const order = [...pool].sort((a, b) => Number(b.id === pinned) - Number(a.id === pinned));
  const first = order.find((c) => shortfall(need, c.standing).needs.length === 0);
  if (first && !need.hold)
    return { ...base, ok: true, reason: null, accountId: first.id, switched: first.id !== pinned };
  if (need.hold)
    return {
      ...base,
      ok: false,
      reason: `r/${name} removed our last comment and did not say why. Held until you clear it`,
    };
  if (!order.length)
    return {
      ...base,
      ok: false,
      reason: `r/${name} needs ${sentence(need)}: no account to send from`,
    };
  const parts = order.map((c) => {
    const s = shortfall(need, c.standing);
    return { who: c.standing.account, s };
  });
  const head = parts[0] as (typeof parts)[number];
  const rest = parts.slice(1).map((p) => `${p.who} has ${p.s.has.join(" and ")}`);
  return {
    ...base,
    ok: false,
    reason: `r/${name} needs ${head.s.needs.join(" and ")}, ${head.who} has ${head.s.has.join(" and ")}${rest.length ? ` (${rest.join(", ")})` : ""}`,
  };
}

/** Raised at the send: the comment stays queued; the message is the hold reason. */
export class ThreadHeld extends ReachRefusal {}

/**
 * The gate for each sub that has a floor or a hold. A sub with none is absent: nothing holds it.
 * `subs` null = every sub with a floor. Writes nothing.
 */
export async function gatesFor(
  db: Queryable,
  subs: readonly string[] | null,
  now: Date,
): Promise<Map<string, Gate>> {
  const rows = await db
    .select()
    .from(redditRequirements)
    .where(subs ? inArray(redditRequirements.subreddit, [...subs]) : sql`true`);
  const bySub = new Map<string, RedditRequirement[]>();
  for (const r of rows) bySub.set(r.subreddit, [...(bySub.get(r.subreddit) ?? []), r]);
  const wanted = [...bySub.keys()].filter((s) => {
    const n = effectiveNeed(bySub.get(s) ?? []);
    return hasNumbers(n) || n.hold;
  });
  const out = new Map<string, Gate>();
  if (!wanted.length) return out;
  const places = await db
    .select({
      sub: redditPlaces.subreddit,
      name: redditPlaces.name,
      account: redditPlaces.accountId,
    })
    .from(redditPlaces)
    .where(inArray(redditPlaces.subreddit, wanted));
  const accounts = await db
    .select()
    .from(reachAccounts)
    .where(
      and(
        eq(reachAccounts.platform, "reddit"),
        inArray(reachAccounts.state, ["active", "warming"]),
      ),
    );
  const pool = accounts
    .filter((a) => !(a.health && warmupOf(a.health as AccountHealth, now).frozen))
    .map((a) => ({ id: a.id, standing: standingOfAccount(a, now) }));
  for (const p of places)
    out.set(p.sub, decide(p.name, p.account, effectiveNeed(bySub.get(p.sub) ?? []), pool));
  return out;
}

/** Keep the sub's place on the account that qualifies: its queued threads move with it. */
export async function moveToQualifying(
  db: Queryable,
  sub: string,
  accountId: string,
): Promise<void> {
  await db.update(redditPlaces).set({ accountId }).where(eq(redditPlaces.subreddit, sub));
  await db
    .update(redditThreads)
    .set({ accountId })
    .where(and(eq(redditThreads.subreddit, sub), eq(redditThreads.state, "queued")));
}

/**
 * Before the scheduler slots anything: a gated sub's queued comments leave the schedule, and a
 * sub whose own account doesn't qualify but another does moves to that one. Answers every gate.
 */
export async function applyGates(db: Queryable, now: Date): Promise<Map<string, Gate>> {
  const gates = await gatesFor(db, null, now);
  for (const [sub, g] of gates) {
    if (g.ok && g.switched && g.accountId) await moveToQualifying(db, sub, g.accountId);
    if (!g.ok)
      await db
        .update(redditThreads)
        .set({ sendAt: null })
        .where(
          and(
            eq(redditThreads.subreddit, sub),
            eq(redditThreads.state, "queued"),
            sql`${redditThreads.sendAt} is not null`,
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
export async function learnFromProof(
  db: Queryable,
  item: string,
  proof: { state: string; note: string | null; checkedAt: string },
): Promise<void> {
  if (proof.state === "pending") return;
  const sub = await subOfItem(db, item);
  if (!sub) return;
  const was = await rowOf(db, sub, "removal");
  if (proof.state === "live") {
    if (was?.hold && was.item === item) await keep(db, sub, "removal", { hold: false });
    return;
  }
  if (proof.state !== "hidden" && proof.state !== "missing") return;
  // A removal he already judged by hand is not learned twice.
  if (was?.clearedAt && was.item === item) return;
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
export const subKey = (s: string): string =>
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
export async function learnText(
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

export interface GateRow {
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
