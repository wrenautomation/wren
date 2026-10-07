/**
 * Record types (console standard, S1). A product declares each kind of row it shows once, as
 * plain data: the server builds every query from it (`./records-serve.ts`) and the web draws
 * from the server's `recordsTypes` answer plus `KINDS` here. No React, no database at runtime.
 *
 * A field reads one column of the record's SQL view, cast once by its kind, so a filter, a sort
 * and a page cursor compare the same values.
 */
import type { Queryable } from "@wren/db";
import type { ZodType } from "zod";
import { APPS, isChannel, type Permission } from "./access.js";

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
  /**
   * Several of its `states` at once ("email,text"): a filter matches a row with any picked one.
   * ponytail: kept as comma-joined text, so a state can't hold a comma; a text[] column if one must.
   */
  tags: {
    sql: "state",
    ops: ["in"],
    sortable: false,
    searchable: false,
    masked: false,
    column: left,
    csv: (c, f) =>
      typeof c === "string" && c
        ? c
            .split(",")
            .map((s) => f.states?.[s]?.label ?? s)
            .join(", ")
        : null,
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
  /**
   * Who or what made a row: a person's email ("ana@firm.example"), or a machine as "<what>:<which>"
   * ("pipeline:compose", "import:leads.csv", "form:lander"). It can name someone: masked.
   */
  actor: {
    sql: "text",
    ops: ["eq", "in", "contains", "empty"],
    sortable: true,
    searchable: true,
    masked: true,
    column: left,
    csv: plain,
  },
  /** Long text with its line breaks (an email's copy): its own section on the page, never a column. */
  prose: {
    sql: "text",
    ops: ["contains", "empty"],
    sortable: false,
    searchable: true,
    masked: false,
    column: null,
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
  /** false: no footer total, for a column too costly to compute over every row. */
  total?: false;
  /**
   * Its heading on a record's page; ungrouped fields come first. An actor and the created and
   * updated dates default to "System", drawn last and folded.
   */
  group?: string;
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
export const prose = kind("prose");
export const actor = kind("actor");
export const score = (label?: string, opts: Opts = {}) =>
  kind("score")(label, { max: 100, ...opts });
export const status = (states: Record<string, State>, label?: string, opts: Opts = {}) =>
  kind("status")(label, { states, ...opts });
export const tags = (states: Record<string, State>, label?: string, opts: Opts = {}) =>
  kind("tags")(label, { states, ...opts });
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
  /** The date field its stats count by (`recordsStats`): "received". */
  at?: string;
}

/** A patch or a record's editable values, by field key. */
export type Values = Record<string, unknown>;

/**
 * What may change on a record, and how (`./edits.ts`, designs/2026-10-06-edits-claude-templates.md).
 * The records layer serves edit, history, undo and Ask Claude from it; the store only reads and
 * writes. Every edit is checked against `patch` then `check`, compare-and-swaps on the values'
 * version, and leaves a `changes` row.
 */
export interface RecordEdits {
  /** The fields a person changes in place, each a field of the record, in the form's order. */
  fields: readonly string[];
  /** Every key a patch may set (Claude's may set more than the form shows): partial and strict. */
  patch: ZodType<Values>;
  /** What the schema can't say (a slot's rules, a range past the end): what's wrong, or null. */
  check?: (
    patch: Values,
    now: Values,
    db: Queryable,
    id: string,
  ) => Promise<string | null> | string | null;
  /** The values a patch may set, as they are now; null when there's no such record. */
  read: (db: Queryable, id: string) => Promise<Values | null>;
  /** Write a checked patch, inside the edit's transaction; `by` is who pressed Save or Accept. */
  write: (db: Queryable, id: string, patch: Values, by: string) => Promise<void>;
  /** What Ask Claude reads past the record: the lead, the playbook or SOP, the numbers. */
  context?: (db: Queryable, id: string) => Promise<string | null>;
  /** What Claude is told the record is for, one line: "A cold text's words; it must say STOP." */
  about?: string;
  /** What editing needs at Wren; `run` when left out. Settings need `manage`. */
  needs?: "run" | "manage";
}

/** The kinds a person edits in place: one input each. */
export const EDITABLE: ReadonlySet<Kind> = new Set<Kind>([
  "text",
  "prose",
  "number",
  "status",
  "tags",
  "link",
  "date",
]);

export interface RecordDecl<F extends Record<string, Draft>> {
  /** "<product>.<thing>": "reactivation.person". */
  id: string;
  name: { one: string; many: string };
  /** The SQL view behind it, one row per record. */
  view?: string;
  /**
   * Or its rows from outside the database (Restate's state, the roster), keyed by column like a
   * view's. They are read once per request and queried as a table, so every filter, sort, page
   * and count is the same SQL. For a few hundred rows, not thousands.
   */
  rows?: (db: Queryable) => Promise<Record<string, unknown>[]>;
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
  /** What opening it needs past `read` (`@wren/core/access`): Wren's Money records need `money`. */
  needs?: Permission;
  /** What the detail adds past the row (a brief's sources); null when there's none. */
  load?: (db: Queryable, id: string) => Promise<object | null>;
  /** What a person or Claude may change on it; absent, it's read only. */
  edits?: RecordEdits;
  /** The app it belongs to (`APPS` in `./access.ts`): what a grant's `apps` names. */
  app: string;
  /**
   * Its channel (`ACCESS_CHANNELS`): one for every row, a field holding it per row, or null when
   * it has none. A login limited to channels sees only rows on theirs.
   */
  channel: RecordChannel;
  /**
   * The handlers its actions call ("Service/handler"), each with the input key that names the
   * row. A login limited to some apps or channels may call these on a row it may act on, and
   * no other handler.
   */
  calls?: Readonly<Record<string, string>>;
}
/** A record type's channel: one, a field holding it, or none. */
export type RecordChannel = string | { field: string } | null;
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
/** The group that folds last on a record's page. */
export const SYSTEM = "System";
const SYSTEM_KEYS = new Set(["created", "updated", "createdAt", "updatedAt"]);
const groupOf = (key: string, d: Draft) =>
  d.group ??
  (d.kind === "actor" || (d.kind === "date" && SYSTEM_KEYS.has(key)) ? SYSTEM : undefined);

/**
 * A record type from its declaration: labels filled from keys, columns named, and every name,
 * view and filter checked now, so a typo fails at import, not on a page.
 */
export function defineRecord<F extends Record<string, Draft>>(decl: RecordDecl<F>): RecordType {
  const fields: Record<string, Field> = {};
  for (const [key, d] of Object.entries(decl.fields)) {
    if (key === "id") throw new Error(`${decl.id}: "id" is the key; name the field otherwise`);
    const group = groupOf(key, d);
    fields[key] = {
      ...d,
      label: d.label ?? words(key),
      from: d.from ?? snake(key),
      ...(group ? { group } : {}),
    };
  }
  const type: RecordType = { ...decl, fields };
  if (!decl.view === !decl.rows) throw new Error(`${decl.id}: needs a view or rows, not both`);
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
    if (v.at !== undefined && fields[v.at]?.kind !== "date")
      throw new Error(`${decl.id}: ${v.id} counts by ${v.at}, not a date field`);
  }
  if (decl.edits) checkEdits(type, decl.edits);
  checkAttributes(type);
  DECLARED.set(type.id, { app: type.app, channel: type.channel });
  return type;
}

