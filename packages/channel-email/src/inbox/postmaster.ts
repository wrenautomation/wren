/**
 * Google Postmaster Tools: the complaint rate, pulled.
 *
 * The one number that can end a domain and the one we cannot see any other
 * way. A Gmail user hitting "report spam" leaves no trace in our mailbox, in a
 * DSN, or anywhere else on our side — Postmaster is the only window, and above
 * ~0.3% Google starts treating the domain as a bad sender.
 *
 * Read-only, and the read is all it is: this stores what Google says and
 * decides nothing. The kill switches stay on hard bounces, whose meaning we
 * own end to end; wiring an external daily aggregate — one that arrives late,
 * and often not at all below Google's volume threshold — into an automatic
 * pause would hand a young fleet's availability to a number that is silent
 * most days. The digest surfaces it; a human acts on it.
 *
 * Volume threshold, and why an empty answer is normal: Google publishes
 * traffic stats only for days a domain sent enough mail to Gmail addresses to
 * keep the numbers non-identifying. At this fleet's volume most days will
 * simply have no row. That is not an error, and `syncPostmaster` reports it as
 * `days_without_data` rather than failing.
 *
 * **v2.** `GET domains/{d}/trafficStats` became `POST
 * domains/{d}/domainStats:query` (a request naming the metrics it wants, and
 * a FLAT list of one row per metric per day). Each metric is asked for by
 * name, so the response correlates back through `MetricDefinition.name` —
 * `METRICS` below IS the mapping from our column names to Google's
 * vocabulary. `domainReputation` (BAD|LOW|MEDIUM|HIGH) has no v2 equivalent:
 * the column stays and goes NULL going forward, and a re-sync never writes
 * over the v1 history that is still the only reputation Google ever gave us.
 */
import type { Db, Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import { postmasterDays } from "../schema.js";
import { POSTMASTER_SCOPE, POSTMASTER_TRAFFIC_SCOPE } from "../send/google-auth.js";

export const API = "https://gmailpostmastertools.googleapis.com/v2";

export type MetricColumn =
  | "spam_rate"
  | "spf_success_ratio"
  | "dkim_success_ratio"
  | "dmarc_success_ratio"
  | "delivery_error_rate"
  | "tls_inbound_count"
  | "tls_outbound_count";

/**
 * Our column names, and how v2 is asked for each. The `name` we send is the
 * key we get back (`DomainStat.metric`), so this table is both the request
 * and the parse. The three auth ratios are one metric filtered three ways.
 * TLS counts are the denominator, as near as v2 publishes one: every metric
 * above is a RATE, and a rate with no volume behind it is unreadable. Both
 * directions are stored under Google's own names; v1 defined the pair from
 * Gmail's side, so `tls_inbound_count` is the one to read as "at least this
 * many of our sends".
 */
export const METRICS: ReadonlyArray<readonly [MetricColumn, string, string | null]> = [
  ["spam_rate", "SPAM_RATE", null],
  ["spf_success_ratio", "AUTH_SUCCESS_RATE", 'auth_type = "spf"'],
  ["dkim_success_ratio", "AUTH_SUCCESS_RATE", 'auth_type = "dkim"'],
  ["dmarc_success_ratio", "AUTH_SUCCESS_RATE", 'auth_type = "dmarc"'],
  ["delivery_error_rate", "DELIVERY_ERROR_RATE", null],
  ["tls_inbound_count", "TLS_ENCRYPTION_MESSAGE_COUNT", 'traffic_direction = "inbound"'],
  ["tls_outbound_count", "TLS_ENCRYPTION_MESSAGE_COUNT", 'traffic_direction = "outbound"'],
];

/** Google's cap: 200 DomainStat rows per page. `nextPageToken` is followed however long the window is. */
const PAGE_SIZE = 200;

/** Google's own line for bulk senders. Not a threshold anything acts on here — a number for a person to read. */
export const SPAM_RATE_LIMIT = 0.003;

export class PostmasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostmasterError";
  }
}

type Json = Record<string, unknown>;

async function errorBody(response: Response): Promise<Json> {
  try {
    const body: unknown = await response.clone().json();
    const error = body && typeof body === "object" ? (body as Json).error : null;
    return error && typeof error === "object" ? (error as Json) : {};
  } catch {
    return {};
  }
}

