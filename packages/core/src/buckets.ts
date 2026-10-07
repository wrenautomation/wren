/** Token buckets (GCRA): research's per-source caps and vendors' per-key read limits. */

/** A refilling budget: `perDay` spends a day, at most `burst` at once. */
export interface Bucket {
  perDay: number;
  burst: number;
}

/**
 * Spends a token bucket allows now, given when it spent (ms, oldest first),
 * and how long until the next one when none. It refills one spend every
 * day / `perDay` and holds at most `burst`, so a free daily cap is used
 * evenly through the day instead of all at the reset.
 */
export function bucketRoom(
  spent: readonly number[],
  now: number,
  bucket: Bucket,
): { room: number; nextInMs: number } {
  const gap = 86_400_000 / bucket.perDay;
  // GCRA: `due` is when the bucket would be back to one free spend.
  let due = Number.NEGATIVE_INFINITY;
  for (const t of spent) due = Math.max(due, t) + gap;
  if (!Number.isFinite(due)) return { room: bucket.burst, nextInMs: 0 };
  const room = Math.min(bucket.burst, Math.max(0, Math.floor((now - due) / gap) + bucket.burst));
  return { room, nextInMs: room > 0 ? 0 : Math.ceil(due - (bucket.burst - 1) * gap - now) };
}
