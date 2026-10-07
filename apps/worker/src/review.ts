/**
 * The Friday review (direction doc, "How to juggle"): every parked idea, what unparks it, and a
 * live check where prod keeps the number. A new idea gets a row here before anyone builds it.
 */
import { defineRecord, status, text } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";

type State = "fired" | "watch" | "quiet" | "manual";
interface Check {
  now: string;
  state: State;
}
interface Parked {
  id: string;
  idea: string;
  unpark: string;
  /** Absent: a person judges it on Friday. */
  check?: (db: Queryable) => Promise<Check>;
}

const one = async <T extends Record<string, unknown>>(db: Queryable, q: SQL) => {
  const [r] = await db.execute<T>(q);
  return r;
};

/**
 * The pg box has no compute charge; any EC2 compute in Books means something bills on demand.
 * Two days: an on-demand box bills every day, and a deleted box drops out fast.
 */
async function ec2Compute(db: Queryable): Promise<Check> {
  const r = await one<{ usd: string | null }>(
    db,
    sql`SELECT sum(amount) AS usd FROM books.usage
        WHERE provider = 'aws' AND service = 'Amazon Elastic Compute Cloud - Compute'
          AND "on" >= current_date - 2`,
  );
  const usd = Number(r?.usd ?? 0);
  return {
    now: `EC2 compute $${usd.toFixed(2)} in the last 2 days`,
    state: usd > 0 ? "fired" : "quiet",
  };
}

/** The read costing the most time; hot is 1,000+ calls at 100 ms+ mean. Whether an index fixes it is Friday's call. */
async function hotRead(db: Queryable): Promise<Check> {
  const on = await one<{ on: boolean }>(
    db,
    sql`SELECT to_regclass('pg_stat_statements') IS NOT NULL AS on`,
  );
  if (!on?.on) return { now: "pg_stat_statements is off", state: "manual" };
  const r = await one<{ calls: string; mean: string; q: string; since: string | null }>(
    db,
    sql`SELECT calls, mean_exec_time AS mean, left(regexp_replace(query, '\s+', ' ', 'g'), 70) AS q,
               (SELECT to_char(stats_reset, 'MM-DD') FROM pg_stat_statements_info) AS since
        FROM pg_stat_statements WHERE query ILIKE 'select%'
        ORDER BY total_exec_time DESC LIMIT 1`,
  );
  if (!r) return { now: "No reads recorded", state: "quiet" };
  const calls = Number(r.calls);
  const mean = Math.round(Number(r.mean));
  return {
    now: `Costliest read since ${r.since ?? "the last reset"}: ${mean} ms mean over ${calls.toLocaleString("en-US")} calls (${r.q})`,
    state: calls >= 1000 && mean >= 100 ? "watch" : "quiet",
  };
}

/** Firms whose homepage refused us (403, 429, 503) out of firms tried this week. */
async function crawlBlocks(db: Queryable): Promise<Check> {
  const r = await one<{ tried: string; blocked: string }>(
    db,
    sql`SELECT count(DISTINCT company_id) AS tried,
               count(DISTINCT company_id) FILTER (WHERE text = '' AND status_code IN (403, 429, 503)) AS blocked
        FROM documents WHERE fetched_at >= now() - interval '7 days'`,
  );
  const tried = Number(r?.tried ?? 0);
  const blocked = Number(r?.blocked ?? 0);
  const share = tried ? blocked / tried : 0;
  return {
    now: `${blocked} of ${tried} firms crawled this week refused us (${Math.round(share * 100)}%)`,
    state: tried >= 50 && share >= 0.1 ? "fired" : share >= 0.03 ? "watch" : "quiet",
  };
}

/** The audit log's size (the planner's count: cheap and close enough). 10M rows is when to partition it by month. */
async function auditSize(db: Queryable): Promise<Check> {
  const r = await one<{ n: string | null }>(
    db,
    sql`SELECT reltuples::bigint AS n FROM pg_class WHERE oid = 'audit_events'::regclass`,
  );
  const n = Math.max(0, Number(r?.n ?? 0));
  return {
    now: `${n.toLocaleString("en-US")} audit rows`,
    state: n >= 10_000_000 ? "fired" : n >= 5_000_000 ? "watch" : "quiet",
  };
}

export const PARKED: readonly Parked[] = [
  {
    id: "digitalocean",
    idea: "DigitalOcean move",
    unpark:
      "The pg box starts billing at on-demand rates, or the AWS bill takes more than an hour a month to understand",
    check: ec2Compute,
  },
  {
    id: "airbyte",
    idea: "Airbyte",
    unpark: "A client's CRM or ATS has no file export we parse. Try dlt first",
  },
  {
    id: "redis",
    idea: "Redis or Valkey",
    unpark:
      "pg_stat_statements shows a hot read an index can't fix, or two processes need a shared rate limit",
    check: hotRead,
  },
  {
    id: "proxies",
    idea: "Rotating proxies, gateway",
    unpark: "Crawl or autobrowse logs show IP blocks at a rate worth paying for",
    check: crawlBlocks,
  },
  {
    id: "audit-partition",
    idea: "Partition audit_events by month",
    unpark:
      "The log reaches 10M rows: partition on `at`, export old months to S3, then detach and drop (designs/2026-10-06-db-design.md)",
    check: auditSize,
  },
  {
    id: "remotion",
    idea: "Remotion",
    unpark: "The recorder's captures don't hold up in a sales video",
  },
  {
    id: "scrums",
    idea: "Simulated scrums",
    unpark: "No trigger. This review covers it",
  },
];

export const reviewRecord = (parked: readonly Parked[] = PARKED) =>
  defineRecord({
    id: "wren.parked",
    app: "review",
    channel: null,
    name: { one: "parked idea", many: "parked ideas" },
    // It shows spend.
    needs: "money",
    rows: async (db) =>
      Promise.all(
        parked.map(async (p) => {
          const c: Check = p.check
            ? await p.check(db)
            : { now: "A person judges it on Friday", state: "manual" };
          return { id: p.id, idea: p.idea, unpark: p.unpark, now: c.now, state: c.state };
        }),
      ),
    key: "id",
    title: "idea",
    subtitle: "unpark",
    fields: {
      idea: text("Idea"),
      state: status(
        {
          fired: { label: "Fired: move it to Now", tone: "bad" },
          watch: { label: "Watch", tone: "warn" },
          quiet: { label: "Quiet", tone: "good" },
          manual: { label: "You judge", tone: "neutral" },
        },
        "Trigger",
      ),
      now: text("Now"),
      unpark: text("Unpark when"),
    },
    views: [
      { id: "all", label: "All", sort: "state" },
      { id: "look", label: "Needs a look", where: { state: ["fired", "watch"] }, sort: "state" },
      { id: "manual", label: "You judge", where: { state: "manual" }, sort: "idea" },
    ],
  });
