/**
 * The simulator: selection strategies on synthetic truth, no database and no LLM.
 * Each locus's alleles get true rates; each day `perDay` recipients are drawn one
 * allele per locus along the shares, succeed with the mean of their alleles' rates
 * (one outcome credits every allele, as on real threads), and the engine ticks.
 * A retired allele is replaced by a new one whose rate comes from the locus's prior,
 * unless the mutation is `retire_only` or `manual`.
 */
import { type AlleleCounts, evaluateLocus, stopReason } from "./engine.js";
import { betaDraw, type Rng, seeded } from "./rng.js";
import { parseSettings, type SelectionName } from "./settings.js";

export interface SimulateOptions {
  readonly selections: readonly SelectionName[];
  readonly loci: number;
  readonly alleles: number;
  /** True rates, assigned in turn to each locus's starting alleles (shuffled per run). */
  readonly rates: readonly number[];
  readonly perDay: number;
  readonly days: number;
  readonly runs: number;
  readonly seed?: string;
  /** Any other settings (minSends, floor, mutation …). */
  readonly settings?: unknown;
}

export interface SimulateResult {
  readonly selection: SelectionName;
  /** Mean successes lost per run against always sending each locus's best. */
  readonly regret: number;
  /** Mean share of picks that went to the best allele then present at its locus. */
  readonly bestShare: number;
  /** Runs where every locus settled. */
  readonly settledRuns: number;
  /** Median day the experiment settled, over the runs that did. */
  readonly daysToSettle: number | null;
  /** Settled loci whose winner was not the best allele tried there. */
  readonly wrongSettles: number;
  readonly settledLoci: number;
}

interface SimAllele {
  key: string;
  rate: number;
  counts: { -readonly [K in keyof AlleleCounts]: AlleleCounts[K] };
}

const fresh = (key: string, rate: number): SimAllele => ({
  key,
  rate,
  counts: {
    exposures: 0,
    replies: 0,
    interested: 0,
    booked: 0,
    opens: 0,
    tracked: 0,
    negatives: 0,
  },
});

function draw(rng: Rng, shares: readonly number[]): number {
  const u = rng() * shares.reduce((t, v) => t + v, 0);
  let run = 0;
  for (const [i, s] of shares.entries()) {
    run += s;
    if (u < run) return i;
  }
  return shares.length - 1;
}

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

export function simulate(opts: SimulateOptions): SimulateResult[] {
  if (opts.rates.length === 0) throw new Error("simulate needs at least one rate");
  const settings = parseSettings(opts.settings);
  const mutate = settings.mutation !== "retire_only" && settings.mutation !== "manual";
  const priorMean = opts.rates.reduce((t, v) => t + v, 0) / opts.rates.length;
  return opts.selections.map((selection) => {
    const s = { ...settings, selection };
    let regret = 0;
    let best = 0;
    let picks = 0;
    let wrong = 0;
    let settledLoci = 0;
    const settleDays: number[] = [];
    for (let run = 0; run < opts.runs; run++) {
      // The same seed per run across strategies: each faces the same truth.
      const truth = seeded(`${opts.seed ?? "sim"}:${run}`);
      const rng = seeded(`${opts.seed ?? "sim"}:${run}:${selection}`);
      const loci = Array.from({ length: opts.loci }, (_, l) => {
        const rates = shuffle(
          truth,
          Array.from(
            { length: opts.alleles },
            (_, i) => opts.rates[i % opts.rates.length] as number,
          ),
        );
        return {
          name: `l${l}`,
          live: rates.map((r, i) => fresh(`l${l}a${i}`, r)),
          tried: rates.length,
          top: Math.max(...rates),
          history: [] as (string | null)[],
          shares: rates.map(() => 1 / rates.length),
          settled: false,
        };
      });
      let stopped = false;
      for (let day = 0; day < opts.days; day++) {
        for (let r = 0; r < opts.perDay; r++) {
          const chosen = loci.map((l) => l.live[draw(rng, l.shares)] as SimAllele);
          const p = chosen.reduce((t, a) => t + a.rate, 0) / chosen.length;
          const ideal = loci.reduce((t, l) => t + l.top, 0) / loci.length;
          regret += ideal - p;
          const hit = rng() < p ? 1 : 0;
          chosen.forEach((a, i) => {
            a.counts.exposures += 1;
            a.counts.replies += hit;
            a.counts.interested += hit;
            a.counts.booked += hit;
            picks += 1;
            if (a.rate === (loci[i] as (typeof loci)[number]).top) best += 1;
          });
        }
        if (stopped) continue;
        const results = loci.map((l) => {
          const res = evaluateLocus(
            {
              locus: l.name,
              alleles: l.live.map((a) => a.key),
              counts: l.live.map((a) => a.counts),
              tried: l.tried,
              history: l.history,
            },
            s,
          );
          l.history.push(res.best);
          const gone = new Set(res.retire.map((x) => x.allele));
          l.live = l.live.filter((a) => !gone.has(a.key));
          l.settled = res.settled;
          l.shares = l.live.map((a) => res.shares[a.key] ?? 0);
          if (mutate && !res.settled) {
            for (let k = 0; k < gone.size && l.tried < s.maxAlleles; k++) {
              const rate = betaDraw(truth, s.prior * priorMean, s.prior * (1 - priorMean));
              l.live.push(fresh(`${l.name}a${l.tried}`, rate));
              l.tried += 1;
              l.top = Math.max(l.top, rate);
              // A newcomer starts at the floor; the next tick prices it.
              l.shares.push(s.floor);
            }
          }
          return res;
        });
        const stop = stopReason(results);
        if (stop) {
          stopped = true;
          if (stop === "settled") settleDays.push(day + 1);
          for (const [i, res] of results.entries()) {
            if (!res.settled) continue;
            settledLoci += 1;
            const l = loci[i] as (typeof loci)[number];
            if ((l.live.find((a) => a.key === res.best)?.rate ?? 0) < l.top) wrong += 1;
          }
        }
      }
    }
    return {
      selection,
      regret: regret / opts.runs,
      bestShare: picks > 0 ? best / picks : 0,
      settledRuns: settleDays.length,
      daysToSettle: median(settleDays),
      wrongSettles: wrong,
      settledLoci,
    };
  });
}
