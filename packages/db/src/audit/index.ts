/**
 * The audit log in every database (main and each client's): which row changed,
 * how, when, and who by. Tables typed in ./schema.ts; their SQL, the trigger
 * function, the guard, `audit_seal()` and `audit_verify()` in ./install.ts.
 * Here: which tables are audited, installing it all on every migrate, and the
 * calls the sealer and CLI make.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, Queryable } from "../index.js";
import { AUDIT_FUNCTION_STATEMENTS, AUDIT_GUARD, AUDIT_TABLE_STATEMENTS } from "./install.js";
import { type AuditEvent, auditEvents } from "./schema.js";

export * from "./schema.js";

/**
 * Tables left out, each with why: machine-made, high volume, or already a log.
 * A table outside `public` goes by its schema too (`books.bills`). Every other
 * table in an audited schema is audited, so a new table is by default.
 */
export const AUDIT_SKIPPED: Readonly<Record<string, string>> = {
  runs: "the run ledger, already a log of every stage",
  inbox_syncs: "a sync cursor, rewritten every pass",
  open_syncs: "a sync cursor, rewritten every pass",
  documents: "fetched page bodies, a cache",
  sightings: "raw crawl evidence, append-only",
  contact_candidates: "address guesses, a million writes",
  verifications: "verifier verdicts, a cache with its own times",
  discovery_attempts: "a domain probe log",
  enrichments: "derived company facts, remade by the pipeline",
  import_errors: "an import's own error log",
  company_checks: "lookup results with their own tried trail",
  person_lookups: "lookup results with their own tried trail",
  postmaster_days: "numbers pulled from Google",
  content_metrics: "numbers pulled from the platforms",
  search_days: "numbers pulled from Search Console",
  search_pages: "index states pulled from Search Console",
  search_answers: "what the answer engines said, with its own date",
  open_events: "pixel hits, append-only",
};

/** Schemas left out besides Postgres's own (`pg_*`, `information_schema`); a new schema is audited. */
export const AUDIT_SKIPPED_SCHEMAS: Readonly<Record<string, string>> = {
  drizzle: "the migration journal, already a log",
  auth: "sign-in: session tokens, password hashes and signing keys never go in a permanent log",
};

/** A table's name in the log: bare in `public`, `schema.table` elsewhere. */
export const auditName = (schema: string, table: string): string =>
  schema === "public" ? table : `${schema}.${table}`;

/** The log itself: never audited (a trigger there would log its own writes). */
export const AUDIT_TABLES = ["audit_events", "audit_seals", "audit_eras"] as const;

const ROW_TRIGGER = "audit_row";
const TRUNCATE_TRIGGER = "audit_truncate";

type TableTriggers = {
  schema: string;
  table: string;
  /** The partition tree's top table: a partition is audited or skipped with it. */
  rootSchema: string;
  root: string;
  partition: boolean;
  key: string[];
  rowArgs: Buffer | null;
  /** `pg_trigger.tgenabled`: null when missing, O or A when on. */
  rowEnabled: string | null;
  truncateEnabled: string | null;
};

/** A trigger that fires in normal sessions: O (origin) or A (always); D and R do not. */
const firing = (enabled: string | null) => enabled === "O" || enabled === "A";

