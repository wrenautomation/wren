/**
 * The lake (designs/2026-10-11-lake.md): every table of Wren's database and each client's as a
 * DuckLake table (Parquet under `WREN_LAKE_PATH`, catalog in the `wren_lake` Postgres database),
 * and the warehouse's models (`lake/models/*.sql`) built over them. DuckDB does the work in this
 * process, so a sync runs wherever the CLI does: nightly in CI, or here.
 *
 * A sync moves only what changed. Postgres hashes each row (md5 of its text); DuckDB diffs the
 * hashes against the lake's `_h` by primary key (a table without one keys on the hash), fetches
 * only new and changed rows, and drops gone ones, one DuckLake snapshot per changed table. Every
 * earlier snapshot stays readable (`wren lake sql --at`); nothing is ever expired. First, though,
 * a table's fingerprint (rows and summed row hashes, one cheap read) is checked against the last
 * sync's (`meta.fingerprints`): an unchanged table costs that one query.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

/** Columns never copied: plaintext secrets and capability tokens. Hashes of them are fine. */
export const SECRET_COLUMN = /(^|_)(secret|password|token)$/i;
/** Postgres schemas never copied: migration bookkeeping. */
const SKIP_SCHEMAS = new Set(["drizzle", "information_schema"]);
/** Keys per fetch; past one fetch and this share of the table, one full read beats many fetches. */
const CHUNK = 5000;
const FULL_SHARE = 0.5;
/** Types DuckDB reads as themselves; anything else (tsvector, enums, ranges) arrives as text. */
const NATIVE =
  /^(integer|bigint|smallint|boolean|text|character varying|character|uuid|date|timestamp|time|double precision|real|numeric|jsonb|json|bytea|interval|oid)\b/;

export const qi = (s: string) => `"${s.replaceAll('"', '""')}"`;
export const ql = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** A Postgres array literal of text values, each quoted. */
export function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}

export type PgColumn = { name: string; type: string };
export type PgTable = { schema: string; name: string; columns: PgColumn[]; pk: string[] | null };

/** The lake schema for one Postgres schema of one database: `wren`, `wren_books`, `client_acme`. */
export function lakeSchema(owner: string | null, pgSchema: string): string {
  const base = owner === null ? "wren" : `client_${owner}`;
  return (pgSchema === "public" ? base : `${base}_${pgSchema}`).replace(/[^a-z0-9_]/gi, "_");
}

/** The select list a table is copied with: secrets left out, odd types as text, then the hash. */
export function selectList(t: PgTable): string {
  const cols = t.columns
    .filter((c) => !SECRET_COLUMN.test(c.name) && c.name !== "_h")
    .map((c) => {
      const base = c.type.replace(/\[\]$/, "");
      return NATIVE.test(base) ? `_r.${qi(c.name)}` : `_r.${qi(c.name)}::text AS ${qi(c.name)}`;
    });
  return [...cols, "md5(_r::text) AS _h"].join(", ");
}

/** The Postgres filter for rows whose keys are `values` (one array per key column, as text). */
export function keyFilter(t: PgTable, values: readonly (readonly string[])[]): string {
  if (!t.pk) return `md5(_r::text) = ANY(${ql(pgArray(values[0] ?? []))}::text[])`;
  const typeOf = (k: string) => t.columns.find((c) => c.name === k)?.type ?? "text";
  const arrays = t.pk.map((k, i) => `${ql(pgArray(values[i] ?? []))}::${typeOf(k)}[]`);
  if (t.pk.length === 1) return `_r.${qi(t.pk[0] as string)} = ANY(${arrays[0]})`;
  return `(${t.pk.map((k) => `_r.${qi(k)}`).join(", ")}) IN (SELECT * FROM unnest(${arrays.join(", ")}))`;
}

type Row = Record<string, unknown>;
const rows = async (c: DuckDBConnection, sql: string): Promise<Row[]> =>
  (await c.runAndReadAll(sql)).getRowObjectsJson() as Row[];
const one = async (c: DuckDBConnection, sql: string) =>
  Number(Object.values((await rows(c, sql))[0] ?? {})[0] ?? 0);
const pgQuery = (alias: string, sql: string) => `postgres_query(${ql(alias)}, ${ql(sql)})`;

export type LakeOptions = {
  /** `s3://bucket/` or a local directory. */
  dataPath: string;
  /** The catalog: a Postgres URL, or a local `.ducklake` file. */
  catalogUrl: string;
  readOnly?: boolean;
  /** Read the lake as it was: an ISO time, or a snapshot number. */
  at?: string;
};

export type Lake = { c: DuckDBConnection; close(): void };

