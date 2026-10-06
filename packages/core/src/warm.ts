/**
 * How often to check back after a touch, the way a person would: every couple of minutes right
 * after posting, commenting or messaging, then less as it goes quiet. Every warm channel (DMs,
 * comments on our posts and under our comments) reads on this; a cold one waits `COLD_EVERY_MS`.
 */

const MIN = 60_000;

/** Within `within` ms of the last touch, check every `every` ms. First match wins. */
export const WARM_TIERS: readonly { within: number; every: number }[] = [
  { within: 15 * MIN, every: 2 * MIN },
  { within: 60 * MIN, every: 5 * MIN },
  { within: 6 * 60 * MIN, every: 15 * MIN },
];
export const COLD_EVERY_MS = 30 * MIN;
/** ±20%, so checks never land on a clock beat. */
const SPREAD = 0.2;

/**
 * The wait before the next check, given the last touch (ours or theirs). `r` is a random number
 * in [0, 1): the caller's, so a Restate handler passes `ctx.rand.random()` and replays the same.
 */
export function warmEveryMs(lastTouch: Date | null, now: Date, r: number): number {
  const age = lastTouch ? now.getTime() - lastTouch.getTime() : Number.POSITIVE_INFINITY;
  const every = WARM_TIERS.find((t) => age < t.within)?.every ?? COLD_EVERY_MS;
  return Math.round(every * (1 - SPREAD + 2 * SPREAD * r));
}