/** A trigger's arguments as Postgres stores them: each one NUL-terminated. */
function triggerArgs(stored: Buffer | null): string[] | null {
  if (stored === null) return null;
  const text = stored.toString("utf8");
  return text === "" ? [] : text.slice(0, -1).split("\0");
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Install or refresh the audit layer, idempotent, run after every migrate:
 * 1. Under a lock, in one transaction: the log tables when missing, every
 *    function (the current definition wins), the guards.
 * 2. The trigger on each table, one statement at a time: each locks only its
 *    own table, briefly, so live writers wait a moment and never deadlock.
 */
export async function installAudit(db: Db): Promise<{ added: number; removed: number }> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wren audit install'))`);
    const found = await tx.execute<{ t: string | null }>(
      sql`select to_regclass('public.audit_events')::text as t`,
    );
    if (!found[0]?.t) for (const s of AUDIT_TABLE_STATEMENTS) await tx.execute(sql.raw(s));
    for (const s of AUDIT_FUNCTION_STATEMENTS) await tx.execute(sql.raw(s));
    for (const table of AUDIT_TABLES) {
      const [guard] = await tx.execute<{ enabled: string }>(
        sql`select tgenabled as enabled from pg_trigger where tgrelid = ${table}::regclass and tgname = 'append_only'`,
      );
      if (!guard) await tx.execute(sql.raw(AUDIT_GUARD(table)));
      else if (!firing(guard.enabled))
        await tx.execute(sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER append_only`));
    }
  });
  return syncAuditTriggers(db);
}

/**
 * Put the audit trigger on every table of every audited schema that is not skipped, with its
 * primary key columns as arguments, and take it off skipped ones. A trigger
 * turned off by hand is turned back on. Touches only what differs.
 * Partitions: the row trigger comes from the parent (a partition's own would log
 * each change twice); the TRUNCATE one does not, so each partition gets its own.
 */
async function syncAuditTriggers(db: Db): Promise<{ added: number; removed: number }> {
  const tables = await db.execute<TableTriggers>(sql`
    select n.nspname as "schema", c.relname as "table",
      coalesce(rn.nspname, n.nspname) as "rootSchema", coalesce(r.relname, c.relname) as "root",
      c.relispartition as "partition",
      coalesce((select array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum))
        from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = c.oid and i.indisprimary), '{}') as "key",
      (select t.tgargs from pg_trigger t where t.tgrelid = c.oid and t.tgname = ${ROW_TRIGGER}) as "rowArgs",
      (select t.tgenabled from pg_trigger t where t.tgrelid = c.oid and t.tgname = ${ROW_TRIGGER}) as "rowEnabled",
      (select t.tgenabled from pg_trigger t where t.tgrelid = c.oid and t.tgname = ${TRUNCATE_TRIGGER}) as "truncateEnabled"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_class r on r.oid = pg_partition_root(c.oid)
      left join pg_namespace rn on rn.oid = r.relnamespace
    where c.relkind in ('r', 'p') and left(n.nspname, 3) <> 'pg_' and n.nspname <> 'information_schema'
    order by n.nspname, c.relname`);
  const run = (text: string) => db.execute(sql.raw(text));
  let added = 0;
  let removed = 0;
  for (const t of tables) {
    const root = auditName(t.rootSchema, t.root);
    if ((AUDIT_TABLES as readonly string[]).includes(root)) continue;
    const table = `${quote(t.schema)}.${quote(t.table)}`;
    const on = `ON ${table}`;
    const have = triggerArgs(t.rowArgs);
    if (Object.hasOwn(AUDIT_SKIPPED, root) || Object.hasOwn(AUDIT_SKIPPED_SCHEMAS, t.schema)) {
      const row = have !== null && !t.partition;
      if (!row && t.truncateEnabled === null) continue;
      if (row) await run(`DROP TRIGGER IF EXISTS ${ROW_TRIGGER} ${on}`);
      await run(`DROP TRIGGER IF EXISTS ${TRUNCATE_TRIGGER} ${on}`);
      removed++;
      continue;
    }
    if (!t.partition && (have === null || have.join("\0") !== t.key.join("\0"))) {
      await run(
        `CREATE OR REPLACE TRIGGER ${ROW_TRIGGER} AFTER INSERT OR UPDATE OR DELETE ${on} ` +
          `FOR EACH ROW EXECUTE FUNCTION audit_row(${t.key.map(literal).join(", ")})`,
      );
      added++;
    } else if (have !== null && !firing(t.rowEnabled)) {
      await run(`ALTER TABLE ${table} ENABLE TRIGGER ${ROW_TRIGGER}`);
      added++;
    }
    if (t.truncateEnabled === null)
      await run(
        `CREATE TRIGGER ${TRUNCATE_TRIGGER} AFTER TRUNCATE ${on} ` +
          "FOR EACH STATEMENT EXECUTE FUNCTION audit_row()",
      );
    else if (!firing(t.truncateEnabled))
      await run(`ALTER TABLE ${table} ENABLE TRIGGER ${TRUNCATE_TRIGGER}`);
  }
  return { added, removed };
}

export type AuditSeal = {
  id: number;
  sealedAt: string;
  /** Where the seal starts and ends: (era, tx), see ./install.ts. */
  fromEra: number;
  fromTx: number;
  throughEra: number;
  throughTx: number;
  events: number;
  /** Hex. */
  hash: string;
};

/** How long a seal waits for another seal's lock before giving up; the next pass tries again. */
export const SEAL_LOCK_WAIT_MS = 10_000;

/**
 * Seal every event of the transactions finished since the last seal. Null when
 * there were none (no empty seals). Any login may call it. Its own transaction,
 * READ COMMITTED and writable whatever the login's defaults, waiting at most
 * `lockWaitMs` for a seal already running.
 */
export async function sealAudit(
  db: Db,
  opts: { lockWaitMs?: number } = {},
): Promise<AuditSeal | null> {
  return db.transaction(
    async (tx) => {
      const wait = String(opts.lockWaitMs ?? SEAL_LOCK_WAIT_MS);
      await tx.execute(sql`select set_config('lock_timeout', ${wait}, true)`);
      const rows = await tx.execute<AuditSeal>(sql`
        select id, sealed_at::text as "sealedAt", from_era as "fromEra", from_tx::float8 as "fromTx",
          through_era as "throughEra", through_tx::float8 as "throughTx", events::float8 as "events",
          encode(hash, 'hex') as "hash"
        from audit_seal()`);
      return rows[0] ?? null;
    },
    { isolationLevel: "read committed", accessMode: "read write" },
  );
}

export interface AuditCheck {
  seals: number;
  /** Events covered by seals. */
  sealed: number;
  /** Events not sealed yet (newer than the last seal). */
  unsealed: number;
  /** The first seal that no longer matches its events, and why; null when all match. */
  broken: { seal: number; problem: string } | null;
  /** The newest seal's hash (hex), to compare with the copy in the worker log. */
  lastHash: string | null;
}

/** Recompute every seal from its events. */
export async function verifyAudit(db: Queryable): Promise<AuditCheck> {
  const rows = await db.execute<{
    seals: number;
    sealed: number;
    unsealed: number;
    brokenSeal: number | null;
    problem: string | null;
    lastHash: string | null;
  }>(sql`
    select seals::float8 as "seals", sealed::float8 as "sealed", unsealed::float8 as "unsealed",
      broken_seal as "brokenSeal", problem, encode(last_hash, 'hex') as "lastHash"
    from audit_verify()`);
  const r = rows[0];
  if (!r) throw new Error("audit_verify() returned nothing");
  return {
    seals: r.seals,
    sealed: r.sealed,
    unsealed: r.unsealed,
    broken: r.brokenSeal === null ? null : { seal: r.brokenSeal, problem: r.problem ?? "" },
    lastHash: r.lastHash,
  };
}

/**
 * Set who is acting for the rest of this transaction (`audit_events.actor`).
 * Call first inside `db.transaction(...)`; outside one it lasts one statement.
 */
export async function setAuditActor(tx: Queryable, actor: string): Promise<void> {
  await tx.execute(sql`select set_config('wren.actor', ${actor}, true)`);
}

/** The newest events, newest first; `table` narrows to one table. */
export async function recentAuditEvents(
  db: Queryable,
  opts: { table?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  return db
    .select()
    .from(auditEvents)
    .where(and(opts.table ? eq(auditEvents.tableName, opts.table) : undefined))
    .orderBy(desc(auditEvents.id))
    .limit(opts.limit ?? 20);
}

/**
 * One event as a line: when, what, which row, who, and which columns. Values
 * only when asked: a row can hold personal data.
 */
export function formatAuditEvent(e: AuditEvent, values = false): string {
  const who = [e.dbUser, e.app, e.actor].filter(Boolean).join(" / ");
  const key = e.rowKey ? ` ${JSON.stringify(e.rowKey)}` : "";
  const head = `#${e.id} ${e.at.toISOString()} ${e.op} ${e.tableName}${key} by ${who}`;
  if (values) {
    const parts = [
      e.oldValues ? `old ${JSON.stringify(e.oldValues)}` : "",
      e.newValues ? `new ${JSON.stringify(e.newValues)}` : "",
    ].filter(Boolean);
    return parts.length ? `${head} ${parts.join(" ")}` : head;
  }
  // An update's changed columns; an insert or delete is the whole row, named by its key.
  const columns = e.op === "update" ? Object.keys(e.newValues ?? {}) : [];
  return columns.length ? `${head} [${columns.join(", ")}]` : head;
}
