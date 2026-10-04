/**
 * Record types (console standard, S1). A product declares each kind of row it shows once, as
 * plain data: the server builds every query from it (`./records-serve.ts`) and the web draws
 * from the server's `recordsTypes` answer plus `KINDS` here. No React, no database at runtime.
 *
 * A field reads one column of the record's SQL view, cast once by its kind, so a filter, a sort
 * and a page cursor compare the same values.
 */
import type { Queryable } from "@wren/db";

/** good green, warn amber, bad red, neutral gray. */
export type Tone = "good" | "warn" | "bad" | "neutral";
export type Op = "eq" | "in" | "contains" | "gte" | "lte" | "empty";
export interface State {
  label: string;
  tone: Tone;
}
/** What a cell holds once it leaves the server. */
export type Cell =
  | string
  | number
  | null
  | { name: string; domain: string | null }
  | { amount: number; currency: string }
  | { n: number; of: number };

interface KindFacts {
  /** How the column is cast: states sort in their declared order. */
  sql: "text" | "numeric" | "timestamptz" | "state";
  ops: readonly Op[];
  sortable: boolean;
  /** `q` matches it. */
  searchable: boolean;
  /** It names someone or a firm: the demo never filters, sorts or searches it (`allowed`). */
  masked: boolean;
  /** Its list column; null keeps it to the record's detail. */
  column: { align: "start" | "end"; width: "s" | "m" | "l" } | null;
  /** Its CSV cell. */
  csv(cell: Cell, field: Field): string | number | null;
}

const NUMBERS = ["eq", "gte", "lte", "empty"] as const;
const plain = (c: Cell) => (c === null || typeof c === "object" ? null : c);
const label = (c: Cell, f: Field) => (typeof c === "string" ? (f.states?.[c]?.label ?? c) : null);
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const left = { align: "start", width: "m" } as const;
const right = { align: "end", width: "s" } as const;

export const KINDS = {
  text: {
    sql: "text",
    ops: ["eq", "in", "contains", "empty"],
    sortable: true,
    searchable: true,
    masked: false,
    column: left,
    csv: plain,
  },
  name: {
    sql: "text",
    ops: ["contains", "empty"],
    sortable: true,
    searchable: true,
    masked: true,
    column: left,
    csv: plain,
  },
  company: {
    sql: "text",
    ops: ["eq", "in", "contains", "empty"],
    sortable: true,
    searchable: true,
    masked: true,
    column: left,
    csv: (c) => (c && typeof c === "object" && "name" in c ? c.name : null),
  },
  status: {
    sql: "state",
    ops: ["in"],
    sortable: true,
    searchable: false,
    masked: false,
    column: { align: "start", width: "s" },
    csv: label,
  },
  number: {
    sql: "numeric",
    ops: NUMBERS,
    sortable: true,
    searchable: false,
    masked: false,
    column: right,
    csv: plain,
  },
  money: {
    sql: "numeric",
    ops: NUMBERS,
    sortable: true,
    searchable: false,
    masked: false,
    column: right,
    csv: (c) =>
      c && typeof c === "object" && "amount" in c ? `${c.amount.toFixed(2)} ${c.currency}` : null,
  },
  /** A share from 0 to 1. */
  percent: {
    sql: "numeric",
    ops: NUMBERS,
    sortable: true,
    searchable: false,
    masked: false,
    column: right,
    csv: (c) => (typeof c === "number" ? pct(c) : null),
  },
  /** n of m: filters and sorts by n / m. */
  rate: {
    sql: "numeric",
    ops: ["gte", "lte"],
    sortable: true,
    searchable: false,
    masked: false,
    column: right,
    csv: (c) => (c && typeof c === "object" && "n" in c ? `${c.n} of ${c.of}` : null),
  },
  /** ISO; a CSV cell keeps the exact time. */
  date: {
    sql: "timestamptz",
    ops: ["gte", "lte", "empty"],
    sortable: true,
    searchable: false,
    masked: false,
    column: right,
    csv: plain,
  },
  /** An email check: valid, risky, catch_all, invalid. */
  verdict: {
    sql: "state",
    ops: ["in", "empty"],
    sortable: false,
    searchable: false,
    masked: false,
    column: { align: "start", width: "s" },
    csv: label,
  },
  score: {
    sql: "numeric",
    ops: NUMBERS,
    sortable: true,
    searchable: false,
    masked: false,
    column: right,
    csv: plain,
  },
  link: {
    sql: "text",
    ops: ["empty"],
    sortable: false,
    searchable: false,
    masked: false,
    column: { align: "start", width: "s" },
    csv: plain,
  },
  /** Text with source marks (`[f12]`); the record's `load` answers the sources they name. */
  cited: {
    sql: "text",
    ops: ["contains", "empty"],
    sortable: false,
    searchable: true,
    masked: false,
    column: null,
    csv: plain,
  },
} as const satisfies Record<string, KindFacts>;
export type Kind = keyof typeof KINDS;

