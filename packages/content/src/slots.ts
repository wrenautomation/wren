/**
 * When a platform's posts go out when nobody said: the platform's default
 * slots on the fleet's clock. A platform may have several a day; LinkedIn
 * and Reddit, the organic channels, get two on weekdays (William, 09-27:
 * "multiple posts a day"), hours apart so the second doesn't split the
 * first's reach. ContentPlanner's `slots` setting overrides. A draft takes the
 * first free slot after its approval, so a batch approved at once spreads
 * over the days instead of piling onto one hour. `--at` still wins, and
 * `--now` posts on the next pass.
 */
import type { Platform } from "@wren/core/content";
import { wallClock, zonedInstant } from "@wren/core/time";

export interface Slot {
  hour: number;
  minute: number;
  /** ISO weekdays allowed (1 = Monday … 7 = Sunday); absent = every day. */
  days?: readonly number[];
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

export type Slots = Readonly<Record<Platform, readonly Slot[]>>;

export const DEFAULT_SLOTS: Slots = {
  linkedin: [
    { hour: 8, minute: 30, days: WEEKDAYS },
    { hour: 12, minute: 30, days: WEEKDAYS },
  ],
  reddit: [
    { hour: 9, minute: 30, days: WEEKDAYS },
    { hour: 17, minute: 0, days: WEEKDAYS },
  ],
  x: [{ hour: 12, minute: 0, days: WEEKDAYS }],
  facebook: [{ hour: 13, minute: 0 }],
  instagram: [{ hour: 18, minute: 0 }],
  tiktok: [{ hour: 19, minute: 0 }],
  youtube: [{ hour: 15, minute: 0 }],
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead a free slot is looked for; past it the queue is a month deep and the caller hears so. */
const HORIZON_DAYS = 60;

/** ISO weekday (1..7) of a UTC-midnight date. */
const isoDay = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

/** The platform's slot instants on each calendar day (on `zone`'s clock) from `from`'s day, for `days` days, in order. */
export function slotInstants(
  platform: Platform,
  from: Date,
  zone: string,
  days: number,
  slots: Slots = DEFAULT_SLOTS,
): Date[] {
  const today = wallClock(zone, from);
  const start = Date.UTC(today.year, today.month - 1, today.day);
  const out: Date[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start + i * DAY_MS);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const on = slots[platform]
      .filter((s) => !s.days || s.days.includes(isoDay(day)))
      .map((s) => zonedInstant(zone, y, m, d, s.hour, s.minute));
    out.push(...on.sort((a, b) => a.getTime() - b.getTime()));
  }
  return out;
}

/**
 * The first slot instant strictly after `now` that no draft holds yet
 * (`taken`: the scheduled times already given out on this platform).
 */
export function nextSlot(
  platform: Platform,
  now: Date,
  zone: string,
  slots: Slots = DEFAULT_SLOTS,
  taken: readonly Date[] = [],
): Date {
  const held = new Set(taken.map((t) => t.getTime()));
  const free = slotInstants(platform, now, zone, HORIZON_DAYS, slots).find(
    (at) => at.getTime() > now.getTime() && !held.has(at.getTime()),
  );
  if (!free)
    throw new Error(`no free ${platform} slot within ${HORIZON_DAYS} days of ${now.toISOString()}`);
  return free;
}
