/**
 * Days offices are closed, so nothing sends on them. Cold email sent on
 * Thanksgiving or between Christmas and New Year lands under a week of
 * out-of-office replies and gets read last, if at all.
 *
 * Calendars, named in `WREN_SEND_HOLIDAYS`:
 * - `us`: the days most US offices close, not every federal holiday. New
 *   Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and
 *   the Friday after, Christmas Eve, Christmas Day.
 * - `ca`: Canada's national statutory holidays. New Year's Day, Good Friday,
 *   Victoria Day, Canada Day, Labour Day, Thanksgiving, Christmas, Boxing Day.
 * - `year_end`: every day from Dec 24 through Jan 1.
 *
 * A fixed-date holiday on a weekend is also off on the weekday offices take
 * instead: Friday or Monday in the US, the next free weekday in Canada.
 */
import { PlainDate } from "./dates.js";

export const HOLIDAY_CALENDARS = ["us", "ca", "year_end"] as const;
export type HolidayCalendar = (typeof HOLIDAY_CALENDARS)[number];

const SATURDAY = 5;
const SUNDAY = 6;
const MONDAY = 0;
const THURSDAY = 3;

/** The `nth` (1-based) `weekday` of a month; `nth` -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): PlainDate {
  if (nth === -1) {
    let day = new PlainDate(year, month, 1).addDays(31);
    while (day.month !== month) day = day.addDays(-1);
    while (day.weekday() !== weekday) day = day.addDays(-1);
    return day;
  }
  let day = new PlainDate(year, month, 1);
  while (day.weekday() !== weekday) day = day.addDays(1);
  return day.addDays(7 * (nth - 1));
}

/** Western Easter Sunday (the anonymous Gregorian algorithm). */
function easter(year: number): PlainDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new PlainDate(year, month, day);
}

type Days = Map<string, string>;

function add(days: Days, day: PlainDate, name: string): void {
  const key = day.toString();
  if (!days.has(key)) days.set(key, name);
}

/** US: Saturday moves to Friday, Sunday to Monday. */
function usFixed(days: Days, day: PlainDate, name: string): void {
  add(days, day, name);
  if (day.weekday() === SATURDAY) add(days, day.addDays(-1), `${name} (observed)`);
  if (day.weekday() === SUNDAY) add(days, day.addDays(1), `${name} (observed)`);
}

/** Canada: a weekend holiday moves to the next weekday not already taken. */
function caFixed(days: Days, day: PlainDate, name: string): void {
  add(days, day, name);
  if (day.weekday() < SATURDAY) return;
  let observed = day.addDays(1);
  while (observed.weekday() >= SATURDAY || days.has(observed.toString())) {
    observed = observed.addDays(1);
  }
  add(days, observed, `${name} (observed)`);
}

function us(year: number): Days {
  const days: Days = new Map();
  usFixed(days, new PlainDate(year, 1, 1), "New Year's Day");
  add(days, nthWeekday(year, 5, MONDAY, -1), "Memorial Day");
  usFixed(days, new PlainDate(year, 7, 4), "Independence Day");
  add(days, nthWeekday(year, 9, MONDAY, 1), "Labor Day");
  const thanksgiving = nthWeekday(year, 11, THURSDAY, 4);
  add(days, thanksgiving, "Thanksgiving");
  add(days, thanksgiving.addDays(1), "the day after Thanksgiving");
  add(days, new PlainDate(year, 12, 24), "Christmas Eve");
  usFixed(days, new PlainDate(year, 12, 25), "Christmas Day");
  // Next year's New Year's Day on a Saturday is observed this Dec 31.
  const nextNewYear = new PlainDate(year + 1, 1, 1);
  if (nextNewYear.weekday() === SATURDAY) {
    add(days, nextNewYear.addDays(-1), "New Year's Day (observed)");
  }
  return days;
}

