/**
 * A made-up content business for the dashboard story: 180 days of views, replies, calls and
 * signings on five platforms, the same every run (a seeded draw), so a delta always has a period
 * before it.
 */

export const PLATFORMS = [
  { key: "youtube", label: "YouTube", views: 2400, rate: 0.006, grow: 0.006 },
  { key: "linkedin", label: "LinkedIn", views: 1500, rate: 0.011, grow: 0.004 },
  { key: "x", label: "X", views: 1800, rate: 0.004, grow: 0.002 },
  { key: "tiktok", label: "TikTok", views: 2100, rate: 0.002, grow: 0.009 },
  { key: "threads", label: "Threads", views: 500, rate: 0.008, grow: 0.007 },
] as const;

export type PlatformKey = (typeof PLATFORMS)[number]["key"];

export interface Day {
  at: string;
  /** Per platform. */
  views: Record<PlatformKey, number>;
  replies: Record<PlatformKey, number>;
  calls: Record<PlatformKey, number>;
  signed: Record<PlatformKey, number>;
}

export const DAYS = 180;
const END = Date.UTC(2026, 9, 24);

/** mulberry32: a small seeded draw, so the story reads the same each time. */
function draw(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const each = <T>(f: (p: (typeof PLATFORMS)[number]) => T) =>
  Object.fromEntries(PLATFORMS.map((p) => [p.key, f(p)])) as Record<PlatformKey, T>;

/** Oldest first. Weekends run quieter; a launch week in the middle spikes. */
export const DAYS_OF: Day[] = (() => {
  const r = draw(7);
  return Array.from({ length: DAYS }, (_, i) => {
    const at = new Date(END - (DAYS - 1 - i) * 86_400_000);
    const weekend = at.getUTCDay() % 6 === 0 ? 0.62 : 1;
    const launch = i >= 120 && i < 127 ? 1.9 : 1;
    const views = each((p) =>
      Math.round(p.views * (1 + p.grow) ** i * weekend * launch * (0.75 + r() * 0.5)),
    );
    const replies = each((p) => Math.round(views[p.key] * p.rate * (0.6 + r() * 0.8)));
    const calls = each((p) => Math.round(replies[p.key] * (0.06 + r() * 0.08)));
    const signed = each((p) => (calls[p.key] > 0 && r() < 0.18 ? 1 : 0));
    return { at: at.toISOString(), views, replies, calls, signed };
  });
})();

/** When replies land, by weekday (Monday first) and hour: a weight for each pair. */
export const HOUR_WEIGHT: number[][] = (() => {
  const r = draw(11);
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const work = h >= 8 && h <= 18 ? 1 : h >= 19 && h <= 22 ? 0.55 : 0.08;
      const lunch = h === 12 || h === 13 ? 1.35 : 1;
      const day = d >= 5 ? 0.45 : d === 1 || d === 2 ? 1.2 : 1;
      return work * lunch * day * (0.7 + r() * 0.6);
    }),
  );
})();
