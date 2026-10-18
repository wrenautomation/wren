/**
 * Every records page's reads (`<product>/recordsTypes`, `recordsList`, `recordsGet`, `recordsCounts`),
 * answered from the page's own config: its columns become fields, the states its `count` and
 * `needs` name become a status, and rows are made up per field kind. The server's real types
 * live in each product's records list; this shows the page's frame (bar, views, table, panel)
 * with believable cells, not the server's exact columns. Synthetic data only.
 */

import { APPS } from "@wren/core/access";
import {
  actor,
  company,
  date,
  defineRecord,
  metaOf,
  money,
  name,
  number,
  prose,
  type RecordMeta,
  score,
  status,
  text,
} from "@wren/core/records";
import type { GetAsk, ListAsk, RecordAnswer, RecordsStat, Row } from "@wren/core/records/serve";
import { pageOf } from "@wren/ui/fixtures";
import type { ListPage } from "../../module.js";
import { MODULES } from "../../modules/index.js";
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

const PAGES: (ListPage & { app: string })[] = MODULES.flatMap((m) =>
  m.pages.flatMap((p) => ("record" in p && p.record ? [{ ...(p as ListPage), app: m.id }] : [])),
);

/** A field for `key`, by its name: `sentAt` a date, `amount` money, `status` a status. */
function fieldFor(key: string, states: string[]) {
  const k = key.toLowerCase();
  if (states.length && /(^|_)(state|status|stage|verdict)$/.test(k))
    return status(Object.fromEntries(states.map((s) => [s, { label: words(s), tone: toneOf(s) }])));
  if (/(at|on|date|seen|since|due|when|day)$/.test(k)) return date();
  if (/(amount|value|price|cost|revenue|total|paid|mrr)$/.test(k)) return money();
  if (/score$/.test(k)) return score();
  if (/(company|firm|business|account)$/.test(k)) return company();
  if (/(owner|by|who|assignee|author|agent)$/.test(k)) return actor();
  if (/(count|visits|views|sent|opens|clicks|replies|calls|n|size|leads)$/.test(k)) return number();
  if (/(note|body|text|summary|preview|reply|message|about|why)$/.test(k)) return prose();
  if (/(name|title|person|contact|lead)$/.test(k)) return name();
  return text();
}

const words = (s: string) => s.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const toneOf = (s: string) =>
  /wait|pending|draft|open|new|review|hold|ask/.test(s)
    ? "warn"
    : /fail|lost|bounce|bad|reject|stuck|refus/.test(s)
      ? "bad"
      : /done|sent|won|live|paid|ok|approv|booked|active/.test(s)
        ? "good"
        : "neutral";
const IDENT = /^[a-z_][a-z0-9_]*$/i;

/** The record type a page names, made from every page that names it. */
function typeOf(record: string) {
  const pages = PAGES.filter((p) => p.record === record);
  const wheres = pages.flatMap((p) => [p.count, p.needs].filter(Boolean)) as Readonly<
    Record<string, readonly string[]>
  >[];
  const states: Record<string, Set<string>> = {};
  for (const w of wheres)
    for (const [k, v] of Object.entries(w)) states[k] = new Set([...(states[k] ?? []), ...v]);
  const stateKey = Object.keys(states)[0] ?? "status";
  const stateList = [...(states[stateKey] ?? ["open"]), "done"];
  const keys = [
    ...new Set([
      "name",
      ...pages.flatMap((p) => p.columns ?? []).filter((k) => IDENT.test(k) && k !== "id"),
      stateKey,
      "updatedAt",
    ]),
  ];
  const fields = Object.fromEntries(
    keys.map((k) => [k, k === stateKey ? fieldFor("status", stateList) : fieldFor(k, [])]),
  );
  const [one, many] = nameOf(record, pages[0]?.label);
  const app = pages[0] && Object.hasOwn(APPS, pages[0].app) ? pages[0].app : Object.keys(APPS)[0];
  const actions = [...new Set(pages.flatMap((p) => (p.actions ?? []).map((a) => a.id)))];
  return defineRecord({
    id: record,
    name: { one, many },
    view: "fake",
    key: "id",
    title: "name",
    app: app ?? "work",
    channel: null,
    fields,
    views: [
      ...(Object.entries(states).length
        ? [
            {
              id: "waiting",
              label: "Waiting",
              where: { [stateKey]: [...(states[stateKey] ?? [])] },
            },
          ]
        : []),
      { id: "all", label: "All", sort: "-updatedAt" },
    ],
    related: [],
    actions,
    activity: { view: "fake_log", by: "id" },
  });
}