export const VERDICTS: Readonly<Record<string, State>> = {
  valid: { label: "Valid", tone: "good" },
  catch_all: { label: "Catch-all", tone: "warn" },
  risky: { label: "Risky", tone: "warn" },
  invalid: { label: "Invalid", tone: "bad" },
};

export interface Field {
  kind: Kind;
  label: string;
  /** The view's column; the key in snake_case when absent. */
  from?: string;
  /** status, verdict: each state, in the order they sort. */
  states?: Readonly<Record<string, State>>;
  /** company: the column with its domain. */
  domain?: string;
  /** money: the column with each row's currency code. */
  currency?: string;
  /** rate: the column with the count it is out of. */
  of?: string;
  /** score: its top. */
  max?: number;
}
type Opts = Partial<Omit<Field, "kind" | "label">>;
type Draft = Omit<Field, "label"> & { label?: string };
const kind =
  (k: Kind) =>
  (label?: string, opts: Opts = {}): Draft => ({ kind: k, ...opts, ...(label ? { label } : {}) });

export const text = kind("text");
export const name = kind("name");
export const company = kind("company");
export const number = kind("number");
export const money = (label?: string, opts: Opts = {}) =>
  kind("money")(label, { currency: "currency", ...opts });
export const percent = kind("percent");
export const date = kind("date");
export const link = kind("link");
export const cited = kind("cited");
export const score = (label?: string, opts: Opts = {}) =>
  kind("score")(label, { max: 100, ...opts });
export const status = (states: Record<string, State>, label?: string, opts: Opts = {}) =>
  kind("status")(label, { states, ...opts });
export const verdict = (label?: string, opts: Opts = {}) =>
  kind("verdict")(label, { states: VERDICTS, ...opts });
export const rate = (of: string, label?: string, opts: Opts = {}) =>
  kind("rate")(label, { of, ...opts });

/**
 * A field's filter: a value (eq, or in for a status), a list (in), or ops (`{gte: 3}`,
 * `{empty: true}`). Every clause must hold.
 */
export type Filter = string | number | readonly (string | number)[] | Partial<Record<Op, unknown>>;
export type Where = Readonly<Record<string, Filter>>;
export interface SavedView {
  id: string;
  label: string;
  where?: Where;
  /** A sortable field, "-" first for descending: "-score". */
  sort?: string;
}

export interface RecordDecl<F extends Record<string, Draft>> {
  /** "<product>.<thing>": "reactivation.person". */
  id: string;
  name: { one: string; many: string };
  /** The SQL view behind it, one row per record. */
  view: string;
  /** The view's unique column. */
  key: string;
  title: keyof F & string;
  subtitle?: keyof F & string;
  fields: F;
  /** Tabs, the first opened by default. */
  views: readonly SavedView[];
  /** Records that point at this one: `by` is their view's column holding this key. */
  related?: readonly { record: string; by: string }[];
  /** A view of (`by`, at, what) lines about one record, newest first. */
  activity?: { view: string; by: string };
  /** Action ids the web offers on it. */
  actions?: readonly string[];
  /** What the detail adds past the row (a brief's sources); null when there's none. */
  load?: (db: Queryable, id: string) => Promise<object | null>;
}
export type RecordType = Omit<RecordDecl<Record<string, Draft>>, "fields"> & {
  fields: Readonly<Record<string, Field>>;
};

