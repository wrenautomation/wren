/**
 * Every SQL statement of the runtime. Times that decide "is it due" come from the caller's clock
 * (`now`), so one process's clock judges both sides; leases use the server clock (minutes, not ms).
 */
import type postgres from "postgres";
import type { Registry, RetryPolicy } from "./registry.js";
import { FENCED } from "./schema.js";
import type { ErrorJson, Invocation, Loaded, Outcome, Row, Writes } from "./turn.js";
import { millis } from "./turn.js";

type Sql = postgres.Sql | postgres.TransactionSql;
const b64 = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("base64"));
const json = (v: unknown) => JSON.stringify(v);

export const isFenced = (e: unknown) => (e as { code?: string })?.code === FENCED;

export interface Claim {
  id: string;
  attempt: number;
  service: string;
  handler: string;
  /** Pinned code: a Lambda version ARN or a box build sha. */
  build: string | null;
}

/** Register a process's handlers: their kind decides key locking at submit time. */
export async function register(sql: Sql, registry: Registry) {
  const defs = registry.list().map((h) => ({
    service: h.service,
    handler: h.name,
    object: h.object,
    exclusive: h.exclusive,
    private: h.private,
  }));
  if (!defs.length) return;
  await sql`
    INSERT INTO rt.handlers (service, handler, object, exclusive, private)
    SELECT x.service, x.handler, x.object, x.exclusive, x.private
    FROM jsonb_to_recordset(${json(defs)}::text::jsonb) AS x(service text, handler text, object boolean, exclusive boolean, private boolean)
    ON CONFLICT (service, handler) DO UPDATE SET object = excluded.object, exclusive = excluded.exclusive,
      private = excluded.private, at = now()`;
}

/**
 * Which rows a dispatcher takes. `only` / `except`: by service. `build`: pinned on first claim;
 * `strict` also skips rows pinned to another build (a box slot runs only its own code).
 * `lock: false`: ignore key locks (bridge rows: Restate locks the key).
 */
export interface Lane {
  only?: readonly string[];
  except?: readonly string[];
  build?: string;
  strict?: boolean;
  /** false: only rows already pinned to `build` (a superseded slot finishing its own). */
  fresh?: boolean;
  lock?: boolean;
  /** Skip services in `rt.pg_services` (bridge lanes): the newest box runs them on pg. */
  skipPg?: boolean;
  /** Only rows a caller waits on (true) or only the rest (false). */
  callerWaits?: boolean;
}

const laneSql = (sql: Sql, l: Lane) => sql`
  ${l.only ? sql`AND i.service IN ${sql(l.only as string[])}` : sql``}
  ${l.except?.length ? sql`AND i.service NOT IN ${sql(l.except as string[])}` : sql``}
  ${l.skipPg ? sql`AND i.service NOT IN (SELECT service FROM rt.pg_services)` : sql``}
  ${l.callerWaits === undefined ? sql`` : sql`AND i.caller_waits = ${l.callerWaits}`}
  ${
    l.strict && l.build
      ? l.fresh === false
        ? sql`AND i.build = ${l.build}`
        : sql`AND (i.build IS NULL OR i.build = ${l.build})`
      : sql``
  }`;

/** Claim up to `n` due invocations. FIFO per object key for exclusive handlers; one holder per key. */
export async function claim(
  sql: Sql,
  n: number,
  leaseMs: number,
  now: number,
  lane: Lane = {},
): Promise<Claim[]> {
  if (lane.only && lane.only.length === 0) return [];
  const at = new Date(now);
  const lock = lane.lock ?? true;
  return sql<Claim[]>`
    WITH c AS (
      SELECT i.id FROM rt.invocations i
      WHERE ((i.status IN ('pending', 'suspended') AND i.run_at <= ${at})
             OR (i.status = 'running' AND i.lease_until < now()))
        ${laneSql(sql, lane)}
        AND (NOT ${lock} OR NOT i.exclusive OR i.holds OR (
          NOT EXISTS (SELECT 1 FROM rt.invocations h WHERE h.service = i.service AND h.key = i.key AND h.holds)
          AND i.id = (
            SELECT o.id FROM rt.invocations o
            WHERE o.service = i.service AND o.key = i.key AND o.exclusive AND o.status = 'pending'
              AND NOT o.holds AND o.run_at <= ${at}
            ORDER BY o.created_at, o.id LIMIT 1)))
      ORDER BY i.run_at
      LIMIT ${n}
      FOR UPDATE OF i SKIP LOCKED)
    UPDATE rt.invocations i SET
      status = 'running', attempt = i.attempt + 1, wake = false, holds = i.exclusive AND ${lock},
      lease_until = now() + make_interval(secs => ${leaseMs / 1000}),
      started_at = coalesce(i.started_at, now()),
      build = coalesce(i.build, ${lane.build ?? null})
    FROM c WHERE i.id = c.id
    RETURNING i.id, i.attempt, i.service, i.handler, i.build`;
}

