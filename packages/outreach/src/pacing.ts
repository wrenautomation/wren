/**
 * When approved comments go out: one account's lane, spaced, inside waking hours in its zone, under
 * a cap a day. Nothing leaves at once. The send itself is a Restate call delayed to the slot
 * (`restate/schedule.ts`); `send_at` on the row is the slot, so a change of mind is a cleared
 * column, and the call finds it gone.
 */

export interface Pace {
  /** Minutes between two sends on one lane, at least. */
  gapMinutes: number;
  /** Sends a local day, counting what's already sent and scheduled. */
  perDay: number;
  /** Local hours a send may land in: from inclusive, to exclusive. */
  from: number;
  to: number;
  zone: string;
  /**
   * A smaller cap a day for one kind of send on the lane (reach places under the warm-up share):
   * `taken` are that kind's sends, which count toward `perDay` as well. A slot found is that kind.
   */
  within?: { perDay: number; taken: readonly Date[] };
}

export const ZONE = "America/Toronto";

const MINUTE = 60_000;
/** A slot no sooner than this after now. */
const LEAD_MS = 10 * MINUTE;
/** How far ahead a lane may be filled. */
const HORIZON_MS = 14 * 86_400_000;

function local(d: Date, zone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/**
 * The next `n` slots on a lane, each at least the gap from every taken one (sent or scheduled),
 * inside the hours, under the day's cap. `rand` (0 to 1) spreads each slot up to half a gap past
 * its earliest, so sends don't land on the minute. Fewer than `n` when the horizon fills.
 */
export function sendSlots(
  n: number,
  o: { now: Date; taken: readonly Date[]; pace: Pace; rand: () => number },
): Date[] {
  const { pace } = o;
  const gap = pace.gapMinutes * MINUTE;
  const taken = [...o.taken];
  const perDay = new Map<string, number>();
  for (const t of taken) {
    const d = local(t, pace.zone).day;
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const kindPerDay = new Map<string, number>();
  for (const t of pace.within?.taken ?? []) {
    const d = local(t, pace.zone).day;
    kindPerDay.set(d, (kindPerDay.get(d) ?? 0) + 1);
  }
  const full = (day: string) =>
    (perDay.get(day) ?? 0) >= pace.perDay ||
    (pace.within ? (kindPerDay.get(day) ?? 0) >= pace.within.perDay : false);
  const out: Date[] = [];
  const end = o.now.getTime() + HORIZON_MS;
  let t = o.now.getTime() + LEAD_MS;
  while (out.length < n && t < end) {
    const at = new Date(t);
    const { day, hour } = local(at, pace.zone);
    if (hour < pace.from || hour >= pace.to || full(day)) {
      t += 15 * MINUTE;
      continue;
    }
    const near = taken.find((x) => Math.abs(x.getTime() - t) < gap);
    if (near) {
      t = near.getTime() + gap;
      continue;
    }
    const slot = new Date(t + Math.floor(o.rand() * (gap / 2 / MINUTE)) * MINUTE);
    const s = local(slot, pace.zone);
    if (
      s.hour >= pace.to ||
      s.day !== day ||
      taken.some((x) => Math.abs(x.getTime() - slot.getTime()) < gap)
    ) {
      t += 15 * MINUTE;
      continue;
    }
    out.push(slot);
    taken.push(slot);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    if (pace.within) kindPerDay.set(day, (kindPerDay.get(day) ?? 0) + 1);
    t = slot.getTime() + gap;
  }
  return out;
}
