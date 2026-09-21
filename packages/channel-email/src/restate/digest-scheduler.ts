/**
 * The morning digest: `DigestScheduler/fleet` posts yesterday's numbers per sending
 * domain (sent, hard bounces, replies, unsubscribes), Google's newest complaint
 * rate where Postmaster has one, and the queue (approved openers, follow-ups
 * waiting) once a day at `DIGEST_HOUR` on the fleet's clock. Counts only; the
 * notifier never carries an address we mailed or a word anyone wrote back.
 * A digest that cannot be built is skipped, not retried into the afternoon.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { sql } from "drizzle-orm";
import type { SendPolicy } from "../send/policy.js";
import { zonedInstant } from "../send/tz.js";

export const DIGEST_KEY = "fleet";
export const DIGEST_COMMAND = "notify digest";
export const DIGEST_HOUR = 7;

export interface DigestSchedulerDeps {
  db: Db;
  notifier: Notifier;
  policy: SendPolicy;
}

export interface DigestStats {
  day: string;
  domains: number;
  lines: string[];
  sent: boolean;
}

interface DomainDay {
  domain: string;
  sent: number;
  hard: number;
  replies: number;
  unsub: number;
  spam_rate: number | null;
}

/** The first `DIGEST_HOUR`:00 (send timezone) strictly after `now`. */
export function nextDigestAt(policy: SendPolicy, now: Date): Date {
  const local = policy.localNow(now);
  for (let offset = 0; offset < 2; offset += 1) {
    const day = local.date.addDays(offset);
    const at = zonedInstant(policy.timezone, day.year, day.month, day.day, DIGEST_HOUR, 0);
    if (at.getTime() > now.getTime()) return at;
  }
  throw new Error("no digest hour within two days: the local clock is broken");
}

/** Yesterday (UTC day, the grain of `send_health`) per domain, with the newest Postmaster rate at or before it. */
export async function digestLines(
  db: Db,
  day: string,
): Promise<{ lines: string[]; domains: number }> {
  const rows = (await db.execute(sql`
    SELECT h.domain,
           sum(h.sent)::int AS sent, sum(h.hard_bounces)::int AS hard,
           sum(h.replies)::int AS replies, sum(h.unsubscribes)::int AS unsub,
           (SELECT p.spam_rate FROM postmaster_days p
             WHERE p.domain = h.domain AND p.day <= ${day}::date AND p.spam_rate IS NOT NULL
             ORDER BY p.day DESC LIMIT 1) AS spam_rate
    FROM send_health h
    WHERE h.day = ${day}::date
    GROUP BY h.domain ORDER BY h.domain
  `)) as unknown as DomainDay[];
  const lines = rows.map((r) => {
    const spam = r.spam_rate === null ? "" : `, spam ${(Number(r.spam_rate) * 100).toFixed(2)}%`;
    return `${r.domain}: sent ${r.sent}, hard bounces ${r.hard}, replies ${r.replies}, unsubscribes ${r.unsub}${spam}`;
  });
  const [queue] = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE step = 0)::int AS openers,
           count(*) FILTER (WHERE step > 0)::int AS followups
    FROM messages WHERE state = 'approved'
  `)) as unknown as { openers: number; followups: number }[];
  lines.push(
    `queue: ${queue?.openers ?? 0} openers approved, ${queue?.followups ?? 0} follow-ups waiting`,
  );
  return {
    lines: rows.length === 0 ? ["nothing sent", ...lines.slice(-1)] : lines,
    domains: rows.length,
  };
}

export function makeDigestScheduler(deps: DigestSchedulerDeps) {
  return makeLoopObject("DigestScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const delay = nextDigestAt(deps.policy, now).getTime() - now.getTime();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    return runPass<DigestStats>(ctx, deps.db, now, {
      name: "digest",
      ledger: { command: DIGEST_COMMAND, argv: { daemon: true, day: yesterday } },
      body: async () => {
        const { lines, domains } = await digestLines(deps.db, yesterday);
        const sent = await deps.notifier.notify(`digest for ${yesterday}`, lines.join("\n"));
        return { day: yesterday, domains, lines, sent };
      },
      delayAfter: () => delay,
      retryMs: delay,
      notifier: deps.notifier,
    });
  });
}

export type DigestScheduler = ReturnType<typeof makeDigestScheduler>;