/**
 * Every record type declared in this process, by id, with its app and channel: the inventory
 * test reads it after the worker is built, and Access review lists what each app holds.
 */
export const DECLARED = new Map<string, { app: string; channel: RecordChannel }>();

/** Its app is one of `APPS`; its channel one of `ACCESS_CHANNELS`, a field it has, or null. */
export function checkAttributes(type: Pick<RecordType, "id" | "app" | "channel" | "fields">) {
  if (!Object.hasOwn(APPS, type.app)) throw new Error(`${type.id}: no such app ${type.app}`);
  const c = type.channel;
  if (c === null) return;
  if (typeof c === "string") {
    if (!isChannel(c)) throw new Error(`${type.id}: no such channel ${c}`);
  } else if (!Object.hasOwn(type.fields, c.field))
    throw new Error(`${type.id}: its channel is in a field it doesn't have: ${c.field}`);
}

function checkEdits(type: RecordType, edits: RecordEdits) {
  if (!edits.fields.length) throw new Error(`${type.id}: edits name no field`);
  if (!edits.patch.safeParse({}).success) throw new Error(`${type.id}: its patch must be partial`);
  for (const k of edits.fields) {
    const f = Object.hasOwn(type.fields, k) ? type.fields[k] : undefined;
    if (!f) throw new Error(`${type.id}: edits a field it doesn't have: ${k}`);
    if (!EDITABLE.has(f.kind)) throw new Error(`${type.id}: ${f.label} can't be edited in place`);
  }
}

/**
 * A record type someone else declared, made editable where its store is wired (the worker):
 * the declaring package keeps reading, the wiring adds the write.
 */
export function withEdits(type: RecordType, edits: RecordEdits): RecordType {
  const out = { ...type, edits };
  checkEdits(out, edits);
  return out;
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
  group?: string;
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
  /** The fields a person edits in place; absent or null when it's read only. Ask Claude comes with it. */
  edits?: readonly string[] | null;
  /** What editing needs, when it isn't `run`. */
  editNeeds?: "manage";
  /** Where its rows sit, for access checks on the web: the app, and the channel or its field. */
  app: string;
  channel: RecordChannel;
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
        ...(f.group ? { group: f.group } : {}),
      };
    }),
    views: type.views,
    related: (type.related ?? []).map((r) => ({ record: r.record })),
    actions: type.actions ?? [],
    activity: !!type.activity,
    detail: !!type.load,
    // The demo reads only: its edits would land nowhere.
    edits: type.edits && !demo ? type.edits.fields : null,
    ...(type.edits?.needs === "manage" && !demo ? { editNeeds: "manage" as const } : {}),
    app: type.app,
    channel: type.channel,
  };
}

/** The CSV row of a record: its id, then each field's cell, in declaration order. */
export const csvRow = (type: RecordType, row: Record<string, Cell>): (string | number | null)[] => [
  (row.id as string | number | undefined) ?? null,
  ...Object.entries(type.fields).map(([k, f]) => KINDS[f.kind].csv(row[k] ?? null, f)),
];
