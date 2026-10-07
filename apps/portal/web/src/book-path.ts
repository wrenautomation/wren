/**
 * Where a booking page is: its API base (`/c/<client>` on the app host, nothing on the client's
 * own host), and whether it books (`/book/<tag>`) or shows one call (`/booking/<token>`).
 */
export type BookPath =
  | { base: string; kind: "book"; tag: string | null }
  | { base: string; kind: "booking"; token: string };

export function bookPath(pathname: string): BookPath | null {
  const m =
    /^(\/c\/[a-z][a-z0-9_]{0,39})?\/(?:book(?:\/([A-Za-z0-9_-]{1,64}))?|booking\/([A-Za-z0-9._-]{1,80}))\/?$/.exec(
      pathname,
    );
  if (!m) return null;
  const base = m[1] ?? "";
  if (m[3]) return { base, kind: "booking", token: m[3] };
  return { base, kind: "book", tag: m[2] ?? null };
}

/** Open times grouped by day on `zone`'s clock, in order. */
export function byDay(slots: readonly string[], zone: string): Map<string, string[]> {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out = new Map<string, string[]>();
  for (const s of slots) {
    const d = key.format(new Date(s));
    const list = out.get(d);
    if (list) list.push(s);
    else out.set(d, [s]);
  }
  return out;
}

/** The visitor's zone, else the calendar's. */
export function zoneOf(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}

/** Every zone the browser knows, with `zone` first if it's missing. */
export function zones(zone: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
      "timeZone",
    );
  } catch {}
  return all.includes(zone) ? all : [zone, ...all];
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const looksLikeEmail = (s: string) => EMAIL.test(s.trim());

/** A refusal from `<base>/__book/<handler>`: its words and its status (0 = no answer). */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const TAKEN = "That time was just taken. Pick another.";

/**
 * Book, or on a 409 (someone took the time first) the open times again with TAKEN, so the page
 * shows fresh times in place and keeps what the booker typed. Any other refusal is its own words.
 */
export async function bookOrReload<T, S>(
  send: () => Promise<T>,
  reload: () => Promise<S>,
): Promise<{ booked: T } | { error: string; slots: S | null }> {
  try {
    return { booked: await send() };
  } catch (err) {
    if (!(err instanceof Refused && err.status === 409))
      return { error: (err as Error).message, slots: null };
    try {
      return { error: TAKEN, slots: await reload() };
    } catch {
      return { error: TAKEN, slots: null };
    }
  }
}
