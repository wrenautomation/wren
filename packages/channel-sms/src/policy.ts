/**
 * When and how much the fleet may send: one plain settings object, and the
 * pure checks the sender runs against it.
 *
 * Quiet hours are the lead's, not ours. A company with a known time zone is
 * judged on its own clock; one without must be inside the window in both
 * Eastern and Pacific time, so no US lead ever gets a text at 7am or 9pm.
 * Whatever the settings say, the window is clamped to 8:00–20:00 (the
 * strictest state rules), and weekends are off unless listed.
 */
import { canonicalZone, wallClock } from "@wren/core/time";
import type { ContactBasis } from "./schema.js";

export const FLEET_ZONE = "America/New_York";
const UNKNOWN_ZONE_CHECKS = ["America/New_York", "America/Los_Angeles"] as const;
const EARLIEST_MINUTE = 8 * 60;
export const LATEST_MINUTE = 20 * 60;

export interface SmsPolicy {
  /** Lead-local window, minutes after midnight, [start, end). */
  windowStartMinute: number;
  windowEndMinute: number;
  /** ISO weekdays allowed at the lead, 1 = Monday. */
  days: readonly number[];
  /** Campaign-wide cap per fleet day: the pool never exceeds it, however many numbers. */
  dailyCap: number;
  /** Most texts one phone gets in any 31 days (the consent's "up to 4 texts a month"). */
  monthlyPerContact: number;
  /** A fully ramped number's cap per day. */
  numberCap: number;
  /** Ramp: day-one cap, added every `rampEveryDays`. */
  rampStart: number;
  rampStep: number;
  rampEveryDays: number;
  /** Least time between two texts from one number. */
  gapSeconds: number;
  /** Most numbers the pool may hold (PH-D10). */
  maxNumbers: number;
  /** Which contact bases the sender may text; must match the registered campaign. */
  bases: readonly ContactBasis[];
}

export const DEFAULT_POLICY: SmsPolicy = {
  windowStartMinute: 10 * 60,
  windowEndMinute: 17 * 60,
  days: [1, 2, 3, 4, 5],
  dailyCap: 1000,
  monthlyPerContact: 4,
  numberCap: 200,
  rampStart: 20,
  rampStep: 20,
  rampEveryDays: 2,
  gapSeconds: 20,
  maxNumbers: 5,
  bases: ["opt_in"],
};

/** "10:00" → 600. */
export function parseClock(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`not a clock time (HH:MM): ${JSON.stringify(text)}`);
  const minute = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || minute > 24 * 60)
    throw new Error(`not a clock time: ${JSON.stringify(text)}`);
  return minute;
}

function isoWeekday(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
}

function openIn(zone: string, at: Date, policy: SmsPolicy): boolean {
  const w = wallClock(zone, at);
  if (!policy.days.includes(isoWeekday(w.year, w.month, w.day))) return false;
  const minute = w.hour * 60 + w.minute;
  const start = Math.max(policy.windowStartMinute, EARLIEST_MINUTE);
  const end = Math.min(policy.windowEndMinute, LATEST_MINUTE);
  return minute >= start && minute < end;
}

/** True when a text may reach a lead in `zone` (null = unknown, US) at `at`. */
export function inWindow(zone: string | null, at: Date, policy: SmsPolicy): boolean {
  const known = zone ? canonicalZone(zone) : null;
  if (known) return openIn(known, at, policy);
  return UNKNOWN_ZONE_CHECKS.every((z) => openIn(z, at, policy));
}

/** The fleet day an instant falls on, "YYYY-MM-DD" in Eastern time: what the daily caps count. */
export function fleetDay(at: Date): string {
  const w = wallClock(FLEET_ZONE, at);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A number's cap on `day`: grows from `rampStart` by `rampStep` every `rampEveryDays`, up to `numberCap`. */
export function numberCapOn(rampStartedOn: string, day: string, policy: SmsPolicy): number {
  const age = Math.max(0, daysBetween(rampStartedOn, day));
  const ramped =
    policy.rampStart + policy.rampStep * Math.floor(age / Math.max(1, policy.rampEveryDays));
  return Math.min(policy.numberCap, ramped);
}
