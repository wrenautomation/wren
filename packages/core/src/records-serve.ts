/**
 * The records routes over one client's database: list, get, export, and the types the web draws.
 * Every name in the SQL comes from a declaration (`./records.ts`), never from the ask; every
 * value is bound and cast by its field's kind. Pages are keyset, ordered by the sort, then the
 * key as text, so equal sort values never repeat or skip a row.
 *
 * With a mask (the demo), every row, detail and CSV cell goes through it, and filters are only
 * those `allowed` leaves: no masked field, no substring match, no value the mask would rewrite.
 * A hit on a name would say who is on the list.
 *
 * A type with `rows` instead of a view (loops, inboxes) is read once per request and queried
 * as a table of text columns, cast by kind like any view's.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { type Reach, reach } from "./access.js";
import { type EditState, editState } from "./edits.js";
import { isDemo, isOperator, PortalRefusal, type PortalRequest } from "./portal.js";
import {
  allowed,
  BadAsk,
  type Cell,
  type Clause,
  clausesOf,
  csvRow,
  type Field,
  KINDS,
  type Me,
  metaOf,
  type RecordMeta,
  type RecordType,
  type SavedView,
  sortOf,
} from "./records.js";
import { canonicalZone, wallClock, zonedInstant } from "./time.js";
import { jsonl, type TrainRecord, trainRecords } from "./train.js";

export type Mask = <T>(v: T) => T;
export type Row = { id: string | number } & Record<string, Cell>;

export interface ListAsk {
  record: string;
  /** A saved view's id; absent, every row. */
  view?: string;
  where?: unknown;
  /** A sortable field, "-" for descending; absent, the view's. */
  sort?: string;
  q?: string;
  /** `next` from the page before. */
  cursor?: string;
  limit?: number;
  /** Only rows pointing at this record, as its type's `related` says: a person's emails. */
  of?: { record: string; id: string | number };
  /** Also count each state of every status, tags, verdict and choice field: Shop, Filter. */
  facets?: boolean;
}
export interface RecordsPage {
  record: string;
  view: string | null;
  rows: Row[];
  /** Rows in this view with this search; `counts` has every view's. */
  total: number;
  counts: Record<string, number>;
  next: string | null;
  /** One figure per field over this view and search, by kind (`totalsOf`); a field with none is left out. */
  totals: Record<string, Total>;
  /**
   * Asked for: rows in this view per state of each status, tags, verdict and choice field, under
   * every filter but that field's own, so a picked state never zeroes its siblings.
   */
  facets?: Record<string, Record<string, number>>;
}
/**
 * A list column's footer: money sums (one currency), a rate pools n of m, a verdict is valid of
 * the rows, text filled of the rows, a date its newest, a status its commonest state.
 */
export type Total =
  | { sum: number; currency: string }
  | { n: number; of: number }
  | { newest: string }
  | { most: string; n: number; of: number };
export interface GetAsk {
  record: string;
  id: string | number;
}
export interface ActivityLine {
  at: string;
  kind: string | null;
  what: string;
}
export interface RecordAnswer {
  record: string;
  row: Row;
  related: { record: string; count: number }[];
  /** Newest first; null when the type keeps none. */
  activity: ActivityLine[] | null;
  /** What the type's `load` adds; null without one. */
  detail: object | null;
  /** Its values, version, history and asks, when it declares edits; never on the demo. */
  edit?: EditState | null;
}
export type ExportFormat = "csv" | "jsonl";
export interface ExportAsk extends Omit<ListAsk, "cursor" | "limit"> {
  /** Absent, CSV. JSONL is a line per row, with its drafts' training records when it has some. */
  format?: ExportFormat;
}
export interface RecordsFile {
  record: string;
  format: ExportFormat;
  body: string;
  rows: number;
  /** More rows matched than an export carries. */
  capped: boolean;
}

/** How many days a stat's period spans back (today counts), or the calendar month so far. */
export type Period = number | "month";
export interface StatsAsk extends ExportAsk {
  /** A date field; absent, the view's `at`. */
  at?: string;
  /** Needed unless `pick`. */
  period?: Period;
  /** A number or money field to add up; absent, rows are counted. */
  sum?: string;
  /** A number or duration field's median over the period's rows, in place of a count or sum. */
  median?: string;
  /**
   * A number, money or percent field read off the newest row up to now, by `at`, for a type with
   * a row per month: its value, the row before's, and the newest 12. Takes no period.
   */
  pick?: string;
  /** The IANA zone days start in; UTC when absent. */
  zone?: string;
}
export interface RecordsStat {
  record: string;
  view: string | null;
  /** This period so far. A pick's is null when its row has none, or there is no row. */
  value: number | null;
  /** The same stretch of the period before: last week to this hour, not all of last week. */
  prior: number | null;
  /** Each day of this period so far, oldest first: the day's start and its value. A pick's rows. */
  series: { at: string; value: number | null }[];
  /** A money sum's currency; null otherwise or with no rows. */
  currency: string | null;
  /** A median's newest row's value, by `at`; absent for counts, sums and picks. */
  latest?: number | null;
}