const nameOf = (record: string, label?: string): [string, string] => {
  const one = (record.split(".").pop() ?? record).replace(/_/g, " ");
  return [one, label?.toLowerCase() ?? `${one}s`];
};

const PEOPLE = ["Ada North", "Bo Fenwick", "Cai Moreno", "Dee Okafor", "Eli Brandt", "Fay Lin"];
const FIRMS = ["Northwind", "Fenwick & Sons", "Moreno Roofing", "Okafor Electric", "Brandt HVAC"];
const LINES = [
  "Asked for a quote on the winter run.",
  "Replied with a question about timing.",
  "Booked a call for Thursday.",
  "No answer to the second message yet.",
];

/** Rows for `meta`: one cell per field, by its kind. */
function rowsOf(meta: RecordMeta, n = 8): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const row: Row = { id: i + 1 };
    for (const f of meta.fields) {
      const states = f.states ? Object.keys(f.states) : [];
      row[f.key] =
        f.kind === "status"
          ? (states[i % states.length] ?? null)
          : f.kind === "date"
            ? ago(i * 0.7 + 0.1)
            : f.kind === "money"
              ? { amount: 400 + ((i * 1370) % 9000), currency: "USD" }
              : f.kind === "score"
                ? 95 - i * 9
                : f.kind === "number"
                  ? (i * 7) % 23
                  : f.kind === "company"
                    ? { name: FIRMS[i % FIRMS.length] ?? "", domain: null }
                    : f.kind === "prose"
                      ? (LINES[i % LINES.length] ?? null)
                      : f.kind === "name" || f.kind === "actor"
                        ? (PEOPLE[i % PEOPLE.length] ?? null)
                        : `${f.label} ${i + 1}`;
    }
    return row;
  });
}

/**
 * Rows written by hand, for a record that code reads as its own type (Today's plan reads
 * `marketing.cadence` rows as goals), where made-up cells would not fit.
 */
let OWN: Record<string, Row[]> = {};

const TYPES = new Map<string, { meta: RecordMeta; rows: Row[] }>();
function recordOf(id: string) {
  let got = TYPES.get(id);
  if (!got) {
    const meta = { ...metaOf(typeOf(id), false), detail: true };
    got = { meta, rows: OWN[id] ?? rowsOf(meta) };
    TYPES.set(id, got);
  }
  return got;
}

/** Count stats for any records view: a gentle week, up on the one before. */
function statOf(b: Record<string, unknown>): RecordsStat {
  const series = Array.from({ length: 7 }, (_, i) => ({
    at: ago(6 - i).slice(0, 10),
    value: 2 + ((i * 5) % 7),
  }));
  return {
    record: String(b.record ?? ""),
    view: typeof b.view === "string" ? b.view : null,
    value: series.reduce((n, s) => n + s.value, 0),
    prior: 21,
    series,
    currency: null,
  };
}

const LOG = [
  { at: ago(0.5), kind: "note", what: "Replied to the second message." },
  { at: ago(3), kind: "note", what: "Second message sent." },
  { at: ago(7), kind: "note", what: "First message sent." },
];

/** The records answers for every product that serves a page's record; `own` rows by record id. */
export function recordsAnswers(own: Record<string, Row[]> = {}): Answers {
  OWN = own;
  // The console serves Wren's own and every client's component records; channels serve their own.
  const products = [
    ...new Set(["console", "email", "sms", ...PAGES.map((p) => p.record.split(".")[0] ?? "")]),
  ];
  const out: Answers = {};
  const records = [...new Set(PAGES.map((p) => p.record))];
  for (const product of products) {
    out[`${product}/recordsTypes`] = () => records.map((r) => recordOf(r).meta);
    out[`${product}/recordsList`] = (b) => {
      const ask = b as unknown as ListAsk;
      const { meta, rows } = recordOf(ask.record);
      return pageOf(rows, ask, meta);
    };
    out[`${product}/recordsCounts`] = (b) => {
      const asks = Array.isArray(b.asks) ? (b.asks as ListAsk[]) : [];
      return {
        totals: asks.map((a) => pageOf(recordOf(a.record).rows, a, recordOf(a.record).meta).total),
      };
    };
    out[`${product}/recordsStats`] = statOf;
    out[`${product}/recordsGet`] = (b): RecordAnswer => {
      const ask = b as unknown as GetAsk;
      const { meta, rows } = recordOf(ask.record);
      const row = rows.find((r) => String(r.id) === String(ask.id)) ?? (rows[0] as Row);
      return { record: meta.id, row, related: [], activity: LOG, detail: null };
    };
  }
  return out;
}
