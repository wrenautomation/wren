/**
 * Warm-up ramps (William, 10-26): a new account starts low each day and climbs to its cap, so a
 * platform sees a person who grows, never a burst on day one. Every act with a day cap and a
 * ramp takes it from here; never a copy per platform.
 */

export interface Ramp {
  /** Acts a day on day 0. */
  start: number;
  /** Added each `everyDays`. */
  step: number;
  everyDays: number;
}

/** The ramp an act takes unless it names its own: 30% of the cap, plus 15% every two days. */
export function rampFor(cap: number): Ramp {
  return {
    start: Math.max(1, Math.ceil(cap * 0.3)),
    step: Math.max(1, Math.ceil(cap * 0.15)),
    everyDays: 2,
  };
}

/** The day's cap `days` into the ramp (0 = the first day), never above `cap`. */
export function rampedCap(cap: number, days: number, ramp: Ramp = rampFor(cap)): number {
  if (cap <= 0) return 0;
  const climbed = ramp.start + ramp.step * Math.floor(Math.max(0, days) / ramp.everyDays);
  return Math.min(cap, climbed);
}
