/**
 * Plackett-Luce from human picks: each choice = one winner out of a shown set.
 * P(i wins set S) = w_i / Σ_S w. Fit by MM (Hunter 2004). Pure; ids are opaque.
 */

export interface Choice {
  readonly set: readonly string[];
  readonly winner: string;
  /** Default 1. A strong mark counts more. */
  readonly weight?: number;
}

export interface Strength {
  readonly id: string;
  /** Geometric mean of all fitted items = 1. */
  readonly strength: number;
  /** Chance to beat an average item head to head. */
  readonly pBeatsAverage: number;
  /** Std error of log strength (Fisher information, prior included). */
  readonly se: number;
  /** Choices the item was shown in. */
  readonly seen: number;
}

/**
 * Tiers best first (e.g. amazing, good, unmarked, bad) → choices.
 * Each item of a tier wins against itself + every lower tier; no order inside a tier.
 */
export function tiersToChoices(
  tiers: readonly (readonly string[])[],
  weights?: readonly number[],
): Choice[] {
  const out: Choice[] = [];
  for (let t = 0; t < tiers.length - 1; t++) {
    const lower = tiers.slice(t + 1).flat();
    if (!lower.length) continue;
    for (const id of tiers[t] ?? [])
      out.push({ set: [id, ...lower], winner: id, weight: weights?.[t] ?? 1 });
  }
  return out;
}

/**
 * MM fit. Prior: one win and one loss against a fixed reference of strength 1, so
 * unseen or always-winning items stay finite.
 */
export function fitPlackettLuce(
  ids: readonly string[],
  choices: readonly Choice[],
  opts: { prior?: number; iterations?: number; tolerance?: number } = {},
): Strength[] {
  const prior = opts.prior ?? 1;
  const iterations = opts.iterations ?? 500;
  const tolerance = opts.tolerance ?? 1e-9;
  const known = new Set(ids);
  const cs = choices.filter(
    (c) => known.has(c.winner) && c.set.every((s) => known.has(s)) && c.set.length > 1,
  );
  const w = new Map(ids.map((id) => [id, 1]));
  const wins = new Map(ids.map((id) => [id, prior]));
  for (const c of cs) wins.set(c.winner, (wins.get(c.winner) ?? 0) + (c.weight ?? 1));
  const member = new Map<string, Choice[]>(ids.map((id) => [id, []]));
  for (const c of cs) for (const s of c.set) member.get(s)?.push(c);

  for (let it = 0; it < iterations; it++) {
    const sums = cs.map((c) => c.set.reduce((t, s) => t + (w.get(s) ?? 1), 0));
    const sumOf = new Map(cs.map((c, i) => [c, sums[i] ?? 1]));
    let diff = 0;
    const next = new Map<string, number>();
    for (const id of ids) {
      const wi = w.get(id) ?? 1;
      let den = (2 * prior) / (wi + 1);
      for (const c of member.get(id) ?? []) den += (c.weight ?? 1) / (sumOf.get(c) ?? 1);
      next.set(id, (wins.get(id) ?? prior) / den);
    }
    for (const id of ids) {
      const v = next.get(id) ?? 1;
      diff = Math.max(diff, Math.abs(Math.log(v) - Math.log(w.get(id) ?? 1)));
      w.set(id, v);
    }
    if (diff < tolerance) break;
  }

  // centre: geometric mean 1
  const logMean = ids.reduce((t, id) => t + Math.log(w.get(id) ?? 1), 0) / Math.max(ids.length, 1);
  const g = Math.exp(logMean);
  return ids
    .map((id) => {
      const raw = w.get(id) ?? 1;
      let info = 2 * prior * (raw / (raw + 1)) * (1 / (raw + 1));
      for (const c of member.get(id) ?? []) {
        const p = raw / c.set.reduce((t, s) => t + (w.get(s) ?? 1), 0);
        info += (c.weight ?? 1) * p * (1 - p);
      }
      const strength = raw / g;
      return {
        id,
        strength,
        pBeatsAverage: strength / (strength + 1),
        se: 1 / Math.sqrt(info),
        seen: member.get(id)?.length ?? 0,
      };
    })
    .sort((a, b) => b.strength - a.strength);
}

/** Good rate with vs without a trait (a guide), with "too early" under `minN` total. */
export function rateSplit(
  rows: readonly { has: boolean; good: boolean }[],
  minN = 30,
): {
  with: { good: number; n: number };
  without: { good: number; n: number };
  diff: number | null;
  early: boolean;
} {
  const w = { good: 0, n: 0 };
  const wo = { good: 0, n: 0 };
  for (const r of rows) {
    const a = r.has ? w : wo;
    a.n++;
    if (r.good) a.good++;
  }
  const diff = w.n && wo.n ? w.good / w.n - wo.good / wo.n : null;
  return { with: w, without: wo, diff, early: w.n + wo.n < minN || !w.n || !wo.n };
}
