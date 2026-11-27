/**
 * autotrack's bucket in the lake (designs/2026-10-11-lake.md, "autotrack"). A model whose first
 * line says `-- needs: track` is built only when `WREN_LAKE_TRACK_PATH` is set, and may use:
 *
 *   track.events      every segment's events, one row per event, loaded once by `loadTrack`:
 *                     device, session, segment, day (UTC), then the event's fields
 *   {{track_labels}}  every `labels/<device>/<session>.json`: `filename`, `episodes`, `acts` (JSON),
 *                     read in place (a relabel rewrites the file)
 *   {{track_calls}}   autobrowse's run ledgers, `ledgers/<kind>/<kind>-YYYY-MM.jsonl.gz` (autobrowse
 *   {{track_flows}}   src/runs/ledger-ship.ts): `filename`, then the line's fields; read in place,
 *   {{track_engine}}  since the desk rewrites a month file as it grows
 *
 * Columns are declared, so an event kind without a field has NULL there and one odd file can't
 * change a type.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { DuckDBConnection } from "@duckdb/node-api";
import { s3Options } from "@wren/config/s3";

const ql = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** The union of every event kind's fields that the models read (autotrack's `Event`). */
const EVENT_COLUMNS = {
  kind: "VARCHAR",
  t: "BIGINT",
  ts: "BIGINT",
  app: "JSON",
  window: "JSON",
  display: "VARCHAR",
  x: "DOUBLE",
  y: "DOUBLE",
  button: "VARCHAR",
  count: "BIGINT",
  dx: "DOUBLE",
  dy: "DOUBLE",
  element: "JSON",
  out: "JSON",
  text: "VARCHAR",
  redacted: "BOOLEAN",
  key: "VARCHAR",
  mods: "VARCHAR[]",
  act: "VARCHAR",
  url: "VARCHAR",
  title: "VARCHAR",
  target: "JSON",
  effects: "JSON",
  action: "VARCHAR",
  detail: "JSON",
  goal: "VARCHAR",
} as const;

const LABEL_COLUMNS = { episodes: "JSON", acts: "JSON" } as const;

/** autobrowse `CallRecord` (src/runs/ledger.ts): one row per site call attempt. */
const CALL_COLUMNS = {
  at: "TIMESTAMPTZ",
  service: "VARCHAR",
  site: "VARCHAR",
  route: "VARCHAR",
  caller: "VARCHAR",
  invocation: "VARCHAR",
  attempt: "INTEGER",
  ok: "BOOLEAN",
  status: "INTEGER",
  terminal: "BOOLEAN",
  error: "VARCHAR",
  ms: "BIGINT",
  from: "VARCHAR",
  via: "VARCHAR",
  template: "VARCHAR",
  body: "VARCHAR",
  artifact: "VARCHAR",
} as const;

/** autobrowse flow ledger: one row per flow run. */
const FLOW_COLUMNS = {
  site: "VARCHAR",
  flow: "VARCHAR",
  startedAt: "TIMESTAMPTZ",
  endedAt: "TIMESTAMPTZ",
  ms: "BIGINT",
  outcome: "VARCHAR",
  submitted: "BOOLEAN",
  goal: "VARCHAR",
  error: "VARCHAR",
  failure: "VARCHAR",
  acts: "INTEGER",
  captchaTries: "INTEGER",
  captchaSolved: "BOOLEAN",
  captchas: "JSON",
  llmCalls: "INTEGER",
  inputTokens: "BIGINT",
  outputTokens: "BIGINT",
  seed: "BIGINT",
} as const;

/** autobrowse engine ledger: one row per compiled-workflow run. */
const ENGINE_COLUMNS = {
  workflow: "VARCHAR",
  key: "VARCHAR",
  site: "VARCHAR",
  startedAt: "TIMESTAMPTZ",
  endedAt: "TIMESTAMPTZ",
  ms: "BIGINT",
  status: "VARCHAR",
  gate: "VARCHAR",
  steps: "JSON",
} as const;

const LEDGER_COLUMNS = {
  calls: CALL_COLUMNS,
  flows: FLOW_COLUMNS,
  engine: ENGINE_COLUMNS,
} as const;

type Columns = Record<string, string>;

const empty = (cols: Columns) =>
  `(SELECT NULL::VARCHAR AS filename, ${Object.entries(cols)
    .map(([k, t]) => `NULL::${t} AS "${k}"`)
    .join(", ")} WHERE false)`;

const reader = (pattern: string, cols: Columns) =>
  `read_json(${ql(pattern)}, format = 'newline_delimited', filename = true, ignore_errors = true, columns = {${Object.entries(
    cols,
  )
    .map(([k, t]) => `"${k}": ${ql(t)}`)
    .join(", ")}})`;

/** A `.json` file holds one object; the same reader with `format = 'auto'` takes it whole. */
const objectReader = (pattern: string, cols: Columns) =>
  reader(pattern, cols).replace("format = 'newline_delimited'", "format = 'auto'");

