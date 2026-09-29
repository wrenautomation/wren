/**
 * The made-up half of a demo CRM: who owned the contact, when they were added,
 * last contacted, last placed with. Seeded by the agency's domain, so the same
 * agency gets the same history every time. Dates are what a dead client list
 * looks like: added years ago, last touched one to four years back.
 */

export type Rng = () => number;

/** mulberry32 over a string hash: small, fast, same numbers for the same seed. */
export function seededRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;

const OWNERS = ["Sam Patel", "Alex Chen", "Jordan Reyes", "Taylor Brooks", "Morgan Lee"];
/** Bullhorn ClientContact statuses, weighted toward what old lists hold. */
const STATUSES = [
  ...Array(4).fill("Client"),
  ...Array(3).fill("Inactive"),
  ...Array(2).fill("Prospect"),
  "Passive",
] as const;

const DAY = 86_400_000;
const daysBefore = (d: Date, days: number) => new Date(d.getTime() - Math.round(days) * DAY);

export interface History {
  owner: string;
  status: string;
  created: Date;
  lastContacted: Date | null;
  lastPlacement: Date | null;
}

/**
 * One contact's history. Added 3-10 years ago; most last contacted 1-4 years
 * ago, about one in ten inside the last year; about six in ten placed with at
 * least once, the last placement before the last contact.
 */
export function simulateHistory(rng: Rng, today: Date): History {
  const created = daysBefore(today, 365 * (3 + rng() * 7));
  const recent = rng() < 0.1;
  const contactedAgo = recent ? 30 + rng() * 300 : 365 * (1 + rng() * 3);
  const lastContacted =
    rng() < 0.05
      ? null
      : new Date(Math.max(daysBefore(today, contactedAgo).getTime(), created.getTime() + 30 * DAY));
  let lastPlacement: Date | null = null;
  if (rng() < 0.6) {
    const from = created.getTime() + 60 * DAY;
    const to = (lastContacted ?? today).getTime();
    if (to > from) lastPlacement = new Date(from + rng() * (to - from));
  }
  return {
    owner: pick(rng, OWNERS),
    status: pick(rng, STATUSES),
    created,
    lastContacted,
    lastPlacement,
  };
}

/** Bullhorn's list export writes US dates: 09/29/2026. */
export const usDate = (d: Date | null): string =>
  d
    ? `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`
    : "";