function details(error: Json): Json[] {
  return Array.isArray(error.details)
    ? (error.details as unknown[]).filter((d): d is Json => !!d && typeof d === "object")
    : [];
}

/** True when this 403 is "the API was never switched on", not "your credential was refused". */
async function serviceDisabled(response: Response): Promise<boolean> {
  return details(await errorBody(response)).some((d) => d.reason === "SERVICE_DISABLED");
}

/** The console link Google puts in the error, so nobody has to hand-assemble one out of a project number. */
async function activationUrl(response: Response): Promise<string> {
  for (const d of details(await errorBody(response))) {
    const metadata = d.metadata;
    const url = metadata && typeof metadata === "object" ? (metadata as Json).activationUrl : null;
    if (url) return String(url);
  }
  return "https://console.cloud.google.com/apis/library/gmailpostmastertools.googleapis.com";
}

// What is retried, and why it is a small number of times rather than a
// policy: the endpoint answers a fraction of calls with a 503 for no visible
// reason, and a 429 on v2 is a real quota answer that clears the same way.
const RETRYABLE = new Set([429, 503]);
const RETRY_ATTEMPTS = 4;
/** A server-named wait is honoured, but never past this. */
const MAX_RETRY_WAIT_MS = 60_000;

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to wait before retrying — the server's own `Retry-After` when usable, else exponential backoff. */
function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After") ?? "";
  const seconds = Number(header);
  if (header.trim() !== "" && Number.isFinite(seconds))
    return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  return Math.min(2 ** attempt * 1000, MAX_RETRY_WAIT_MS);
}

export interface PostmasterClient {
  fetch: FetchLike;
  /** The bearer, or a supplier that mints/refreshes one (`postmasterToken`) — a long-lived worker outlives any one token. */
  token: string | (() => Promise<string>);
  sleep?: Sleep;
}

async function request(
  client: PostmasterClient,
  path: string,
  body: Json | null,
): Promise<Response> {
  const url = `${API}/${path}`;
  const bearer = typeof client.token === "string" ? client.token : await client.token();
  const headers: Record<string, string> = { Authorization: `Bearer ${bearer}` };
  try {
    if (body === null) return await client.fetch(url, { method: "GET", headers });
    return await client.fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new PostmasterError(`Postmaster unreachable: ${(err as Error).message}`);
  }
}

async function call(
  client: PostmasterClient,
  path: string,
  body: Json | null = null,
): Promise<Json> {
  const sleep = client.sleep ?? realSleep;
  let response = await request(client, path, body);
  for (let attempt = 1; RETRYABLE.has(response.status); attempt++) {
    if (attempt === RETRY_ATTEMPTS) {
      throw new PostmasterError(
        `Postmaster answered ${response.status} on ${RETRY_ATTEMPTS} attempts in a row. Nothing is wrong with the credential — the endpoint is intermittently unavailable. Re-run: every (domain, day) is upserted, so nothing already stored is lost and nothing is stored twice`,
      );
    }
    await sleep(retryAfterMs(response, attempt));
    response = await request(client, path, body);
  }
  if (response.status === 401 || response.status === 403) {
    // SERVICE_DISABLED means the delegation is FINE and the API was simply
    // never switched on for the key's Cloud project.
    if (await serviceDisabled(response)) {
      throw new PostmasterError(
        `the Gmail Postmaster Tools API is not enabled on the service account's Google Cloud project — the credential and its scope are fine. Enable it, wait a few minutes, retry:\n${await activationUrl(response)}`,
      );
    }
    throw new PostmasterError(
      `Postmaster refused the credential — the Workspace admin console's domain-wide-delegation entry must list one of ${POSTMASTER_TRAFFIC_SCOPE} (preferred, read-only) or ${POSTMASTER_SCOPE}, and the impersonated user must be the one that registered these domains at postmaster.google.com. Note that postmaster.readonly reaches only the retired v1 API and will not work here`,
    );
  }
  if (response.status === 404) {
    throw new PostmasterError("no such registered domain — add it at postmaster.google.com first");
  }
  if (response.status !== 200) throw new PostmasterError(`Postmaster answered ${response.status}`);
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" ? (payload as Json) : {};
  } catch (err) {
    throw new PostmasterError(`Postmaster answered with no usable JSON: ${(err as Error).message}`);
  }
}

