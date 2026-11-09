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
}

/** Register a process's handlers: their kind decides key locking at submit time. */
export async function register(sql: Sql, registry: Registry) {
  const defs = registry.list().map((h) => ({
    service: h.service,
    handler: h.name,
    object: h.object,
    exclusive: h.exclusive,
  }));
  if (!defs.length) return;
  await sql`
    INSERT INTO rt.handlers (service, handler, object, exclusive)
    SELECT x.service, x.handler, x.object, x.exclusive
    FROM jsonb_to_recordset(${json(defs)}::text::jsonb) AS x(service text, handler text, object boolean, exclusive boolean)
    ON CONFLICT (service, handler) DO UPDATE SET object = excluded.object, exclusive = excluded.exclusive, at = now()`;
}

/** Claim up to `n` due invocations. FIFO per object key for exclusive handlers; one holder per key. */
export async function claim(sql: Sql, n: number, leaseMs: number, now: number): Promise<Claim[]> {
  const at = new Date(now);
  return sql<Claim[]>`
    WITH c AS (
      SELECT i.id FROM rt.invocations i
      WHERE ((i.status IN ('pending', 'suspended') AND i.run_at <= ${at})
             OR (i.status = 'running' AND i.lease_until < now()))
        AND (NOT i.exclusive OR i.holds OR (
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
      status = 'running', attempt = i.attempt + 1, wake = false, holds = i.exclusive,
      lease_until = now() + make_interval(secs => ${leaseMs / 1000}),
      started_at = coalesce(i.started_at, now())
    FROM c WHERE i.id = c.id
    RETURNING i.id, i.attempt, i.service, i.handler`;
}

/** Soonest time anything becomes claimable, for the dispatcher's sleep. */
export async function nextDue(sql: Sql): Promise<Date | null> {
  const [r] = await sql<{ at: Date | null }[]>`
    SELECT least(
      (SELECT min(run_at) FROM rt.invocations
        WHERE status IN ('pending', 'suspended') AND run_at < 'infinity'), -- infinity parses to Invalid Date
      (SELECT min(lease_until) FROM rt.invocations WHERE status = 'running')) AS at`;
  return r?.at ?? null;
}

export async function load(sql: Sql, id: string, attempt: number): Promise<Loaded | undefined> {
  const [inv] = await sql<(Invocation & { input: Buffer })[]>`
    SELECT id, service, handler, key, input, headers, attempt, failures, cancel, parent_id, parent_seq
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
      INSERT INTO rt.invocations (id, service, handler, key, exclusive, input, headers, parent_id, parent_seq, run_at, idem_key)
      SELECT x.id, x.service, x.handler, x.key, coalesce(h.exclusive, x.key IS NOT NULL),
        decode(x.input, 'base64'), coalesce(x.headers, '{}'), x.parent_id, x.parent_seq, x.run_at, x.idem_key
      FROM jsonb_to_recordset(${json(rows)}::text::jsonb) AS x(id text, service text, handler text, key text,
        input text, headers jsonb, parent_id text, parent_seq int, run_at timestamptz, idem_key text)
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
      tx`SELECT rt.fence(${inv.id}, ${inv.attempt}, ${leaseMs})`,
      ...writes(tx, inv, w, new Date()),
    ]);
  } catch (e) {
    if (isFenced(e)) throw Object.assign(e as Error, { fenced: true });
    throw e;
  }
}

/** Restate's default (deploy/scripts/box-restate.sh): 500 ms × 2 up to 1 min, 70 tries, then pause. */
export const SERVER_RETRY: {
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
}

/** New invocation, or the one an idempotency key already made. */
export async function submit(sql: Sql, s: Submit): Promise<{ id: string; fresh: boolean }> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO rt.invocations (id, service, handler, key, exclusive, input, headers, idem_key, run_at)
    SELECT ${s.id}, ${s.service}, ${s.handler}, ${s.key},
      coalesce((SELECT exclusive FROM rt.handlers WHERE service = ${s.service} AND handler = ${s.handler}), ${s.key}::text IS NOT NULL),
      ${Buffer.from(s.input)}, ${json(s.headers)}::text::jsonb, ${s.idemKey}, ${s.runAt}
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (row) {
    await sql`SELECT pg_notify('rt_wake', '')`;
    return { id: row.id, fresh: true };
  }
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

export async function handlers(sql: Sql) {
  return sql<{ service: string; handler: string; object: boolean; exclusive: boolean }[]>`
    SELECT service, handler, object, exclusive FROM rt.handlers`;
}