/**
 * Soonest future time a row of this lane becomes due, for the dispatcher's sleep. Rows due now
 * but blocked (a key holder) are left out: the holder's finish sends NOTIFY rt_wake.
 */
export async function nextDue(sql: Sql, lane: Lane = {}): Promise<Date | null> {
  if (lane.only && lane.only.length === 0) return null;
  const [r] = await sql<{ at: Date | null }[]>`
    SELECT least(
      (SELECT min(run_at) FROM rt.invocations i
        WHERE status IN ('pending', 'suspended') AND run_at > now() AND run_at < 'infinity'
        ${laneSql(sql, lane)}), -- infinity parses to Invalid Date
      (SELECT min(lease_until) FROM rt.invocations i WHERE status = 'running' ${laneSql(sql, lane)})) AS at`;
  return r?.at ?? null;
}

export async function load(sql: Sql, id: string, attempt: number): Promise<Loaded | undefined> {
  const [inv] = await sql<(Invocation & { input: Buffer })[]>`
    SELECT id, service, handler, key, input, headers, attempt, failures, cancel, parent_id, parent_seq,
      caller_waits
    FROM rt.invocations WHERE id = ${id} AND attempt = ${attempt} AND status = 'running'`;
  if (!inv) return undefined;
  const [journal, state, awk] = await Promise.all([
    sql<Row[]>`
      SELECT seq, kind, name, done, value, error, wake_at, ref, tries, first_at
      FROM rt.journal WHERE invocation_id = ${id} ORDER BY seq`,
    inv.key === null
      ? Promise.resolve([] as { name: string; value: Buffer }[])
      : sql<{ name: string; value: Buffer }[]>`
          SELECT name, value FROM rt.state WHERE service = ${inv.service} AND key = ${inv.key}`,
    sql<{ seq: number; value: Buffer | null; error: ErrorJson | null }[]>`
      SELECT seq, value, error FROM rt.awakeables WHERE invocation_id = ${id}`,
  ]);
  return {
    inv,
    journal: [...journal],
    state: new Map(state.map((r) => [r.name, r.value])),
    awakeables: new Map(awk.map((r) => [r.seq, { value: r.value, error: r.error }])),
  };
}

export async function renew(sql: Sql, id: string, attempt: number, leaseMs: number) {
  await sql`SELECT rt.fence(${id}, ${attempt}, ${leaseMs})`;
}

/**
 * Give a claim back unrun, no failure counted: the invoke was refused before any turn began
 * (a Lambda throttle). The attempt check keeps a later claim's row safe.
 */
export async function release(sql: Sql, id: string, attempt: number, delayMs: number) {
  const r = await sql`UPDATE rt.invocations SET status = 'pending', lease_until = NULL,
      run_at = now() + ${delayMs} * interval '1 millisecond'
    WHERE id = ${id} AND attempt = ${attempt} AND status = 'running'`;
  return r.count === 1;
}

/**
 * A row pinned to a build without its handler (the box made it before the new build's ARN was read):
 * unpinned and released, when nothing ran yet, so the next claim pins it to the lane's build. False:
 * it started, or it was unpinned `UNPIN_MAX` times (a service no build has), and should fail.
 */
export const UNPIN_MAX = 30;
export async function unpin(
  sql: Sql,
  id: string,
  attempt: number,
  delayMs: number,
  message: string,
) {
  const r =
    await sql`UPDATE rt.invocations i SET status = 'pending', lease_until = NULL, build = NULL,
      failures = failures + 1, last_failure = ${json({ message })}::text::jsonb,
      run_at = now() + ${delayMs} * interval '1 millisecond'
    WHERE i.id = ${id} AND i.attempt = ${attempt} AND i.status = 'running' AND i.build IS NOT NULL
      AND i.failures < ${UNPIN_MAX}
      AND NOT EXISTS (SELECT 1 FROM rt.journal j WHERE j.invocation_id = i.id)`;
  return r.count === 1;
}

