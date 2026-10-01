/**
 * The number pool (PH-D10): a fixed set of numbers on one registered
 * campaign, each lead texted from the same number every time.
 *
 * Rotation is volume balancing, nothing more: a new contact gets the active
 * number carrying the fewest running threads, and each number sends at most
 * its ramped daily cap. The pool never grows past `maxNumbers`, the fleet
 * never sends past the campaign's `dailyCap` however many numbers there are,
 * and a paused number is never swapped for a fresh one: its threads wait.
 */
import { zonedInstant } from "@wren/core/time";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq, gte, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { countryOf } from "./phone.js";
import { FLEET_ZONE, fleetDay, numberCapOn, type SmsPolicy } from "./policy.js";
import type { SmsProvider } from "./provider.js";
import {
  type PhoneCountry,
  type SmsNumber,
  smsContacts,
  smsMessages,
  smsNumbers,
} from "./schema.js";

/** Outbound states that count as a send attempt today (the carrier saw it, or may have). */
const ATTEMPTED = ["sending", "sent", "delivered", "failed", "unknown"] as const;

/** The instant the fleet day containing `at` began. */
export function fleetDayStart(at: Date): Date {
  const [y, m, d] = fleetDay(at).split("-").map(Number) as [number, number, number];
  return zonedInstant(FLEET_ZONE, y, m, d);
}

export interface NumberToday {
  number: SmsNumber;
  cap: number;
  sentToday: number;
  lastAttemptAt: Date | null;
}

export interface PoolToday {
  day: string;
  numbers: NumberToday[];
  sentToday: number;
  /** What the fleet may still send today: the campaign cap and the numbers' caps, whichever is lower. */
  remaining: number;
}

export async function poolToday(db: Queryable, policy: SmsPolicy, now: Date): Promise<PoolToday> {
  const day = fleetDay(now);
  const since = fleetDayStart(now);
  const numbers = await db
    .select()
    .from(smsNumbers)
    .where(ne(smsNumbers.state, "retired"))
    .orderBy(asc(smsNumbers.e164));
  const usage = await db
    .select({
      numberId: smsMessages.numberId,
      sent: count(),
      last: max(smsMessages.attemptedAt),
    })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.direction, "out"),
        inArray(smsMessages.state, [...ATTEMPTED]),
        gte(smsMessages.attemptedAt, since),
      ),
    )
    .groupBy(smsMessages.numberId);
  const byNumber = new Map(usage.map((u) => [u.numberId, u]));
  const rows: NumberToday[] = numbers.map((n) => ({
    number: n,
    cap: n.state === "active" ? numberCapOn(n.rampStartedOn, day, policy) : 0,
    sentToday: byNumber.get(n.id)?.sent ?? 0,
    lastAttemptAt: byNumber.get(n.id)?.last ?? null,
  }));
  const sentToday = usage.reduce((sum, u) => sum + u.sent, 0);
  const numberRoom = rows.reduce((sum, r) => sum + Math.max(0, r.cap - r.sentToday), 0);
  return {
    day,
    numbers: rows,
    sentToday,
    remaining: Math.max(0, Math.min(policy.dailyCap - sentToday, numberRoom)),
  };
}

/** True when this number may send one more now: active, under today's cap, past the gap since its last send. */
export function numberReady(n: NumberToday, now: Date, policy: SmsPolicy): boolean {
  if (n.number.state !== "active" || n.sentToday >= n.cap) return false;
  if (n.lastAttemptAt === null) return true;
  return now.getTime() - n.lastAttemptAt.getTime() >= policy.gapSeconds * 1000;
}

/**
 * Why `number` may not text `to` yet, or null when it may. Another country is
 * never; an unregistered US number is until the carriers attach it.
 */
export function cannotReach(
  number: Pick<SmsNumber, "e164" | "country" | "registeredAt">,
  to: string,
): string | null {
  const country = countryOf(to);
  if (country !== number.country)
    return `${number.e164} is a ${number.country} number; ${to} is ${country ?? "not US or CA"}`;
  if (country === "US" && number.registeredAt === null)
    return `${number.e164} waits on the 10DLC campaign (carrier review)`;
  return null;
}

