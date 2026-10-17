/**
 * A fake records workspace for stories and unit tests: one record type ("Lead"), its rows, the
 * four record calls answered from them (views, search, filters, sort, group, paging, counts), and
 * the actions on it. No `/api`, no router. Synthetic data only.
 */
import {
  actor,
  type Cell,
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
import type { GetAsk, ListAsk, RecordAnswer, RecordsPage, Row } from "@wren/core/records/serve";
import { useMemo } from "react";
import type { Action, Call } from "../action.js";
import type { Needs, Place, RecordActs, RecordsApi } from "../records.js";
import { type LocalRecords, localRecords } from "../records-local.js";
import { answer, fails, pending } from "./load.js";
import { usePlace } from "./place.js";
import { WORST } from "./worst.js";

const STATES = {
  waiting: { label: "Waiting", tone: "warn", about: "Nobody has answered yet." },
  approved: { label: "Approved", tone: "good", about: "A person said yes." },
  rejected: { label: "Rejected", tone: "bad", about: "A person said no." },
  closed: { label: "Closed", tone: "neutral" },
} as const;

const TYPE = defineRecord({
  id: "demo.lead",
  name: { one: "lead", many: "leads" },
  view: "demo_leads",
  key: "id",
  title: "name",
  subtitle: "note",
  app: "leads",
  channel: null,
  fields: {
    name: name("Name"),
    company: company("Company", { domain: "domain" }),
    state: status(STATES, "State"),
    score: score("Score"),
    value: money("Value"),
    seen: date("Last seen"),
    owner: actor("Owner"),
    city: text("City"),
    note: prose("Note"),
    visits: number("Visits"),
  },
  views: [
    { id: "waiting", label: "Waiting", where: { state: ["waiting"] } },
    { id: "approved", label: "Approved", where: { state: ["approved"] } },
    { id: "all", label: "All", sort: "-seen" },
  ],
  related: [],
  actions: ["approve", "reject"],
  activity: { view: "demo_lead_log", by: "lead_id" },
});

/** The record type as the server's `recordsTypes` answers it. */
export const LEAD_META: RecordMeta = { ...metaOf(TYPE, false), detail: true };

/** The page's `needs`: a waiting lead waits on the viewer. */
export const LEAD_NEEDS: Needs = { state: ["waiting"] };

/** What the viewer may do with a lead: approve (undoable) and reject (asks first). */
export const LEAD_ACTIONS: readonly Action[] = [
  {
    id: "approve",
    label: "Approve",
    handler: "demo/approve",
    undo: "demo/unapprove",
    key: "a",
    bulk: true,
    when: { state: ["waiting"] },
    sets: { state: "approved" },
  },
  {
    id: "reject",
    label: "Reject",
    handler: "demo/reject",
    key: "r",
    bulk: true,
    confirm: "Reject this lead?",
    when: { state: ["waiting"] },
    sets: { state: "rejected" },
  },
];

const lead = (
  id: number,
  who: string,
  firm: string,
  state: keyof typeof STATES,
  scoreOf: number,
  amount: number,
  seen: string,
  city: string,
  words: string,
): Row => ({
  id,
  name: who,
  company: { name: firm, domain: `${firm.toLowerCase().replace(/\W+/g, "")}.example` },
  state,
  score: scoreOf,
  value: { amount, currency: "USD" },
  currency: "USD",
  seen,
  owner: id % 3 ? "ana@desk.example" : "pipeline:compose",
  city,
  note: words,
  visits: id * 3,
});

/** Fourteen leads across the four states; six wait on the viewer. */
export const LEADS: Row[] = [
  lead(
    1,
    "Ada North",
    "Northwind",
    "waiting",
    100,
    4800,
    "2026-10-16T09:12:00Z",
    "Leeds",
    "Asked for a quote on the winter run.",
  ),
  lead(
    2,
    "Bo Fenwick",
    "Fenwick & Sons",
    "waiting",
    84,
    2100,
    "2026-10-16T07:40:00Z",
    "Bristol",
    "Replied to the second email with a question about timing.",
  ),
  lead(
    3,
    "Cai Moreno",
    "Moreno Dental",
    "approved",
    77,
    9600,
    "2026-10-15T15:05:00Z",
    "Cardiff",
    "Booked a call for Tuesday.",
  ),
  lead(
    4,
    "Dee Okafor",
    "Okafor Legal",
    "waiting",
    68,
    1200,
    "2026-10-15T11:22:00Z",
    "Leicester",
    "Opened three times, no reply.",
  ),
  lead(
    5,
    "Eli Park",
    "Parkside Garage",
    "closed",
    41,
    0,
    "2026-10-14T16:30:00Z",
    "Derby",
    "Went with another firm.",
  ),
  lead(
    6,
    "Fay Lindqvist",
    "Lindqvist Studio",
    "approved",
    88,
    7300,
    "2026-10-14T10:02:00Z",
    "Bath",
    "Sent the brief and the budget.",
  ),
  lead(
    7,
    "Gus Amari",
    "Amari Foods",
    "waiting",
    59,
    3400,
    "2026-10-13T14:48:00Z",
    "York",
    "Wants a sample first.",
  ),
  lead(
    8,
    "Hana Sato",
    "Sato Optics",
    "rejected",
    22,
    600,
    "2026-10-13T08:15:00Z",
    "Hull",
    "Out of area.",
  ),
  lead(
    9,
    "Ivo Brandt",
    "Brandt Cycles",
    "waiting",
    73,
    5200,
    "2026-10-12T17:37:00Z",
    "Exeter",
    "Forwarded the email to a partner.",
  ),
  lead(
    10,
    "Jun Wallace",
    "Wallace Yoga",
    "closed",
    35,
    0,
    "2026-10-12T12:09:00Z",
    "Poole",
    "Asked to stop.",
  ),
  lead(
    11,
    "Kit Ramos",
    "Ramos Tiles",
    "approved",
    80,
    6100,
    "2026-10-11T09:55:00Z",
    "Bolton",
    "Agreed on scope.",
  ),
  lead(
    12,
    "Lou Chen",
    "Chen Pharmacy",
    "waiting",
    66,
    2900,
    "2026-10-10T13:20:00Z",
    "Dover",
    "Clicked the pricing link.",
  ),
  lead(
    13,
    "Mia Duval",
    "Duval Bakery",
    "rejected",
    28,
    450,
    "2026-10-09T10:44:00Z",
    "Ely",
    "Budget too small.",
  ),
  lead(
    14,
    "Noor Haddad",
    "Haddad Studio",
    "approved",
    93,
    12000,
    "2026-10-08T16:01:00Z",
    "Wells",
    "Signed. Kickoff next week.",
  ),
];

/**
 * Leads built from the worst-case values: a long name and firm, an address that never breaks,
 * non-Latin and right-to-left words, emoji, a huge and a negative sum, a one-letter name and a
 * row with most of its fields missing.
 */
export const WORST_LEADS: Row[] = [
  {
    ...lead(
      1,
      WORST.longName,
      WORST.longCompany,
      "waiting",
      100,
      WORST.hugeCount,
      "2026-10-16T09:12:00Z",
      WORST.url,
      WORST.longText,
    ),
    owner: WORST.email,
  },
  lead(
    2,
    WORST.nonLatin,
    "山田商店",
    "waiting",
    0,
    WORST.negative,
    "2026-10-15T09:12:00Z",
    "تل أبيب",
    WORST.rtl,
  ),
  lead(
    3,
    WORST.emoji,
    WORST.emoji,
    "approved",
    50,
    WORST.zero,
    "2026-10-14T09:12:00Z",
    "—",
    WORST.emoji,
  ),
  lead(4, WORST.shortName, "Q", "closed", 5, 1, "2026-10-13T09:12:00Z", "Q", "Q"),
  { id: 5, name: "Only a name", state: "waiting" } as Row,
];

type Mode = "ok" | "pending" | "fails";

export interface FakeRecordsOptions {
  rows?: Row[];
  /** How each call answers: `ok` (default), never (`pending`) or with a 500 (`fails`). */
  types?: Mode;
  list?: Mode;
  get?: Mode;
  /** Wait this long (ms) before an `ok` answer. */
  ms?: number;
}

const read = <T>(mode: Mode, make: () => T, ms: number): (() => Promise<T>) =>
  mode === "pending" ? pending<T>() : mode === "fails" ? fails<T>() : answer(make(), ms);

const sortKey = (c: Cell | undefined, state?: string[]): string | number => {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return c;
  if (typeof c === "object") return "name" in c ? c.name : "amount" in c ? c.amount : c.n / c.of;
  const i = state?.indexOf(c) ?? -1;
  return i >= 0 ? i : c;
};

const hasText = (row: Row, q: string) =>
  Object.values(row).some((c) =>
    String(typeof c === "object" && c ? ("name" in c ? c.name : "") : (c ?? ""))
      .toLowerCase()
      .includes(q.toLowerCase()),
  );

const meetsFilter = (cell: Cell | undefined, w: unknown): boolean => {
  if (Array.isArray(w)) return w.map(String).includes(String(cell ?? ""));
  if (typeof w === "string" || typeof w === "number") return String(w) === String(cell ?? "");
  if (w && typeof w === "object") {
    const o = w as Record<string, unknown>;
    const s = String(sortKey(cell));
    if ("contains" in o && !s.toLowerCase().includes(String(o.contains).toLowerCase()))
      return false;
    if ("gte" in o && !(sortKey(cell) >= (o.gte as number | string))) return false;
    if ("lte" in o && !(sortKey(cell) <= (o.lte as number | string))) return false;
    if ("empty" in o && (cell === null || cell === undefined || cell === "") !== !!o.empty)
      return false;
  }
  return true;
};

/** The rows an ask keeps, in the order it asks for. */
function select(rows: Row[], ask: ListAsk, view = ask.view): Row[] {
  const v = LEAD_META.views.find((x) => x.id === view);
  const where = { ...(v?.where ?? {}), ...((ask.where as Record<string, unknown>) ?? {}) };
  const kept = rows.filter(
    (r) =>
      Object.entries(where).every(([k, w]) => meetsFilter(r[k], w)) &&
      (!ask.q || hasText(r, ask.q)),
  );
  const sort = ask.sort ?? v?.sort;
  const key = sort?.replace(/^-/, "");
  const order = (k: string) => {
    const f = LEAD_META.fields.find((x) => x.key === k);
    return f?.states ? Object.keys(f.states) : undefined;
  };
  const out = [...kept];
  if (key) {
    const states = order(key);
    out.sort((a, b) => {
      const x = sortKey(a[key], states);
      const y = sortKey(b[key], states);
      const d =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort?.startsWith("-") ? -d : d;
    });
  }
  if (ask.group) {
    const g = ask.group;
    const states = order(g);
    out.sort((a, b) => Number(sortKey(a[g], states)) - Number(sortKey(b[g], states)));
  }
  return out;
}

/** The page the server would answer for `ask` over `rows`. */
export function pageOf(rows: Row[], ask: ListAsk): RecordsPage {
  const all = select(rows, ask);
  const from = ask.offset ?? 0;
  const out: RecordsPage = {
    record: LEAD_META.id,
    view: ask.view ?? null,
    rows: all.slice(from, from + (ask.limit ?? 50)),
    total: all.length,
    counts: Object.fromEntries(LEAD_META.views.map((v) => [v.id, select(rows, ask, v.id).length])),
    next: null,
    totals: {},
  };
  if (ask.facets) {
    const count = (key: string) => {
      const others = { ...(ask.where as Record<string, unknown>) };
      delete others[key];
      const by: Record<string, number> = {};
      for (const r of select(rows, { ...ask, where: others })) {
        const k = String(r[key] ?? "");
        by[k] = (by[k] ?? 0) + 1;
      }
      return by;
    };
    out.facets = { state: count("state") };
  }
  return out;
}

const LOG = [
  { at: "2026-10-16T09:12:00Z", kind: "email", what: "Replied to the second email." },
  { at: "2026-10-14T08:00:00Z", kind: "email", what: "Second email sent." },
  { at: "2026-10-10T08:00:00Z", kind: "email", what: "First email sent." },
];

/**
 * The four record calls (and the type's `keep`-less workspace) answered from `rows`. Each call
 * can be held (`pending`) or refused (`fails`) to show the loading and failed states.
 */
export function fakeRecords(o: FakeRecordsOptions = {}): RecordsApi {
  const rows = o.rows ?? LEADS;
  const ms = o.ms ?? 0;
  return {
    types: read(o.types ?? "ok", () => [LEAD_META], ms),
    list: (ask: ListAsk) => read(o.list ?? "ok", () => pageOf(rows, ask), ms)(),
    get: (ask: GetAsk) =>
      read(
        o.get ?? "ok",
        (): RecordAnswer => {
          const row = rows.find((r) => String(r.id) === String(ask.id)) ?? rows[0];
          return {
            record: LEAD_META.id,
            row: row as Row,
            related: [],
            activity: LOG,
            detail: null,
          };
        },
        ms,
      )(),
    export: answer({
      record: LEAD_META.id,
      format: "csv" as const,
      body: "id,name\n",
      rows: rows.length,
      capped: false,
    }),
  };
}

export interface RecordsDemo {
  api: RecordsApi;
  place: Place;
  acts: RecordActs;
  local: LocalRecords;
}

/**
 * A whole records page for one story: the fake workspace on the demo's browser copy (an approve
 * moves a row between views, as it does on the public demo), a place in the hash, and the
 * actions as a viewer on Wren's team. Fresh on each mount.
 */
export function useRecordsDemo(
  o: FakeRecordsOptions & { at?: string; picked?: (string | number)[] } = {},
): RecordsDemo {
  const place = usePlace(
    o.at ?? "",
    o.picked ? { picked: o.picked.map(String) } : {},
    LEAD_META.name.one,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: one copy per mount, whatever `o` is.
  const local = useMemo(() => localRecords(fakeRecords(o)), []);
  const call: Call = useMemo(() => local.callFor(LEAD_META.id, LEAD_ACTIONS), [local]);
  const acts = useMemo<RecordActs>(
    () => ({ actions: LEAD_ACTIONS, viewer: { team: true, demo: false }, call }),
    [call],
  );
  return { api: local.api, place, acts, local };
}