/** S3 credentials for DuckDB: the environment's, else the AWS CLI's current login. */
function s3Secret(): string {
  let id = process.env.AWS_ACCESS_KEY_ID;
  let key = process.env.AWS_SECRET_ACCESS_KEY;
  let session = process.env.AWS_SESSION_TOKEN;
  if (!id || !key) {
    const out = execFileSync("aws", ["configure", "export-credentials", "--format", "process"], {
      encoding: "utf8",
    });
    const j = JSON.parse(out) as {
      AccessKeyId: string;
      SecretAccessKey: string;
      SessionToken?: string;
    };
    id = j.AccessKeyId;
    key = j.SecretAccessKey;
    session = j.SessionToken;
  }
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  return `CREATE OR REPLACE SECRET lake_s3 (TYPE s3, KEY_ID ${ql(id)}, SECRET ${ql(key)}${session ? `, SESSION_TOKEN ${ql(session)}` : ""}, REGION ${ql(region)})`;
}

/** DuckDB with the lake attached as `lake`. */
export async function openLake(o: LakeOptions): Promise<Lake> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const inst: DuckDBInstance = await DuckDBInstance.create(":memory:");
  const c = await inst.connect();
  await c.run("SET TimeZone = 'UTC'");
  await c.run("INSTALL ducklake; LOAD ducklake; INSTALL postgres; LOAD postgres");
  if (o.dataPath.startsWith("s3://")) {
    await c.run("INSTALL httpfs; LOAD httpfs");
    await c.run(s3Secret());
  }
  const opts = [`DATA_PATH ${ql(o.dataPath)}`];
  if (o.readOnly) opts.push("READ_ONLY");
  if (o.at)
    opts.push(/^\d+$/.test(o.at) ? `SNAPSHOT_VERSION ${o.at}` : `SNAPSHOT_TIME ${ql(o.at)}`);
  const catalog = /^postgres(ql)?:\/\//.test(o.catalogUrl)
    ? `ducklake:postgres:${o.catalogUrl}`
    : `ducklake:${o.catalogUrl}`;
  await c.run(`ATTACH ${ql(catalog)} AS lake (${opts.join(", ")})`);
  return {
    c,
    close() {
      c.closeSync();
      inst.closeSync();
    },
  };
}

/** Every table in a database, with its columns and primary key. */
async function pgTables(c: DuckDBConnection, alias: string): Promise<PgTable[]> {
  const sql = `select n.nspname as schema, c.relname as name,
      (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)::text as columns,
      (select json_agg(a.attname order by array_position(i.indkey::int2[], a.attnum))
         from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = c.oid and i.indisprimary)::text as pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition and n.nspname not like 'pg\\_%'
    order by 1, 2`;
  return (await rows(c, `FROM ${pgQuery(alias, sql)}`))
    .filter((r) => !SKIP_SCHEMAS.has(String(r.schema)))
    .map((r) => ({
      schema: String(r.schema),
      name: String(r.name),
      columns: JSON.parse(String(r.columns)) as PgColumn[],
      pk: r.pk ? (JSON.parse(String(r.pk)) as string[]) : null,
    }));
}

export type TableResult = {
  table: string;
  result: "created" | "changed" | "unchanged" | "failed";
  rows: number;
  upserted: number;
  removed: number;
  error?: string;
};

/** Rows and the sum of 60 bits of each row's md5: equal means unchanged, with no sort. */
const fingerprintSql = (from: string) =>
  `SELECT count(*)::text || ':' || coalesce(sum(('x' || substr(md5(_r::text), 1, 15))::bit(60)::bigint), 0)::text AS fp ${from}`;

/**
 * One table into the lake: create it, or apply what changed since the last sync. `known` is the
 * fingerprint the last sync left; the result carries this one's.
 */
