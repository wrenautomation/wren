/** Calendar dates and clock times without a timezone, plus business-day cadence math (D36). */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A calendar day. Immutable; arithmetic returns new values. */
export class PlainDate {
  constructor(
    readonly year: number,
    readonly month: number,
    readonly day: number,
  ) {
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      throw new Error(`not a calendar date: ${year}-${month}-${day}`);
    }
    Object.freeze(this);
  }

  /** Strict `YYYY-MM-DD`. */
  static fromIso(text: string): PlainDate {
    const m = ISO_DATE.exec(text.trim());
    if (!m) throw new Error(`expected YYYY-MM-DD, got ${JSON.stringify(text)}`);
    return new PlainDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  /** The UTC calendar day of an instant. */
  static utcDayOf(at: Date): PlainDate {
    return new PlainDate(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
  }

  private get epochDays(): number {
    return Date.UTC(this.year, this.month - 1, this.day) / DAY_MS;
  }

  /** 0 = Monday … 6 = Sunday, as Python's `date.weekday()`. */
  weekday(): number {
    return (new Date(Date.UTC(this.year, this.month - 1, this.day)).getUTCDay() + 6) % 7;
  }

  addDays(n: number): PlainDate {
    return PlainDate.utcDayOf(new Date((this.epochDays + n) * DAY_MS));
  }

  /** `other - this` in days. */
  daysUntil(other: PlainDate): number {
    return other.epochDays - this.epochDays;
  }

  compare(other: PlainDate): number {
    return this.epochDays - other.epochDays;
  }

  equals(other: PlainDate): boolean {
    return this.compare(other) === 0;
  }

  toString(): string {
    return `${String(this.year).padStart(4, "0")}-${String(this.month).padStart(2, "0")}-${String(this.day).padStart(2, "0")}`;
  }
}

export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

export function minutesOfDay(t: ClockTime): number {
  return t.hour * 60 + t.minute;
}

export function formatClock(t: ClockTime): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/**
 * The date `days` business days after `start`. A weekend start rolls forward
 * to Monday first, so day 0 from a Saturday is Monday. `holiday` marks more
 * days off (the send policy's calendars); weekends are always off.
 */
export function addBusinessDays(
  start: PlainDate,
  days: number,
  holiday: (day: PlainDate) => boolean = () => false,
): PlainDate {
  if (days < 0) throw new Error("cadence never schedules into the past");
  const off = (day: PlainDate) => day.weekday() >= 5 || holiday(day);
  let current = start;
  while (off(current)) current = current.addDays(1);
  for (let i = 0; i < days; i++) {
    current = current.addDays(1);
    while (off(current)) current = current.addDays(1);
  }
  return current;
}
