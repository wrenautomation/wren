/**
 * When an out-of-office says its person is back. A follow-up sent while they
 * are away lands under the pile they clear on return, so the next step waits.
 *
 * Reads the dates the message names near an away word ("back", "until",
 * "returning", "out", ...) and keeps the latest one ahead of the day it
 * arrived, within `MAX_AWAY_DAYS`. "Out Dec 22 to Jan 4, back Jan 5" gives
 * Jan 5. No date, or only dates far off (a stale auto-reply, a webinar in the
 * signature), gives null: the sequence keeps its own pace.
 *
 * Numeric dates read month first (1/5 is January 5): the lists are US and
 * Canada. A date without a year is its next occurrence.
 */
import { PlainDate } from "../send/dates.js";

/** A longer leave isn't held: the thread would block the firm's other contacts for months. */
export const MAX_AWAY_DAYS = 60;

/** How far before a date an away word may sit and still own it. */
const NEAR_CHARS = 60;

const AWAY_WORD =
  /\b(back|return|returning|returns|until|till|til|through|thru|resume|resuming|away|out|off|leave|vacation|holidays?|travel(?:l?ing)?|closed|reopen(?:s|ing)?|available)\b/i;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4}))?";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

interface Found {
  readonly at: number;
  readonly date: (received: PlainDate) => PlainDate | null;
}

/** `year` given, or the next occurrence of month/day on or after `received`. */
function dated(
  month: number,
  day: number,
  year: number | null,
  received: PlainDate,
): PlainDate | null {
  try {
    if (year !== null) return new PlainDate(year < 100 ? 2000 + year : year, month, day);
    const same = new PlainDate(received.year, month, day);
    return same.compare(received) >= 0 ? same : new PlainDate(received.year + 1, month, day);
  } catch {
    return null; // Feb 30, 13/40: not a day
  }
}

const monthOf = (name: string): number => MONTHS[name.slice(0, 3).toLowerCase()] ?? 0;

function* dates(text: string): Generator<Found> {
  for (const m of text.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+${DAY}\\b${YEAR}`, "gi"))) {
    const [, month, day, year] = m;
    yield {
      at: m.index,
      date: (r) => dated(monthOf(month as string), Number(day), year ? Number(year) : null, r),
    };
  }
  for (const m of text.matchAll(
    new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\b\\.?${YEAR}`, "gi"),
  )) {
    const [, day, month, year] = m;
    yield {
      at: m.index,
      date: (r) => dated(monthOf(month as string), Number(day), year ? Number(year) : null, r),
    };
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const [, year, month, day] = m;
    yield { at: m.index, date: (r) => dated(Number(month), Number(day), Number(year), r) };
  }
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g)) {
    const [, month, day, year] = m;
    yield {
      at: m.index,
      date: (r) => dated(Number(month), Number(day), year ? Number(year) : null, r),
    };
  }
  for (const m of text.matchAll(new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "gi"))) {
    const weekday = WEEKDAYS.indexOf((m[1] as string).toLowerCase());
    yield {
      at: m.index,
      date: (r) => {
        let day = r.addDays(1);
        while (day.weekday() !== weekday) day = day.addDays(1);
        return day;
      },
    };
  }
  for (const m of text.matchAll(/\btomorrow\b/gi)) yield { at: m.index, date: (r) => r.addDays(1) };
}

/** The last day the person is away, from their auto-reply's subject and text, or null. */
export function awayUntil(text: string, received: PlainDate): PlainDate | null {
  const latest = received.addDays(MAX_AWAY_DAYS);
  let best: PlainDate | null = null;
  for (const found of dates(text)) {
    if (!AWAY_WORD.test(text.slice(Math.max(0, found.at - NEAR_CHARS), found.at))) continue;
    const day = found.date(received);
    if (day === null || day.compare(received) < 0 || day.compare(latest) > 0) continue;
    if (best === null || day.compare(best) > 0) best = day;
  }
  return best;
}
