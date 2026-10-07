/**
 * Open start times: the weekly hours walked day by day on the owner's clock, each start turned
 * into an instant with `zonedInstant`, so a call at 10:00 stays at 10:00 across a DST change.
 * A wall time the clock skips (spring forward) is no slot; one it reads twice (fall back) is one
 * slot, the first. Busy times and our own calls are kept clear by the buffer either side, and
 * a day at its cap offers nothing. Pure: the caller brings busy times and calls.
 */
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Rules } from "./rules.js";

export interface Span {
  start: Date;
  end: Date;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** "2026-10-06" for `at` on `zone`'s clock. */
export function dayOn(zone: string, at: Date): string {
  const w = wallClock(zone, at);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/**
 * Starts in [from, to) a booker may take, ascending. `busy` is the calendar's own busy time
 * (Google's free/busy); `calls` are our booked calls, which also count toward each day's cap.
 */
export function openSlots(
  rules: Rules,
  o: { from: Date; to: Date; now: Date; busy: readonly Span[]; calls: readonly Span[] },
): Date[] {
  const { zone } = rules;
  const earliest = Math.max(o.from.getTime(), o.now.getTime() + rules.notice * MIN);
  const today = wallClock(zone, o.now);
  const lastDay = Date.UTC(today.year, today.month - 1, today.day) + rules.days * DAY;
  const first = wallClock(zone, new Date(earliest));
  const end = wallClock(zone, o.to);
  const stop = Math.min(Date.UTC(end.year, end.month - 1, end.day), lastDay);
  const perDay = new Map<string, number>();
  for (const c of o.calls) {
    const d = dayOn(zone, c.start);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const blocked = [...o.busy, ...o.calls];
  const pad = rules.buffer * MIN;
  const out: Date[] = [];
  for (let d = Date.UTC(first.year, first.month - 1, first.day); d <= stop; d += DAY) {
    const day = new Date(d);
    const [y, m, dd] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const key = `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if ((perDay.get(key) ?? 0) >= rules.perDay) continue;
    for (const stretch of rules.week[day.getUTCDay()] ?? []) {
      for (let at = stretch.from; at + rules.length <= stretch.to; at += rules.step) {
        const [hh, mm] = [Math.floor(at / 60), at % 60];
        // 24:00 never starts a call: `at + length <= to` keeps every start under it.
        const start = zonedInstant(zone, y, m, dd, hh, mm);
        const w = wallClock(zone, start);
        if (w.day !== dd || w.hour !== hh || w.minute !== mm) continue; // skipped by DST
        const t = start.getTime();
        if (t < earliest || t >= o.to.getTime()) continue;
        const span = { start: new Date(t - pad), end: new Date(t + (rules.length * MIN + pad)) };
        if (blocked.some((b) => overlaps(span, b))) continue;
        if (out.length && (out[out.length - 1] as Date).getTime() === t) continue;
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * The weekly hours as instants for each of the owner's days that touches [from, to), clipped to
 * it: what the Calendar app shades as open. A stretch's ends move with DST as its slots do; an
 * end of 24:00 is the next midnight.
 */
export function openHours(rules: Rules, from: Date, to: Date): Span[] {
  const { zone } = rules;
  const a = wallClock(zone, from);
  const b = wallClock(zone, to);
  const out: Span[] = [];
  const at = (y: number, m: number, d: number, minutes: number) =>
    minutes >= 24 * 60
      ? (() => {
          const next = new Date(Date.UTC(y, m - 1, d) + DAY);
          return zonedInstant(
            zone,
            next.getUTCFullYear(),
            next.getUTCMonth() + 1,
            next.getUTCDate(),
            0,
            0,
          );
        })()
      : zonedInstant(zone, y, m, d, Math.floor(minutes / 60), minutes % 60);
  for (
    let d = Date.UTC(a.year, a.month - 1, a.day);
    d <= Date.UTC(b.year, b.month - 1, b.day);
    d += DAY
  ) {
    const day = new Date(d);
    const [y, m, dd] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    for (const stretch of rules.week[day.getUTCDay()] ?? []) {
      const start = Math.max(at(y, m, dd, stretch.from).getTime(), from.getTime());
      const end = Math.min(at(y, m, dd, stretch.to).getTime(), to.getTime());
      if (start < end) out.push({ start: new Date(start), end: new Date(end) });
    }
  }
  return out;
}

/** True when `start` is one of the open slots: what booking checks, fresh, before it writes. */
export function isOpen(
  rules: Rules,
  start: Date,
  o: { now: Date; busy: readonly Span[]; calls: readonly Span[] },
): boolean {
  const t = start.getTime();
  return openSlots(rules, { ...o, from: start, to: new Date(t + MIN) }).some(
    (s) => s.getTime() === t,
  );
}
