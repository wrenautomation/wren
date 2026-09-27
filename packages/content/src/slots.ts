/**
 * When a platform's post goes out when nobody said: the next default slot on
 * the fleet's clock. One slot per platform (the hour people read it), on
 * weekdays for the work platforms and every day for the video ones; a draft
 * approved after today's slot waits for tomorrow's. `--at` still wins, and
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

export const DEFAULT_SLOTS: Readonly<Record<Platform, Slot>> = {
  linkedin: { hour: 8, minute: 30, days: WEEKDAYS },
  reddit: { hour: 9, minute: 30 },
  x: { hour: 12, minute: 0, days: WEEKDAYS },
  facebook: { hour: 13, minute: 0 },
  instagram: { hour: 18, minute: 0 },
  tiktok: { hour: 19, minute: 0 },
  youtube: { hour: 15, minute: 0 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO weekday (1..7) of a UTC-midnight date. */
const isoDay = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

/** The first slot instant strictly after `now`, within two weeks (a slot with no days is a bug). */
export function nextSlot(platform: Platform, now: Date, zone: string, slots = DEFAULT_SLOTS): Date {
  const slot = slots[platform];
  const today = wallClock(zone, now);
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (let i = 0; i < 15; i++) {
    const day = new Date(start + i * DAY_MS);
    if (slot.days && !slot.days.includes(isoDay(day))) continue;
    const at = zonedInstant(
      zone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      slot.hour,
      slot.minute,
    );
    if (at.getTime() > now.getTime()) return at;
  }
  throw new Error(`no ${platform} slot within two weeks of ${now.toISOString()}`);
}
