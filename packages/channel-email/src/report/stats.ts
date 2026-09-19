/**
 * The one way a rate is stated (ported from emailsgen.stats). Wilson, not
 * Wald: Wald collapses to [0, 0] at k = 0 (a campaign with no replies yet
 * does not have a reply rate of exactly zero) and runs past 0 and 1 at small
 * n. Wilson stays inside [0, 1], is never empty, and is asymmetric the right
 * way around at low rates. No trials means no information: [0, 1].
 */

export interface Interval {
  readonly low: number;
  readonly high: number;
}

const Z_95 = 1.959963984540054;

export function wilsonInterval(successes: number, trials: number, z = Z_95): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < 0) {
    throw new Error(`counts must be non-negative integers, got ${successes}/${trials}`);
  }
  if (successes > trials) throw new Error(`${successes} successes out of ${trials} trials`);
  if (trials === 0) return { low: 0, high: 1 };
  const n = trials;
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  // The algebra gives exactly 0 and 1 at the edges; floating point gives
  // 3e-18, which would fail "low <= k/n" for k = 0. Pin them.
  const low = successes === 0 ? 0 : Math.max(0, centre - half);
  const high = successes === trials ? 1 : Math.min(1, centre + half);
  return { low, high };
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

/** `3.2% [1.1–8.9] n=62`: the rate, its 95% interval, and the trials it rests on. */
export function formatRate(successes: number, trials: number): string {
  if (trials === 0) return "n=0";
  const { low, high } = wilsonInterval(successes, trials);
  return `${pct(successes / trials)} [${pct(low)}–${pct(high)}] n=${trials}`;
}