type CsvCell = string | number | boolean | null;
const csvCell = (v: CsvCell) => {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const toCsv = ({ columns, rows }: { columns: string[]; rows: CsvCell[][] }): string =>
  [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

const PAGE = 50;
const MAX_LIMIT = 200;
/** Like ConsolePortal's cap on a view. */
export const MAX_EXPORT = 5000;
const MAX_Q = 100;
const MAX_CURSOR = 1000;
const ACTIVITY = 50;
const MAX_DAYS = 92;
/** The rows a pick's series carries. */
const PICKS = 12;
const BARE_DAY = "^\\d{4}-\\d{2}-\\d{2}$";

/** Midnight in `zone` of a calendar day; the day may run past its month either way. */
const midnight = (zone: string, year: number, month: number, day: number): Date => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return zonedInstant(zone, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/**
 * A stat's windows at `now`: this period from its first midnight in `zone`, and the period
 * before cut to the same length, so a half-elapsed today meets a half-elapsed day.
 * ponytail: the cut is in hours, so across a DST change the prior stretch is an hour off.
 */
export function statWindows(period: Period, zone: string, now: Date) {
  const { year, month, day } = wallClock(zone, now);
  const first = period === "month" ? 1 : day - period + 1;
  const days = Array.from({ length: period === "month" ? day : period }, (_, i) =>
    midnight(zone, year, month, first + i),
  );
  const from = days[0] as Date;
  const priorFrom =
    period === "month"
      ? midnight(zone, year, month - 1, 1)
      : midnight(zone, year, month, first - period);
  const priorTo = new Date(
    Math.min(priorFrom.getTime() + now.getTime() - from.getTime(), from.getTime()),
  );
  return { from, priorFrom, priorTo, days };
}

type Cast = "text" | "numeric" | "timestamptz";
const ref = (column: string) => sql`r.${sql.identifier(column)}`;
const bind = (v: unknown, cast: Cast) => sql`${v}::${sql.raw(cast)}`;
const castOf = (f: Field): Cast => {
  const s = KINDS[f.kind].sql;
  return s === "state" ? "text" : s;
};
/** The kinds a facet counts by state, and the most options a choice may have to be counted. */
const FACETED = new Set<string>(["status", "tags", "verdict", "choice"]);
const FACET_MAX = 40;

/** The field's value as filters compare it; a rate is n / m. */
const valueSql = (f: Field): SQL => {
  const c = ref(f.from ?? "");
  if (f.kind === "rate") return sql`((${c})::numeric / nullif((${ref(f.of ?? "")})::numeric, 0))`;
  if (f.kind === "tags") return sql`string_to_array(nullif((${c})::text, ''), ',')`;
  return sql`(${c})::${sql.raw(castOf(f))}`;
};
/** The field as it sorts: a state by its place in the declaration, text with digits by value. */
const sortSql = (f: Field): { expr: SQL; cast: Cast } =>
  KINDS[f.kind].sql === "state"
    ? {
        expr: sql`array_position(array[${sql.join(
          Object.keys(f.states ?? {}).map((s) => sql`${s}`),
          sql`, `,
        )}]::text[], (${ref(f.from ?? "")})::text)`,
        cast: "numeric",
      }
    : KINDS[f.kind].sql === "text"
      ? { expr: sql`${valueSql(f)} collate "natural"`, cast: "text" }
      : { expr: valueSql(f), cast: castOf(f) };
/** Text kinds whose footer says how many rows have one. */
const FILLED = new Set(["text", "name", "company", "actor", "choice"]);

/**
 * The footer's aggregates, read in the count query: `in` is the view's filter, the rest of the
 * where (filters, search) is already the query's. Returns the select list and a reader.
 */
function totalsOf(t: RecordType, inView: SQL) {
  const cols: SQL[] = [];
  const col = (expr: SQL) => {
    const name = `t${cols.length}`;
    cols.push(sql`${expr} ${sql.identifier(name)}`);
    return name;
  };
  const when = (extra: SQL) => sql`filter (where (${inView}) and ${extra})`;
  const all = col(sql`count(*) filter (where ${inView})::int`);
  const reads: [string, (r: Raw) => Total | null][] = [];
  for (const [key, f] of Object.entries(t.fields)) {
    if (f.total === false) continue;
    const v = valueSql(f);
    if (f.kind === "money") {
      const cur = ref(f.currency ?? "");
      const has = sql`${v} is not null`;
      const s = col(sql`sum(${v}) ${when(has)}`);
      const k = col(sql`count(distinct ${cur}) ${when(has)}::int`);
      const c = col(sql`min((${cur})::text) ${when(has)}`);
      reads.push([
        key,
        (r) =>
          r[s] == null || Number(r[k]) !== 1 ? null : { sum: Number(r[s]), currency: String(r[c]) },
      ]);
    } else if (f.kind === "rate") {
      const n = sql`(${ref(f.from ?? "")})::numeric`;
      const of = sql`(${ref(f.of ?? "")})::numeric`;
      const both = sql`${n} is not null and ${of} is not null`;
      const a = col(sql`sum(${n}) ${when(both)}`);
      const b = col(sql`sum(${of}) ${when(both)}`);
      reads.push([
        key,
        (r) => (Number(r[b] ?? 0) > 0 ? { n: Number(r[a]), of: Number(r[b]) } : null),
      ]);
    } else if (f.kind === "verdict" || FILLED.has(f.kind)) {
      const hit = f.kind === "verdict" ? sql`${v} = 'valid'` : sql`coalesce(${v}, '') <> ''`;
      const a = col(sql`count(*) ${when(hit)}::int`);
      reads.push([
        key,
        (r) => (Number(r[all]) > 0 ? { n: Number(r[a]), of: Number(r[all]) } : null),
      ]);
    } else if (f.kind === "date") {
      const a = col(sql`max(${v}) filter (where ${inView})`);
      reads.push([
        key,
        (r) => (r[a] == null ? null : { newest: new Date(r[a] as string).toISOString() }),
      ]);
    } else if (f.kind === "status") {
      const states = Object.keys(f.states ?? {});
      const each = states.map((s) => col(sql`count(*) ${when(sql`${v} = ${s}`)}::int`));
      reads.push([
        key,
        (r) => {
          const counts = each.map((a) => Number(r[a]));
          const top = Math.max(0, ...counts);
          const most = states[counts.indexOf(top)];
          return top > 0 && most ? { most, n: top, of: Number(r[all]) } : null;
        },
      ]);
    }
  }
  const read = (r: Raw): Record<string, Total> => {
    const out: Record<string, Total> = {};
    for (const [k, fn] of reads) {
      const got = fn(r);
      if (got) out[k] = got;
    }
    return out;
  };
  return { cols, read };
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const and = (parts: SQL[]) => (parts.length ? sql.join(parts, sql` and `) : sql`true`);

/**
 * `q` against one field: its stored text, and for a choice also the keys whose label holds it
 * ("SEC RIA" finds "sec_ria") or that read as it with spaces ("sec ria").
 */
export function searchSql(f: Field, q: string): SQL {
  const own = sql`${valueSql(f)} ilike ${like(q)}`;
  if (f.kind !== "choice") return own;
  const low = q.toLowerCase();
  const keys = Object.entries(f.choices?.() ?? {})
    .filter(([, label]) => label.toLowerCase().includes(low))
    .map(([k]) => k);
  const spaced = sql`translate(${valueSql(f)}, '_-./', '    ') ilike ${like(q)}`;
  return keys.length
    ? sql`(${own} or ${spaced} or ${valueSql(f)} in (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )}))`
    : sql`(${own} or ${spaced})`;
}

/** A view name, each part quoted: "books.spend". */
const viewSql = (view: string) =>
  sql.join(
    view.split(".").map((p) => sql.identifier(p)),
    sql.raw("."),
  );

function clauseSql(type: RecordType, c: Clause): SQL {
  const f = type.fields[c.field] as Field;
  const v = valueSql(f);
  const cast = castOf(f);
  switch (c.op) {
    case "eq":
      return sql`${v} = ${bind(c.value, cast)}`;
    case "in":
      if (f.kind === "tags")
        return sql`${v} && array[${sql.join(
          (c.value as string[]).map((x) => sql`${x}`),
          sql`, `,
        )}]::text[]`;
      return sql`${v} in (${sql.join(
        (c.value as (string | number)[]).map((x) => bind(x, cast)),
        sql`, `,
      )})`;
    case "contains":
      return sql`${v} ilike ${like(String(c.value))}`;
    case "gte":
      return sql`${v} >= ${bind(c.value, cast)}`;
    case "lte":
      return sql`${v} <= ${bind(c.value, cast)}`;
    case "empty": {
      const empty = cast === "text" ? sql`coalesce(${v}, '') = ''` : sql`${v} is null`;
      return c.value ? empty : sql`not (${empty})`;
    }
  }
}

/** Is any text in this value something the mask rewrites? Then it names someone the demo hides. */
const hides = (mask: Mask | undefined, v: unknown): boolean =>
  !!mask &&
  (Array.isArray(v) ? v.some((x) => hides(mask, x)) : typeof v === "string" && mask(v) !== v);

/** A record id from a browser: a whole number or short text, compared as text. */
function idOf(v: unknown): string {
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  if (typeof v === "string" && v.length > 0 && v.length <= 200) return v;
  throw new PortalRefusal("no such record", 404);
}

/** Postgres refused a value (SQLSTATE class 22): the ask was bad, not the server. */
const badValue = (e: unknown): boolean => {
  for (let x = e; x instanceof Error; x = x.cause) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("22")) return true;
  }
  return false;
};

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof BadAsk) throw new PortalRefusal(e.message, 400);
    if (badValue(e)) throw new PortalRefusal("a value there doesn't fit", 400);
    throw e;
  }
}

