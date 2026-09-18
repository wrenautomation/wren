/**
 * IANA zone arithmetic on top of `Intl`, no library. Two directions: an
 * instant → its wall clock in a zone, and a wall clock in a zone → the
 * instant. The second is where DST lives: a wall time can exist twice (fall
 * back) or not at all (spring forward); both resolve the way Python's
 * `fold=0` does, the pre-transition offset.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(zone, made);
  return made;
}

/** The canonical IANA name, or null when the runtime knows no such zone. */
export function canonicalZone(zone: string): string | null {
  try {
    return formatterFor(zone).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export interface WallClock {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** A finite Date, or a loud error: an invalid Date compares false to everything. */
export function assertInstant(at: Date): Date {
  if (Number.isNaN(at.getTime()))
    throw new Error("send policy needs a valid instant, got an invalid Date");
  return at;
}

export function wallClock(zone: string, at: Date): WallClock {
  const parts = formatterFor(zone).formatToParts(assertInstant(at));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl gave no ${type} for zone ${zone}`);
    return Number(part.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Minutes east of UTC the zone keeps at `at`. */
export function offsetMinutes(zone: string, at: Date): number {
  const w = wallClock(zone, at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const wholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
}

/**
 * The instant at which `zone` reads the given wall clock. An ambiguous wall
 * time resolves to its first occurrence; a nonexistent one is read with the
 * offset in force just before the gap.
 */
export function zonedInstant(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetA = offsetMinutes(zone, new Date(guess));
  const candidateA = guess - offsetA * 60_000;
  const offsetB = offsetMinutes(zone, new Date(candidateA));
  const candidateB = guess - offsetB * 60_000;
  const reads = (t: number): boolean => {
    const w = wallClock(zone, new Date(t));
    return (
      w.year === year &&
      w.month === month &&
      w.day === day &&
      w.hour === hour &&
      w.minute === minute &&
      w.second === second
    );
  };
  const matching = [...new Set([candidateA, candidateB])].filter(reads);
  if (matching.length > 0) return new Date(Math.min(...matching));
  return new Date(guess - Math.min(offsetA, offsetB) * 60_000);
}