async function syncTable(
  c: DuckDBConnection,
  alias: string,
  schema: string,
  t: PgTable,
  known: string | undefined,
  exists: boolean,
): Promise<TableResult & { fp: string }> {
  const target = `lake.${qi(schema)}.${qi(t.name)}`;
  const from = `FROM ${qi(t.schema)}.${qi(t.name)} _r`;
  const [print] = await rows(c, `FROM ${pgQuery(alias, fingerprintSql(from))}`);
  const fp = String(print?.fp);
  const all = pgQuery(alias, `SELECT ${selectList(t)} ${from}`);
  const res: TableResult & { fp: string } = {
    table: `${schema}.${t.name}`,
    result: "unchanged",
    rows: Number(fp.split(":")[0]),
    upserted: 0,
    removed: 0,
    fp,
  };
  if (exists && known === fp) return res;
  if (!exists) {
    await c.run(`BEGIN`);
    await c.run(`CREATE TABLE ${target} AS FROM ${all}`);
    await c.run(`CALL lake.set_commit_message('wren lake sync', ${ql(`create ${res.table}`)})`);
    await c.run(`COMMIT`);
    res.rows = res.upserted = await one(c, `SELECT count(*) FROM ${target}`);
    res.result = "created";
    return res;
  }

  const keys = t.pk ?? ["_h"];
  const keyList = keys.map(qi).join(", ");
  const match = [...new Set([...keys, "_h"])].map(qi).join(", ");
  const hashes = t.pk
    ? `${t.pk.map((k) => `_r.${qi(k)}`).join(", ")}, md5(_r::text) AS _h`
    : "md5(_r::text) AS _h";
  await c.run(
    `CREATE OR REPLACE TEMP TABLE cur AS FROM ${pgQuery(alias, `SELECT ${hashes} ${from}`)}`,
  );
  await c.run(
    `CREATE OR REPLACE TEMP TABLE todo AS SELECT ${keyList} FROM cur ANTI JOIN ${target} USING (${match})`,
  );
  await c.run(
    `CREATE OR REPLACE TEMP TABLE gone AS SELECT ${keyList} FROM (SELECT ${keyList} FROM ${target}) ANTI JOIN cur USING (${keyList})`,
  );
  const total = await one(c, "SELECT count(*) FROM cur");
  const todo = await one(c, "SELECT count(*) FROM todo");
  const gone = await one(c, "SELECT count(*) FROM gone");
  res.rows = total;
  if (todo === 0 && gone === 0) return res;

  await evolve(c, target, pgQuery(alias, `SELECT ${selectList(t)} ${from} LIMIT 0`));
  const full = todo > CHUNK && todo > total * FULL_SHARE;
  await c.run("BEGIN");
  if (full) {
    await c.run(`DELETE FROM ${target}`);
    await c.run(`INSERT INTO ${target} BY NAME FROM ${all}`);
  } else {
    const on = keys.map((k) => `${target}.${qi(k)} = k.${qi(k)}`).join(" AND ");
    await c.run(`DELETE FROM ${target} USING (FROM todo UNION ALL FROM gone) k WHERE ${on}`);
    const casts = keys.map((k) => `CAST(${qi(k)} AS VARCHAR) AS ${qi(k)}`).join(", ");
    const keyed = await rows(c, `SELECT ${casts} FROM todo`);
    for (let i = 0; i < keyed.length; i += CHUNK) {
      const part = keyed.slice(i, i + CHUNK);
      const values = keys.map((k) => part.map((r) => String(r[k])));
      const q = `SELECT ${selectList(t)} ${from} WHERE ${keyFilter(t, values)}`;
      await c.run(`INSERT INTO ${target} BY NAME FROM ${pgQuery(alias, q)}`);
    }
  }
  await c.run(
    `CALL lake.set_commit_message('wren lake sync', ${ql(`${full ? "reload" : "apply"} ${res.table}`)})`,
  );
  await c.run("COMMIT");
  res.result = "changed";
  res.upserted = full ? total : todo;
  res.removed = full ? 0 : gone;
  return res;
}

/** New columns in Postgres become new lake columns; a changed type is widened or refused. */
async function evolve(c: DuckDBConnection, target: string, probe: string) {
  const want = await rows(c, `DESCRIBE FROM ${probe}`);
  const have = new Map(
    (await rows(c, `DESCRIBE ${target}`)).map((r) => [
      String(r.column_name),
      String(r.column_type),
    ]),
  );
  for (const col of want) {
    const name = String(col.column_name);
    const type = String(col.column_type);
    const now = have.get(name);
    if (now === undefined) await c.run(`ALTER TABLE ${target} ADD COLUMN ${qi(name)} ${type}`);
    else if (now !== type)
      await c.run(`ALTER TABLE ${target} ALTER COLUMN ${qi(name)} SET DATA TYPE ${type}`);
  }
}

export type DatabaseSync = { owner: string | null; tables: TableResult[]; ms: number };

