/**
 * How much each account may do today: one settings object, and the pure
 * checks the loop runs against it. Reddit runs on the warmup ladder
 * (`@wren/channel-reddit` warmupOf: age and karma), LinkedIn on a ramp from
 * the day outreach started. Both sit under autobrowse's own per-account caps,
 * which refuse past them with a 429 whatever this says.
 *
 * The window is ours (fleet time), not the lead's: a DM or an invite is read
 * whenever they open the app, and a person's account sending at 3am is the
 * tell, so sends go in working hours on weekdays.
 */
import type { AccountHealth } from "@wren/core/outreach";
import { wallClock } from "@wren/core/time";
import { warmupOf } from "@wren/channel-reddit";
import type { Platform } from "./schema.js";

export const FLEET_ZONE = "America/New_York";

export interface ReachPolicy {
  /** Fleet-local window, minutes after midnight, [start, end). */
  windowStartMinute: number;
  windowEndMinute: number;
  /** ISO weekdays allowed, 1 = Monday. */
  days: readonly number[];
  /** Least seconds between two sends from one account. */
  gapSeconds: number;
  reddit: {
    /** Private messages a day at the top of the ladder (the site's own cap is 5). */
    messagesPerDay: number;
  };
  linkedin: {
    /** Invites a day on day one, added every `rampEveryDays`, up to `connectsCap`. */
    connectsStart: number;
    connectsStep: number;
    rampEveryDays: number;
    connectsCap: number;
    messagesPerDay: number;
  };
}

export const DEFAULT_POLICY: ReachPolicy = {
  windowStartMinute: 10 * 60,
  windowEndMinute: 17 * 60,
  days: [1, 2, 3, 4, 5],
  gapSeconds: 120,
  reddit: { messagesPerDay: 5 },
  linkedin: {
    connectsStart: 5,
    connectsStep: 5,
    rampEveryDays: 7,
    connectsCap: 20,
    messagesPerDay: 20,
  },
};

/** "10:00" → 600. */
export function parseClock(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`not a clock time: ${text}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`not a clock time: ${text}`);
  return h * 60 + min;
}

/** The fleet day an instant falls on, "YYYY-MM-DD": what the daily caps count. */
export function fleetDay(at: Date): string {
  const w = wallClock(FLEET_ZONE, at);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function inWindow(at: Date, policy: ReachPolicy): boolean {
  const w = wallClock(FLEET_ZONE, at);
  const weekday = ((new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7) + 1;
  if (!policy.days.includes(weekday)) return false;
  const minute = w.hour * 60 + w.minute;
  return minute >= policy.windowStartMinute && minute < policy.windowEndMinute;
}

export interface Standing {
  /** What may still go today from this account, before today's sends are taken off. */
  caps: { connects: number; messages: number };
  /** Why nothing may go at all; null = fine. */
  frozen: string | null;
  /** Where the account is on its ladder or ramp, in words. */
  stage: string;
}

/**
 * An account's caps for the day. Reddit: the warmup ladder on the last health
 * read (none yet = lurk). LinkedIn: the ramp from `startedOn`.
 */
export function standingOf(
  a: { platform: Platform; startedOn: string; health: AccountHealth | null },
  policy: ReachPolicy,
  now: Date,
): Standing {
  if (a.platform === "reddit") {
    if (!a.health)
      return { caps: { connects: 0, messages: 0 }, frozen: "no health read yet", stage: "lurk" };
    const w = warmupOf(a.health, now);
    return {
      caps: { connects: 0, messages: Math.min(w.caps.messages, policy.reddit.messagesPerDay) },
      frozen: w.frozen,
      stage: `${w.stage} (day ${w.ageDays}, ${w.karma} karma${w.next ? `; ${w.next}` : ""})`,
    };
  }
  const li = policy.linkedin;
  const day = Math.max(0, daysBetween(a.startedOn, fleetDay(now)));
  const connects = Math.min(
    li.connectsCap,
    li.connectsStart + li.connectsStep * Math.floor(day / li.rampEveryDays),
  );
  return {
    caps: { connects, messages: li.messagesPerDay },
    frozen: a.health?.suspended ? "suspended" : null,
    stage: `ramp day ${day}: ${connects} invites a day${connects < li.connectsCap ? ` (cap ${li.connectsCap})` : ""}`,
  };
}