/**
 * First in a flush that writes an attach: share-lock each target before our own fence. A target's
 * `finish` fences (row lock) first, so either it commits before our settle check reads it, or its
 * attach UPDATE runs after our row committed: no lost wake. We hold nothing while we wait.
 */
function attachLocks(tx: postgres.TransactionSql, w: Writes | null) {
  const targets = w
    ? [...w.journal.values()].filter((r) => r.kind === "attach" && !r.done).map((r) => r.ref)
    : [];
  return targets.length
    ? [
        tx`SELECT 1 FROM rt.invocations WHERE id = ANY(${targets as string[]}) ORDER BY id FOR SHARE`,
      ]
    : [];
}

/** The statements that write one flush; run inside a transaction after `rt.fence`. */
function writes(tx: postgres.TransactionSql, inv: Invocation, w: Writes, now: Date) {
  const qs: postgres.PendingQuery<postgres.Row[]>[] = [];
  if (w.journal.size) {
    const rows = [...w.journal.values()].map((r) => ({ ...r, value: b64(r.value) }));
    qs.push(tx`
      INSERT INTO rt.journal (invocation_id, seq, kind, name, done, value, error, wake_at, ref, tries, first_at)
      SELECT ${inv.id}, x.seq, x.kind, x.name, x.done, decode(x.value, 'base64'), x.error, x.wake_at, x.ref, x.tries, x.first_at
      FROM jsonb_to_recordset(${json(rows)}::text::jsonb) AS x(seq int, kind text, name text, done boolean,
        value text, error jsonb, wake_at timestamptz, ref text, tries int, first_at timestamptz)
      ON CONFLICT (invocation_id, seq) DO UPDATE SET done = excluded.done, value = excluded.value,
        error = excluded.error, tries = excluded.tries, first_at = excluded.first_at, at = now()
      WHERE NOT rt.journal.done`);
  }
  if (inv.key !== null && (w.clearAll || w.clears.size)) {
    qs.push(tx`
      DELETE FROM rt.state WHERE service = ${inv.service} AND key = ${inv.key} AND (
        (${w.clearAll} AND NOT (name IN (SELECT jsonb_array_elements_text(${json([...w.sets.keys()])}::text::jsonb))))
        OR name IN (SELECT jsonb_array_elements_text(${json([...w.clears])}::text::jsonb)))`);
  }
  if (inv.key !== null && w.sets.size) {
    const rows = [...w.sets].map(([name, value]) => ({ name, value: b64(value) }));
    qs.push(tx`
      INSERT INTO rt.state (service, key, name, value)
      SELECT ${inv.service}, ${inv.key}, x.name, decode(x.value, 'base64')
      FROM jsonb_to_recordset(${json(rows)}::text::jsonb) AS x(name text, value text)
      ON CONFLICT (service, key, name) DO UPDATE SET value = excluded.value, at = now()`);
  }
  if (w.children.length) {
    const rows = w.children.map((c) => ({ ...c, input: b64(c.input) }));
    qs.push(tx`
      INSERT INTO rt.invocations (id, service, handler, key, exclusive, input, headers, parent_id, parent_seq, run_at, idem_key, caller_waits)
      SELECT x.id, x.service, x.handler, x.key, coalesce(h.exclusive, x.key IS NOT NULL),
        decode(x.input, 'base64'), coalesce(x.headers, '{}'), x.parent_id, x.parent_seq, x.run_at, x.idem_key,
        coalesce(x.caller_waits, false)
      FROM jsonb_to_recordset(${json(rows)}::text::jsonb) AS x(id text, service text, handler text, key text,
        input text, headers jsonb, parent_id text, parent_seq int, run_at timestamptz, idem_key text,
        caller_waits boolean)
      LEFT JOIN rt.handlers h ON h.service = x.service AND h.handler = x.handler
      ON CONFLICT DO NOTHING`);
    qs.push(tx`SELECT pg_notify('rt_wake', '')`);
  }
  if (w.awakes.length) {
    const rows = w.awakes.map((a) => ({ ...a, value: b64(a.value) }));
    qs.push(tx`
      WITH x AS (
        SELECT * FROM jsonb_to_recordset(${json(rows)}::text::jsonb)
          AS x(id text, invocation text, seq int, value text, error jsonb)),
      ins AS (
        INSERT INTO rt.awakeables (id, invocation_id, seq, value, error)
        SELECT id, invocation, seq, decode(value, 'base64'), error FROM x
        ON CONFLICT DO NOTHING RETURNING invocation_id)
      SELECT rt.wake(invocation_id, ${now}) FROM ins`);
  }
  if (w.cancels.length)
    qs.push(
      tx`SELECT rt.cancel(id, ${now}) FROM jsonb_array_elements_text(${json(w.cancels)}::text::jsonb) AS id`,
    );
  if (w.uncancel) qs.push(tx`UPDATE rt.invocations SET cancel = false WHERE id = ${inv.id}`);
  // last, so a child sent in this flush exists: an attach whose target already ended (or never
  // was: 404) settles now
  if ([...w.journal.values()].some((r) => r.kind === "attach" && !r.done))
    qs.push(tx`
      WITH a AS (
        UPDATE rt.journal j SET done = true, value = t.result, at = now(),
          error = CASE WHEN t.id IS NULL THEN '{"message":"invocation not found","code":404}'::jsonb
            ELSE t.error END
        FROM rt.journal w LEFT JOIN rt.invocations t ON t.id = w.ref
        WHERE w.invocation_id = ${inv.id} AND w.kind = 'attach' AND NOT w.done
          AND j.invocation_id = w.invocation_id AND j.seq = w.seq
          AND (t.id IS NULL OR t.status IN ('done', 'killed'))
        RETURNING j.invocation_id)
      SELECT rt.wake(invocation_id, ${now}) FROM a LIMIT 1`);
  return qs;
}

