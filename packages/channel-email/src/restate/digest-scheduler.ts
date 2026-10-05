/**
 * The morning email digest: `DigestScheduler/fleet` posts to the email lane once a day
 * at `DIGEST_HOUR` on the fleet's clock. Yesterday's sends in one line (a domain gets its
 * own line only when it bounced, lost an unsubscribe or nears Google's spam line), the
 * queue, then the fleet's health as counts: inboxes on ramp, seed placement, probers
 * (PTR, blocklists, refusals) and mail domains (lists, SPF, DKIM, DMARC, MX, NS). Healthy
 * rows collapse into those counts; anything in trouble goes out once more, all together,
 * as one "email health" warning that pings. Counts only; the notifier never carries an
 * address we mailed or a word anyone wrote back.
 * A digest that cannot be built is skipped, not retried into the afternoon.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { sql } from "drizzle-orm";
import type { RampMap } from "../send/deliver.js";
import type { SendPolicy } from "../send/policy.js";
import { zonedInstant } from "../send/tz.js";
import {
  type DomainTarget,
  domainProblems,
  domainStandings,
} from "../verification/domain-health.js";
import { proberHealth, proberProblems } from "../verification/prober-health.js";
import { placementLines } from "./placement-scheduler.js";

export const DIGEST_KEY = "fleet";
export const DIGEST_COMMAND = "notify digest";
export const DIGEST_HOUR = 7;
/** Google's guidance keeps spam under 0.1%; a domain at or past it gets its own line. */
const SPAM_WATCH = 0.001;

export interface DigestSchedulerDeps {
  db: Db;
  notifier: Notifier;
  policy: SendPolicy;
  /** Prober host names (WREN_SMTP_PROBE_URL), each checked every morning. */
  probers?: readonly string[];
  /** Sending, site and signature domains, each checked every morning. */
  domains?: readonly DomainTarget[];
  /** Inboxes on their own ramp: one line each, with today's cap. */
  ramps?: RampMap;
  /** Seeds are set: one inbox-placement line per ramped inbox too. */
  placement?: boolean;
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

const spamOf = (r: DomainDay) => (r.spam_rate === null ? null : Number(r.spam_rate));
const pct = (rate: number) => `${(rate * 100).toFixed(2)}%`;

/** Yesterday (UTC day, the grain of `send_health`) summed over domains, with the newest Postmaster rate at or before it. */
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
  const sum = (k: "sent" | "hard" | "replies" | "unsub") =>
    rows.reduce((n, r) => n + Number(r[k]), 0);
  const rates = rows.map(spamOf).filter((r): r is number => r !== null);
  const spam = rates.length === 0 ? "" : `, worst spam ${pct(Math.max(...rates))}`;
  const across = rows.length > 1 ? ` across ${rows.length} domains` : "";
  const lines =
    rows.length === 0
      ? ["nothing sent"]
      : [
          `sent ${sum("sent")}, replies ${sum("replies")}, hard bounces ${sum("hard")}, unsubscribes ${sum("unsub")}${across}${spam}`,
          ...rows
            .filter((r) => r.hard > 0 || r.unsub > 0 || (spamOf(r) ?? 0) >= SPAM_WATCH)
            .map((r) => {
              const rate = spamOf(r);
              return `  ${r.domain}: sent ${r.sent}, hard bounces ${r.hard}, unsubscribes ${r.unsub}${rate === null ? "" : `, spam ${pct(rate)}`}`;
            }),
        ];
  const [queue] = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE step = 0)::int AS openers,
           count(*) FILTER (WHERE step > 0)::int AS followups
    FROM messages WHERE state = 'approved'
  `)) as unknown as { openers: number; followups: number }[];
  lines.push(
    `queue: ${queue?.openers ?? 0} openers approved, ${queue?.followups ?? 0} follow-ups waiting`,
  );
  return { lines, domains: rows.length };
}

/** The ramped inboxes in one line: how many send today, their summed cap, how many start later. */
export function rampSummary(policy: SendPolicy, ramps: RampMap, now: Date): string | null {
  const all = Object.values(ramps);
  if (all.length === 0) return null;
  const today = policy.localDay(now);
  const live = all.filter((r) => today.compare(r.start) >= 0);
  const cap = live.reduce((n, r) => n + policy.perInboxCap(now, r), 0);
  const later = all.length - live.length;
  return `inboxes: ${live.length} sending, ${cap}/day today${later > 0 ? `, ${later} start later` : ""}`;
}

/** "probers: 1 of 2 ok": a health row as a count. */
const okCount = (label: string, total: number, bad: number) =>
  `${label}: ${total - bad} of ${total} ok`;

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
        const ramps = deps.ramps ?? {};
        const ramp = rampSummary(deps.policy, ramps, now);
        if (ramp) lines.push(ramp);
        const trouble: string[] = [];
        if (deps.placement && Object.keys(ramps).length > 0) {
          const placement = await placementLines(deps.db, Object.keys(ramps));
          lines.push(okCount("placement", placement.lines.length, placement.trouble.length));
          trouble.push(...placement.trouble.map((l) => `placement ${l}`));
        }
        const [probers, standings] = await Promise.all([
          proberHealth(deps.db, deps.probers ?? [], new Date(now.getTime() - 24 * 3600 * 1000)),
          domainStandings(deps.domains ?? []),
        ]);
        const proberTrouble = probers.flatMap(proberProblems);
        const badProbers = probers.filter((p) => proberProblems(p).length > 0).length;
        if (probers.length > 0) lines.push(okCount("probers", probers.length, badProbers));
        const domainTrouble = standings.flatMap(domainProblems);
        const badDomains = standings.filter((d) => domainProblems(d).length > 0).length;
        if (standings.length > 0) lines.push(okCount("domains", standings.length, badDomains));
        trouble.push(...proberTrouble, ...domainTrouble);
        if (trouble.length > 0)
          await deps.notifier.notify("email health", trouble.join("\n"), "warning");
        const sent = await deps.notifier.notify(`email digest for ${yesterday}`, lines.join("\n"));
        return { day: yesterday, domains, lines, sent };
      },
      delayAfter: () => delay,
      retryMs: delay,
      notifier: deps.notifier,
    });
  });
}

export type DigestScheduler = ReturnType<typeof makeDigestScheduler>;