/** Every table of one database into the lake. A table that fails is reported; the rest go on. */
export async function syncDatabase(
  lake: Lake,
  databaseUrl: string,
  owner: string | null,
  only?: (t: PgTable) => boolean,
): Promise<DatabaseSync> {
  const { c } = lake;
  const started = Date.now();
  const alias = "pg";
  await c.run(`ATTACH ${ql(databaseUrl)} AS ${alias} (TYPE postgres, READ_ONLY)`);
  try {
    const tables = (await pgTables(c, alias)).filter((t) => !only || only(t));
    const out: TableResult[] = [];
    for (const schema of new Set(tables.map((t) => lakeSchema(owner, t.schema))))
      await c.run(`CREATE SCHEMA IF NOT EXISTS lake.${qi(schema)}`);
    await c.run("CREATE SCHEMA IF NOT EXISTS lake.meta");
    await c.run(
      "CREATE TABLE IF NOT EXISTS lake.meta.fingerprints (lake_table VARCHAR, fp VARCHAR)",
    );
    const fps = new Map(
      (await rows(c, "SELECT lake_table, fp FROM lake.meta.fingerprints")).map((r) => [
        String(r.lake_table),
        String(r.fp),
      ]),
    );
    const have = new Set(
      (
        await rows(
          c,
          "SELECT schema_name || '.' || table_name AS t FROM duckdb_tables() WHERE database_name = 'lake'",
        )
      ).map((r) => String(r.t)),
    );
    const moved = new Map<string, string>();
    for (const t of tables) {
      const schema = lakeSchema(owner, t.schema);
      const name = `${schema}.${t.name}`;
      try {
        const { fp, ...r } = await syncTable(c, alias, schema, t, fps.get(name), have.has(name));
        if (fp !== fps.get(name)) moved.set(name, fp);
        out.push(r);
      } catch (err) {
        await c.run("ROLLBACK").catch(() => {});
        out.push({
          table: `${schema}.${t.name}`,
          result: "failed",
          rows: 0,
          upserted: 0,
          removed: 0,
          error: err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err),
        });
      }
    }
    await saveFingerprints(c, moved);
    return { owner, tables: out, ms: Date.now() - started };
  } finally {
    await c.run(`DETACH ${alias}`);
  }
}

/** New fingerprints, in one snapshot. A failed table keeps its old one, so it's diffed again. */
async function saveFingerprints(c: DuckDBConnection, moved: Map<string, string>) {
  if (!moved.size) return;
  const names = [...moved.keys()].map(ql).join(", ");
  const values = [...moved].map(([t, fp]) => `(${ql(t)}, ${ql(fp)})`).join(", ");
  await c.run("BEGIN");
  await c.run(`DELETE FROM lake.meta.fingerprints WHERE lake_table IN (${names})`);
  await c.run(`INSERT INTO lake.meta.fingerprints VALUES ${values}`);
  await c.run("CALL lake.set_commit_message('wren lake sync', 'fingerprints')");
  await c.run("COMMIT");
}

/** Fold small files the nightly diffs leave behind. Snapshots are kept: time travel still works. */
export async function compact(lake: Lake) {
  await lake.c.run("CALL ducklake_merge_adjacent_files('lake')");
}

/** The warehouse: each `*.sql` in `dir`, in name order, one transaction each, with `USE lake`. */
export async function buildModels(
  lake: Lake,
  dir: string,
): Promise<{ model: string; ms: number }[]> {
  const { c } = lake;
  await c.run("CREATE SCHEMA IF NOT EXISTS lake.warehouse");
  await c.run("USE lake");
  const out: { model: string; ms: number }[] = [];
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const started = Date.now();
    await c.run("BEGIN");
    try {
      await c.run(readFileSync(join(dir, f), "utf8"));
      await c.run(`CALL lake.set_commit_message('wren lake build', ${ql(f)})`);
      await c.run("COMMIT");
    } catch (err) {
      await c.run("ROLLBACK").catch(() => {});
      throw new Error(`model ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
    out.push({ model: f.replace(/\.sql$/, ""), ms: Date.now() - started });
  }
  return out;
}

/** Any query over the lake, `USE lake` first so `wren.runs` names a table. */
export async function query(lake: Lake, sql: string): Promise<Row[]> {
  await lake.c.run("USE lake");
  return rows(lake.c, sql);
}

/** Each lake table's files and bytes, and the newest snapshot. */
export async function status(lake: Lake) {
  const tables = await rows(
    lake.c,
    `SELECT s.schema_name AS schema, i.table_name AS table, i.file_count AS files, i.file_size_bytes AS bytes
     FROM ducklake_table_info('lake') i
     JOIN __ducklake_metadata_lake.ducklake_schema s ON s.schema_id = i.schema_id AND s.end_snapshot IS NULL
     ORDER BY bytes DESC`,
  );
  const [last] = await rows(
    lake.c,
    "SELECT snapshot_id, snapshot_time, commit_message FROM lake.snapshots() ORDER BY snapshot_id DESC LIMIT 1",
  );
  return { tables, last: last ?? null };
}
