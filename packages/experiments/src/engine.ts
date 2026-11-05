/**
 * The bandit over one locus: counts in, shares and decisions out. Pure functions
 * over `{allele, exposures, successes}`; nothing here knows email or a database.
 *
 * fitness turns counts into trials, a pooled Beta prior turns trials into
 * posteriors, P(best) comes from those, and a selection strategy turns them into
 * shares above a floor. Guards and convergence decide what retires and when a
 * locus or the whole experiment is done.
 */
import { type Arm, type Beta, pBest, posteriors } from "@wrenautomation/vireo/stats";
import type { FitnessName, SelectionName, Settings } from "./settings.js";

// posteriors and P(best) live in vireo: one copy
export { type Beta, pBest, posteriors };

/** One allele's counts. The unit is the recipient: each count is recipients, never messages. */
export interface AlleleCounts {
  readonly exposures: number;
  readonly replies: number;
  readonly interested: number;
  readonly booked: number;
  /** Human opens, of `tracked` recipients whose sends carried a pixel. */
  readonly opens: number;
  readonly tracked: number;
  /** Opt-outs and not-interested replies. */
  readonly negatives: number;
}

export type Weights = Settings["weights"];
type Fitness = (counts: readonly AlleleCounts[], weights: Weights) => Arm[];

const as =
  (key: "replies" | "interested" | "booked"): Fitness =>
  (counts) =>
    counts.map((c) => ({ successes: c[key], trials: c.exposures }));

export const FITNESS: Readonly<Record<FitnessName, Fitness>> = {
  replies: as("replies"),
  interested: as("interested"),
  booked: as("booked"),
  opens: (counts) => counts.map((c) => ({ successes: c.opens, trials: c.tracked })),
  // Divided by the weight sum, so successes never pass trials.
  weighted: (counts, w) => {
    const total = w.replies + w.interested + w.booked || 1;
    return counts.map((c) => ({
      successes:
        (w.replies * c.replies + w.interested * c.interested + w.booked * c.booked) / total,
      trials: c.exposures,
    }));
  },
  // The first of interested, replies, opens that the locus has any of.
  lexicographic: (counts, w) => {
    const key = (["interested", "replies", "opens"] as const).find((k) =>
      counts.some((c) => c[k] > 0),
    );
    return FITNESS[key ?? "interested"](counts, w);
  },
};

interface SelectionInput {
  readonly arms: readonly Arm[];
  readonly posteriors: readonly Beta[];
  readonly pBest: readonly number[];
}
/** Raw shares, before the floor. */
type Selection = (x: SelectionInput) => number[];

/** `epsilon`: this part spread evenly, the rest to the current best. */
const EPSILON = 0.1;

const argmax = (xs: readonly number[]) =>
  xs.reduce((best, v, i) => (v > (xs[best] ?? -1) ? i : best), 0);
const mean = ({ a, b }: Beta) => a / (a + b);
const oneHot = (n: number, at: number) => Array.from({ length: n }, (_, i) => (i === at ? 1 : 0));

export const SELECTION: Readonly<Record<SelectionName, Selection>> = {
  even: ({ arms }) => arms.map(() => 1 / arms.length),
  thompson: ({ pBest }) => [...pBest],
  epsilon: ({ posteriors }) => {
    const best = argmax(posteriors.map(mean));
    return posteriors.map((_, i) => EPSILON / posteriors.length + (i === best ? 1 - EPSILON : 0));
  },
  ucb1: ({ arms, posteriors }) => {
    const total = Math.max(
      1,
      arms.reduce((t, x) => t + x.trials, 0),
    );
    const bounds = arms.map((x, i) =>
      x.trials === 0
        ? Number.POSITIVE_INFINITY
        : mean(posteriors[i] as Beta) + Math.sqrt((2 * Math.log(total)) / x.trials),
    );
    return oneHot(arms.length, argmax(bounds));
  },
};

/** Every share at least `floor`; the rest split by the raw shares. */
export function withFloor(shares: readonly number[], floor: number): number[] {
  const n = shares.length;
  if (n * floor >= 1) return shares.map(() => 1 / n);
  const sum = shares.reduce((t, v) => t + v, 0);
  return shares.map((s) => floor + (1 - n * floor) * (sum > 0 ? s / sum : 1 / n));
}

/** A settled locus keeps this share on its winner; challengers split the rest. */
const SETTLED_SHARE = 0.9;
const SETTLE_AT = 0.95;
const RETIRE_BELOW = 0.02;