/** A browser asked for something the declaration doesn't allow; the server answers 400. */
export class BadAsk extends Error {}

/** One checked clause: the field, its op, a value fit to bind. */
export interface Clause {
  field: string;
  op: Op;
  value: string | number | boolean | (string | number)[];
}

const MAX_TEXT = 200;
const MAX_IN = 100;

function checked(f: Field, v: unknown): string | number {
  const facts = KINDS[f.kind];
  if (facts.sql === "numeric") {
    const n =
      typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
    if (!Number.isFinite(n)) throw new BadAsk(`${f.label} takes a number`);
    return n;
  }
  if (typeof v !== "string" || v.length > MAX_TEXT) throw new BadAsk(`${f.label} takes text`);
  if (facts.sql === "state" && !Object.hasOwn(f.states ?? {}, v))
    throw new BadAsk(`${f.label} has no such state`);
  if (facts.sql === "timestamptz" && Number.isNaN(Date.parse(v)))
    throw new BadAsk(`${f.label} takes a date`);
  return v;
}

function clause(f: Field, field: string, op: Op, v: unknown): Clause {
  if (!(KINDS[f.kind].ops as readonly Op[]).includes(op))
    throw new BadAsk(`${f.label} can't be filtered that way`);
  if (op === "empty") {
    if (typeof v !== "boolean") throw new BadAsk("empty takes true or false");
    return { field, op, value: v };
  }
  if (op === "in") {
    if (!Array.isArray(v) || v.length === 0 || v.length > MAX_IN)
      throw new BadAsk(`${f.label} takes a list of 1 to ${MAX_IN}`);
    return { field, op, value: v.map((x) => checked(f, x)) };
  }
  return { field, op, value: checked(f, v) };
}

/** A `where` from a declaration or a browser, checked field by field. */
export function clausesOf(type: RecordType, where: unknown): Clause[] {
  if (where === undefined || where === null) return [];
  if (typeof where !== "object" || Array.isArray(where)) throw new BadAsk("where takes an object");
  const out: Clause[] = [];
  for (const [key, filter] of Object.entries(where)) {
    const f = Object.hasOwn(type.fields, key) ? type.fields[key] : undefined;
    if (!f) throw new BadAsk(`no such field on ${type.name.many}`);
    const ops = KINDS[f.kind].ops as readonly Op[];
    if (Array.isArray(filter)) out.push(clause(f, key, "in", filter));
    else if (filter !== null && typeof filter === "object") {
      const entries = Object.entries(filter);
      if (!entries.length) throw new BadAsk(`${f.label} takes an op`);
      for (const [op, v] of entries) out.push(clause(f, key, op as Op, v));
    } else
      out.push(
        clause(f, key, ops.includes("eq") ? "eq" : "in", ops.includes("eq") ? filter : [filter]),
      );
  }
  return out;
}

