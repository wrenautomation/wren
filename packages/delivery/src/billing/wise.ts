/**
 * Wise, read only (designs/2026-10-15-wise-billing.md). The token is a personal one with read
 * access; this client only ever GETs, so it can't move money even with a stronger token. No
 * official Wise SDK for Node exists, and three GETs don't need one: plain fetch.
 */

/** Money that came into one of our balances, as BillingWatch stores it. */
export interface CreditIn {
  /** Wise's reference number for it, unique: `DEPOSIT-123`. */
  wiseId: string;
  balanceId: string;
  currency: string;
  /** What landed, after Wise's fee. */
  cents: number;
  feeCents: number;
  at: Date;
  /** Wise's kind: DEPOSIT, TRANSFER, CONVERSION, MONEY_ADDED. */
  kind: string;
  payer: string | null;
  /** The transfer's memo. */
  memo: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

/** What BillingWatch reads; tests hand it a fake. */
export interface WiseReader {
  /** Every credit to every balance between two moments, oldest first. */
  credits(from: Date, to: Date): Promise<CreditIn[]>;
}

/** Our own money moving, not a client paying: stored, never matched. */
export const OWN_KINDS = new Set([
  "CONVERSION",
  "MONEY_ADDED",
  "INCOMING_CROSS_BALANCE",
  "BALANCE_INTEREST",
  "BALANCE_CASHBACK",
  "BALANCE_ADJUSTMENT",
  "ACCRUAL_CHARGE",
  "INVESTMENT_TRADE_ORDER",
  "CARD",
]);

/** A Wise call that failed: the status and path, never the token. */
export class WiseError extends Error {}

const cents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One statement line as a credit, or null when it isn't money in. */
export function creditOf(balanceId: string, t: Record<string, unknown>): CreditIn | null {
  if (t.type !== "CREDIT") return null;
  const amount = (t.amount ?? {}) as { value?: unknown; currency?: unknown };
  const fees = (t.totalFees ?? {}) as { value?: unknown };
  const d = (t.details ?? {}) as Record<string, unknown>;
  const value = cents(amount.value);
  const currency = str(amount.currency);
  const at = new Date(String(t.date ?? ""));
  if (value <= 0 || !currency || Number.isNaN(at.getTime())) return null;
  return {
    wiseId: str(t.referenceNumber) ?? `${balanceId}:${at.toISOString()}:${value}`,
    balanceId,
    currency,
    cents: value,
    feeCents: Math.max(0, cents(fees.value)),
    at,
    kind: str(d.type) ?? "UNKNOWN",
    payer: str(d.senderName),
    memo: str(d.paymentReference),
    description: str(d.description),
    raw: t,
  };
}

export function wiseReader(o: {
  token: string;
  profileId: string;
  fetch?: typeof fetch;
  base?: string;
}): WiseReader {
  const f = o.fetch ?? fetch;
  const base = o.base ?? "https://api.wise.com";
  const get = async <T>(path: string): Promise<T> => {
    const r = await f(`${base}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${o.token}`, accept: "application/json" },
    });
    if (!r.ok) throw new WiseError(`Wise ${path.split("?")[0]}: ${r.status}`);
    return (await r.json()) as T;
  };
  const p = encodeURIComponent(o.profileId);
  return {
    async credits(from, to) {
      const balances = await get<{ id: number | string; currency: string }[]>(
        `/v4/profiles/${p}/balances?types=STANDARD`,
      );
      const out: CreditIn[] = [];
      for (const b of balances) {
        const q = new URLSearchParams({
          currency: b.currency,
          intervalStart: from.toISOString(),
          intervalEnd: to.toISOString(),
          type: "COMPACT",
        });
        const s = await get<{ transactions?: Record<string, unknown>[] }>(
          `/v1/profiles/${p}/balance-statements/${encodeURIComponent(String(b.id))}/statement.json?${q}`,
        );
        for (const t of s.transactions ?? []) {
          const c = creditOf(String(b.id), t);
          if (c) out.push(c);
        }
      }
      return out.sort((a, b) => a.at.getTime() - b.at.getTime());
    },
  };
}
