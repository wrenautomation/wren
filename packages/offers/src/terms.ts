/**
 * What a client pays for an offer: one plan, in cents (null = none). Frozen into an agreement
 * when it is issued, and kept as versions in `pipeline.terms_versions`. Rows from before the
 * last four fields lack them, so every new field is optional.
 */
export interface Terms {
  currency: string;
  setupCents: number;
  monthlyCents: number | null;
  perUnitCents: number | null;
  /** What a per-unit fee counts, singular: "meeting booked". */
  unit: string | null;
  /** The most the per-unit fees add up to. */
  capCents: number | null;
  /** How long it runs, or null until either side ends it. */
  days: number | null;
  /** Past `days`, it carries on until this many units, or null to stop at `days`. Older terms lack it. */
  until?: number | null;
  /** Every fee back if there are no units by `days` (contract section 6). Older terms lack it. */
  refundIfNone?: { minContacts: number } | null;
  /** Days after an invoice's date that it's due. */
  payDays: number;
  /** A revenue share, in basis points (1000 = 10%). */
  shareBps?: number | null;
  /** The least a period bills when a share is in play. */
  floorCents?: number | null;
  /** The setup paid in parts: `count` of them, one every `everyDays`, the first on signing. */
  installments?: { count: number; everyDays: number } | null;
  /** Days before the first bill. */
  trialDays?: number | null;
}
