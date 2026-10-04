/**
 * The records routes over one client's database: list, get, export, and the types the web draws.
 * Every name in the SQL comes from a declaration (`./records.ts`), never from the ask; every
 * value is bound and cast by its field's kind. Pages are keyset, ordered by the sort, then the
 * key as text, so equal sort values never repeat or skip a row.
 *
 * With a mask (the demo), every row, detail and CSV cell goes through it, and filters are only
 * those `allowed` leaves: no masked field, no substring match, no value the mask would rewrite.
 * A hit on a name would say who is on the list.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { toCsv } from "./console.js";
import { PortalRefusal } from "./portal.js";
import {
  allowed,
  BadAsk,
  type Cell,
  type Clause,
  clausesOf,
  csvRow,
  type Field,
  KINDS,
  metaOf,
  type RecordMeta,
  type RecordType,
  sortOf,
} from "./records.js";

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
}
export interface RecordsPage {
  record: string;
  view: string | null;
  rows: Row[];
  /** Rows in this view with this search; `counts` has every view's. */
  total: number;
  counts: Record<string, number>;
  next: string | null;
}
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
}
export type ExportAsk = Omit<ListAsk, "cursor" | "limit">;
export interface RecordsCsv {
  record: string;
  csv: string;
  rows: number;
  /** More rows matched than a CSV carries. */
  capped: boolean;
}

const PAGE = 50;
const MAX_LIMIT = 200;
/** Like ConsolePortal's cap on a view. */
export const MAX_EXPORT = 5000;
const MAX_Q = 100;
const MAX_CURSOR = 1000;
const ACTIVITY = 50;

type Cast = "text" | "numeric" | "timestamptz";
const ref = (column: string) => sql`r.${sql.identifier(column)}`;
const bind = (v: unknown, cast: Cast) => sql`${v}::${sql.raw(cast)}`;
const castOf = (f: Field): Cast => {
  const s = KINDS[f.kind].sql;
  return s === "state" ? "text" : s;
};
/** The field's value as filters compare it; a rate is n / m. */
const valueSql = (f: Field): SQL => {
  const c = ref(f.from ?? "");
  if (f.kind === "rate") return sql`((${c})::numeric / nullif((${ref(f.of ?? "")})::numeric, 0))`;
  return sql`(${c})::${sql.raw(castOf(f))}`;
};
/** The field as it sorts: a state by its place in the declaration. */
const sortSql = (f: Field): { expr: SQL; cast: Cast } =>
  KINDS[f.kind].sql === "state"
    ? {
        expr: sql`array_position(array[${sql.join(
          Object.keys(f.states ?? {}).map((s) => sql`${s}`),
          sql`, `,
        )}]::text[], (${ref(f.from ?? "")})::text)`,
        cast: "numeric",
      }
    : { expr: valueSql(f), cast: castOf(f) };
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const and = (parts: SQL[]) => (parts.length ? sql.join(parts, sql` and `) : sql`true`);

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
const columnsOf = (type: RecordType): SQL =>
  sql.join(
    [
      ...new Set([
        type.key,
        ...Object.values(type.fields).flatMap((f) =>
          [f.from, f.domain, f.currency, f.of].filter((c): c is string => !!c),
        ),
      ]),
    ].map(ref),
    sql`, `,
  );

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

