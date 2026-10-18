/**
 * Every records page's reads (`<product>/recordsTypes`, `recordsList`, `recordsGet`, `recordsCounts`),
 * answered with the server's own types: the meta of every record type the worker serves
 * (`virtual:record-types`, made in `.storybook/main.ts` from `apps/worker/src/record-types.ts`).
 * Rows are made up per field kind. A record the worker doesn't serve is unmocked: the story
 * fails. Synthetic data only.
 */

import TYPES from "virtual:record-types";
import type { Cell, RecordMeta } from "@wren/core/records";
import type { GetAsk, ListAsk, RecordAnswer, RecordsStat, Row } from "@wren/core/records/serve";
import { pageOf } from "@wren/ui/fixtures";
import type { ListPage } from "../../module.js";
import { MODULES } from "../../modules/index.js";
import { type Answers, unmocked } from "../api.js";
import { ago } from "./shell.js";

const PAGES: ListPage[] = MODULES.flatMap((m) =>
  m.pages.flatMap((p) => ("record" in p && p.record ? [p as ListPage] : [])),
);

const PEOPLE = ["Ada North", "Bo Fenwick", "Cai Moreno", "Dee Okafor", "Eli Brandt", "Fay Lin"];
const FIRMS = ["Northwind", "Fenwick & Sons", "Moreno Roofing", "Okafor Electric", "Brandt HVAC"];
const LINES = [
  "Asked for a quote on the winter run.",
  "Replied with a question about timing.",
  "Booked a call for Thursday.",
  "No answer to the second message yet.",
];

/** A cell of `kind` for row `i`. A field with states takes one of them. */
function cellOf(f: RecordMeta["fields"][number], i: number): Cell {
  const states = f.states ? Object.keys(f.states) : [];
  if (states.length && f.kind !== "tags") return states[i % states.length] ?? null;
  switch (f.kind) {
    case "date":
      return ago(i * 0.7 + 0.1);
    case "money":
      return { amount: 400 + ((i * 1370) % 9000), currency: "USD" };
    case "score":
      return 95 - i * 9;
    case "number":
      return (i * 7) % 23;
    case "percent":
      return ((i * 13) % 90) / 100;
    case "rate":
      return { n: (i * 3) % 11, of: 12 };
    case "duration":
      return 30 + ((i * 97) % 900);
    case "company":
      return { name: FIRMS[i % FIRMS.length] ?? "", domain: null };
    case "prose":
    case "cited":
      return LINES[i % LINES.length] ?? null;
    case "name":
    case "actor":
      return PEOPLE[i % PEOPLE.length] ?? null;
    case "link":
      return `https://example.com/${i + 1}`;
    case "tags":
      return states.slice(0, (i % 2) + 1).join(",") || null;
    default:
      return `${f.label} ${i + 1}`;
  }
}

/** Rows for `meta`: one cell per field, by its kind. */
function rowsOf(meta: RecordMeta, n = 8): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const row: Row = { id: i + 1 };
    for (const f of meta.fields) row[f.key] = cellOf(f, i);
    return row;
  });
}

/**
 * Rows written by hand, for a record that code reads as its own type (Today's plan reads
 * `marketing.cadence` rows as goals), where made-up cells would not fit.
 */
let OWN: Record<string, Row[]> = {};

const METAS = new Map(TYPES.map((m) => [m.id, m]));
const ROWS = new Map<string, Row[]>();
/** The worker's type `id` and its rows; null when the worker serves no such record. */
function recordOf(id: string) {
  const meta = METAS.get(id);
  if (!meta) return null;
  let rows = ROWS.get(id);
  if (!rows) {
    rows = OWN[id] ?? rowsOf(meta);
    ROWS.set(id, rows);
  }
  return { meta, rows };
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
  for (const product of products) {
    const key = (handler: string, record: string) => unmocked(`${product}/${handler}:${record}`);
    out[`${product}/recordsTypes`] = () => [...METAS.values()];
    out[`${product}/recordsList`] = (b) => {
      const ask = b as unknown as ListAsk;
      const got = recordOf(ask.record);
      return got ? pageOf(got.rows, ask, got.meta) : key("recordsList", ask.record);
    };
    out[`${product}/recordsCounts`] = (b) => {
      const asks = Array.isArray(b.asks) ? (b.asks as ListAsk[]) : [];
      return {
        totals: asks.map((a) => {
          const got = recordOf(a.record);
          // As the server: a list it can't read counts 0.
          if (got) return pageOf(got.rows, a, got.meta).total;
          key("recordsCounts", a.record);
          return 0;
        }),
      };
    };
    out[`${product}/recordsStats`] = statOf;
    out[`${product}/recordsGet`] = (b) => {
      const ask = b as unknown as GetAsk;
      const got = recordOf(ask.record);
      if (!got) return key("recordsGet", ask.record);
      const row = got.rows.find((r) => String(r.id) === String(ask.id)) ?? (got.rows[0] as Row);
      return {
        record: got.meta.id,
        row,
        related: [],
        activity: LOG,
        detail: null,
      } satisfies RecordAnswer;
    };
  }
  return out;
}
