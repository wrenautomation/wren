import { type Db, serializable, type Tx } from "@wren/db";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { CARD, GST_PAID } from "./chart.js";
import { toCad } from "./money.js";
import { bocRate, type RateFeed } from "./rates.js";
import {
  accounts,
  type Bill,
  bills,
  billTaxes,
  type Entry,
  entries,
  type Line,
  lines,
  type RateSource,
  vendors,
} from "./schema.js";

export type PlannedLine = Pick<
  Line,
  "accountId" | "cadCents" | "amountCents" | "currency" | "rate" | "rateSource" | "memo"
>;

/** CAD per unit that turns `total` into exactly `cad`, to 8 places. */
function statedRate(cad: number, total: number): string {
  const scaled = (BigInt(Math.abs(cad)) * 10n ** 9n) / BigInt(Math.abs(total));
  const rounded = (scaled + 5n) / 10n;
  const whole = rounded / 10n ** 8n;
  return `${whole}.${(rounded % 10n ** 8n).toString().padStart(8, "0")}`;
}

/**
 * The lines a bill posts: its expense (after claimable tax) and the claimable
 * GST/HST, against the card. Every bill is paid by card when it is issued, so
 * there is no payable. The CAD is the stated charge when a document gives
 * one, else the Bank of Canada rate on the issue day.
 */
export async function planLines(
  db: Db,
  feed: RateFeed,
  bill: Bill,
  vendorName: string,
  claimableCents: number,
  ids: { card: number; gst: number },
): Promise<PlannedLine[]> {
  let rate = "1";
  let rateSource: RateSource = "same";
  let totalCad = bill.totalCents;
  if (bill.currency !== "CAD") {
    if (bill.chargedCadCents !== null && bill.totalCents !== 0) {
      rate = statedRate(bill.chargedCadCents, bill.totalCents);
      rateSource = "stated";
      totalCad = bill.chargedCadCents;
    } else {
      rate = (await bocRate(db, feed, bill.currency, bill.issuedOn)).rate;
      rateSource = "boc";
      totalCad = toCad(bill.totalCents, rate);
    }
  }
  const taxCad = toCad(claimableCents, rate);
  const line = (accountId: number, cadCents: number, amountCents: number, memo: string | null) => ({
    accountId,
    cadCents,
    amountCents,
    currency: bill.currency,
    rate,
    rateSource,
    memo,
  });
  return [
    line(
      bill.accountId,
      totalCad - taxCad,
      bill.totalCents - claimableCents,
      bill.plan ?? vendorName,
    ),
    ...(claimableCents ? [line(ids.gst, taxCad, claimableCents, "GST/HST")] : []),
    line(ids.card, -totalCad, -bill.totalCents, bill.paymentMethod),
  ];
}

const signature = (l: PlannedLine) =>
  `${l.accountId}:${l.cadCents}:${l.amountCents}:${l.currency}:${l.rateSource}`;
const sameLines = (a: readonly PlannedLine[], b: readonly PlannedLine[]) =>
  a.map(signature).sort().join("|") === b.map(signature).sort().join("|");

export interface PostOptions {
  feed: RateFeed;
  runId?: string | null;
  log?: (line: string) => void;
}

export interface Posted {
  posted: number;
  reversed: number;
  unchanged: number;
}

/** A bill's entry that stands: not a reversal, not reversed. */
const isLive = and(
  isNotNull(entries.billId),
  isNull(entries.reversesId),
  sql`NOT EXISTS (SELECT 1 FROM ${entries} r WHERE r.reverses_id = ${entries.id})`,
);

/**
 * Make the journal match the bills. Every bill that is `ok` or `accepted`
 * with a total has one live entry with its current amounts; every other bill
 * has none. A live entry that no longer matches is reversed (on its own date)
 * and, when the bill still posts, a new one takes its place. Idempotent.
 */
