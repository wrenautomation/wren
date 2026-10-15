/**
 * The timeline's math (`./timeline.tsx`): which days a zoom shows, each day's count from the
 * server's `stats` series, weeks and months bucketed from days, empty stretches folded, and the
 * `where` that pages one day's lines. Days are the viewer's own, in local time.
 */

/** How far out the axis is: a section per day, a row per day, or a row per week. */
export type Zoom = "day" | "week" | "month";
export const ZOOMS: readonly (readonly [Zoom, string])[] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

/** Lines a day section reads at a time. */
export const DAY_PAGE = 50;

const pad = (n: number) => String(n).padStart(2, "0");
/** A local day as "2026-10-07". */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "2026-10-07" as local midnight; null for anything else. */
export function dayFrom(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d) === s ? d : null;
}
export const plus = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The Monday the week of `d` starts on. */
export const monday = (d: Date) => plus(d, -((d.getDay() + 6) % 7));

export const zoomOf = (params: URLSearchParams): Zoom => {
  const z = params.get("zoom");
  return z === "week" || z === "month" ? z : "day";
};

/** The newest day on screen: the address's `day`, never past today; today when it names none. */
export function anchorOf(params: URLSearchParams, today: Date): Date {
  const d = dayFrom(params.get("day"));
  return d && d < today ? d : today;
}

/**
 * The days a zoom shows, oldest first, ending with `anchor`: two weeks of day sections; twelve
 * weeks of day rows, from a Monday; thirteen weeks of week rows, from a Monday. Each stays inside
 * the server's 92-day stat.
 */
export function rangeOf(anchor: Date, zoom: Zoom): Date[] {
  const first =
    zoom === "day" ? plus(anchor, -13) : plus(monday(anchor), zoom === "week" ? -7 * 11 : -7 * 12);
  const out: Date[] = [];
  for (let d = first; d <= anchor; d = plus(d, 1)) out.push(d);
  return out;
}

/** Where the arrows go: a day, a week or a month either way, never past today. */
export function stepOf(anchor: Date, zoom: Zoom, by: -1 | 1, today: Date): Date | null {
  const to =
    zoom === "day"
      ? plus(anchor, by)
      : zoom === "week"
        ? plus(anchor, 7 * by)
        : new Date(anchor.getFullYear(), anchor.getMonth() + by, anchor.getDate());
  if (by === 1 && anchor >= today) return null;
  return to > today ? today : to;
}

/** The anchor that shows the stretch just before this one: the foot's "Earlier". */
export function earlierOf(days: readonly Date[]): Date | null {
  const first = days[0];
  return first ? plus(first, -1) : null;
}

/** One day's lines counted, all and per state of the timeline's kind field. */
export interface DayCount {
  day: string;
  n: number;
  by: Record<string, number>;
}

/** The server's series (`stats` with `by`) by local day; a day it lacks counts 0. */
export function countsOf(
  days: readonly Date[],
  series: readonly { at: string; value: number | null; by?: Record<string, number> }[],
): DayCount[] {
  const got = new Map<string, { n: number; by: Record<string, number> }>();
  for (const p of series)
    got.set(dayKey(new Date(p.at)), { n: Number(p.value ?? 0), by: { ...(p.by ?? {}) } });
  return days.map((d) => {
    const k = dayKey(d);
    return { day: k, n: got.get(k)?.n ?? 0, by: got.get(k)?.by ?? {} };
  });
}

const add = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
};

/** A week of days: its Monday, its last day shown, the days, and their sum. */
export interface WeekCount {
  week: string;
  last: string;
  days: DayCount[];
  n: number;
  by: Record<string, number>;
}

/** Days into weeks from Monday, oldest first. */
export function weeksOf(days: readonly DayCount[]): WeekCount[] {
  const out: WeekCount[] = [];
  for (const d of days) {
    const date = dayFrom(d.day);
    if (!date) continue;
    const week = dayKey(monday(date));
    let w = out.at(-1);
    if (w?.week !== week) {
      w = { week, last: d.day, days: [], n: 0, by: {} };
      out.push(w);
    }
    w.days.push(d);
    w.last = d.day;
    w.n += d.n;
    add(w.by, d.by);
  }
  return out;
}

/** Weeks under the month their Monday falls in ("2026-10"), oldest first. */
export function monthsOf(weeks: readonly WeekCount[]): { month: string; weeks: WeekCount[] }[] {
  const out: { month: string; weeks: WeekCount[] }[] = [];
  for (const w of weeks) {
    const month = w.week.slice(0, 7);
    const m = out.at(-1);
    if (m?.month === month) m.weeks.push(w);
    else out.push({ month, weeks: [w] });
  }
  return out;
}

/** A day with lines, or a run of days without (newest first, `from` the oldest). */
export type Stretch = { day: DayCount } | { quiet: { from: string; to: string; days: number } };

/**
 * Newest first, each day with lines its own stretch and each run of empty days one quiet line.
 * `keep` stays a day of its own even when empty: the day a jump landed on, today.
 */
export function stretchesOf(days: readonly DayCount[], keep: ReadonlySet<string>): Stretch[] {
  const out: Stretch[] = [];
  for (const d of [...days].reverse()) {
    if (d.n > 0 || keep.has(d.day)) {
      out.push({ day: d });
      continue;
    }
    const last = out.at(-1);
    if (last && "quiet" in last) {
      last.quiet.from = d.day;
      last.quiet.days++;
    } else out.push({ quiet: { from: d.day, to: d.day, days: 1 } });
  }
  return out;
}

/** A count's states, most first, the rest summed: the chips beside a day. */
export function topOf(
  by: Readonly<Record<string, number>>,
  max = 4,
): { top: [string, number][]; rest: number } {
  const all = Object.entries(by)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { top: all.slice(0, max), rest: all.slice(max).reduce((s, [, n]) => s + n, 0) };
}

/** A day's lines as a date filter: local midnight to its last millisecond. */
export function dayWhere(day: string): { gte: string; lte: string } | null {
  const d = dayFrom(day);
  if (!d) return null;
  return { gte: d.toISOString(), lte: new Date(plus(d, 1).getTime() - 1).toISOString() };
}

/** A bar's height in the strip, 0 to 1: a square root, so one huge day leaves the rest readable. */
export function barOf(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.max(0.08, Math.sqrt(n) / Math.sqrt(max));
}