type Raw = Record<string, unknown>;

function cellOf(f: Field, raw: Raw): Cell {
  const v = raw[f.from ?? ""];
  if (v === null || v === undefined) return null;
  if (f.kind === "company") {
    const d = f.domain ? raw[f.domain] : null;
    return { name: String(v), domain: typeof d === "string" ? d : null };
  }
  if (f.kind === "money")
    return { amount: Number(v), currency: String(raw[f.currency ?? ""] ?? "") };
  if (f.kind === "rate") return { n: Number(v), of: Number(raw[f.of ?? ""] ?? 0) };
  const s = KINDS[f.kind].sql;
  if (s === "numeric") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (s === "timestamptz") return new Date(String(v)).toISOString();
  return String(v);
}

/** The view's columns a type reads: its key and every field's. */
const namesOf = (type: RecordType): string[] => [
  ...new Set([
    type.key,
    ...Object.values(type.fields).flatMap((f) =>
      [f.from, f.domain, f.currency, f.of].filter((c): c is string => !!c),
    ),
  ]),
];
const columnsOf = (type: RecordType): SQL => sql.join(namesOf(type).map(ref), sql`, `);

/** A cursor: the sort it was made under, whether the sort value was null, that value, the key. */
type Cursor = [sort: string, isNull: boolean, value: string | null, key: string];
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function decode(s: unknown, sort: string): Cursor {
  if (typeof s !== "string" || s.length > MAX_CURSOR || !/^[\w-]+$/.test(s))
    throw new BadAsk("that page marker is broken");
  let c: unknown;
  try {
    c = JSON.parse(Buffer.from(s, "base64url").toString());
  } catch {
    throw new BadAsk("that page marker is broken");
  }
  if (
    !Array.isArray(c) ||
    c.length !== 4 ||
    typeof c[0] !== "string" ||
    typeof c[1] !== "boolean" ||
    !(c[2] === null || (typeof c[2] === "string" && c[2].length <= MAX_CURSOR)) ||
    typeof c[3] !== "string" ||
    c[3].length > MAX_CURSOR
  )
    throw new BadAsk("that page marker is broken");
  if (c[0] !== sort) throw new BadAsk("that page marker is from another sort");
  return c as Cursor;
}

