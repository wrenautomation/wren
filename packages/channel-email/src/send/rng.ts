import { randomInt } from "node:crypto";

/** The one draw the send walk makes: a uniform integer in `[low, high]`, inclusive. */
export interface Rng {
  int(low: number, high: number): number;
}

/** Deterministic for a seed (mulberry32): the same seed sends at the same times. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(low, high) {
      if (high < low) throw new Error(`empty range [${low}, ${high}]`);
      return low + Math.floor(next() * (high - low + 1));
    },
  };
}

/** An `Rng` over a unit-interval source, e.g. Restate's journaled `ctx.rand.random`. */
export function rngFrom(random: () => number): Rng {
  return {
    int(low, high) {
      if (high < low) throw new Error(`empty range [${low}, ${high}]`);
      return low + Math.floor(random() * (high - low + 1));
    },
  };
}

export const systemRng: Rng = {
  int(low, high) {
    if (high < low) throw new Error(`empty range [${low}, ${high}]`);
    return randomInt(low, high + 1);
  },
};
