/**
 * Schema `rt` (designs/2026-11-09-own-runtime.md): queue, journal, object state, awakeables, cache.
 * Own migrations table; `migrate()` is idempotent and safe to run from every process at start.
 */
import type postgres from "postgres";

const V1 = `
CREATE TABLE rt.invocations (
  id text PRIMARY KEY,
  service text NOT NULL,
  handler text NOT NULL,
  key text,
  exclusive boolean NOT NULL DEFAULT false,
  holds boolean NOT NULL DEFAULT false,
  input bytea NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'suspended', 'done', 'paused', 'killed')),
  run_at timestamptz NOT NULL DEFAULT now(),
  wake boolean NOT NULL DEFAULT false,
  attempt int NOT NULL DEFAULT 0,
  failures int NOT NULL DEFAULT 0,
  lease_until timestamptz,
  cancel boolean NOT NULL DEFAULT false,
  build text,
  idem_key text,
  parent_id text,
  parent_seq int,
  result bytea,
  error jsonb,
  last_failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX invocations_idem ON rt.invocations (service, handler, coalesce(key, ''), idem_key)
  WHERE idem_key IS NOT NULL;
CREATE UNIQUE INDEX invocations_holder ON rt.invocations (service, key) WHERE holds;
CREATE INDEX invocations_due ON rt.invocations (run_at) WHERE status IN ('pending', 'suspended');
CREATE INDEX invocations_lease ON rt.invocations (lease_until) WHERE status = 'running';
CREATE INDEX invocations_key_queue ON rt.invocations (service, key, created_at)
  WHERE exclusive AND status = 'pending' AND NOT holds;
CREATE INDEX invocations_parent ON rt.invocations (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX invocations_open ON rt.invocations (status) WHERE status IN ('paused', 'killed');

CREATE TABLE rt.journal (
  invocation_id text NOT NULL REFERENCES rt.invocations (id) ON DELETE CASCADE,
  seq int NOT NULL,
  kind text NOT NULL,
  name text NOT NULL DEFAULT '',
  done boolean NOT NULL DEFAULT false,
  value bytea,
  error jsonb,
  wake_at timestamptz,
  ref text,
  tries int NOT NULL DEFAULT 0,
  first_at timestamptz,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invocation_id, seq)
);

CREATE TABLE rt.state (
  service text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  value bytea NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, key, name)
);

CREATE TABLE rt.awakeables (
  id text PRIMARY KEY,
  invocation_id text NOT NULL,
  seq int NOT NULL,
  value bytea,
  error jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX awakeables_invocation ON rt.awakeables (invocation_id);

CREATE UNLOGGED TABLE rt.cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);

-- what each handler is, written by every process that serves it (exclusive decides key locking)
CREATE TABLE rt.handlers (
  service text NOT NULL,
  handler text NOT NULL,
  object boolean NOT NULL,
  exclusive boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, handler)
);

-- a child finished, an awakeable resolved, a cancel came: run the invocation again now
CREATE FUNCTION rt.wake(p_id text, p_now timestamptz) RETURNS void
LANGUAGE sql AS $$
  UPDATE rt.invocations SET wake = true,
    status = CASE WHEN status = 'suspended' THEN 'pending' ELSE status END,
    run_at = CASE WHEN status = 'suspended' THEN p_now ELSE run_at END
  WHERE id = p_id AND status IN ('pending', 'running', 'suspended');
  SELECT pg_notify('rt_wake', '');
$$;

CREATE FUNCTION rt.cancel(p_id text, p_now timestamptz) RETURNS void
LANGUAGE sql AS $$
  UPDATE rt.invocations SET cancel = true WHERE id = p_id AND status NOT IN ('done', 'killed');
  SELECT rt.wake(p_id, p_now);
$$;

-- every write of a turn starts here: renews the lease, or aborts the transaction if the turn lost it
CREATE FUNCTION rt.fence(p_id text, p_attempt int, p_lease_ms int) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE rt.invocations SET lease_until = now() + make_interval(secs => p_lease_ms / 1000.0)
    WHERE id = p_id AND attempt = p_attempt AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rt fenced: % attempt %', p_id, p_attempt USING ERRCODE = 'RT001';
  END IF;
END $$;
`;

/** Phase 3: Restate proxies wait on a Restate awakeable (`reply`); bridge rows keep Restate's id. */
const V2 = `
ALTER TABLE rt.invocations ADD COLUMN reply text, ADD COLUMN replied_at timestamptz, ADD COLUMN remote text;
CREATE INDEX invocations_unreplied ON rt.invocations (completed_at)
  WHERE reply IS NOT NULL AND replied_at IS NULL AND status IN ('done', 'killed');
`;

const MIGRATIONS: readonly string[] = [V1, V2];

/** Bring schema `rt` up to date. One advisory lock, so parallel starts take turns. */
export async function migrate(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('rt.migrate'))`;
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS rt;
      CREATE TABLE IF NOT EXISTS rt.migrations (version int PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())`);
    const [row] = await tx<{ v: number | null }[]>`SELECT max(version) AS v FROM rt.migrations`;
    for (let v = (row?.v ?? 0) + 1; v <= MIGRATIONS.length; v++) {
      await tx.unsafe(MIGRATIONS[v - 1] as string);
      await tx`INSERT INTO rt.migrations (version) VALUES (${v})`;
    }
  });
}

/** Postgres error code `rt.fence` raises. */
export const FENCED = "RT001";
