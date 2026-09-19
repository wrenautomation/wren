/** When the report is due: Friday 19:00 on the fleet's clock, every week. */
import type { SendPolicy } from "../send/policy.js";
import { zonedInstant } from "../send/tz.js";

export const REPORT_WEEKDAY = 4; // Friday, in PlainDate's 0 = Monday
export const REPORT_HOUR = 19;

/** The first Friday 19:00 (send timezone) strictly after `now`. */
export function nextReportAt(policy: SendPolicy, now: Date): Date {
  const local = policy.localNow(now);
  for (let offset = 0; offset < 8; offset += 1) {
    const day = local.date.addDays(offset);
    if (day.weekday() !== REPORT_WEEKDAY) continue;
    const at = zonedInstant(policy.timezone, day.year, day.month, day.day, REPORT_HOUR, 0);
    if (at.getTime() > now.getTime()) return at;
  }
  throw new Error("no Friday within eight days: PlainDate.weekday is broken");
}

export function untilNextReport(policy: SendPolicy, now: Date): number {
  return nextReportAt(policy, now).getTime() - now.getTime();
}