/** The active number in `country` carrying the fewest running threads, for a new contact; null when there is none. */
export async function pickNumber(db: Queryable, country: PhoneCountry): Promise<SmsNumber | null> {
  const load = sql<number>`(SELECT count(*) FROM ${smsContacts} WHERE ${smsContacts.numberId} = ${smsNumbers.id} AND ${smsContacts.state} = 'enrolled')`;
  const [row] = await db
    .select({ number: smsNumbers })
    .from(smsNumbers)
    .where(and(eq(smsNumbers.state, "active"), eq(smsNumbers.country, country)))
    .orderBy(asc(load), asc(smsNumbers.e164))
    .limit(1);
  return row?.number ?? null;
}

export interface SyncStats {
  seen: number;
  added: string[];
  retired: string[];
  /** Numbers the account holds past the pool's size: not added, reported. */
  overCap: string[];
  /** Numbers outside the US and Canada: never pooled. */
  notUsOrCa: string[];
}

/**
 * Match the pool to the numbers the provider says we own. New numbers join
 * (ramp day one = today) while the pool has room; numbers gone from the
 * account are retired. It never buys, releases or swaps a number.
 */
export async function syncNumbers(
  db: Queryable,
  provider: SmsProvider,
  policy: SmsPolicy,
  now: Date,
): Promise<SyncStats> {
  const owned = await provider.listNumbers();
  const stats: SyncStats = {
    seen: owned.length,
    added: [],
    retired: [],
    overCap: [],
    notUsOrCa: [],
  };
  const current = await db.select().from(smsNumbers).where(eq(smsNumbers.provider, provider.name));
  const ownedSet = new Set(owned.map((o) => o.e164));
  for (const n of current) {
    if (n.state !== "retired" && !ownedSet.has(n.e164)) {
      await db
        .update(smsNumbers)
        .set({ state: "retired", retiredAt: now, pausedReason: null, pausedAt: null })
        .where(eq(smsNumbers.id, n.id));
      stats.retired.push(n.e164);
    }
  }
  // Country comes from the digits; rows from before the column get theirs here.
  for (const n of current) {
    const country = countryOf(n.e164);
    if (country && country !== n.country)
      await db.update(smsNumbers).set({ country }).where(eq(smsNumbers.id, n.id));
  }
  const known = new Map(current.map((n) => [n.e164, n]));
  let live = current.filter((n) => n.state !== "retired" && ownedSet.has(n.e164)).length;
  for (const o of owned) {
    const existing = known.get(o.e164);
    if (existing && existing.state !== "retired") continue;
    const country = countryOf(o.e164);
    if (!country) {
      stats.notUsOrCa.push(o.e164);
      continue;
    }
    if (live >= policy.maxNumbers) {
      stats.overCap.push(o.e164);
      continue;
    }
    if (existing) {
      await db
        .update(smsNumbers)
        .set({
          state: "active",
          retiredAt: null,
          providerId: o.providerId,
          rampStartedOn: fleetDay(now),
          country,
        })
        .where(eq(smsNumbers.id, existing.id));
    } else {
      await db.insert(smsNumbers).values({
        e164: o.e164,
        provider: provider.name,
        providerId: o.providerId,
        rampStartedOn: fleetDay(now),
        country,
      });
    }
    stats.added.push(o.e164);
    live += 1;
  }
  return stats;
}

export async function pauseNumber(
  db: Queryable,
  e164: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(smsNumbers)
    .set({ state: "paused", pausedReason: reason, pausedAt: now })
    .where(and(eq(smsNumbers.e164, e164), eq(smsNumbers.state, "active")))
    .returning({ id: smsNumbers.id });
  return rows.length > 0;
}

export async function resumeNumber(db: Queryable, e164: string): Promise<boolean> {
  const rows = await db
    .update(smsNumbers)
    .set({ state: "active", pausedReason: null, pausedAt: null })
    .where(and(eq(smsNumbers.e164, e164), eq(smsNumbers.state, "paused")))
    .returning({ id: smsNumbers.id });
  return rows.length > 0;
}

/** The pool row for one of our numbers, by its E.164; null for a number that is not ours. */
export async function numberByE164(db: Queryable, e164: string): Promise<SmsNumber | null> {
  const [row] = await db
    .select()
    .from(smsNumbers)
    .where(and(eq(smsNumbers.e164, e164), isNull(smsNumbers.retiredAt)))
    .limit(1);
  return row ?? null;
}