async function hasFiles(c: DuckDBConnection, pattern: string): Promise<boolean> {
  const r = await c.runAndReadAll(`SELECT count(*) AS n FROM glob(${ql(pattern)})`);
  return Number(r.getRowObjectsJson()[0]?.n ?? 0) > 0;
}

/** The bucket's path with one trailing slash. */
const trackBase = (path: string) => (path.endsWith("/") ? path : `${path}/`);

export type TrackSources = { labels: string; calls: string; flows: string; engine: string };

/** The `{{track_*}}` values for a bucket (or a directory standing in for it). */
export async function trackSources(c: DuckDBConnection, path: string): Promise<TrackSources> {
  const labels = `${trackBase(path)}labels/*/*.json`;
  const ledger = async (kind: keyof typeof LEDGER_COLUMNS) => {
    const files = `${trackBase(path)}ledgers/${kind}/${kind}-*.jsonl.gz`;
    const cols = LEDGER_COLUMNS[kind];
    return (await hasFiles(c, files)) ? reader(files, cols) : empty(cols);
  };
  return {
    labels: (await hasFiles(c, labels))
      ? objectReader(labels, LABEL_COLUMNS)
      : empty(LABEL_COLUMNS),
    calls: await ledger("calls"),
    flows: await ledger("flows"),
    engine: await ledger("engine"),
  };
}

/** A session's name: its start time and a tag (`20261125T194917-40ac`). Other prefixes are not sessions. */
const SESSION = /^\d{8}T\d{6}-[0-9a-z]+$/;

/** Where segments are and which are whole: the bucket, or a directory in tests. */
export type SegmentSource = {
  /** Every `<device>/<session>` in the bucket. */
  sessions(): Promise<{ device: string; session: string }[]>;
  /** A session's segment names. */
  segments(device: string, session: string): Promise<string[]>;
  /** Is the segment whole? Its `events.jsonl.gz` lands last (autotrack `ship.ts`). */
  whole(device: string, session: string, segment: string): Promise<boolean>;
};

const eventsKey = (device: string, session: string, segment: string) =>
  `${device}/${session}/${segment}/events.jsonl.gz`;

function dirSegments(base: string): SegmentSource {
  const dirs = (p: string) =>
    existsSync(p)
      ? readdirSync(p, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [];
  return {
    async sessions() {
      return dirs(base).flatMap((device) =>
        dirs(join(base, device))
          .filter((s) => SESSION.test(s))
          .map((session) => ({ device, session })),
      );
    },
    async segments(device, session) {
      return dirs(join(base, device, session));
    },
    async whole(device, session, segment) {
      return existsSync(join(base, eventsKey(device, session, segment)));
    },
  };
}

/** The bucket, listed by `/` so a listing never walks the frames. */
function s3Segments(path: string, client = new S3Client(s3Options())): SegmentSource {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(path);
  if (!m) throw new Error(`not an s3:// path: ${path}`);
  const bucket = m[1] as string;
  const root = m[2] ? (m[2].endsWith("/") ? m[2] : `${m[2]}/`) : "";
  const children = async (prefix: string): Promise<string[]> => {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: "/",
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const p of r.CommonPrefixes ?? [])
        if (p.Prefix) out.push(p.Prefix.slice(prefix.length, -1));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  };
  return {
    async sessions() {
      const out: { device: string; session: string }[] = [];
      for (const device of await children(root))
        for (const session of await children(`${root}${device}/`))
          if (SESSION.test(session)) out.push({ device, session });
      return out;
    },
    segments: (device, session) => children(`${root}${device}/${session}/`),
    async whole(device, session, segment) {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: root + eventsKey(device, session, segment),
          }),
        );
        return true;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404) return false;
        throw err;
      }
    },
  };
}

/** `fn` over `items`, at most `n` at once, results in order. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, work));
  return out;
}

const colDefs = (cols: Columns) =>
  Object.entries(cols)
    .map(([k, t]) => `"${k}" ${t}`)
    .join(", ");

/** `track.events` and its ledger `track.segments`; a column added to `EVENT_COLUMNS` since is added. */
async function ensureTrackTables(c: DuckDBConnection) {
  await c.run("CREATE SCHEMA IF NOT EXISTS lake.track");
  const had = await c.runAndReadAll(
    "SELECT column_name FROM information_schema.columns WHERE table_catalog = 'lake' AND table_schema = 'track' AND table_name = 'events'",
  );
  const have = new Set(had.getRowObjectsJson().map((r) => String(r.column_name)));
  if (have.size === 0) {
    await c.run(
      `CREATE TABLE lake.track.events (device VARCHAR, session VARCHAR, segment VARCHAR, day DATE, ${colDefs(EVENT_COLUMNS)})`,
    );
    // Parquet files by device and day: a day's question reads that day's files
    await c.run("ALTER TABLE lake.track.events SET PARTITIONED BY (device, day)");
  } else {
    for (const [k, t] of Object.entries(EVENT_COLUMNS))
      if (!have.has(k)) await c.run(`ALTER TABLE lake.track.events ADD COLUMN "${k}" ${t}`);
  }
  await c.run(
    "CREATE TABLE IF NOT EXISTS lake.track.segments (device VARCHAR, session VARCHAR, segment VARCHAR, events BIGINT, loaded_at TIMESTAMPTZ)",
  );
}