/** "-score" as the field and direction; it must be a sortable field. */
export function sortOf(type: RecordType, sort: unknown): { field: string; desc: boolean } {
  if (typeof sort !== "string") throw new BadAsk("sort takes a field name");
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const f = Object.hasOwn(type.fields, field) ? type.fields[field] : undefined;
  if (!f || !KINDS[f.kind].sortable) throw new BadAsk(`${type.name.many} don't sort that way`);
  return { field, desc };
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const words = (s: string) => {
  const w = snake(s).replaceAll("_", " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * A record type from its declaration: labels filled from keys, columns named, and every name,
 * view and filter checked now, so a typo fails at import, not on a page.
 */
export function defineRecord<F extends Record<string, Draft>>(decl: RecordDecl<F>): RecordType {
  const fields: Record<string, Field> = {};
  for (const [key, d] of Object.entries(decl.fields)) {
    if (key === "id") throw new Error(`${decl.id}: "id" is the key; name the field otherwise`);
    fields[key] = { ...d, label: d.label ?? words(key), from: d.from ?? snake(key) };
  }
  const type: RecordType = { ...decl, fields };
  const columns = [
    decl.view,
    decl.key,
    ...(decl.related ?? []).map((r) => r.by),
    ...(decl.activity ? [decl.activity.view, decl.activity.by] : []),
    ...Object.values(fields).flatMap((f) => [f.from, f.domain, f.currency, f.of]),
  ];
  for (const c of columns)
    if (c !== undefined && !IDENT.test(c)) throw new Error(`${decl.id}: bad column ${c}`);
  for (const f of Object.values(fields)) {
    if (KINDS[f.kind].sql === "state" && !Object.keys(f.states ?? {}).length)
      throw new Error(`${decl.id}: ${f.label} needs states`);
    if (f.kind === "rate" && !f.of) throw new Error(`${decl.id}: ${f.label} needs of`);
  }
  for (const k of [decl.title, decl.subtitle])
    if (k !== undefined && !Object.hasOwn(fields, k)) throw new Error(`${decl.id}: no field ${k}`);
  if (!decl.views.length) throw new Error(`${decl.id}: needs a view`);
  if (new Set(decl.views.map((v) => v.id)).size !== decl.views.length)
    throw new Error(`${decl.id}: view ids repeat`);
  for (const v of decl.views) {
    clausesOf(type, v.where);
    if (v.sort) sortOf(type, v.sort);
  }
  return type;
}

/** What the web gets for a field: its kind's facts as this viewer may use them. */
export interface FieldMeta {
  key: string;
  kind: Kind;
  label: string;
  states?: Readonly<Record<string, State>>;
  max?: number;
  ops: readonly Op[];
  sortable: boolean;
  searchable: boolean;
  column: KindFacts["column"];
}
export interface RecordMeta {
  id: string;
  name: { one: string; many: string };
  title: string;
  subtitle: string | null;
  fields: FieldMeta[];
  views: readonly SavedView[];
  related: readonly { record: string }[];
  actions: readonly string[];
  activity: boolean;
  detail: boolean;
}

/**
 * What this viewer may do with a field. The demo never filters, sorts or searches a masked one,
 * never matches part of any text (substring hits would spell a hidden surname out letter by
 * letter), and sorts only by numbers, dates and states (a page marker carries the raw value).
 */
export function allowed(f: Field, demo: boolean) {
  const k = KINDS[f.kind];
  const ops = k.ops as readonly Op[];
  if (!demo) return { ops, sortable: k.sortable, searchable: k.searchable };
  if (k.masked) return { ops: [] as Op[], sortable: false, searchable: false };
  return {
    ops: ops.filter((o) => o !== "contains"),
    sortable: k.sortable && k.sql !== "text",
    searchable: false,
  };
}

export function metaOf(type: RecordType, demo: boolean): RecordMeta {
  return {
    id: type.id,
    name: type.name,
    title: type.title,
    subtitle: type.subtitle ?? null,
    fields: Object.entries(type.fields).map(([key, f]) => {
      const may = allowed(f, demo);
      return {
        key,
        kind: f.kind,
        label: f.label,
        ...(f.states ? { states: f.states } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
        ...may,
        column: KINDS[f.kind].column,
      };
    }),
    views: type.views,
    related: (type.related ?? []).map((r) => ({ record: r.record })),
    actions: type.actions ?? [],
    activity: !!type.activity,
    detail: !!type.load,
  };
}

/** The CSV row of a record: its id, then each field's cell, in declaration order. */
export const csvRow = (type: RecordType, row: Record<string, Cell>): (string | number | null)[] => [
  (row.id as string | number | undefined) ?? null,
  ...Object.entries(type.fields).map(([k, f]) => KINDS[f.kind].csv(row[k] ?? null, f)),
];
