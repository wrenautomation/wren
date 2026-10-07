/**
 * Managed usage as draft lines (designs/2026-10-07-setup-and-vendors.md): each owner's month of
 * each vendor on Wren's key, at cost plus Wren's markup. Nothing here sends or charges; putting a
 * line on the Wise invoice is a person's step.
 */
import { vendorUsage } from "@wren/core/vendor-schema";
import { vendorSettings } from "@wren/core/vendors";
import { atomic, type Db } from "@wren/db";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { type UsageLine, usageLines } from "./schema.js";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `2026-03` as its first instant and the next month's, UTC. */
export function monthBounds(month: string): { from: Date; to: Date; day: string } {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`month: YYYY-MM, not ${JSON.stringify(month)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    from: new Date(Date.UTC(y, mo - 1, 1)),
    to: new Date(Date.UTC(y, mo, 1)),
    day: `${month}-01`,
  };
}

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Micro-dollars to cents, half up. */
const cents = (micros: number) => Math.round(micros / 10_000);

/**
 * Rewrite a month's draft lines from `vendor_usage`: one per owner and vendor on Wren's key.
 * Lines already on an invoice stay as they are. Wren's own lines carry no markup.
 */
export async function writeUsageLines(
  main: Db,
  month: string,
): Promise<{ lines: number; costCents: number; amountCents: number; kept: number }> {
  const { from, to, day } = monthBounds(month);
  const { markupPct } = await vendorSettings(main);
  const sums = await main
    .select({
      client: vendorUsage.client,
      vendor: vendorUsage.vendor,
      units: sql<string>`sum(${vendorUsage.units})`,
      micros: sql<string>`sum(${vendorUsage.micros})`,
    })
    .from(vendorUsage)
    .where(and(eq(vendorUsage.mode, "managed"), gte(vendorUsage.at, from), lt(vendorUsage.at, to)))
    .groupBy(vendorUsage.client, vendorUsage.vendor);
  return atomic(main, async (tx) => {
    const fixed = await tx
      .select({ client: usageLines.client, vendor: usageLines.vendor })
      .from(usageLines)
      .where(and(eq(usageLines.month, day), eq(usageLines.state, "on_invoice")));
    const isFixed = (c: string | null, v: string) =>
      fixed.some((f) => f.client === c && f.vendor === v);
    await tx
      .delete(usageLines)
      .where(and(eq(usageLines.month, day), eq(usageLines.state, "draft")));
    const rows = sums
      .filter((s) => !isFixed(s.client, s.vendor))
      .map((s) => {
        const cost = cents(Number(s.micros));
        const markup = s.client === null ? 0 : markupPct;
        return {
          client: s.client,
          vendor: s.vendor,
          month: day,
          units: Number(s.units),
          costCents: cost,
          markupPct: markup,
          amountCents: Math.round((cost * (100 + markup)) / 100),
        };
      });
    if (rows.length) await tx.insert(usageLines).values(rows);
    return {
      lines: rows.length,
      costCents: rows.reduce((a, r) => a + r.costCents, 0),
      amountCents: rows.reduce((a, r) => a + r.amountCents, 0),
      kept: fixed.length,
    };
  });
}

/** A month's lines, an owner's or all of them: Billing and the Books page. */
export async function usageLinesOf(
  main: Db,
  month: string,
  client?: string | null,
): Promise<UsageLine[]> {
  const { day } = monthBounds(month);
  return main
    .select()
    .from(usageLines)
    .where(
      and(
        eq(usageLines.month, day),
        client === undefined
          ? undefined
          : client === null
            ? sql`${usageLines.client} is null`
            : eq(usageLines.client, client),
      ),
    )
    .orderBy(asc(usageLines.client), asc(usageLines.vendor));
}