/** The domains this account actually has in Postmaster — a domain absent here is one nobody registered. */
export async function registeredDomains(client: PostmasterClient): Promise<string[]> {
  const payload = await call(client, "domains");
  const rows = Array.isArray(payload.domains) ? (payload.domains as unknown[]) : [];
  // Names come back as "domains/example.com".
  return rows
    .map((row) => {
      const name = String((row as Json | null)?.name ?? "");
      const slash = name.indexOf("/");
      return slash >= 0 ? name.slice(slash + 1) : name;
    })
    .sort();
}

/** `METRICS` as v2's request shape. */
function metricDefinitions(): Json[] {
  return METRICS.map(([column, standardMetric, filter]) => {
    const definition: Json = { name: column, baseMetric: { standardMetric } };
    if (filter) definition.filter = filter;
    return definition;
  });
}

/** A calendar day as `YYYY-MM-DD`. */
export type Day = string;

function dayParts(day: Day): { year: number; month: number; day: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { year: y ?? 0, month: m ?? 0, day: d ?? 0 };
}

function shiftDay(day: Day, days: number): Day {
  const { year, month, day: d } = dayParts(day);
  return new Date(Date.UTC(year, month - 1, d + days)).toISOString().slice(0, 10);
}

/** Every DomainStat row for one domain over one window, pages followed. v2's dates are inclusive at both ends. */
async function queryStats(
  client: PostmasterClient,
  domain: string,
  start: Day,
  end: Day,
): Promise<Json[]> {
  const body: Json = {
    metricDefinitions: metricDefinitions(),
    timeQuery: { dateRanges: { dateRanges: [{ start: dayParts(start), end: dayParts(end) }] } },
    aggregationGranularity: "DAILY",
    pageSize: PAGE_SIZE,
  };
  const rows: Json[] = [];
  for (;;) {
    const payload = await call(client, `domains/${domain}/domainStats:query`, body);
    if (Array.isArray(payload.domainStats)) {
      rows.push(
        ...(payload.domainStats as unknown[]).filter(
          (r): r is Json => !!r && typeof r === "object",
        ),
      );
    }
    const pageToken = payload.nextPageToken;
    if (!pageToken) return rows;
    body.pageToken = pageToken;
  }
}

/**
 * One StatisticValue as a number. v2 boxes every statistic in a typed wrapper
 * and picks the field by type, so read whichever arrived. `intValue` arrives
 * as a STRING (proto int64 over JSON) and stays an integer here.
 */
function statistic(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Json;
  if ("intValue" in box) return asInt(box.intValue);
  for (const key of ["doubleValue", "floatValue"]) if (key in box) return asFloat(box[key]);
  return null;
}

function asInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== "" ? Math.trunc(n) : null;
}

function asFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== "" ? n : null;
}