export function serveRecords(types: readonly RecordType[], db: Queryable, mask?: Mask) {
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

  /** Everything a list or export asks, checked, as SQL. */
  function plan(ask: ExportAsk) {
    const t = typeOf(ask.record);
    let view = null;
    if (ask.view !== undefined) {
      view = t.views.find((v) => v.id === ask.view) ?? null;
      if (!view) throw new BadAsk(`${t.name.many} have no such view`);
    }
    const asked = clausesOf(t, ask.where);
    const base: SQL[] = asked.map((c) => {
      const f = t.fields[c.field] as Field;
      if (!allowed(f, demo).ops.includes(c.op))
        throw new BadAsk(`the demo doesn't filter ${f.label} that way`);
      return hides(mask, c.value) ? sql`false` : clauseSql(t, c);
    });
    if (ask.q !== undefined) {
      if (typeof ask.q !== "string" || ask.q.length > MAX_Q) throw new BadAsk("search is too long");
      const q = ask.q.trim();
      if (q) {
        const over = Object.values(t.fields).filter((f) => allowed(f, demo).searchable);
        if (!over.length) throw new BadAsk(`${t.name.many} can't be searched here`);
        base.push(
          sql`(${sql.join(
            over.map((f) => sql`${valueSql(f)} ilike ${like(q)}`),
            sql` or `,
          )})`,
        );
      }
    }
    if (ask.of !== undefined) {
      const of = ask.of as { record?: unknown; id?: unknown } | null;
      const parent = typeOf(of?.record);
      const rel = parent.related?.find((r) => r.record === t.id);
      if (!rel) throw new BadAsk(`${parent.name.many} have no ${t.name.many}`);
      base.push(sql`(${ref(rel.by)})::text = ${idOf(of?.id)}`);
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
    const inView = and(view ? clausesOf(t, view.where).map((c) => clauseSql(t, c)) : []);
    return { t, view, base: and(base), inView, by, order, sortKey: sort ? (sortName ?? "") : "" };
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
          from ${viewSql(p.t.view)} r
          where ${p.base} and ${p.inView} and ${after}
          order by ${p.order}
          limit ${limit + 1}`);
        const views = p.t.views;
        const [n] = await db.execute<Raw>(sql`
          select count(*) filter (where ${p.inView})::int "__total",
            ${sql.join(
              views.map(
                (v, i) =>
                  sql`count(*) filter (where ${and(clausesOf(p.t, v.where).map((c) => clauseSql(p.t, c)))})::int ${sql.identifier(`c${i}`)}`,
              ),
              sql`, `,
            )}
          from ${viewSql(p.t.view)} r where ${p.base}`);
        const page = raw.slice(0, limit);
        const last = raw.length > limit ? page.at(-1) : undefined;
        return {
          record: p.t.id,
          view: p.view?.id ?? null,
          rows: page.map((r) => rowOf(p.t, r)),
          total: Number(n?.__total ?? 0),
          counts: Object.fromEntries(views.map((v, i) => [v.id, Number(n?.[`c${i}`] ?? 0)])),
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
          select ${columnsOf(t)} from ${viewSql(t.view)} r
          where (${ref(t.key)})::text = ${id} limit 1`);
        if (!raw) throw new PortalRefusal(`no such ${t.name.one}`, 404);
        const related = [];
        for (const r of t.related ?? []) {
          const other = typeOf(r.record);
          const [c] = await db.execute<{ n: number }>(sql`
            select count(*)::int n from ${viewSql(other.view)} r
            where (${ref(r.by)})::text = ${id}`);
          related.push({ record: other.id, count: Number(c?.n ?? 0) });
        }
        const activity = t.activity
          ? (
              await db.execute<Raw>(sql`
                select r.at, r.kind, r.what from ${viewSql(t.activity.view)} r
                where (${ref(t.activity.by)})::text = ${id}
                order by r.at desc nulls last limit ${ACTIVITY}`)
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
        };
      }),

    export: (ask: ExportAsk): Promise<RecordsCsv> =>
      guard(async () => {
        const p = plan(ask);
        const raw = await db.execute<Raw>(sql`
          select ${columnsOf(p.t)} from ${viewSql(p.t.view)} r
          where ${p.base} and ${p.inView}
          order by ${p.order}
          limit ${MAX_EXPORT + 1}`);
        const rows = raw.slice(0, MAX_EXPORT).map((r) => csvRow(p.t, rowOf(p.t, r)));
        const columns = ["ID", ...Object.values(p.t.fields).map((f) => f.label)];
        return {
          record: p.t.id,
          csv: toCsv({ columns, rows }),
          rows: rows.length,
          capped: raw.length > MAX_EXPORT,
        };
      }),
  };
}
export type RecordsApi = ReturnType<typeof serveRecords>;
