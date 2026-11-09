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

/**
 * Phase 3: views shaped like Restate's admin SQL tables, so the watchdog, the dead-letter queue
 * and the console read pg loops with the same queries. Timestamps as ISO text, as Restate sends.
 */
const V3 = `
-- when the status last changed: Restate's modified_at (the watchdog's "stuck since", a letter's paused at)
ALTER TABLE rt.invocations ADD COLUMN moved_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION rt.moved() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.moved_at := now(); RETURN NEW; END $$;
CREATE TRIGGER invocations_moved BEFORE UPDATE OF status ON rt.invocations
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION rt.moved();

CREATE SCHEMA rt_admin;
CREATE FUNCTION rt_admin.iso(t timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
CREATE FUNCTION rt_admin.failure(e jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN e IS NULL THEN NULL
  ELSE '[' || coalesce(e->>'code', '500') || '] ' || coalesce(e->>'message', '') END $$;
CREATE FUNCTION rt_admin.target(service text, key text, handler text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT service || coalesce('/' || key, '') || '/' || handler $$;

CREATE VIEW rt_admin.sys_invocation AS
SELECT i.id,
  rt_admin.target(i.service, i.key, i.handler) AS target,
  i.service AS target_service_name, i.key AS target_service_key, i.handler AS target_handler_name,
  CASE
    WHEN i.status IN ('done', 'killed') THEN 'completed'
    WHEN i.status <> 'pending' THEN i.status
    WHEN i.run_at > now() AND NOT i.wake THEN 'scheduled'
    WHEN i.exclusive AND NOT i.holds AND EXISTS (
      SELECT 1 FROM rt.invocations h WHERE h.holds AND h.service = i.service AND h.key = i.key)
      THEN 'pending'
    WHEN i.failures > 0 THEN 'backing-off'
    ELSE 'ready'
  END AS status,
  CASE WHEN i.parent_id IS NULL THEN 'ingress' ELSE 'service' END AS invoked_by,
  i.parent_id AS invoked_by_id,
  rt_admin.target(p.service, p.key, p.handler) AS invoked_by_target,
  rt_admin.failure(i.last_failure) AS last_failure,
  CASE WHEN i.status = 'killed' THEN 'killed' WHEN i.status = 'done' THEN
    CASE WHEN i.error IS NULL THEN 'success' ELSE 'failure' END END AS completion_result,
  rt_admin.failure(i.error) AS completion_failure,
  i.attempt AS retry_count,
  i.build AS pinned_deployment_id,
  rt_admin.iso(i.created_at) AS created_at,
  rt_admin.iso(i.moved_at) AS modified_at,
  CASE WHEN i.status = 'pending' AND i.run_at > i.created_at THEN rt_admin.iso(i.run_at) END AS scheduled_at,
  CASE WHEN i.status = 'pending' AND i.run_at > i.created_at THEN rt_admin.iso(i.run_at) END AS scheduled_start_at,
  rt_admin.iso(i.completed_at) AS completed_at
FROM rt.invocations i LEFT JOIN rt.invocations p ON p.id = i.parent_id;

CREATE VIEW rt_admin.state AS
SELECT service AS service_name, key AS service_key, name AS key,
  convert_from(value, 'UTF8') AS value_utf8, value
FROM rt.state;

CREATE VIEW rt_admin.sys_service AS
SELECT DISTINCT service AS name, bool_or(object) OVER (PARTITION BY service) AS object FROM rt.handlers;

CREATE VIEW rt_admin.sys_journal AS
SELECT invocation_id AS id, seq AS index, kind AS entry_type, name,
  CASE WHEN error IS NOT NULL THEN '{"Failure":{"code":' || coalesce(error->>'code', '500')
    || ',"message":' || to_json(coalesce(error->>'message', ''))::text || '}}' END AS entry_json,
  done AS completed, rt_admin.iso(at) AS appended_at
FROM rt.journal;

-- a paused row's last failure as Restate's Paused event
CREATE VIEW rt_admin.sys_journal_events AS
SELECT id, 'Paused' AS event_type, rt_admin.iso(moved_at) AS appended_at,
  json_build_object('last_failure', json_build_object(
    'error_code', coalesce((last_failure->>'code')::int, 500),
    'error_message', last_failure->>'message'))::text AS event_json
FROM rt.invocations WHERE status = 'paused' AND last_failure IS NOT NULL;
`;

const V4 = `
-- the services the newest box runs on pg; every bridge lane skips them, so a slot that has not
-- yet seen it was superseded never sends a newly moved or renamed service back to Restate
CREATE TABLE rt.pg_services (
  service text PRIMARY KEY,
  build text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
`;

const V5 = `
-- the door refuses a handler marked ingressPrivate, as Restate's ingress does
ALTER TABLE rt.handlers ADD COLUMN private boolean NOT NULL DEFAULT false;
`;

const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5];

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