export async function post(db: Db, opts: PostOptions): Promise<Posted> {
  const runId = opts.runId ?? null;
  const keyed = new Map(
    (await db.select({ id: accounts.id, key: accounts.key }).from(accounts)).map((a) => [
      a.key,
      a.id,
    ]),
  );
  const card = keyed.get(CARD);
  const gst = keyed.get(GST_PAID);
  if (card === undefined || gst === undefined)
    throw new Error("books accounts missing: seed the chart first");

  const live = await db.select().from(entries).where(isLive);
  const liveLines = live.length
    ? await db
        .select()
        .from(lines)
        .where(
          inArray(
            lines.entryId,
            live.map((e) => e.id),
          ),
        )
    : [];
  const liveByBill = new Map(
    live.map((e) => [e.billId, { entry: e, lines: liveLines.filter((l) => l.entryId === e.id) }]),
  );
  const claimable = new Map(
    (
      await db
        .select({ billId: billTaxes.billId, cents: sql<string>`sum(${billTaxes.amountCents})` })
        .from(billTaxes)
        .where(eq(billTaxes.claimable, true))
        .groupBy(billTaxes.billId)
    ).map((t) => [t.billId, Number(t.cents)]),
  );
  const all = await db
    .select({ bill: bills, vendorName: vendors.name })
    .from(bills)
    .innerJoin(vendors, eq(vendors.id, bills.vendorId))
    .orderBy(asc(bills.issuedOn), asc(bills.id));

  const out: Posted = { posted: 0, reversed: 0, unchanged: 0 };
  for (const { bill, vendorName } of all) {
    const postable = (bill.review === "ok" || bill.review === "accepted") && bill.totalCents !== 0;
    const current = liveByBill.get(bill.id);
    if (!postable && !current) continue;
    const plan = postable
      ? await planLines(db, opts.feed, bill, vendorName, claimable.get(bill.id) ?? 0, { card, gst })
      : null;
    if (
      current &&
      plan &&
      current.entry.postedOn === bill.issuedOn &&
      sameLines(current.lines, plan)
    ) {
      out.unchanged++;
      continue;
    }
    // Level 4: a pass that overlaps this one (the daily loop and a CLI run) moved
    // the bill since the read above; it is left to that pass, never posted twice.
    const moved = await serializable(db, async (tx) => {
      const [now] = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(and(isLive, eq(entries.billId, bill.id)));
      if ((now?.id ?? null) !== (current?.entry.id ?? null)) return true;
      if (current) await reverse(tx, current.entry, current.lines, runId);
      if (plan)
        await insertEntry(
          tx,
          { postedOn: bill.issuedOn, memo: `${vendorName} ${bill.number}`, billId: bill.id, runId },
          plan,
        );
      return false;
    });
    if (moved) {
      opts.log?.(`  ${vendorName} ${bill.number}: moved by another pass, left to it`);
      continue;
    }
    if (current) out.reversed++;
    if (plan) out.posted++;
    opts.log?.(
      `  ${vendorName} ${bill.number}: ${current ? (plan ? "reposted" : "reversed") : "posted"}`,
    );
  }
  return out;
}

async function insertEntry(
  tx: Tx,
  entry: Pick<Entry, "postedOn" | "memo" | "billId" | "runId"> & { reversesId?: number },
  planned: readonly PlannedLine[],
): Promise<number> {
  const [row] = await tx.insert(entries).values(entry).returning({ id: entries.id });
  if (!row) throw new Error("entry insert returned nothing");
  await tx.insert(lines).values(planned.map((l) => ({ ...l, entryId: row.id })));
  return row.id;
}

/** Cancel an entry with its mirror image, dated the same day. */
async function reverse(
  tx: Tx,
  entry: Entry,
  entryLines: readonly Line[],
  runId: string | null,
): Promise<number> {
  return insertEntry(
    tx,
    {
      postedOn: entry.postedOn,
      memo: `reverses ${entry.id}: ${entry.memo}`,
      billId: entry.billId,
      reversesId: entry.id,
      runId,
    },
    entryLines.map((l) => ({
      accountId: l.accountId,
      cadCents: -l.cadCents,
      amountCents: -l.amountCents,
      currency: l.currency,
      rate: l.rate,
      rateSource: l.rateSource,
      memo: l.memo,
    })),
  );
}
