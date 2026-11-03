/**
 * A subreddit's floor and whether an account clears it (designs/2026-10-14-reddit-gates.md).
 *
 * The floors are `reddit_requirements` rows (a removal's words, the rules read, or set by hand);
 * the account's standing is the health read stored on `reach_accounts` (age, karma, comment
 * karma). `gatesFor` is the one question: may this sub's comment or post go out, and from which
 * account. It writes nothing. Outbound's scheduler and send ask it; inbound's post places ask it;
 * how a floor is learned or cleared is outbound's (`discovery/requirements.ts`).
 */

import type { AccountHealth } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { warmupOf } from "@wren/starling-reddit";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type ReachAccount,
  type RedditRequirement,
  reachAccounts,
  redditPlaces,
  redditRequirements,
} from "./schema.js";

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

/** A floor with a number in it: age, karma or comment karma. */
export const hasNumbers = (n: Need): boolean =>
  n.minAgeDays !== null || n.minKarma !== null || n.minCommentKarma !== null;

const DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const sane = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max;
const num = (s: string) => Number(s.replace(/,/g, ""));
/** The higher floor; null is no floor. */
export const maxOf = (a: number | null, b: number | null): number | null =>
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

interface Shortfall {
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
