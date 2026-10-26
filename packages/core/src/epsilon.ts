/**
 * Epsilon on every spaced schedule (William, 10-26): a slot moves by a random 1 to 9 minutes and
 * some seconds, and never lands on :00 or :30, so no act fires at the top of an hour. Every slot
 * builder takes it from here; never a copy per schedule.
 */

const MINUTE = 60_000;

/** `at` moved 1 to 9 whole minutes (and 0 to 59 seconds) on, off :00 and :30. `rand` gives 0 to 1. */
export function nudge(at: Date, rand: () => number): Date {
  const ms = (1 + Math.floor(rand() * 9)) * MINUTE + Math.floor(rand() * 60) * 1000;
  let t = at.getTime() + ms;
  if (new Date(t).getUTCMinutes() % 30 === 0) t += MINUTE;
  return new Date(t);
}

/**
 * A repeatable 0-to-1 source from `key` (FNV-1a then xorshift): the same key gives the same
 * numbers on every run. For slots that must come out the same each time they are worked out
 * (a free-slot check, a replay); random enough that no two days match.
 */
export function seeded(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 0x1_0000_0000;
  };
}

/** `at` nudged by its own seed: the same instant and key always give the same slot. */
export const nudgeFixed = (at: Date, key: string): Date => nudge(at, seeded(`${key} ${at.toISOString()}`));
