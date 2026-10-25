/**
 * The dated lines a deal's terms imply. Pure; no row stores it. Dates are `YYYY-MM-DD` (UTC).
 * The first bill is the signing date plus `trialDays`. Setup (or its first part) and the first
 * month fall on it. A share has no amount: it bills on reported revenue.
 */
import type { Terms } from "@wren/offers";

type ScheduleLine =
  | { kind: "setup"; on: string; cents: number; currency: string; part?: { n: number; of: number } }
  | { kind: "monthly"; on: string; cents: number; currency: string }
  | {
      kind: "unit";
      /** Billed as each unit happens. */
      on: null;
      centsEach: number;
      unit: string | null;
      capCents: number | null;
      currency: string;
    }
  | {
      kind: "share";
      on: null;
      bps: number;
      basis: "on reported revenue";
      floorCents: number | null;
      currency: string;
    };

/** With no `days` and no `until`, recurring lines run this many months. */
const OPEN_ENDED_MONTHS = 12;

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const plusMonths = (d: Date, n: number) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d.getUTCDate(), last));
  return t;
};

/**
 * Lines due from `signedAt` through `until` (inclusive). Default end: the last day of `days`,
 * else `OPEN_ENDED_MONTHS` months. A given `until` also cuts setup parts; the default end cuts
 * only monthly lines.
 */
export function scheduleOf(
  terms: Terms,
  signedAt: Date | string,
  until?: Date | string,
): ScheduleLine[] {
  const signed = new Date(signedAt);
  const first = plusDays(signed, terms.trialDays ?? 0);
  const given = until === undefined ? null : day(new Date(until));
  const end =
    given ??
    day(
      terms.days != null
        ? plusDays(signed, terms.days - 1)
        : plusDays(plusMonths(signed, OPEN_ENDED_MONTHS), -1),
    );
  const currency = terms.currency;
  const lines: ScheduleLine[] = [];

  if (terms.setupCents > 0) {
    const n = Math.max(1, terms.installments?.count ?? 1);
    const every = terms.installments?.everyDays ?? 0;
    const each = Math.floor(terms.setupCents / n);
    for (let i = 0; i < n; i++) {
      // The remainder goes on the first part, so the parts add up.
      const cents = i === 0 ? terms.setupCents - each * (n - 1) : each;
      const on = day(plusDays(first, i * every));
      if (given && on > given) continue;
      lines.push({
        kind: "setup",
        on,
        cents,
        currency,
        ...(n > 1 ? { part: { n: i + 1, of: n } } : {}),
      });
    }
  }

  if (terms.monthlyCents != null && terms.monthlyCents > 0) {
    for (let i = 0; ; i++) {
      const on = day(plusMonths(first, i));
      if (on > end) break;
      lines.push({ kind: "monthly", on, cents: terms.monthlyCents, currency });
    }
  }

  if (terms.perUnitCents != null && terms.perUnitCents > 0) {
    lines.push({
      kind: "unit",
      on: null,
      centsEach: terms.perUnitCents,
      unit: terms.unit,
      capCents: terms.capCents,
      currency,
    });
  }

  if (terms.shareBps != null && terms.shareBps > 0) {
    lines.push({
      kind: "share",
      on: null,
      bps: terms.shareBps,
      basis: "on reported revenue",
      floorCents: terms.floorCents ?? null,
      currency,
    });
  }

  // Dated lines first, by date; undated after. The sort is stable, so same-day lines keep order.
  return lines.sort((a, b) => (a.on ?? "9999").localeCompare(b.on ?? "9999"));
}
