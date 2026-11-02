/**
 * The bed's duck under speech (designs/2026-10-24-video-film-file.md, Decision 4). No imports: the
 * Remotion bundle reads this file as it is.
 */

/** Speech closer than `joinS` is one stretch; the bed falls over `attackS`, comes back over `releaseS`. */
export const DUCK = { db: 8, joinS: 0.6, attackS: 0.15, releaseS: 0.5 } as const;

export const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * How far the bed is ducked at `t`, 0 (full) to 1 (all of `duckDb` down): down over `attackS`
 * before speech starts, back up over `releaseS` after it ends.
 */
export function duckAt(t: number, duck: readonly (readonly [number, number])[]): number {
  let k = 0;
  for (const [s, e] of duck) {
    if (t >= s && t <= e) return 1;
    if (t < s && s - t < DUCK.attackS) k = Math.max(k, 1 - (s - t) / DUCK.attackS);
    if (t > e && t - e < DUCK.releaseS) k = Math.max(k, 1 - (t - e) / DUCK.releaseS);
  }
  return k;
}

/** The bed's volume at `t`: its level, less the duck. */
export const bedVolume = (
  m: { volume: number; duck: readonly (readonly [number, number])[]; duckDb: number },
  t: number,
) => m.volume * dbToGain(-m.duckDb * duckAt(t, m.duck));
