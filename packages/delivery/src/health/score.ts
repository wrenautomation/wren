/**
 * Client health's arithmetic (designs/2026-10-07-health.md): four sub-scores from 0 to 100,
 * weighted, a missing one handing its weight to the rest. Pure, so every number can be said
 * back in words and tested without a database.
 */

export const PARTS = ["results", "engagement", "sentiment", "money"] as const;
export type Part = (typeof PARTS)[number];

/** The default weights; they add to 100. */
export const WEIGHTS: Readonly<Record<Part, number>> = {
  results: 40,
  engagement: 20,
  sentiment: 25,
  money: 15,
};

/** A part is stale when its newest input is older than this many days. Absent: read live. */
export const STALE_DAYS: Readonly<Partial<Record<Part, number>>> = { results: 14, sentiment: 21 };

export const BANDS = ["healthy", "watch", "risk", "none"] as const;
export type Band = (typeof BANDS)[number];
/** 70 and up is healthy, 40 to 69 watch, under 40 at risk; no score is no data. */
export const bandOf = (score: number | null): Band =>
  score === null ? "none" : score >= 70 ? "healthy" : score >= 40 ? "watch" : "risk";

/** One row behind a sub-score, as the Health page lists it. */
export interface HealthInput {
  part: Part;
  /** What it is: "Meetings booked", "Visit", "Weekly rating". */
  what: string;
  /** Its reading, said: "6 of 9 expected by now", "4 of 5". */
  value: string;
  /** When it was true: the row's own time. Null when it's a count of none. */
  at: string | null;
  /** Where its rows open in the portal; null when it has none. */
  href: string | null;
}

/** A part's score, why, and how old its newest input is. */
export interface PartScore {
  /** Null: no data, so its weight goes to the others. */
  score: number | null;
  why: string;
  /** The newest input's time (ISO); null when it's read live or has none. */
  at: string | null;
  stale: boolean;
}

const DAY = 86_400_000;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Days from `at` to `now`, whole. */
export const ageDays = (at: string | Date, now: Date) =>
  Math.floor((now.getTime() - new Date(at).getTime()) / DAY);

/** Whether `at` is past the part's stale limit on `now`. */
export const staleOf = (part: Part, at: string | null, now: Date): boolean => {
  const limit = STALE_DAYS[part];
  return limit !== undefined && at !== null && ageDays(at, now) > limit;
};

/** What a plan expects by `day` (days since the start): straight from `fromDay` to `days`. */
export function expectedBy(
  t: { count: number; fromDay: number },
  days: number,
  day: number,
): number {
  if (day <= t.fromDay) return 0;
  if (days <= t.fromDay) return t.count;
  return Math.min(t.count, (t.count * (day - t.fromDay)) / (days - t.fromDay));
}

/**
 * Results against the plan: actual over expected, capped at 100. Under one expected it's too
 * early to say, which counts as no data.
 */
export function resultsScore(
  actual: number,
  expected: number,
): { score: number | null; why: string } {
  if (expected < 1) return { score: null, why: "Too early to measure" };
  const shown = Math.round(expected * 10) / 10;
  return {
    score: clamp((100 * actual) / expected),
    why: `${actual} of ${shown} expected by now`,
  };
}

/** Visits wanted in 30 days: about once a week. */
export const VISITS_WANTED = 4;
export const visitsScore = (days: number) => clamp((100 * days) / VISITS_WANTED);

/** Done on time over all that were due: null when none were. */
export const shareScore = (done: number, late: number): number | null =>
  done + late === 0 ? null : clamp((100 * done) / (done + late));

/** A 1 to 5 rating on the 0 to 100 scale. */
export const ratingScore = (rating: number) => clamp((rating - 1) * 25);

/** The oldest unpaid invoice's days past due: none is 100, a week 60, a month 30, then 0. */
export function moneyScore(daysLate: number | null): number {
  if (daysLate === null || daysLate <= 0) return 100;
  if (daysLate <= 7) return 60;
  if (daysLate <= 30) return 30;
  return 0;
}

/** The mean of the numbers given, rounded; null for none. */
export const meanOf = (xs: readonly (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? clamp(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
};

/**
 * The overall score: each present part times its weight over the weights present. Also each
 * part's weight as it counted (a missing part's goes to the others), adding to 100.
 */
export function combine(
  parts: Readonly<Record<Part, Pick<PartScore, "score">>>,
  weights: Readonly<Record<Part, number>> = WEIGHTS,
): { score: number | null; weights: Record<Part, number> } {
  const present = PARTS.filter((p) => parts[p].score !== null && weights[p] > 0);
  const total = present.reduce((a, p) => a + weights[p], 0);
  const counted = Object.fromEntries(
    PARTS.map((p) => [p, present.includes(p) ? Math.round((100 * weights[p]) / total) : 0]),
  ) as Record<Part, number>;
  if (!present.length) return { score: null, weights: counted };
  const sum = present.reduce((a, p) => a + (parts[p].score as number) * weights[p], 0);
  return { score: clamp(sum / total), weights: counted };
}

/** What's shown: the person's override while it stands, else the model's. */
export const shownScore = (model: number | null, override: number | null) => override ?? model;

/** How far a score fell in a week to raise a flag. */
export const DROP = 15;
