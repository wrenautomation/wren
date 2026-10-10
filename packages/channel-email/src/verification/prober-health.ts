/**
 * Each prober IP's standing, for the morning digest: does its PTR name the host (its
 * HELO), is it on a blocklist, and what share of yesterday's checks were refused for
 * our IP (`blocked`, `no_ptr`) rather than answered. A bad answer to any of the three
 * is a warning: each refusal costs an address we could have verified, and asking
 * through a listing deepens it.
 *
 * A check the prober answered from its own fleet hold ("held: <fleet> lists our IP")
 * never reached a server: it is counted as `held`, outside `checks` and `refused`, so
 * the expiry of a batch of waits cannot read as a fresh run of refusals.
 *
 * Spamhaus refuses lookups from cloud resolvers with a 127.255.255.x answer; that
 * reads as "not checked", never as listed. Its real listings are 127.0.0.2 to .11.
 */
import { promises as dns } from "node:dns";
import type { Db } from "@wren/db";
import { sql } from "drizzle-orm";

export const BLOCKLISTS = [
  "zen.spamhaus.org",
  "bl.spamcop.net",
  "b.barracudacentral.org",
  "psbl.surriel.com",
  "bl.mailspike.net",
] as const;

/** Refusals that name our IP, not the address. */
export const IP_REFUSALS = ["blocked", "no_ptr"] as const;
/** Warn past this share of refused checks, once a day has enough checks to mean it. */
export const REFUSED_WARN_SHARE = 0.1;
export const REFUSED_MIN_CHECKS = 100;

export interface Resolver {
  resolve4(host: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
}

export interface ProberHealth {
  host: string;
  ip: string | null;
  ptr: string | null;
  listed: string[];
  /** Checks that reached a server. */
  checks: number;
  refused: number;
  /** Answered from the prober's fleet hold, without connecting. */
  held: number;
}

const settle = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** Whether `answer` (a DNSBL A record) is a real listing on `list`. */
export function isListing(list: string, answer: string): boolean {
  if (!answer.startsWith("127.")) return false;
  if (list.endsWith("spamhaus.org")) {
    const last = Number(answer.split(".")[3]);
    return answer.startsWith("127.0.0.") && last >= 2 && last <= 11;
  }
  return true;
}

export async function ipStanding(
  host: string,
  resolver: Resolver = dns,
): Promise<Pick<ProberHealth, "ip" | "ptr" | "listed">> {
  const ip = (await settle(resolver.resolve4(host)))?.[0] ?? null;
  if (!ip) return { ip: null, ptr: null, listed: [] };
  const reversed = ip.split(".").reverse().join(".");
  const [ptrs, ...answers] = await Promise.all([
    settle(resolver.reverse(ip)),
    ...BLOCKLISTS.map((list) => settle(resolver.resolve4(`${reversed}.${list}`))),
  ]);
  const listed = BLOCKLISTS.filter((list, i) => (answers[i] ?? []).some((a) => isListing(list, a)));
  return { ip, ptr: ptrs?.[0]?.replace(/\.$/, "") ?? null, listed };
}

/** mailifier's answer for a check it held back: the last transcript line reads "held: …". */
const HELD = sql`coalesce(raw->'transcript'->-1->>'reply', '') LIKE 'held:%'`;

/** Checks per prober host since `since`: reached a server, refused for our IP, held back. */
export async function proberCounts(
  db: Db,
  since: Date,
): Promise<Map<string, { checks: number; refused: number; held: number }>> {
  const refusals = sql.join(
    IP_REFUSALS.map((r) => sql`${r}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    SELECT raw->>'prober' AS host,
           count(*) FILTER (WHERE NOT ${HELD})::int AS checks,
           count(*) FILTER (WHERE NOT ${HELD} AND result = 'risky'
                            AND raw->>'reason' IN (${refusals}))::int AS refused,
           count(*) FILTER (WHERE ${HELD})::int AS held
    FROM verifications
    WHERE checked_at >= ${since.toISOString()} AND raw ? 'prober'
    GROUP BY 1
  `)) as unknown as { host: string; checks: number; refused: number; held: number }[];
  return new Map(rows.map((r) => [r.host, { checks: r.checks, refused: r.refused, held: r.held }]));
}

export async function proberHealth(
  db: Db,
  hosts: readonly string[],
  since: Date,
  resolver: Resolver = dns,
): Promise<ProberHealth[]> {
  const counts = await proberCounts(db, since);
  return Promise.all(
    hosts.map(async (host) => ({
      host,
      ...(await ipStanding(host, resolver)),
      ...(counts.get(host) ?? { checks: 0, refused: 0, held: 0 }),
    })),
  );
}

/** What is wrong with one prober, empty when nothing is. */
export function proberProblems(h: ProberHealth): string[] {
  const problems: string[] = [];
  if (!h.ip) return [`${h.host} does not resolve`];
  if (h.ptr !== h.host) problems.push(`PTR of ${h.ip} is ${h.ptr ?? "missing"}, not ${h.host}`);
  if (h.listed.length > 0) problems.push(`${h.ip} listed on ${h.listed.join(", ")}`);
  if (h.checks >= REFUSED_MIN_CHECKS && h.refused / h.checks > REFUSED_WARN_SHARE)
    problems.push(`${h.host} refused for our IP on ${share(h)} of ${h.checks} checks`);
  return problems;
}

const share = (h: ProberHealth) =>
  h.checks === 0 ? "0%" : `${((h.refused / h.checks) * 100).toFixed(1)}%`;

/** Prober hosts from WREN_SMTP_PROBE_URL (one URL or a comma list). */
export const proberHosts = (urls: string | null | undefined): string[] =>
  (urls ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => new URL(u).hostname);
