/**
 * Pull pixel fetches from the tracking host into `open_events`.
 *
 * The same shape as the mailbox sync, and for the same reason: the remote side
 * is the source of truth, this reads forward from a cursor, and a re-run of an
 * overlapping window writes nothing new.
 *
 * The cursor is explicit (`open_syncs`) rather than derived from
 * `max(open_events.remote_id)`: a derived cursor only advances over rows we
 * STORE, and a hit whose token matches no message is deliberately not stored —
 * so a run of unattached hits at the head of the queue would be re-fetched on
 * every sync, forever. Advancing past them is safe: a token exists in
 * `messages` from compose, long before any send that could produce a fetch.
 *
 * What this does NOT do is decide anything. An open is not consent and a
 * non-open is not a signal to act on; no kill switch, stop or suppression
 * reads these rows. They exist to be counted by `open_outcomes`, which is
 * also where the machine-vs-person judgement is made — at read time.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { eq, inArray, max, sql } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import { messages, openEvents, openSyncs } from "../schema.js";

/** How many rows one request asks for. The host caps at 5000. */
export const PAGE = 1000;
/** Requests per run. A ceiling, not a target: an unbounded loop against a remote host is how a sync run becomes an incident. */
export const MAX_PAGES = 50;

export class OpenSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenSyncError";
  }
}

export interface OpenHit {
  id: number | string;
  token: string;
  seen_at: string;
  user_agent?: string | null;
}

export interface OpenSyncStats {
  fetched: number;
  stored: number;
  already_seen: number;
  unknown_token: number;
  pages: number;
}

async function rows(
  fetch: FetchLike,
  base: string,
  token: string,
  since: number,
): Promise<OpenHit[]> {
  const url = new URL(`${base.replace(/\/+$/, "")}/export`);
  url.searchParams.set("since", String(since));
  url.searchParams.set("limit", String(PAGE));
  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new OpenSyncError(`pixel host unreachable: ${(err as Error).message}`);
  }
  if (response.status === 401) {
    // Named without quoting either value: the secret never reaches a log line, an exception, or a run row.
    throw new OpenSyncError(
      "pixel host rejected the export credential — WREN_PIXEL_EXPORT_TOKEN must equal the worker's EXPORT_TOKEN secret",
    );
  }
  if (response.status !== 200) throw new OpenSyncError(`pixel host answered ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new OpenSyncError(`pixel host answered with no usable export: ${(err as Error).message}`);
  }
  const hits = (payload as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits))
    throw new OpenSyncError("pixel host answered with no usable export: no hits");
  return hits as OpenHit[];
}

export interface SyncOpensOptions {
  baseUrl: string;
  exportToken: string;
  fetch?: FetchLike;
  runId?: string | null;
}

/**
 * Read every hit newer than the last one we hold. Returns the stats.
 *
 * `unknown_token` counts fetches whose token matches no message: an old pixel
 * from a message since deleted, or somebody probing the URL space. Counted and
 * dropped, never stored — a row we cannot attach to a message is not evidence.
 */
export async function syncOpens(db: Db, opts: SyncOpensOptions): Promise<OpenSyncStats> {
  const stats: OpenSyncStats = {
    fetched: 0,
    stored: 0,
    already_seen: 0,
    unknown_token: 0,
    pages: 0,
  };
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  let since = await cursor(db, opts.baseUrl);
  for (let page = 0; page < MAX_PAGES; page++) {
    const hits = await rows(fetchImpl, opts.baseUrl, opts.exportToken, since);
    stats.pages += 1;
    if (!hits.length) break;
    stats.fetched += hits.length;
    // Over every row READ, not every row kept: the whole point of the explicit cursor.
    since = Math.max(...hits.map((hit) => Number(hit.id)));
    await atomic(db, async (tx) => {
      await store(tx, hits, { runId: opts.runId ?? null, stats });
      await advance(tx, opts.baseUrl, since, stats);
    });
    if (hits.length < PAGE) break;
  }
  return stats;
}

/** This host's high-water mark; falls back to the derived cursor so a database written before the explicit one does not re-read its whole history once. */
async function cursor(db: Queryable, baseUrl: string): Promise<number> {
  const [stored] = await db.select().from(openSyncs).where(eq(openSyncs.baseUrl, baseUrl));
  if (stored) return stored.cursorId;
  const [row] = await db.select({ top: max(openEvents.remoteId) }).from(openEvents);
  return row?.top ?? 0;
}

async function advance(
  db: Queryable,
  baseUrl: string,
  cursorId: number,
  stats: OpenSyncStats,
): Promise<void> {
  await db
    .insert(openSyncs)
    .values({ baseUrl, cursorId, syncedAt: sql`now()`, stats: { ...stats } })
    .onConflictDoUpdate({
      target: openSyncs.baseUrl,
      set: {
        cursorId: sql`excluded.cursor_id`,
        syncedAt: sql`excluded.synced_at`,
        stats: sql`excluded.stats`,
      },
      // Never move a cursor backwards: a stale page or a re-pointed host must not make the sync re-read what it already passed.
      setWhere: sql`${openSyncs.cursorId} < excluded.cursor_id`,
    });
}

async function store(
  db: Queryable,
  hits: readonly OpenHit[],
  opts: { runId: string | null; stats: OpenSyncStats },
): Promise<void> {
  const tokens = [...new Set(hits.map((hit) => String(hit.token)))];
  const known = new Map(
    (
      await db
        .select({ token: messages.openToken, id: messages.id })
        .from(messages)
        .where(inArray(messages.openToken, tokens))
    ).map((row) => [row.token, row.id]),
  );
  const values = [];
  for (const hit of hits) {
    const messageId = known.get(String(hit.token));
    if (messageId === undefined) {
      opts.stats.unknown_token += 1;
      continue;
    }
    values.push({
      messageId,
      remoteId: Number(hit.id),
      seenAt: parsed(hit.seen_at),
      userAgent: hit.user_agent || null,
      runId: opts.runId,
    });
  }
  if (!values.length) return;
  // ON CONFLICT on the host's own id: the idempotency the module docstring
  // promises, enforced by the unique index rather than by a read-then-write.
  const inserted = await db
    .insert(openEvents)
    .values(values)
    .onConflictDoNothing({ target: openEvents.remoteId })
    .returning({ id: openEvents.id });
  opts.stats.stored += inserted.length;
  opts.stats.already_seen += values.length - inserted.length;
}

/** The worker writes `new Date().toISOString()` — always UTC, always `Z`. */
function parsed(value: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new OpenSyncError(`pixel host sent an unreadable seen_at: ${value}`);
  return date;
}