/**
 * Which rows of a type this login may read (`reach` in `./access.ts`): null is every row. A
 * fenced list, count, facet or stat reads only the rows inside, so the numbers match the rows.
 */
export type Fence = (t: RecordType) => Reach | null;

/** Does a fence leave any row of `t`? A type with none isn't served: hidden, not empty. */
export const opens = (t: RecordType, r: Reach | null): boolean =>
  !r || r.ids.length > 0 || (typeof t.channel === "object" && r.channels.length > 0);

/**
 * A fence from the login the guard read (`viewer.access`): the rows of each type at `client` it
 * may read. None when the guard didn't run (a handler called straight, a test, the CLI).
 */
export function fenceFor(req: PortalRequest, client: string): Fence | undefined {
  const v = req.viewer;
  if (!v || isDemo(v) || !v.access) return undefined;
  const who = v.access;
  return (t) => reach(who, "read", { client, app: t.app, type: t.id, channel: t.channel });
}

/**
 * Who is signed in, for what is theirs (`mine`): the viewer's address. Nobody for the demo and
 * under View as, which reads what the workspace shares, never one person's own.
 */
export function meOf(req: PortalRequest): Me | null {
  const v = req.viewer;
  if (isDemo(v) || (typeof req.viewAs === "string" && req.viewAs !== "")) return null;
  return { email: v.email.trim().toLowerCase(), team: isOperator(v) };
}

/** Rows whose `field` holds this person's address; none when nobody is signed in. */
function mineSql(t: RecordType, field: string, me: Me | null): SQL {
  if (!me?.email) return sql`false`;
  const col = t.fields[field]?.from ?? field;
  return sql`lower((${ref(col)})::text) = ${me.email}`;
}

const oneOf = (vs: readonly string[]) =>
  sql.join(
    vs.map((v) => sql`${v}::text`),
    sql`, `,
  );

