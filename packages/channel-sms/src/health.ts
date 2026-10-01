/**
 * Health: the checks that stop sending before a carrier does. Each trip is a
 * pause plus one Discord line; nothing here ever resumes or replaces a number
 * (a person reads why, then runs `wren sms numbers resume`).
 *
 * - A number whose delivery failures pass the line over the last 7 days
 *   (enough sends to judge) is paused: carriers filter a number before they
 *   block it, and failures are the first sign.
 * - A number whose opt-out rate passes its line is paused.
 * - Fleet opt-outs past the fleet line pause every number: the copy or the
 *   list is wrong, not one number.
 * - A balance under the floor is a warning (money is William's).
 */
import type { Notifier } from "@wren/core/notify";
import type { Queryable } from "@wren/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { formatPhone } from "./phone.js";
import { pauseNumber } from "./pool.js";
import type { SmsProvider } from "./provider.js";
import { smsMessages, smsNumbers } from "./schema.js";

export interface HealthPolicy {
  windowDays: number;
  /** Fewest finished sends (delivered + failed) before a number is judged. */
  minSample: number;
  maxFailRate: number;
  maxNumberOptOutRate: number;
  maxFleetOptOutRate: number;
  /** Fewest sends before the fleet is judged. */
  minFleetSample: number;
  lowBalanceUsd: number;
}

export const DEFAULT_HEALTH: HealthPolicy = {
  windowDays: 7,
  minSample: 30,
  maxFailRate: 0.15,
  maxNumberOptOutRate: 0.05,
  maxFleetOptOutRate: 0.03,
  minFleetSample: 100,
  lowBalanceUsd: 5,
};

export interface NumberHealth {
  e164: string;
  state: string;
  sent: number;
  delivered: number;
  failed: number;
  optOuts: number;
  /** Contacts texted from this number in the window: the opt-out rate's base. */
  texted: number;
}

export interface HealthReport {
  numbers: NumberHealth[];
  fleet: { sent: number; texted: number; optOuts: number };
  paused: { e164: string; reason: string }[];
  balanceUsd: number | null;
  warnings: string[];
}

export async function numberHealth(db: Queryable, since: Date): Promise<NumberHealth[]> {
  const rows = await db
    .select({
      e164: smsNumbers.e164,
      state: smsNumbers.state,
      sent: sql<number>`count(*) FILTER (WHERE ${smsMessages.direction} = 'out' AND ${smsMessages.state} IN ('sent','delivered','failed','unknown'))::int`,
      delivered: sql<number>`count(*) FILTER (WHERE ${smsMessages.direction} = 'out' AND ${smsMessages.state} = 'delivered')::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${smsMessages.direction} = 'out' AND ${smsMessages.state} = 'failed')::int`,
      optOuts: sql<number>`count(DISTINCT ${smsMessages.contactId}) FILTER (WHERE ${smsMessages.direction} = 'in' AND ${smsMessages.disposition} = 'opt_out')::int`,
      texted: sql<number>`count(DISTINCT ${smsMessages.contactId}) FILTER (WHERE ${smsMessages.direction} = 'out' AND ${smsMessages.state} IN ('sent','delivered','failed','unknown'))::int`,
    })
    .from(smsNumbers)
    .leftJoin(
      smsMessages,
      and(
        eq(smsMessages.numberId, smsNumbers.id),
        gte(
          sql`coalesce(${smsMessages.attemptedAt}, ${smsMessages.receivedAt})`,
          since.toISOString(),
        ),
      ),
    )
    .where(inArray(smsNumbers.state, ["active", "paused"]))
    .groupBy(smsNumbers.id, smsNumbers.e164, smsNumbers.state)
    .orderBy(smsNumbers.e164);
  return rows;
}

export async function checkHealth(
  db: Queryable,
  opts: {
    now: Date;
    policy: HealthPolicy;
    provider?: SmsProvider | null;
    notifier?: Notifier | null;
  },
): Promise<HealthReport> {
  const { policy, now } = opts;
  const since = new Date(now.getTime() - policy.windowDays * 86_400_000);
  const numbers = await numberHealth(db, since);
  const report: HealthReport = {
    numbers,
    fleet: {
      sent: numbers.reduce((s, n) => s + n.sent, 0),
      texted: numbers.reduce((s, n) => s + n.texted, 0),
      optOuts: numbers.reduce((s, n) => s + n.optOuts, 0),
    },
    paused: [],
    balanceUsd: null,
    warnings: [],
  };
  const pause = async (e164: string, reason: string) => {
    if (await pauseNumber(db, e164, reason, now)) report.paused.push({ e164, reason });
  };
  const fleetRate = report.fleet.texted > 0 ? report.fleet.optOuts / report.fleet.texted : 0;
  if (report.fleet.texted >= policy.minFleetSample && fleetRate > policy.maxFleetOptOutRate) {
    const why = `fleet opt-outs ${(100 * fleetRate).toFixed(1)}% over ${policy.windowDays}d (line ${(100 * policy.maxFleetOptOutRate).toFixed(0)}%): check the copy and the list`;
    for (const n of numbers) if (n.state === "active") await pause(n.e164, why);
  }
  for (const n of numbers) {
    if (n.state !== "active" || report.paused.some((p) => p.e164 === n.e164)) continue;
    const finished = n.delivered + n.failed;
    if (finished >= policy.minSample && n.failed / finished > policy.maxFailRate) {
      await pause(
        n.e164,
        `delivery failures ${n.failed}/${finished} over ${policy.windowDays}d: carriers may be filtering it`,
      );
    } else if (n.texted >= policy.minSample && n.optOuts / n.texted > policy.maxNumberOptOutRate) {
      await pause(n.e164, `opt-outs ${n.optOuts}/${n.texted} over ${policy.windowDays}d`);
    }
  }
  if (opts.provider) {
    try {
      report.balanceUsd = await opts.provider.balance();
      if (report.balanceUsd !== null && report.balanceUsd < policy.lowBalanceUsd) {
        report.warnings.push(
          `balance $${report.balanceUsd.toFixed(2)} is under $${policy.lowBalanceUsd}`,
        );
      }
    } catch (err) {
      report.warnings.push(
        `balance unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (opts.notifier) {
    for (const p of report.paused) {
      await opts.notifier.notify(`SMS number ${formatPhone(p.e164)} paused`, p.reason, "warning");
    }
    for (const w of report.warnings) await opts.notifier.notify("SMS", w, "warning");
  }
  return report;
}
