import type { Db } from "@wren/db";
import { and, desc, eq, gt, gte, lte } from "drizzle-orm";
import { shiftDay, today } from "./day.js";
import { rates } from "./schema.js";

/** Daily rates for a currency over a range of days: CAD per unit, one per business day. */
export type RateFeed = (
  currency: string,
  from: string,
  to: string,
) => Promise<Array<{ on: string; cadPerUnit: string }>>;

/** The Bank of Canada's daily rates (the Valet API, no key): series `FX<CUR>CAD`. */
export function bankOfCanada(fetchFn: typeof fetch = fetch): RateFeed {
  return async (currency, from, to) => {
    const series = `FX${currency}CAD`;
    const res = await fetchFn(
      `https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${from}&end_date=${to}`,
    );
    if (!res.ok) throw new Error(`Bank of Canada ${series}: HTTP ${res.status}`);
    const body = (await res.json()) as { observations?: Array<Record<string, unknown>> };
    return (body.observations ?? []).flatMap((o) => {
      const v = (o[series] as { v?: unknown } | undefined)?.v;
      return typeof o.d === "string" && typeof v === "string" ? [{ on: o.d, cadPerUnit: v }] : [];
    });
  };
}

/** How far back a day with no rate (a weekend, a holiday) looks for the last one published. */
const LOOKBACK_DAYS = 10;

/**
 * The Bank of Canada rate for a day: its own, else the last one published
 * before it. Stored rates answer first. The feed is asked only when the
 * store cannot tell: no rate that day and none after it yet, so the gap may
 * be a rate not fetched rather than a day with none.
 */
export async function bocRate(
  db: Db,
  feed: RateFeed,
  currency: string,
  on: string,
): Promise<{ rate: string; on: string }> {
  const from = shiftDay(on, -LOOKBACK_DAYS);
  const series = and(eq(rates.currency, currency), eq(rates.source, "boc"));
  const latest = async () =>
    (
      await db
        .select({ on: rates.on, rate: rates.cadPerUnit })
        .from(rates)
        .where(and(series, gte(rates.on, from), lte(rates.on, on)))
        .orderBy(desc(rates.on))
        .limit(1)
    )[0];
  let hit = await latest();
  if (hit?.on !== on) {
    const [later] = await db
      .select({ on: rates.on })
      .from(rates)
      .where(and(series, gt(rates.on, on), lte(rates.on, shiftDay(on, LOOKBACK_DAYS))))
      .limit(1);
    if (!hit || !later) {
      const until = [shiftDay(on, LOOKBACK_DAYS), today()].sort()[0] as string;
      const got = await feed(currency, from, until);
      if (got.length)
        await db
          .insert(rates)
          .values(
            got.map((r) => ({
              on: r.on,
              currency,
              source: "boc" as const,
              cadPerUnit: r.cadPerUnit,
            })),
          )
          .onConflictDoNothing();
      hit = await latest();
    }
  }
  if (!hit) throw new Error(`no Bank of Canada ${currency} rate from ${from} to ${on}`);
  return { rate: hit.rate, on: hit.on };
}
