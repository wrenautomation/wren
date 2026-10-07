/**
 * The call on a page split, in words a person reads: "B is ahead, 92% sure" or "Too early: 140
 * more visits". Pure, so it's easy to check by hand.
 *
 * The model is the beta-binomial: each arm's rate starts flat, Beta(1, 1), and after `n` visits
 * with `s` goals it is Beta(1 + s, 1 + n - s). "Sure" is the chance that arm has the highest
 * rate, P(best), from the experiments engine's grid integration (`@wren/experiments` `pBest`),
 * the same math the email experiments use.
 */
import { type Beta, pBest } from "@wren/experiments";

/** Visits each arm needs before any call. Below this, one lucky form swings the answer. */
export const MIN_VISITS = 100;
/** P(best) at or above which the leader is called the winner. */
export const SURE = 0.95;

export interface ArmCount {
  readonly label: string;
  /** Unique views: the trials. */
  readonly visits: number;
  /** The goal's count (forms, booking clicks or won deals): the successes. */
  readonly goals: number;
}

export interface SplitCall {
  /** What to show. */
  readonly words: string;
  /** too_early: under MIN_VISITS somewhere; leading: someone is ahead; settled: past SURE. */
  readonly kind: "too_early" | "no_goals" | "leading" | "settled";
  /** The leader's label, once there's one. */
  readonly leader: string | null;
  /** P(best) per arm, in the order given, each 0..1. */
  readonly sure: readonly number[];
  /** Visits still needed before a call; 0 once every arm has MIN_VISITS. */
  readonly more: number;
}

/** Beta(1 + goals, 1 + visits - goals) per arm. Goals above visits count as visits. */
export function posteriorsOf(arms: readonly ArmCount[]): Beta[] {
  return arms.map(({ visits, goals }) => {
    const n = Math.max(0, visits);
    const s = Math.min(Math.max(0, goals), n);
    return { a: 1 + s, b: 1 + n - s };
  });
}

const pct = (p: number) => Math.min(99, Math.floor(p * 100));

export function splitCall(arms: readonly ArmCount[]): SplitCall {
  const sure = arms.length > 1 ? pBest(posteriorsOf(arms)) : arms.map(() => 1);
  const more = arms.reduce((t, a) => t + Math.max(0, MIN_VISITS - a.visits), 0);
  if (more > 0)
    return {
      words: `Too early: ${more} more visit${more === 1 ? "" : "s"}`,
      kind: "too_early",
      leader: null,
      sure,
      more,
    };
  if (arms.every((a) => a.goals <= 0))
    return { words: "No goals yet on any version", kind: "no_goals", leader: null, sure, more };
  let at = 0;
  for (let i = 1; i < sure.length; i++) if ((sure[i] ?? 0) > (sure[at] ?? 0)) at = i;
  const leader = arms[at]?.label ?? null;
  const p = sure[at] ?? 0;
  const settled = p >= SURE;
  return {
    words: `${leader} ${settled ? "wins" : "is ahead"}, ${pct(p)}% sure`,
    kind: settled ? "settled" : "leading",
    leader,
    sure,
    more,
  };
}
