/**
 * The audit layer's SQL, applied by `installAudit` on every migrate. Not a
 * drizzle migration: the triggers follow the live table list, and applying it
 * each time also puts back anything dropped by hand.
 *
 * Every function sets `search_path` with `pg_temp` last: a session's temp
 * table named like a log table can never catch its writes.
 */

/**
 * Where an event sits in the chain: (era, tx). `tx` is the Postgres
 * transaction id, which only grows on one server; a restore onto another
 * server starts again lower. So each server a database has lived on gets its
 * own era, and (era, tx) only grows. `audit_era()` is this server's: the
 * newest era when it is this server's, else a new one after it.
 */
const ERA_FUNCTION = `CREATE OR REPLACE FUNCTION audit_era() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  DECLARE
    here bigint := (SELECT system_identifier FROM pg_control_system());
    newest audit_eras;
    made integer;
  BEGIN
    SELECT * INTO newest FROM audit_eras ORDER BY era DESC LIMIT 1;
    IF newest.cluster = here THEN RETURN newest.era; END IF;
    -- (cluster, follows) is unique: two first writers on a new server make one era.
    INSERT INTO audit_eras (cluster, follows) VALUES (here, coalesce(newest.era, 0))
      ON CONFLICT (cluster, follows) DO NOTHING RETURNING era INTO made;
    IF made IS NULL THEN
      SELECT era INTO made FROM audit_eras WHERE cluster = here AND follows = coalesce(newest.era, 0);
    END IF;
    RETURN made;
  END
  $fn$`;

/** Made once, when `audit_events` is missing. The typed mirror is ./schema.ts. */
export const AUDIT_TABLE_STATEMENTS = [
  `CREATE TABLE audit_eras (
    era integer CONSTRAINT pk_audit_eras PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    cluster bigint NOT NULL,
    follows integer NOT NULL,
    began_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cluster, follows)
  )`,
  ERA_FUNCTION,
  `CREATE TABLE audit_events (
    id bigint CONSTRAINT pk_audit_events PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    at timestamptz NOT NULL DEFAULT now(),
    era integer NOT NULL DEFAULT audit_era(),
    tx bigint NOT NULL DEFAULT (pg_current_xact_id())::text::bigint,
    table_name text NOT NULL,
    op text NOT NULL CHECK (op IN ('insert', 'update', 'delete', 'truncate')),
    row_key jsonb,
    old_values jsonb,
    new_values jsonb,
    db_user text NOT NULL DEFAULT SESSION_USER,
    app text NOT NULL DEFAULT current_setting('application_name'),
    actor text DEFAULT NULLIF(current_setting('wren.actor', true), '')
  )`,
  "CREATE INDEX ix_audit_events_era_tx ON audit_events (era, tx, id)",
  "CREATE INDEX ix_audit_events_table_at ON audit_events (table_name, at)",
  `CREATE TABLE audit_seals (
    id integer CONSTRAINT pk_audit_seals PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    sealed_at timestamptz NOT NULL DEFAULT now(),
    from_era integer NOT NULL,
    from_tx bigint NOT NULL,
    through_era integer NOT NULL,
    through_tx bigint NOT NULL,
    events bigint NOT NULL,
    prev_hash bytea,
    hash bytea NOT NULL
  )`,
];