/** One fenced transaction: the turn still holds its lease, or nothing is written. */
export async function flush(
  sql: postgres.Sql,
  inv: Invocation,
  w: Writes,
  leaseMs: number,
): Promise<void> {
  try {
    await sql.begin((tx) => [
      ...attachLocks(tx, w),
      tx`SELECT rt.fence(${inv.id}, ${inv.attempt}, ${leaseMs})`,
      ...writes(tx, inv, w, new Date()),
    ]);
  } catch (e) {
    if (isFenced(e)) throw Object.assign(e as Error, { fenced: true });
    throw e;
  }
}

/** Restate's default (deploy/scripts/box-restate.sh): 500 ms × 2 up to 1 min, 70 tries, then pause. */
const SERVER_RETRY: {
  initialInterval: number;
  exponentiationFactor: number;
  maxInterval: number;
  maxAttempts: number;
  onMaxAttempts: "pause" | "kill";
} = {
  initialInterval: 500,
  exponentiationFactor: 2,
  maxInterval: 60_000,
  maxAttempts: 70,
  onMaxAttempts: "pause",
};

export function retryDelay(policy: RetryPolicy | undefined, failures: number) {
  const initial = millis(policy?.initialInterval) ?? SERVER_RETRY.initialInterval;
  const factor = policy?.exponentiationFactor ?? SERVER_RETRY.exponentiationFactor;
  const max = millis(policy?.maxInterval) ?? SERVER_RETRY.maxInterval;
  return Math.min(initial * factor ** Math.max(0, failures - 1), max);
}

