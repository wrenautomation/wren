/**
 * The Calendar page's date maths, on the viewer's own clock: which days a view shows, the range
 * it asks for, where a block sits in its day, and side-by-side lanes for calls that overlap.
 * Pure, so the tests pin it.
 */

export const VIEWS = ["day", "week", "month", "list"] as const;
export type View = (typeof VIEWS)[number];

/** How many days the agenda shows from its first. */
export const LIST_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-06" for a local date. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local midnight of "2026-10-06"; null when it doesn't read. */
export function parseDay(s: string | null): Date | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || dayKey(d) !== s ? null : d;
}

/** `d` moved by whole days on the local calendar (DST days stay days). */
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The Monday on or before `d`. */
export const weekStart = (d: Date) => addDays(midnight(d), -((d.getDay() + 6) % 7));

/** The days a view draws around `anchor`, first to last. */
export function daysOf(view: View, anchor: Date): Date[] {
  const a = midnight(anchor);
  if (view === "day") return [a];
  if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(weekStart(a), i));
  if (view === "list") return Array.from({ length: LIST_DAYS }, (_, i) => addDays(a, i));
  // Month: whole weeks from the Monday before the 1st to the Sunday after the last.
  const first = weekStart(new Date(a.getFullYear(), a.getMonth(), 1));
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  const out: Date[] = [];
  for (let d = first; d <= last || out.length % 7; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The instants a view asks the calendar for: its first day's midnight to the day after its last. */
export function rangeOf(view: View, anchor: Date): { from: Date; to: Date } {
  const days = daysOf(view, anchor);
  return { from: days[0] as Date, to: addDays(days[days.length - 1] as Date, 1) };
}

/** Where the previous or next arrow goes: a day, a week, a month or the agenda's length. */
export function step(view: View, anchor: Date, by: 1 | -1): Date {
  if (view === "day") return addDays(anchor, by);
  if (view === "week") return addDays(anchor, 7 * by);
  if (view === "list") return addDays(anchor, LIST_DAYS * by);
  return new Date(anchor.getFullYear(), anchor.getMonth() + by, 1);
}

export interface Block {
  start: Date;
  end: Date;
}

/** A span's top and height in a day column, in minutes from that day's midnight, clipped to it. */
export function placeIn(day: Date, b: Block): { top: number; height: number } | null {
  const from = day.getTime();
  const to = addDays(day, 1).getTime();
  const s = Math.max(b.start.getTime(), from);
  const e = Math.min(b.end.getTime(), to);
  if (e <= s) return null;
  return { top: (s - from) / 60_000, height: (e - s) / 60_000 };
}

/**
 * Lanes for blocks that overlap, as a calendar draws them side by side: each block's lane and how
 * many lanes its cluster of overlaps needs. Blocks in start order.
 */
export function lanes<T extends Block>(
  blocks: readonly T[],
): { item: T; lane: number; of: number }[] {
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: { item: T; lane: number; of: number }[] = [];
  let cluster: { item: T; lane: number; of: number }[] = [];
  let ends: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const c of cluster) c.of = ends.length;
    cluster = [];
    ends = [];
  };
  for (const item of sorted) {
    const s = item.start.getTime();
    if (s >= clusterEnd) close();
    let lane = ends.findIndex((e) => e <= s);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.end.getTime();
    clusterEnd = Math.max(clusterEnd, item.end.getTime());
    const placed = { item, lane, of: 1 };
    cluster.push(placed);
    out.push(placed);
  }
  close();
  return out;
}