export type TrackLoad = { segments: number; events: number; waiting: number; ms: number };

/**
 * Load every whole segment not loaded yet into `track.events`, `batch` segments per commit (a
 * short transaction: one long one lost its catalog connection, 11-26). A segment is immutable once
 * whole, so the ledger `track.segments` says it is done. `reload` empties both first (a new column
 * then fills for old segments too).
 */
export async function loadTrack(
  c: DuckDBConnection,
  path: string,
  o: { source?: SegmentSource; batch?: number; reload?: boolean } = {},
): Promise<TrackLoad> {
  const began = Date.now();
  const base = trackBase(path);
  const source = o.source ?? (path.startsWith("s3://") ? s3Segments(path) : dirSegments(path));
  await ensureTrackTables(c);
  if (o.reload) {
    await c.run("BEGIN");
    await c.run("DELETE FROM lake.track.events");
    await c.run("DELETE FROM lake.track.segments");
    await c.run("COMMIT");
  }
  const done = new Set(
    (await c.runAndReadAll("SELECT device, session, segment FROM lake.track.segments"))
      .getRowObjectsJson()
      .map((r) => `${r.device}/${r.session}/${r.segment}`),
  );
  // listings and checks run 16 at a time: one at a time, a first load lists for many minutes
  const todo: [string, string, string][] = [];
  let waiting = 0;
  const sessions = await source.sessions();
  const found = (
    await pool(sessions, 16, async ({ device, session }) =>
      (
        await source.segments(device, session)
      )
        .filter((g) => !done.has(`${device}/${session}/${g}`))
        .map((g): [string, string, string] => [device, session, g]),
    )
  ).flat();
  const whole = await pool(found, 16, ([d, s, g]) => source.whole(d, s, g));
  for (const [i, k] of found.entries()) {
    if (whole[i]) todo.push(k);
    else waiting++;
  }
  let events = 0;
  const size = o.batch ?? 200;
  for (let i = 0; i < todo.length; i += size) {
    const part = todo.slice(i, i + size);
    const files = part.map(([d, s, g]) => ql(base + eventsKey(d, s, g))).join(", ");
    const keys = part.map(([d, s, g]) => `(${ql(d)}, ${ql(s)}, ${ql(g)})`).join(", ");
    const read = reader("__FILES__", EVENT_COLUMNS).replace("'__FILES__'", `[${files}]`);
    const re = "([^/]+)/([^/]+)/([^/]+)/events\\.jsonl\\.gz$";
    await c.run(`CREATE OR REPLACE TEMP TABLE track_batch AS
      SELECT regexp_extract(filename, '${re}', 1) AS device,
             regexp_extract(filename, '${re}', 2) AS session,
             regexp_extract(filename, '${re}', 3) AS segment,
             CAST(epoch_ms(ts) AS DATE) AS day,
             * EXCLUDE (filename)
      FROM ${read}`);
    await c.run("BEGIN");
    try {
      await c.run("INSERT INTO lake.track.events BY NAME SELECT * FROM track_batch");
      await c.run(`INSERT INTO lake.track.segments
        SELECT k.device, k.session, k.segment, coalesce(n.events, 0), now()
        FROM (VALUES ${keys}) k(device, session, segment)
        LEFT JOIN (SELECT device, session, segment, count(*) AS events FROM track_batch GROUP BY ALL) n
          USING (device, session, segment)`);
      await c.run("CALL lake.set_commit_message('wren lake track', 'segments loaded')");
      await c.run("COMMIT");
    } catch (err) {
      await c.run("ROLLBACK").catch(() => {});
      throw err;
    }
    const n = await c.runAndReadAll("SELECT count(*) AS n FROM track_batch");
    events += Number(n.getRowObjectsJson()[0]?.n ?? 0);
  }
  await c.run("DROP TABLE IF EXISTS track_batch");
  return { segments: todo.length, events, waiting, ms: Date.now() - began };
}

/** Does a model need the track bucket? Its first lines say `-- needs: track`. */
export const needsTrack = (sql: string) => /^--\s*needs:\s*track\b/m.test(sql);

/** The model with each `{{track_<name>}}` filled in; an unknown name stays, so DuckDB fails on it. */
export const fillTrack = (sql: string, s: TrackSources) =>
  sql.replace(/\{\{track_(labels|calls|flows|engine)\}\}/g, (_, k: keyof TrackSources) => s[k]);