/** The outcome of a turn, with its last writes, in one fenced transaction. */
export async function finish(
  sql: postgres.Sql,
  inv: Invocation,
  w: Writes | null,
  outcome: Exclude<Outcome, { type: "fenced" }>,
  policy: RetryPolicy | undefined,
  leaseMs: number,
  now = Date.now(),
): Promise<void> {
  const at = new Date(now);
  try {
    await sql.begin((tx) => {
      const qs: postgres.PendingQuery<postgres.Row[]>[] = [
        ...attachLocks(tx, w),
        tx`SELECT rt.fence(${inv.id}, ${inv.attempt}, ${leaseMs})`,
        ...(w ? writes(tx, inv, w, at) : []),
      ];
      const end = (
        status: "done" | "killed",
        result: Uint8Array | null,
        error: ErrorJson | null,
      ) => {
        qs.push(tx`
          UPDATE rt.invocations SET status = ${status}, result = ${result ? Buffer.from(result) : null},
            error = ${error ? json(error) : null}::text::jsonb, holds = false, lease_until = NULL, completed_at = now()
          WHERE id = ${inv.id}`);
        qs.push(tx`
          WITH a AS (
            UPDATE rt.journal SET done = true, value = ${result ? Buffer.from(result) : null},
              error = ${error ? json(error) : null}::text::jsonb, at = now()
            WHERE kind = 'attach' AND ref = ${inv.id} AND NOT done RETURNING invocation_id)
          SELECT rt.wake(invocation_id, ${at}) FROM (SELECT DISTINCT invocation_id FROM a) d`);
        if (inv.parent_id && inv.parent_seq !== null) {
          qs.push(tx`
            UPDATE rt.journal SET done = true, value = ${result ? Buffer.from(result) : null},
              error = ${error ? json(error) : null}::text::jsonb, at = now()
            WHERE invocation_id = ${inv.parent_id} AND seq = ${inv.parent_seq} AND NOT done`);
          qs.push(tx`SELECT rt.wake(${inv.parent_id}, ${at})`);
        }
        qs.push(tx`SELECT pg_notify('rt_done', ${inv.id}), pg_notify('rt_wake', '')`);
      };
      switch (outcome.type) {
        case "done":
          if ("value" in outcome) end("done", outcome.value, null);
          else end("done", null, outcome.error);
          break;
        case "failed": {
          const failures = inv.failures + 1;
          const max = policy?.maxAttempts ?? SERVER_RETRY.maxAttempts;
          if (failures >= max) {
            if ((policy?.onMaxAttempts ?? SERVER_RETRY.onMaxAttempts) === "kill")
              end("killed", null, { message: outcome.error.message, code: 500 });
            else
              qs.push(tx`
                UPDATE rt.invocations SET status = 'paused', failures = ${failures},
                  last_failure = ${json(outcome.error)}::text::jsonb, lease_until = NULL
                WHERE id = ${inv.id}`);
          } else {
            const runAt = new Date(now + (outcome.retryAfterMs ?? retryDelay(policy, failures)));
            qs.push(tx`
              UPDATE rt.invocations SET status = 'pending', failures = ${failures}, run_at = ${runAt},
                last_failure = ${json(outcome.error)}::text::jsonb, lease_until = NULL
              WHERE id = ${inv.id}`);
          }
          break;
        }
        case "later":
          qs.push(tx`
            UPDATE rt.invocations SET status = 'pending', run_at = ${new Date(now + outcome.delayMs)},
              last_failure = ${json(outcome.error)}::text::jsonb, lease_until = NULL
            WHERE id = ${inv.id}`);
          break;
        case "paused":
          qs.push(tx`
            UPDATE rt.invocations SET status = 'paused', last_failure = ${json(outcome.error)}::text::jsonb,
              lease_until = NULL
            WHERE id = ${inv.id}`);
          break;
        case "suspended": {
          const wakeAt =
            outcome.wakeAt === null ? "infinity" : new Date(outcome.wakeAt).toISOString();
          qs.push(tx`
            UPDATE rt.invocations SET
              status = CASE WHEN wake THEN 'pending' ELSE 'suspended' END,
              run_at = CASE WHEN wake THEN ${at} ELSE ${wakeAt}::text::timestamptz END, -- text: postgres.js can't serialize 'infinity'
              lease_until = NULL
            WHERE id = ${inv.id}`);
          qs.push(tx`SELECT pg_notify('rt_wake', '')`);
          break;
        }
      }
      return qs;
    });
  } catch (e) {
    if (isFenced(e)) return; // another turn owns it now; ours never happened
    throw e;
  }
}

// ── door ─────────────────────────────────────────────────────────────────────────────────────

export interface Submit {
  service: string;
  handler: string;
  key: string | null;
  input: Uint8Array;
  headers: Record<string, string>;
  idemKey: string | null;
  runAt: Date;
  id: string;
  /** A Restate awakeable to resolve with the outcome (a proxy call waits on it). */
  reply?: string | null;
  /** A caller waits on the outcome: the Lambda lane runs it first. */
  callerWaits?: boolean;
}

/** Object state moved over from Restate. A name pg already holds keeps pg's value. */
export async function seedState(
  sql: Sql,
  service: string,
  key: string,
  entries: { name: string; value: Uint8Array }[],
) {
  if (entries.length === 0) return;
  await sql`
    INSERT INTO rt.state (service, key, name, value)
    SELECT ${service}, ${key}, e.name, decode(e.value, 'base64')
    FROM jsonb_to_recordset(${json(entries.map((e) => ({ name: e.name, value: Buffer.from(e.value).toString("base64") })))}::text::jsonb)
      AS e(name text, value text)
    ON CONFLICT DO NOTHING`;
}

