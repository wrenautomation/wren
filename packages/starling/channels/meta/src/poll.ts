/**
 * How long to wait before each status read of a video container (Instagram, Threads): 10 s,
 * 15 s, 20 s, then 30 s, 5 minutes in all (12 reads). A Reel is usually done within a minute, so
 * the early reads catch it; a stuck one costs 12 reads, not 30, and then the post fails unposted.
 */
export const VIDEO_WAITS_MS: readonly number[] = (() => {
  const waits = [10_000, 15_000, 20_000];
  let total = 45_000;
  while (total < 300_000) {
    const wait = Math.min(30_000, 300_000 - total);
    waits.push(wait);
    total += wait;
  }
  return waits;
})();