/** Replaced on every migrate: the current definition always wins. */
export const AUDIT_FUNCTION_STATEMENTS = [
  ERA_FUNCTION,
  // One function for every audited table. Row trigger: TG_ARGV = the primary key's columns.
  // Statement trigger: TRUNCATE. SECURITY DEFINER: a client login cannot write the log itself.
  `CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  DECLARE
    before_row jsonb;
    after_row jsonb;
    row_key jsonb;
    old_changed jsonb;
    new_changed jsonb;
    -- auditName in ./index.ts: bare in public, schema.table elsewhere.
    tbl text := CASE WHEN TG_TABLE_SCHEMA = 'public' THEN TG_TABLE_NAME
      ELSE TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME END;
  BEGIN
    IF TG_LEVEL = 'STATEMENT' THEN
      INSERT INTO audit_events (table_name, op) VALUES (tbl, lower(TG_OP));
      RETURN NULL;
    END IF;
    IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
    IF TG_NARGS > 0 THEN
      SELECT jsonb_object_agg(c, coalesce(before_row, after_row) -> c) INTO row_key
        FROM unnest(TG_ARGV) AS c;
    END IF;
    IF TG_OP = 'INSERT' THEN
      INSERT INTO audit_events (table_name, op, row_key, new_values)
        VALUES (tbl, 'insert', row_key, CASE WHEN row_key IS NULL THEN after_row END);
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO audit_events (table_name, op, row_key, old_values)
        VALUES (tbl, 'delete', row_key, before_row);
    ELSE
      SELECT jsonb_object_agg(d.key, before_row -> d.key), jsonb_object_agg(d.key, d.value)
        INTO old_changed, new_changed
        FROM jsonb_each(after_row) AS d
        WHERE (before_row -> d.key) IS DISTINCT FROM d.value;
      IF new_changed IS NULL THEN RETURN NULL; END IF;
      -- A keyed row: what changed. A keyless one: the whole row, since nothing else names it.
      IF row_key IS NOT NULL THEN
        before_row := old_changed;
        after_row := new_changed;
      END IF;
      INSERT INTO audit_events (table_name, op, row_key, old_values, new_values)
        VALUES (tbl, 'update', row_key, before_row, after_row);
    END IF;
    RETURN NULL;
  END
  $fn$`,
  `CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
  BEGIN
    RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END
  $fn$`,
  // An event as one unambiguous line (a JSON array), hashed. Time as epoch seconds,
  // so the session's time zone never changes the line.
  `CREATE OR REPLACE FUNCTION audit_event_hash(e audit_events) RETURNS bytea
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $fn$
    SELECT sha256(convert_to(jsonb_build_array(e.era, e.tx, e.id, extract(epoch FROM e.at),
      e.table_name, e.op, e.row_key, e.old_values, e.new_values, e.db_user, e.app, e.actor)::text, 'UTF8'))
  $fn$`,
  // Seal every event of the transactions finished since the last seal: all below
  // (this server's era, the oldest transaction still running). No new event can
  // ever land below that line.
  `CREATE OR REPLACE FUNCTION audit_seal() RETURNS SETOF audit_seals
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  DECLARE
    prior audit_seals;
    era_now integer;
    horizon bigint;
    n bigint;
    h bytea;
    made audit_seals;
  BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'audit_seal() needs READ COMMITTED, not %', current_setting('transaction_isolation');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('wren audit seal'));
    era_now := audit_era();
    horizon := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;
    SELECT * INTO prior FROM audit_seals ORDER BY id DESC LIMIT 1;
    SELECT count(*), sha256(coalesce(prior.hash, ''::bytea)
        || coalesce(string_agg(audit_event_hash(e), ''::bytea ORDER BY e.era, e.tx, e.id), ''::bytea))
      INTO n, h
      FROM audit_events e
      WHERE (e.era, e.tx) >= (coalesce(prior.through_era, 0), coalesce(prior.through_tx, 0))
        AND (e.era, e.tx) < (era_now, horizon);
    IF n = 0 THEN RETURN; END IF;
    INSERT INTO audit_seals (from_era, from_tx, through_era, through_tx, events, prev_hash, hash)
      VALUES (coalesce(prior.through_era, 0), coalesce(prior.through_tx, 0), era_now, horizon, n, prior.hash, h)
      RETURNING * INTO made;
    RETURN NEXT made;
  END
  $fn$`,
  // Recompute every seal; report the first that no longer matches its events.
  `CREATE OR REPLACE FUNCTION audit_verify()
  RETURNS TABLE (seals bigint, sealed bigint, unsealed bigint, broken_seal integer, problem text, last_hash bytea)
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $fn$
  DECLARE
    s audit_seals;
    prev audit_seals;
    n bigint;
    h bytea;
  BEGIN
    seals := 0;
    sealed := 0;
    FOR s IN SELECT * FROM audit_seals ORDER BY id LOOP
      seals := seals + 1;
      IF broken_seal IS NULL THEN
        IF (s.from_era, s.from_tx) <> (coalesce(prev.through_era, 0), coalesce(prev.through_tx, 0)) THEN
          broken_seal := s.id;
          problem := format('starts at era %s tx %s, the seal before ended at era %s tx %s',
            s.from_era, s.from_tx, coalesce(prev.through_era, 0), coalesce(prev.through_tx, 0));
        ELSIF s.prev_hash IS DISTINCT FROM prev.hash THEN
          broken_seal := s.id;
          problem := 'prev_hash is not the seal before''s hash';
        ELSE
          SELECT count(*), sha256(coalesce(s.prev_hash, ''::bytea)
              || coalesce(string_agg(audit_event_hash(e), ''::bytea ORDER BY e.era, e.tx, e.id), ''::bytea))
            INTO n, h
            FROM audit_events e
            WHERE (e.era, e.tx) >= (s.from_era, s.from_tx) AND (e.era, e.tx) < (s.through_era, s.through_tx);
          IF n <> s.events THEN
            broken_seal := s.id;
            problem := format('%s events now, %s when sealed', n, s.events);
          ELSIF h <> s.hash THEN
            broken_seal := s.id;
            problem := 'an event changed after it was sealed';
          END IF;
        END IF;
      END IF;
      sealed := sealed + s.events;
      prev := s;
    END LOOP;
    last_hash := prev.hash;
    SELECT count(*) INTO unsealed FROM audit_events e
      WHERE (e.era, e.tx) >= (coalesce(prev.through_era, 0), coalesce(prev.through_tx, 0));
    RETURN NEXT;
  END
  $fn$`,
  "CREATE INDEX IF NOT EXISTS ix_audit_events_at ON audit_events (at)",
  // The Changes page (`console.change`): the last 7 days as lines a person reads. Older: `wren audit`.
  "DROP VIEW IF EXISTS audit_changes",
  `CREATE VIEW audit_changes AS
  SELECT e.id::text id, e.at,
    CASE WHEN e.actor LIKE '%@%' THEN e.actor
      WHEN e.actor LIKE 'claude%' THEN 'agent:' || e.actor
      WHEN e.actor IS NOT NULL THEN 'person:' || e.actor
      ELSE 'pipeline:' || split_part(e.app, ':', 1) END who,
    CASE WHEN e.actor IS NULL THEN 'pipeline' WHEN e.actor LIKE 'claude%' THEN 'agent'
      ELSE 'person' END made_by,
    e.app via,
    e.table_name "table",
    CASE WHEN e.table_name LIKE 'books.%'
        OR e.table_name IN ('delivery.invoices', 'delivery.agreements', 'ad_launches') THEN 'money'
      WHEN e.table_name LIKE 'delivery.%' OR e.table_name IN ('clients', 'client_members') THEN 'client'
      WHEN e.table_name = 'operators' THEN 'team'
      ELSE 'data' END area,
    e.op,
    coalesce(e.row_key ->> 'id', e.row_key::text) "row",
    CASE e.op WHEN 'update' THEN (
        -- Words, not code: "domain verified at: empty → 2026-10-07 06:45 UTC"; a JSON value says
        -- only that it changed.
        SELECT string_agg(replace(n.k, '_', ' ') || CASE
            WHEN n.v ~ '^[[{]' THEN ' updated'
            ELSE ': ' || left(coalesce(regexp_replace(e.old_values ->> n.k,
                '^(\\d{4}-\\d\\d-\\d\\d)T(\\d\\d:\\d\\d).*$', '\\1 \\2 UTC'), 'empty'), 40)
              || ' → ' || left(coalesce(regexp_replace(n.v,
                '^(\\d{4}-\\d\\d-\\d\\d)T(\\d\\d:\\d\\d).*$', '\\1 \\2 UTC'), 'empty'), 40) END,
          '; ' ORDER BY n.k)
        FROM jsonb_each_text(e.new_values) n(k, v))
      WHEN 'delete' THEN 'removed' WHEN 'truncate' THEN 'emptied' ELSE 'added' END change,
    CASE WHEN e.at >= date_trunc('day', now()) THEN 'today' ELSE 'week' END age
  FROM audit_events e
  WHERE e.at > now() - interval '7 days'`,
];

/** The guard on each log table, made when missing. */
export const AUDIT_GUARD = (table: string) =>
  `CREATE TRIGGER append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table} ` +
  "FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only()";