/** New invocation, or the one an idempotency key already made. */
export async function submit(sql: Sql, s: Submit): Promise<{ id: string; fresh: boolean }> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO rt.invocations (id, service, handler, key, exclusive, input, headers, idem_key, run_at, reply, caller_waits)
    SELECT ${s.id}, ${s.service}, ${s.handler}, ${s.key},
      coalesce((SELECT exclusive FROM rt.handlers WHERE service = ${s.service} AND handler = ${s.handler}), ${s.key}::text IS NOT NULL),
      ${Buffer.from(s.input)}, ${json(s.headers)}::text::jsonb, ${s.idemKey}, ${s.runAt}, ${s.reply ?? null},
      ${s.callerWaits ?? false}
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (row) {
    await sql`SELECT pg_notify('rt_wake', '')`;
    return { id: row.id, fresh: true };
  }
  // same id again (a proxy's retry): the first row stands
  if (s.idemKey === null) return { id: s.id, fresh: false };
  const [old] = await sql<{ id: string }[]>`
    SELECT id FROM rt.invocations
    WHERE service = ${s.service} AND handler = ${s.handler} AND coalesce(key, '') = ${s.key ?? ""}
      AND idem_key = ${s.idemKey}`;
  if (!old) throw new Error(`rt: submit of ${s.service}/${s.handler} lost its row`);
  return { id: old.id, fresh: false };
}

export async function result(sql: Sql, id: string) {
  const [r] = await sql<{ status: string; result: Buffer | null; error: ErrorJson | null }[]>`
    SELECT status, result, error FROM rt.invocations WHERE id = ${id}`;
  return r;
}

export async function resolveAwakeable(
  sql: Sql,
  a: {
    id: string;
    invocation: string;
    seq: number;
    value: Uint8Array | null;
    error: ErrorJson | null;
  },
  now = Date.now(),
) {
  await sql`
    WITH ins AS (
      INSERT INTO rt.awakeables (id, invocation_id, seq, value, error)
      VALUES (${a.id}, ${a.invocation}, ${a.seq}, ${a.value ? Buffer.from(a.value) : null}, ${a.error ? json(a.error) : null}::text::jsonb)
      ON CONFLICT DO NOTHING RETURNING invocation_id)
    SELECT rt.wake(invocation_id, ${new Date(now)}) FROM ins`;
}

/** The newest box's pg services, for every bridge lane's `skipPg`. */
export async function setPgServices(sql: postgres.Sql, services: readonly string[], build: string) {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM rt.pg_services`;
    for (const s of services)
      await tx`INSERT INTO rt.pg_services (service, build) VALUES (${s}, ${build})`;
  });
}

/**
 * A renamed service: its open rows (unpinned: old builds don't know the new name) and its state
 * move to `to`; its handler rows go. A state key `to` already holds stays under `from`.
 * `holdMs`: no moved row is due (or its lease free) before then, so a slot running an older build
 * (one without `skipPg`) sees it was superseded before it could take one.
 */
export async function renameService(sql: postgres.Sql, from: string, to: string, holdMs = 0) {
  return sql.begin(async (tx) => {
    const rows = await tx`UPDATE rt.invocations SET service = ${to}, build = NULL,
        run_at = greatest(run_at, now() + ${holdMs} * interval '1 millisecond'),
        lease_until = CASE WHEN status = 'running'
          THEN greatest(lease_until, now() + ${holdMs} * interval '1 millisecond') ELSE lease_until END
      WHERE service = ${from} AND status NOT IN ('done', 'killed')`;
    const state = await tx`UPDATE rt.state s SET service = ${to} WHERE s.service = ${from}
      AND NOT EXISTS (SELECT 1 FROM rt.state n WHERE n.service = ${to} AND n.key = s.key AND n.name = s.name)`;
    await tx`DELETE FROM rt.handlers WHERE service = ${from}`;
    return { rows: rows.count, state: state.count };
  });
}

export async function handlers(sql: Sql) {
  return sql<
    { service: string; handler: string; object: boolean; exclusive: boolean; private: boolean }[]
  >`SELECT service, handler, object, exclusive, private FROM rt.handlers`;
}
