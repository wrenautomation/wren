/**
 * What the books should tell the operator, as edges. Each pass lists every
 * open condition by kind; a new one is raised (and returned for the message),
 * one still open stays quiet, one gone is cleared. Kinds a pass did not look
 * at are left alone.
 */
import type { Db } from "@wren/db";
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { shiftDay } from "./day.js";
import { formatCents, formatMoney } from "./money.js";
import { reviewQueue } from "./report.js";
import { type AlertKind, alerts, subscriptions } from "./schema.js";

export interface Condition {
  key: string;
  kind: AlertKind;
  message: string;
}

/**
 * Raise what is new among `open`, clear what of `kinds` is no longer in it.
 * Returns the newly raised, oldest kind first.
 */
export async function settleAlerts(
  db: Db,
  kinds: readonly AlertKind[],
  open: readonly Condition[],
): Promise<Condition[]> {
  const raised: Condition[] = [];
  for (const c of open) {
    const [row] = await db
      .insert(alerts)
      .values(c)
      .onConflictDoUpdate({
        target: alerts.key,
        set: { message: c.message, raisedAt: sql`now()`, clearedAt: null },
        setWhere: isNotNull(alerts.clearedAt),
      })
      .returning({ key: alerts.key });
    if (row) raised.push(c);
  }
  if (kinds.length) {
    const keys = open.map((c) => c.key);
    await db
      .update(alerts)
      .set({ clearedAt: sql`now()` })
      .where(
        and(
          inArray(alerts.kind, [...kinds]),
          isNull(alerts.clearedAt),
          ...(keys.length ? [notInArray(alerts.key, keys)] : []),
        ),
      );
  }
  return raised;
}

/** Days before a yearly renewal (or a trial's end) that it is worth a word. */
export const RENEWAL_NOTICE_DAYS = 14;
/** Days past a renewal with no new bill before a subscription counts as lapsed. */
export const LAPSED_AFTER_DAYS = 7;

/** Every open condition the books themselves show on `on`. */
export async function bookConditions(db: Db, on: string): Promise<Condition[]> {
  const out: Condition[] = [];
  const queue = await reviewQueue(db);
  for (const b of queue.bills)
    out.push({
      key: `held:${b.id}`,
      kind: "held",
      message: `bill ${b.id} ${b.vendor} ${b.number} ${b.issuedOn ?? ""} ${
        b.totalCents === null ? "" : formatMoney(b.totalCents, b.currency)
      } held: ${b.reasons.join("; ")}`,
    });
  for (const d of queue.documents)
    out.push({
      key: `unread:${d.id}`,
      kind: "unread",
      message: `document ${d.id} ${d.fromAddress ?? ""} "${d.subject ?? ""}": ${d.why}`,
    });

  const subs = await db.select().from(subscriptions);
  for (const s of subs) {
    if (!s.renewsOn || !s.vendor) continue;
    const what = `${s.vendorName ?? s.vendor}${s.plan ? ` ${s.plan}` : ""}`;
    const id = `${s.vendor}:${(s.plan ?? "").toLowerCase()}`;
    const cost = s.lastCadCents === null ? "" : ` (${formatCents(s.lastCadCents)} CAD)`;
    if (s.bills === 1)
      out.push({
        key: `new_subscription:${id}`,
        kind: "new_subscription",
        message: `new subscription: ${what}, ${s.cycle}${cost}, first billed ${s.lastBilledOn}`,
      });
    if (s.cycle === "yearly" && s.renewsOn >= on && s.renewsOn <= shiftDay(on, RENEWAL_NOTICE_DAYS))
      out.push({
        key: `renewal:${id}:${s.renewsOn}`,
        kind: "renewal",
        message: `renews ${s.renewsOn}: ${what}${cost}`,
      });
    if (s.renewsOn < shiftDay(on, -LAPSED_AFTER_DAYS))
      out.push({
        key: `lapsed:${id}:${s.renewsOn}`,
        kind: "lapsed",
        message: `no bill since ${s.lastBilledOn}: ${what} was due ${s.renewsOn}. Cancelled, or a bill went missing?`,
      });
  }
  return out;
}

/** The open alerts, newest first: `wren books alerts`. */
export async function openAlerts(db: Db, kind?: AlertKind) {
  return db
    .select()
    .from(alerts)
    .where(and(isNull(alerts.clearedAt), ...(kind ? [eq(alerts.kind, kind)] : [])))
    .orderBy(sql`${alerts.raisedAt} DESC`);
}