type RetireReason = "p_best" | "guard";

interface LocusInput {
  readonly locus: string;
  /** The live alleles, by key. */
  readonly alleles: readonly string[];
  readonly counts: readonly AlleleCounts[];
  /** Alleles ever tried here, live or not. */
  readonly tried: number;
  /** The best allele at each earlier snapshot, oldest first. */
  readonly history: readonly (string | null)[];
}

interface LocusResult {
  readonly locus: string;
  readonly fitness: FitnessName;
  /** Over every allele that came in, retired ones included. */
  readonly pBest: Readonly<Record<string, number>>;
  /** Over the alleles still live; they sum to 1. */
  readonly shares: Readonly<Record<string, number>>;
  readonly retire: readonly { readonly allele: string; readonly reason: RetireReason }[];
  readonly best: string | null;
  readonly settled: boolean;
  /** The best has held for `window` snapshots and the locus is not settled. */
  readonly stagnant: boolean;
  /** `maxAlleles` tried: it takes no more. */
  readonly spent: boolean;
}

const keyed = (keys: readonly string[], values: readonly number[]) =>
  Object.fromEntries(keys.map((k, i) => [k, values[i] ?? 0]));

/** One locus at one snapshot: what retires, the shares of what is left, and whether it is done. */
export function evaluateLocus(input: LocusInput, settings: Settings): LocusResult {
  const fitness = settings.fitnessByLocus[input.locus] ?? settings.fitness;
  const score = (counts: readonly AlleleCounts[]) => {
    const arms = FITNESS[fitness](counts, settings.weights);
    const post = posteriors(arms, settings.prior);
    return { arms, post, p: pBest(post) };
  };
  const all = score(input.counts);
  const retire = new Map<string, RetireReason>();
  const ratio = settings.guards.negativeRatio;
  const exposed = input.counts.reduce((t, c) => t + c.exposures, 0);
  const negRate = exposed > 0 ? input.counts.reduce((t, c) => t + c.negatives, 0) / exposed : 0;
  input.alleles.forEach((allele, i) => {
    const c = input.counts[i] as AlleleCounts;
    if (c.exposures < settings.minSends) return;
    if (ratio !== null && negRate > 0 && c.negatives / c.exposures > ratio * negRate) {
      retire.set(allele, "guard");
    } else if ((all.p[i] ?? 0) < RETIRE_BELOW) retire.set(allele, "p_best");
  });
  // Something always stays live: the likeliest best.
  if (retire.size === input.alleles.length && input.alleles.length > 0) {
    retire.delete(input.alleles[argmax(all.p)] as string);
  }
  const keep = input.alleles.flatMap((a, i) => (retire.has(a) ? [] : [i]));
  const alleles = keep.map((i) => input.alleles[i] as string);
  const counts = keep.map((i) => input.counts[i] as AlleleCounts);
  const live = retire.size === 0 ? all : score(counts);
  const top = argmax(live.p);
  const best = alleles[top] ?? null;
  const settled =
    best !== null &&
    (live.p[top] ?? 0) >= SETTLE_AT &&
    (counts[top]?.exposures ?? 0) >= settings.minSends;
  const shares = settled
    ? alleles.map((_, i) =>
        alleles.length === 1
          ? 1
          : i === top
            ? SETTLED_SHARE
            : (1 - SETTLED_SHARE) / (alleles.length - 1),
      )
    : withFloor(
        SELECTION[settings.selection]({ arms: live.arms, posteriors: live.post, pBest: live.p }),
        settings.floor,
      );
  const recent = input.history.slice(-(settings.window - 1));
  return {
    locus: input.locus,
    fitness,
    pBest: keyed(input.alleles, all.p),
    shares: keyed(alleles, shares),
    retire: [...retire].map(([allele, reason]) => ({ allele, reason })),
    best,
    settled,
    stagnant: !settled && recent.length === settings.window - 1 && recent.every((b) => b === best),
    spent: input.tried >= settings.maxAlleles,
  };
}

export type StopReason = "settled" | "budget" | "stopped";

/** Every locus settled, or every unsettled one spent: the experiment is done. */
export function stopReason(loci: readonly LocusResult[]): Exclude<StopReason, "stopped"> | null {
  if (loci.length === 0) return null;
  if (loci.every((l) => l.settled)) return "settled";
  if (loci.every((l) => l.settled || l.spent)) return "budget";
  return null;
}