export function serveRecords(
  given: readonly RecordType[],
  db: Queryable,
  mask?: Mask,
  fence?: Fence,
  /** The signed-in person (`meOf`): a `mine` type or view reads their rows, `rows` gets them. */
  me: Me | null = null,
) {
  const types = fence ? given.filter((t) => opens(t, fence(t))) : given;
  const demo = !!mask;
  const typeOf = (id: unknown): RecordType => {
    const t = types.find((x) => x.id === id);
    if (!t) throw new PortalRefusal("no such record", 404);
    return t;
  };
  const keyText = (t: RecordType) => sql`(${ref(t.key)})::text collate "C"`;
  const masked = <T>(v: T): T => (mask ? mask(v) : v);
  const rowOf = (t: RecordType, raw: Raw): Row => {
    const row: Row = { id: raw[t.key] as string | number };
    for (const [k, f] of Object.entries(t.fields)) row[k] = cellOf(f, raw);
    return masked(row);
  };
  /** A JSONL export: a line per row with its fields by key, and its drafts' training records. */
  async function jsonlOf(t: RecordType, rows: Row[]): Promise<string> {
    const itemsOf = (r: Row) => t.drafts?.(String(r.id)) ?? [];
    const items = rows.flatMap(itemsOf);
    const byItem = new Map<string, TrainRecord[]>();
    for (const x of items.length ? await trainRecords(db, { items }) : [])
      byItem.set(x.item, [...(byItem.get(x.item) ?? []), x]);
    return jsonl(
      rows.map((r) => {
        const { id, ...fields } = r;
        const drafts = itemsOf(r).flatMap((i) => byItem.get(i) ?? []);
        return { record: t.id, id, fields, ...(t.drafts ? { drafts: masked(drafts) } : {}) };
      }),
    );
  }
  const loaded = new Map<string, Promise<Raw[]>>();
  /** What a type's rows are read from, as `r`: its view, or its own rows as a table. */
  async function source(t: RecordType): Promise<SQL> {
    const all = t.mine
      ? sql`(select r.* from ${await unfenced(t)} where ${mineSql(t, t.mine, me)}) r`
      : await unfenced(t);
    const r = fence?.(t);
    if (!r) return all;
    const by: SQL[] = [];
    if (typeof t.channel === "object" && t.channel !== null && r.channels.length) {
      const col = t.fields[t.channel.field]?.from ?? t.channel.field;
      by.push(sql`(${ref(col)})::text in (${oneOf(r.channels)})`);
    }
    if (r.ids.length) by.push(sql`(${ref(t.key)})::text in (${oneOf(r.ids)})`);
    const inside = by.length ? sql.join(by, sql` or `) : sql`false`;
    return sql`(select r.* from ${all} where ${inside}) r`;
  }
  async function unfenced(t: RecordType): Promise<SQL> {
    if (t.view) return sql`${viewSql(t.view)} r`;
    const rows = loaded.get(t.id) ?? t.rows?.(db, me) ?? Promise.resolve([]);
    loaded.set(t.id, rows);
    const pointedBy = types.flatMap((x) =>
      (x.related ?? []).filter((r) => r.record === t.id).map((r) => r.by),
    );
    const columns = [...new Set([...namesOf(t), ...pointedBy])];
    return sql`jsonb_to_recordset(${JSON.stringify(await rows)}::jsonb) r(${sql.join(
      columns.map((c) => sql`${sql.identifier(c)} text`),
      sql`, `,
    )})`;
  }

  /** A saved view's rows: its filters, and the signed-in person's own when it's `mine`. */
  const savedSql = (t: RecordType, v: SavedView): SQL =>
    and([
      ...clausesOf(t, v.where).map((c) => clauseSql(t, c)),
      ...(v.mine ? [mineSql(t, v.mine, me)] : []),
    ]);

  /** Everything a list or export asks, checked, as SQL. */
  function plan(ask: ExportAsk) {
    const t = typeOf(ask.record);
    let view = null;
    if (ask.view !== undefined) {
      view = t.views.find((v) => v.id === ask.view) ?? null;
      if (!view) throw new BadAsk(`${t.name.many} have no such view`);
    }
    const asked = clausesOf(t, ask.where);
    /** Each filter with the field it narrows; search and `of` narrow none. */
    const parts: { field: string | null; sql: SQL }[] = asked.map((c) => {
      const f = t.fields[c.field] as Field;
      if (!allowed(f, demo).ops.includes(c.op))
        throw new BadAsk(`the demo doesn't filter ${f.label} that way`);
      return { field: c.field, sql: hides(mask, c.value) ? sql`false` : clauseSql(t, c) };
    });
    if (ask.q !== undefined) {
      if (typeof ask.q !== "string" || ask.q.length > MAX_Q) throw new BadAsk("search is too long");
      const q = ask.q.trim();
      if (q) {
        const over = Object.values(t.fields).filter((f) => allowed(f, demo).searchable);
        if (!over.length) throw new BadAsk(`${t.name.many} can't be searched here`);
        parts.push({
          field: null,
          sql: sql`(${sql.join(
            over.map((f) => searchSql(f, q)),
            sql` or `,
          )})`,
        });
      }
    }
    if (ask.of !== undefined) {
      const of = ask.of as { record?: unknown; id?: unknown } | null;
      const parent = typeOf(of?.record);
      const rel = parent.related?.find((r) => r.record === t.id);
      if (!rel) throw new BadAsk(`${parent.name.many} have no ${t.name.many}`);
      parts.push({ field: null, sql: sql`(${ref(rel.by)})::text = ${idOf(of?.id)}` });
    }
    const sortName = ask.sort ?? view?.sort;
    let sort = sortName === undefined ? null : sortOf(t, sortName);
    if (sort && !allowed(t.fields[sort.field] as Field, demo).sortable) {
      if (ask.sort !== undefined)
        throw new BadAsk(`the demo doesn't sort by ${t.fields[sort.field]?.label}`);
      sort = null; // a view's own sort the demo can't carry in a page marker: key order
    }
    const by = sort ? { ...sortSql(t.fields[sort.field] as Field), desc: sort.desc } : null;
    const order = by
      ? sql`(${by.expr}) is null, ${by.expr} ${by.desc ? sql`desc` : sql`asc`}, ${keyText(t)}`
      : keyText(t);
    const inView = view ? savedSql(t, view) : sql`true`;
    /** Every filter but one field's: what that field's facet counts under. */
    const but = (field: string | null) =>
      and(parts.filter((x) => field === null || x.field !== field).map((x) => x.sql));
    return {
      t,
      view,
      base: but(null),
      but,
      inView,
      by,
      order,
      sortKey: sort ? (sortName ?? "") : "",
    };
  }

  /**
   * One count per state of each status, tags, verdict and choice field, each under the other
   * fields' filters. A choice with more than `FACET_MAX` options is left out.
   */
  async function facetsOf(p: ReturnType<typeof plan>) {
    const cols: SQL[] = [];
    const reads: [string, string, string][] = [];
    for (const [key, f] of Object.entries(p.t.fields)) {
      if (!FACETED.has(f.kind)) continue;
      const states = Object.keys((f.kind === "choice" && f.choices?.()) || f.states || {});
      if (states.length > FACET_MAX) continue;
      const v = valueSql(f);
      for (const s of states) {
        const name = `f${cols.length}`;
        const hit = f.kind === "tags" ? sql`${s} = any(${v})` : sql`${v} = ${s}`;
        cols.push(
          sql`count(*) filter (where ${p.but(key)} and ${hit})::int ${sql.identifier(name)}`,
        );
        reads.push([key, s, name]);
      }
    }
    if (!cols.length) return {};
    const [r] = await db.execute<Raw>(sql`
      select ${sql.join(cols, sql`, `)} from ${await source(p.t)} where ${p.inView}`);
    const out: Record<string, Record<string, number>> = {};
    for (const [key, s, name] of reads) {
      out[key] ??= {};
      out[key][s] = Number(r?.[name] ?? 0);
    }
    return out;
  }

  return {
    types: (): RecordMeta[] => types.map((t) => metaOf(t, demo)),

    list: (ask: ListAsk): Promise<RecordsPage> =>
      guard(async () => {
        const p = plan(ask);
        let limit = PAGE;
        if (ask.limit !== undefined) {
          if (!Number.isSafeInteger(ask.limit) || ask.limit < 1)
            throw new BadAsk("limit takes a whole number");
          limit = Math.min(ask.limit, MAX_LIMIT);
        }
        let after = sql`true`;
        if (ask.cursor !== undefined) {
          const [, isNull, v, k] = decode(ask.cursor, p.sortKey);
          const key = keyText(p.t);
          if (!p.by) after = sql`${key} > ${k}`;
          else if (isNull) after = sql`(${p.by.expr} is null and ${key} > ${k})`;
          else {
            const at = bind(v, p.by.cast);
            const cmp = p.by.desc ? sql`<` : sql`>`;
            after = sql`(${p.by.expr} is null or ${p.by.expr} ${cmp} ${at}
              or (${p.by.expr} = ${at} and ${key} > ${k}))`;
          }
        }
        const raw = await db.execute<Raw>(sql`
          select ${columnsOf(p.t)}, ${keyText(p.t)} "__key",
            ${p.by ? sql`(${p.by.expr})::text` : sql`null`} "__sort"
          from ${await source(p.t)}
          where ${p.base} and ${p.inView} and ${after}
          order by ${p.order}
          limit ${limit + 1}`);
        const views = p.t.views;
        const totals = totalsOf(p.t, p.inView);
        const [n] = await db.execute<Raw>(sql`
          select count(*) filter (where ${p.inView})::int "__total",
            ${sql.join(totals.cols, sql`, `)},
            ${sql.join(
              views.map(
                (v, i) =>
                  sql`count(*) filter (where ${savedSql(p.t, v)})::int ${sql.identifier(`c${i}`)}`,
              ),
              sql`, `,
            )}
          from ${await source(p.t)} where ${p.base}`);
        const facets = ask.facets ? await facetsOf(p) : undefined;
        const page = raw.slice(0, limit);
        const last = raw.length > limit ? page.at(-1) : undefined;
        return {
          record: p.t.id,
          view: p.view?.id ?? null,
          rows: page.map((r) => rowOf(p.t, r)),
          total: Number(n?.__total ?? 0),
          counts: Object.fromEntries(views.map((v, i) => [v.id, Number(n?.[`c${i}`] ?? 0)])),
          totals: n ? totals.read(n) : {},
          ...(facets ? { facets } : {}),
          next: last
            ? encode([
                p.sortKey,
                last.__sort === null,
                (last.__sort as string | null) ?? null,
                String(last.__key),
              ])
            : null,
        };
      }),

    get: (ask: GetAsk): Promise<RecordAnswer> =>
      guard(async () => {
        const t = typeOf(ask.record);
        const id = idOf(ask.id);
        const [raw] = await db.execute<Raw>(sql`
          select ${columnsOf(t)} from ${await source(t)}
          where (${ref(t.key)})::text = ${id} limit 1`);
        if (!raw) throw new PortalRefusal(`no such ${t.name.one}`, 404);
        const related = [];
        for (const r of t.related ?? []) {
          // A type this login can't open isn't served, so it isn't counted either.
          const other = types.find((x) => x.id === r.record);
          if (!other) continue;
          const [c] = await db.execute<{ n: number }>(sql`
            select count(*)::int n from ${await source(other)}
            where (${ref(r.by)})::text = ${id}`);
          related.push({ record: other.id, count: Number(c?.n ?? 0) });
        }
        const activity = t.activity
          ? (
              await db.execute<Raw>(sql`
                select r.at, r.kind, r.what from ${viewSql(t.activity.view)} r
                where (${ref(t.activity.by)})::text = ${id}
                order by r.at desc nulls last
                  ${t.activity.seq ? sql`, ${ref(t.activity.seq)} desc nulls last` : sql``}
                limit ${ACTIVITY}`)
            ).map((a) => ({
              at: a.at instanceof Date ? a.at.toISOString() : String(a.at),
              kind: a.kind === null ? null : String(a.kind),
              what: String(a.what ?? ""),
            }))
          : null;
        const detail = t.load ? await t.load(db, id) : null;
        return {
          record: t.id,
          row: rowOf(t, raw),
          related,
          activity: masked(activity),
          detail: masked(detail),
          ...(t.edits && !demo ? { edit: await editState(db, t, id) } : {}),
        };
      }),

    export: (ask: ExportAsk): Promise<RecordsFile> =>
      guard(async () => {
        const { format = "csv", ...list } = ask;
        if (format !== "csv" && format !== "jsonl") throw new BadAsk(`no ${format} export`);
        const p = plan(list);
        const raw = await db.execute<Raw>(sql`
          select ${columnsOf(p.t)} from ${await source(p.t)}
          where ${p.base} and ${p.inView}
          order by ${p.order}
          limit ${MAX_EXPORT + 1}`);
        const kept = raw.slice(0, MAX_EXPORT).map((r) => rowOf(p.t, r));
        const base = { record: p.t.id, format, rows: kept.length, capped: raw.length > MAX_EXPORT };
        if (format === "jsonl") return { ...base, body: await jsonlOf(p.t, kept) };
        const columns = ["ID", ...Object.values(p.t.fields).map((f) => f.label)];
        return { ...base, body: toCsv({ columns, rows: kept.map((r) => csvRow(p.t, r)) }) };
      }),

    /**
     * A number for an Overview: rows (or a field's sum) whose date falls in this period so far,
     * the same stretch before, and each day's. Filters as list does; it groups by day only, so
     * no name rides out on a key.
     */
    stats: (ask: StatsAsk, now = new Date()): Promise<RecordsStat> =>
      guard(async () => {
        const p = plan(ask);
        const fieldOf = (k: unknown) =>
          typeof k === "string" && Object.hasOwn(p.t.fields, k) ? p.t.fields[k] : undefined;
        const atField = fieldOf(ask.at ?? p.view?.at);
        if (atField?.kind !== "date") throw new BadAsk(`say which date ${p.t.name.many} count by`);
        const sumField = ask.sum === undefined ? null : fieldOf(ask.sum);
        if (sumField !== null && sumField?.kind !== "number" && sumField?.kind !== "money")
          throw new BadAsk(`${p.t.name.many} can't add that up`);
        const medianField = ask.median === undefined ? null : fieldOf(ask.median);
        if (
          medianField !== null &&
          medianField?.kind !== "number" &&
          medianField?.kind !== "duration"
        )
          throw new BadAsk(`${p.t.name.many} have no median there`);
        if (medianField && (sumField || ask.pick !== undefined))
          throw new BadAsk("a median takes no sum or pick");
        const zone =
          typeof ask.zone === "string" ? canonicalZone(ask.zone) : ask.zone ? null : "UTC";
        if (!zone) throw new BadAsk("no such time zone");
        // A bare day ("2026-03-10") starts at midnight in `zone`, not at UTC's. Branch on the
        // column's type: the text round trip on every row cost ~4x on timestamp columns.
        const col = ref(atField.from ?? "");
        const atText = sql`(${col})::text`;
        const at = sql`(case pg_typeof(${col})
          when 'timestamptz'::regtype then (${col})::timestamptz
          when 'date'::regtype then (${col})::date::timestamp at time zone ${zone}
          else (case when ${atText} ~ ${BARE_DAY}
            then ${atText}::timestamp at time zone ${zone} else ${atText}::timestamptz end) end)`;
        const ts = (d: Date) => bind(d.toISOString(), "timestamptz");
        const from = await source(p.t);
        const stat = (
          value: unknown,
          prior: unknown,
          series: RecordsStat["series"],
          currency: unknown,
        ) => ({
          record: p.t.id,
          view: p.view?.id ?? null,
          value: value === null || value === undefined ? null : Number(value),
          prior: prior === null || prior === undefined ? null : Number(prior),
          series,
          currency: typeof currency === "string" ? currency : null,
        });

        if (ask.pick !== undefined) {
          const f = fieldOf(ask.pick);
          if (!f || KINDS[f.kind].sql !== "numeric")
            throw new BadAsk(`${p.t.name.many} have no number to pick there`);
          const currency = f.kind === "money" ? ref(f.currency ?? "") : sql`null::text`;
          const rows = await db.execute<Raw>(sql`
            select ${at} "at", ${valueSql(f)}::numeric "value", ${currency} "currency"
            from ${from} where ${p.base} and ${p.inView} and ${at} <= ${ts(now)}
            order by 1 desc limit ${PICKS}`);
          const series = rows
            .map((r) => ({
              at: new Date(r.at as string).toISOString(),
              value: r.value === null ? null : Number(r.value),
            }))
            .reverse();
          return stat(rows[0]?.value, rows[1]?.value, series, rows[0]?.currency);
        }

        const { period } = ask;
        if (
          period !== "month" &&
          !(
            Number.isSafeInteger(period) &&
            (period as number) >= 1 &&
            (period as number) <= MAX_DAYS
          )
        )
          throw new BadAsk(`period takes 1 to ${MAX_DAYS} days or "month"`);
        const w = statWindows(period as Period, zone, now);
        const within = (a: Date, b: Date) => sql`(${at} >= ${ts(a)} and ${at} < ${ts(b)})`;
        const agg = (when: SQL) =>
          medianField
            ? sql`percentile_cont(0.5) within group (order by ${valueSql(medianField)}) filter (where ${when})`
            : sumField
              ? sql`coalesce(sum(${valueSql(sumField)}) filter (where ${when}), 0)`
              : sql`count(*) filter (where ${when})`;
        const both = sql`(${within(w.from, now)} or ${within(w.priorFrom, w.priorTo)})`;
        const currency =
          sumField?.kind === "money" ? ref(sumField.currency ?? "") : sql`null::text`;
        const [n] = await db.execute<Raw>(sql`
          select ${agg(within(w.from, now))}::numeric "value",
            ${agg(within(w.priorFrom, w.priorTo))}::numeric "prior",
            count(distinct ${currency}) filter (where ${both})::int "currencies",
            min(${currency}) filter (where ${both}) "currency"
          from ${from} where ${p.base} and ${p.inView}`);
        if (Number(n?.currencies ?? 0) > 1) throw new BadAsk(`${sumField?.label} mixes currencies`);
        const days = await db.execute<Raw>(sql`
          select width_bucket(${at}, array[${sql.join(w.days.map(ts), sql`, `)}]) "day",
            ${agg(sql`true`)}::numeric "value"
          from ${from} where ${p.base} and ${p.inView} and ${within(w.from, now)}
          group by 1`);
        // A median's day without rows has none; a count's or a sum's is 0.
        const series: RecordsStat["series"] = w.days.map((d) => ({
          at: d.toISOString(),
          value: medianField ? null : 0,
        }));
        for (const d of days) {
          const point = series[Number(d.day) - 1];
          if (point) point.value = d.value === null ? null : Number(d.value);
        }
        if (!medianField) return stat(n?.value ?? 0, n?.prior ?? 0, series, n?.currency);
        const v = valueSql(medianField);
        const [last] = await db.execute<Raw>(sql`
          select ${v}::numeric "value" from ${from}
          where ${p.base} and ${p.inView} and ${within(w.from, now)} and ${v} is not null
          order by ${at} desc limit 1`);
        return {
          ...stat(n?.value ?? null, n?.prior ?? null, series, null),
          latest: last?.value == null ? null : Number(last.value),
        };
      }),
  };
}
export type RecordsApi = ReturnType<typeof serveRecords>;
