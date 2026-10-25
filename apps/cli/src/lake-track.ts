/**
 * autotrack's bucket as lake sources (designs/2026-10-11-lake.md, "autotrack"). A model whose first
 * line says `-- needs: track` is built only when `WREN_LAKE_TRACK_PATH` is set, and may use:
 *
 *   {{track_events}}  every `<device>/<session>/<segment>/events.jsonl.gz`, one row per event, with
 *                     the object's `filename` (the model takes device, session and segment from it)
 *   {{track_labels}}  every `labels/<device>/<session>.json`: `filename`, `episodes`, `acts` (JSON)
 *
 * DuckDB reads the gzipped files where they are (S3 or a directory). Columns are declared, so an
 * event kind without a field has NULL there and one odd file can't change a type. No files yet:
 * the same columns, no rows.
 */
import type { DuckDBConnection } from "@duckdb/node-api";

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

/** The `{{…}}` values for a bucket (or a directory standing in for it). */
export async function trackSources(
  c: DuckDBConnection,
  path: string,
): Promise<{ events: string; labels: string }> {
  const base = trackBase(path);
  const events = `${base}*/*/*/events.jsonl.gz`;
  const labels = `${base}labels/*/*.json`;
  return {
    events: (await hasFiles(c, events)) ? reader(events, EVENT_COLUMNS) : empty(EVENT_COLUMNS),
    labels: (await hasFiles(c, labels))
      ? objectReader(labels, LABEL_COLUMNS)
      : empty(LABEL_COLUMNS),
  };
}

/** Does a model need the track bucket? Its first lines say `-- needs: track`. */
export const needsTrack = (sql: string) => /^--\s*needs:\s*track\b/m.test(sql);

/** The model with `{{track_events}}` and `{{track_labels}}` filled in. */
export const fillTrack = (sql: string, s: { events: string; labels: string }) =>
  sql.replaceAll("{{track_events}}", () => s.events).replaceAll("{{track_labels}}", () => s.labels);
