/**
 * A promise is how long a person may wait: "30m", "4h", "2d". One rule says what late is
 * (designs/2026-10-20-design-language.md, Decisions): a person waited longer than the promise.
 * The Inbox queues and every list's wait column ask it here. The Map keeps its own copy of
 * `promiseHours` and `hoursSay` in `apps/portal/web/src/map/tasks.ts` until the Map work lands;
 * then it imports these.
 */

const HOURS = { m: 1 / 60, h: 1, d: 24 } as const;

/** Hours in a promise: "30m" is 0.5, "4h" is 4, "2d" is 48. Anything else is null. */
export function promiseHours(p: string): number | null {
  const m = /^(\d+)([mhd])$/.exec(p.trim());
  return m ? Number(m[1]) * HOURS[m[2] as keyof typeof HOURS] : null;
}

/** Hours as a person says them: "40m", "6h", "3d". */
export function hoursSay(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/** Hours from `at` to `now`, never below 0; null when `at` is no time. */
export function hoursSince(at: string | Date | null | undefined, now: Date): number | null {
  if (at === null || at === undefined) return null;
  const t = typeof at === "string" ? Date.parse(at) : at.getTime();
  return Number.isNaN(t) ? null : Math.max(0, (now.getTime() - t) / 36e5);
}

/** True when a wait that started at `at` is past `promise` by `now`. No time or no promise: not late. */
export function lateOf(
  at: string | Date | null | undefined,
  promise: string | null | undefined,
  now: Date,
): boolean {
  const limit = promise ? promiseHours(promise) : null;
  const waited = hoursSince(at, now);
  return limit !== null && waited !== null && waited > limit;
}
