/**
 * `{call.times}`: two open times on the calendar, said in the lead's clock,
 * filled when the email SENDS, not when it is composed, so a queued email
 * never offers a time that passed or got taken. Compose leaves the token in
 * the body; deliver swaps it for "Tuesday at 11am or Wednesday at 2pm ET"
 * and keeps the times it offered on the message, for the reply that says yes.
 * A calendar that can't answer gives "early next week", so copy reads
 * "I'm free {call.times}." either way.
 */

export const CALL_TIMES = "{call.times}";
export const CALL_TIMES_FALLBACK = "early next week";
/** A lead with no known zone hears Wren's own. */
export const FLEET_ZONE = "America/New_York";
/** How far ahead the offered times may sit: a weekday name stays unambiguous inside a week. */
export const LOOKAHEAD_MS = 6 * 24 * 3600 * 1000;
/** The first offered day is this many weekdays after the send day: they need a chance to read it. */
const NOTICE_WEEKDAYS = 2;
/** One less when the count crosses a weekend: the weekend is reading time too. */
const NOTICE_WEEKDAYS_OVER_WEEKEND = 1;
/** Their business hours, in their clock: the hours a time may start. */
const HOURS_START = 10;
const HOURS_END = 17;

const SHORT_ZONE: Readonly<Record<string, string>> = {
  "America/New_York": "ET",
  "America/Toronto": "ET",
  "America/Chicago": "CT",
  "America/Winnipeg": "CT",
  "America/Denver": "MT",
  "America/Edmonton": "MT",
  "America/Phoenix": "MT",
  "America/Los_Angeles": "PT",
  "America/Vancouver": "PT",
};

interface Local {
  day: string;
  weekday: string;
  hour: number;
  minute: number;
}

function local(at: Date, zone: string): Local {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday ?? "",
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function zoneName(zone: string, at: Date): string {
  const short = SHORT_ZONE[zone];
  if (short) return short;
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? zone;
}

function clock(l: Local): string {
  const h = l.hour % 12 === 0 ? 12 : l.hour % 12;
  const m = l.minute ? `:${String(l.minute).padStart(2, "0")}` : "";
  return `${h}${m}${l.hour < 12 ? "am" : "pm"}`;
}

/** The weekday `n` weekdays after `day` (YYYY-MM-DD), skipping Saturday and Sunday. */
export function weekdaysAfter(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  for (let left = n; left > 0; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Whether a Saturday or Sunday falls strictly between two days (YYYY-MM-DD). */
function weekendBetween(from: string, to: string): boolean {
  const d = new Date(`${from}T12:00:00Z`);
  for (
    d.setUTCDate(d.getUTCDate() + 1);
    d.toISOString().slice(0, 10) < to;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return true;
  }
  return false;
}

/** The first day a time may sit on: two weekdays after the send, one when that crosses a weekend. */
export function firstOfferDay(sendDay: string): string {
  const two = weekdaysAfter(sendDay, NOTICE_WEEKDAYS);
  return weekendBetween(sendDay, two) ? weekdaysAfter(sendDay, NOTICE_WEEKDAYS_OVER_WEEKEND) : two;
}

/**
 * Two times (10am to 5pm theirs) on two weekdays: the first open slot two weekdays after
 * the send, or one when that crosses a weekend (Monday sends offer Wednesday
 * and Thursday, Thursday sends Friday and Monday, Friday sends Monday and
 * Tuesday), then the first on a later weekday. Fewer when the calendar has fewer.
 */
export function pickTimes(open: readonly Date[], zone: string, now: Date): Date[] {
  const earliest = firstOfferDay(local(now, zone).day);
  const usable = open.filter((s) => {
    if (s.getTime() - now.getTime() > LOOKAHEAD_MS) return false;
    const l = local(s, zone);
    const weekend = l.weekday === "Saturday" || l.weekday === "Sunday";
    return !weekend && l.day >= earliest && l.hour >= HOURS_START && l.hour < HOURS_END;
  });
  const first = usable[0];
  if (!first) return [];
  const firstDay = local(first, zone).day;
  const second = usable.find((s) => local(s, zone).day !== firstDay);
  return second ? [first, second] : [first];
}

/** "Tuesday at 11am or Wednesday at 2pm ET"; "Tuesday at 11am ET" for one. */
export function sayTimes(times: readonly Date[], zone: string): string {
  if (times.length === 0) return CALL_TIMES_FALLBACK;
  const said = times.map((t) => {
    const l = local(t, zone);
    return `${l.weekday} at ${clock(l)}`;
  });
  return `${said.join(" or ")} ${zoneName(zone, times[0] as Date)}`;
}

/** The body with `{call.times}` said, and the times it offered (empty when it fell back or had no token). */
export function fillCallTimes(
  body: string,
  open: readonly Date[] | null,
  zone: string | null,
  now: Date,
): { body: string; offered: Date[] } {
  if (!body.includes(CALL_TIMES)) return { body, offered: [] };
  const z = zone ?? FLEET_ZONE;
  const offered = open ? pickTimes(open, z, now) : [];
  return { body: body.replaceAll(CALL_TIMES, sayTimes(offered, z)), offered };
}