/** v2's Date message — separate year/month/day integers. */
function dateOf(value: unknown): Day | null {
  if (!value || typeof value !== "object") return null;
  const { year, month, day } = value as Json;
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  if (![y, m, d].every((n) => Number.isInteger(n)) || m < 1 || m > 12 || d < 1 || d > 31)
    return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

type DayRecord = { raw: Json[] } & Partial<Record<MetricColumn, number | null>>;

/**
 * v2's flat (metric, date, value) rows pivoted back into one record per day —
 * the shape `postmaster_days` stores — plus how many rows had no usable date.
 * A row whose metric we did not ask for is kept in `raw` and skipped as a
 * column; a row with no parseable date is counted rather than dropped in silence.
 */
function byDay(rows: readonly Json[]): [Map<Day, DayRecord>, number] {
  const days = new Map<Day, DayRecord>();
  let unparseable = 0;
  const known = new Set<string>(METRICS.map(([column]) => column));
  for (const row of rows) {
    const day = dateOf(row.date);
    if (day === null) {
      unparseable += 1;
      continue;
    }
    const record = days.get(day) ?? { raw: [] };
    days.set(day, record);
    record.raw.push(row);
    const metric = String(row.metric ?? "");
    if (known.has(metric)) record[metric as MetricColumn] = statistic(row.value);
  }
  return [days, unparseable];
}

export interface PostmasterStats {
  domains: number;
  domains_failed: number;
  days_with_data: number;
  days_without_data: number;
  rows_unparseable: number;
  stored: number;
  per_domain: Record<string, number>;
  failed: Record<string, string>;
}

export interface SyncPostmasterOptions {
  client: PostmasterClient;
  domains: readonly string[];
  /** How far back to pull (default 30 days, inclusive of today). */
  days?: number;
  today?: Day;
  runId?: string | null;
}

/**
 * Pull the last `days` of statistics for each domain (v2).
 *
 * Re-runnable over any window: each (domain, day) is upserted, because Google
 * revises a day's numbers for a while after it closes and the later answer is
 * the better one. Every row Google sent is kept in `raw` alongside the parsed
 * columns, including metrics with no column of their own.
 *
 * Committed per domain: a crash keeps the domains already stored. One
 * domain's failure is that domain's: recorded under `failed` and the walk goes
 * on. Only when EVERY domain failed is the first error thrown — that is a
 * credential, a disabled API, or an outage, and it should read as one loud
 * message rather than a table of them.
 */
export async function syncPostmaster(
  db: Db,
  opts: SyncPostmasterOptions,
): Promise<PostmasterStats> {
  const days = opts.days ?? 30;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  // v2's range is inclusive at both ends, so `days` back from today is `days` dates.
  const [start, end] = [shiftDay(today, -(days - 1)), today];
  const stats: PostmasterStats = {
    domains: 0,
    domains_failed: 0,
    days_with_data: 0,
    days_without_data: 0,
    rows_unparseable: 0,
    stored: 0,
    per_domain: {},
    failed: {},
  };
  for (const domain of opts.domains) {
    let rows: Json[];
    try {
      rows = await queryStats(opts.client, domain, start, end);
    } catch (err) {
      if (!(err instanceof PostmasterError)) throw err;
      stats.domains_failed += 1;
      stats.failed[domain] = err.message;
      continue;
    }
    const [records, unparseable] = byDay(rows);
    stats.domains += 1;
    stats.rows_unparseable += unparseable;
    stats.per_domain[domain] = records.size;
    if (!records.size) {
      // Not an error: below Google's publishing threshold a domain simply has no days.
      stats.days_without_data += 1;
      continue;
    }
    stats.days_with_data += records.size;
    stats.stored += await db.transaction((tx) => store(tx, domain, records, opts.runId ?? null));
  }
  const firstFailure = Object.values(stats.failed)[0];
  if (firstFailure !== undefined && !stats.domains) throw new PostmasterError(firstFailure);
  return stats;
}

/**
 * Upsert one domain's days. `domain_reputation` is deliberately absent from
 * both the insert and the update set: v2 has no such metric, and writing NULL
 * over a v1 value on every re-sync would erase the only reputation Google
 * ever gave us. New days simply have none; old days keep theirs.
 */
async function store(
  db: Queryable,
  domain: string,
  records: Map<Day, DayRecord>,
  runId: string | null,
): Promise<number> {
  const values = [...records.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, record]) => ({
      domain,
      day,
      spamRate: record.spam_rate ?? null,
      spfSuccessRatio: record.spf_success_ratio ?? null,
      dkimSuccessRatio: record.dkim_success_ratio ?? null,
      dmarcSuccessRatio: record.dmarc_success_ratio ?? null,
      deliveryErrorRate: record.delivery_error_rate ?? null,
      tlsInboundCount: record.tls_inbound_count ?? null,
      tlsOutboundCount: record.tls_outbound_count ?? null,
      raw: { domainStats: record.raw },
      runId,
    }));
  if (!values.length) return 0;
  await db
    .insert(postmasterDays)
    .values(values)
    .onConflictDoUpdate({
      target: [postmasterDays.domain, postmasterDays.day],
      // Google revises a day for a while after it closes; the later answer replaces the earlier one.
      set: {
        spamRate: sql`excluded.spam_rate`,
        spfSuccessRatio: sql`excluded.spf_success_ratio`,
        dkimSuccessRatio: sql`excluded.dkim_success_ratio`,
        dmarcSuccessRatio: sql`excluded.dmarc_success_ratio`,
        deliveryErrorRate: sql`excluded.delivery_error_rate`,
        tlsInboundCount: sql`excluded.tls_inbound_count`,
        tlsOutboundCount: sql`excluded.tls_outbound_count`,
        raw: sql`excluded.raw`,
        runId: sql`excluded.run_id`,
        syncedAt: sql`now()`,
      },
    });
  return values.length;
}