function ca(year: number): Days {
  const days: Days = new Map();
  caFixed(days, new PlainDate(year, 1, 1), "New Year's Day");
  add(days, easter(year).addDays(-2), "Good Friday");
  let victoria = new PlainDate(year, 5, 24); // the Monday before May 25
  while (victoria.weekday() !== MONDAY) victoria = victoria.addDays(-1);
  add(days, victoria, "Victoria Day");
  caFixed(days, new PlainDate(year, 7, 1), "Canada Day");
  add(days, nthWeekday(year, 9, MONDAY, 1), "Labour Day");
  add(days, nthWeekday(year, 10, MONDAY, 2), "Thanksgiving (Canada)");
  // Boxing Day first: a Sunday Christmas then moves past Boxing Monday to Tuesday.
  caFixed(days, new PlainDate(year, 12, 26), "Boxing Day");
  caFixed(days, new PlainDate(year, 12, 25), "Christmas Day");
  return days;
}

function yearEnd(year: number): Days {
  const days: Days = new Map();
  add(days, new PlainDate(year, 1, 1), "the year-end break");
  for (let d = 24; d <= 31; d++) add(days, new PlainDate(year, 12, d), "the year-end break");
  return days;
}

const BUILDERS: Record<HolidayCalendar, (year: number) => Days> = { us, ca, year_end: yearEnd };

const memo = new Map<string, ReadonlyMap<string, string>>();

/**
 * The days off in `year` under these calendars, ISO date → name. The first
 * calendar listed names a day two calendars share. Built once per calendar
 * set and year.
 */
export function holidaysIn(
  calendars: Iterable<HolidayCalendar>,
  year: number,
): ReadonlyMap<string, string> {
  const list = [...calendars];
  const key = `${list.join(",")}|${year}`;
  const cached = memo.get(key);
  if (cached) return cached;
  const out: Days = new Map();
  for (const calendar of list) {
    for (const [day, name] of BUILDERS[calendar](year)) {
      if (Number(day.slice(0, 4)) === year && !out.has(day)) out.set(day, name);
    }
  }
  memo.set(key, out);
  return out;
}

/** The holiday `day` falls on under these calendars, by name, or null. */
export function holidayOn(calendars: ReadonlySet<HolidayCalendar>, day: PlainDate): string | null {
  if (calendars.size === 0) return null;
  return holidaysIn(calendars, day.year).get(day.toString()) ?? null;
}

/**
 * The last day of a `days`-day window that opens on `start`. Holidays don't
 * count, so they push the end out; weekends count. A window opened Dec 1 ends
 * Jan 8, not Dec 30: the nine year-end days are skipped, not the month.
 */
export function windowEnd(
  start: PlainDate,
  days: number,
  calendars: ReadonlySet<HolidayCalendar>,
): PlainDate {
  if (!Number.isInteger(days) || days < 1)
    throw new Error(`a window is 1 day or more, got ${days}`);
  let day = start;
  let counted = 0;
  for (;;) {
    if (holidayOn(calendars, day) === null && ++counted === days) return day;
    day = day.addDays(1);
  }
}

/**
 * Strict: an unknown name throws, since a typo that silently sends on
 * Christmas is worse than a startup error. `none` = no holidays (a blank
 * setting reads as unset, so it takes the default).
 */
export function parseHolidayCalendars(raw: string, key: string): ReadonlySet<HolidayCalendar> {
  const out = new Set<HolidayCalendar>();
  if (raw.trim().toLowerCase() === "none") return out;
  for (const token of raw.split(",")) {
    const name = token.trim().toLowerCase();
    if (!name) continue;
    if (!(HOLIDAY_CALENDARS as readonly string[]).includes(name)) {
      throw new Error(
        `unknown holiday calendar '${token.trim()}' in ${key}; expected ${HOLIDAY_CALENDARS.join(", ")}, comma-separated, or none`,
      );
    }
    out.add(name as HolidayCalendar);
  }
  return out;
}
