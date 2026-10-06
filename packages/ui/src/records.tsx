/**
 * The List and Record templates (console standard): a record type's rows and one record, drawn
 * from what the server's `recordsTypes` says, never per page. The address is the state: the
 * view, filters, search, sort, columns, page and open record each ride in it.
 */
import { type Cell, type FieldMeta, type RecordMeta, SYSTEM } from "@wren/core/records";
import type {
  ExportAsk,
  GetAsk,
  ListAsk,
  RecordAnswer,
  RecordsCsv,
  RecordsPage,
  RecordsStat,
  Row,
  StatsAsk,
} from "@wren/core/records/serve";
import { cn } from "cn";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Columns3,
  ListFilter,
  Maximize2,
  Search,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { can, type Viewer } from "./access.js";
import { type Action, applies, type Call, useRun } from "./action.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Button } from "./controls.js";
import { DraftBox, type DraftHandle, type RecordDraft } from "./draft.js";
import { Alert } from "./feedback.js";
import {
  type CiteTo,
  dateOf,
  exact,
  FieldCell,
  FieldFilter,
  FieldLine,
  FieldTotal,
  filterLabel,
  filterShape,
  readFilter,
  relative,
  widthOf,
} from "./fields.js";
import { num } from "./format.js";
import { useScope } from "./palette-scope.js";
import { SourceCard, SourceList, stripMarks, useSourcePick } from "./sources.js";

/** The four record calls, bound to a workspace. */
export interface RecordsApi {
  types(): Promise<RecordMeta[]>;
  list(ask: ListAsk): Promise<RecordsPage>;
  get(ask: GetAsk): Promise<RecordAnswer>;
  export(ask: ExportAsk): Promise<RecordsCsv>;
  /** A number over a period against the one before, by day: the Overview's tiles. */
  stats?(ask: StatsAsk): Promise<RecordsStat>;
}

/** Where a template sits. */
export interface Place {
  params: URLSearchParams;
  /** This page with these params changed; null drops one, the rest stay. */
  link(change: Record<string, string | null>): string;
  /** A record's own page. */
  page(id: string | number): string;
  /** The list a record's page came from. */
  list: string;
  go(to: string, replace?: boolean): void;
}

/** One source card, with the mark a cited field points at it by. */
export interface RecordSource {
  mark: string;
  kind: string;
  meta?: string;
  title?: string | null;
  sure?: number | null;
  detail?: [string, string][];
  link?: { href: string | null; label: string } | null;
}

/** What a record adds from its `detail` (its type's `load`, if any): lines under its fields, sections, sources. */
export interface RecordExtras {
  /** What leads the details, before the fields: an email's draft. */
  lead?: ReactNode;
  /** Lines after the fields; one named like a field replaces it. */
  facts?: [string, ReactNode][];
  /** Titled blocks after the fields, such as how the research went. */
  sections?: [string, ReactNode][];
  sources?: RecordSource[];
  /** Read the record again in this many ms: something still works on it (Claude on a draft). */
  poll?: number;
  /** The draft it holds, edited in place first in the details (`DraftBox`). */
  draft?: RecordDraft;
}

/**
 * Run one of the record's `inline` actions from its extras (a video's editor): its handler on
 * this record with `input`, then the record read again. It throws what the handler refused.
 */
export type RecordAct = (action: string, input?: Record<string, unknown>) => Promise<unknown>;

/** Actions a record's head may show, by the ids its type lists. */
export interface RecordActs {
  actions: readonly Action[];
  viewer: Viewer;
  call: Call;
}

export interface RecordTemplateProps {
  record: string;
  /** The page's name in the nav; the type's plural when left out. */
  title?: string | undefined;
  api: RecordsApi;
  place: Place;
  /** What fills an empty list, said when nothing narrows it: one line, or one per view. */
  empty?: string | Readonly<Record<string, string>> | undefined;
  /** The Queue shows it in place of the empty line: a labeled example of what lands there. */
  example?: ReactNode;
  /** The columns shown until the viewer picks others; every one when left out. */
  columns?: string[] | undefined;
  extras?: ((detail: unknown, row: Row, act: RecordAct) => RecordExtras) | undefined;
  acts?: RecordActs | undefined;
  /** What the page adds beside a list's title, such as a form that adds one; `reload` reads again. */
  head?: ((meta: RecordMeta, reload: () => void) => ReactNode) | undefined;
}

type Load<T> = { data: T | null; error: Error | null; loading: boolean; retry: () => void };

/**
 * Last answers per workspace (`scope`, its api) and key, in this tab only: a page seen before
 * draws at once, then refreshes. Signing out reloads the page, so nothing outlives the person.
 */
const SEEN = new WeakMap<object, Map<string, unknown>>();
const SEEN_MAX = 200;
function seenIn(scope: object) {
  let m = SEEN.get(scope);
  if (!m) {
    m = new Map();
    SEEN.set(scope, m);
  }
  return m;
}
/** Keep `data` as the newest answer; the oldest goes past `max`. */
export function remember(seen: Map<string, unknown>, key: string, data: unknown, max = SEEN_MAX) {
  seen.delete(key);
  seen.set(key, data);
  if (seen.size > max) seen.delete(seen.keys().next().value as string);
}

/**
 * `fn` whenever `key` changes; the last answer stays on screen while the next loads. With a
 * `scope` (whatever `fn` asks: its api), an answer seen before shows at once while it refreshes.
 */
export function useLoad<T>(key: string, fn: () => Promise<T>, scope?: object): Load<T> {
  const seen = scope ? seenIn(scope) : null;
  const [state, setState] = useState<Omit<Load<T>, "retry">>(() => ({
    data: (seen?.get(key) as T | undefined) ?? null,
    error: null,
    loading: true,
  }));
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `fn` reads.
  useEffect(() => {
    let live = true;
    setState((s) => ({
      data: seen?.has(key) ? (seen.get(key) as T) : s.data,
      error: null,
      loading: true,
    }));
    fn().then(
      (data) => {
        if (seen) remember(seen, key, data);
        if (live) setState({ data, error: null, loading: false });
      },
      (err: unknown) =>
        live &&
        setState((s) => ({
          data: s.data,
          error: err instanceof Error ? err : new Error(String(err)),
          loading: false,
        })),
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);
  return {
    ...state,
    // Loading from this render on, so what reads it never paints the old data as new.
    retry: () => {
      setState((s) => ({ ...s, loading: true }));
      setAttempt((n) => n + 1);
    },
  };
}

const TYPES = new WeakMap<RecordsApi, Promise<RecordMeta[]>>();
/** The types, asked once per workspace's api. */
export function useTypes(api: RecordsApi): Load<RecordMeta[]> {
  return useLoad("types", () => {
    let p = TYPES.get(api);
    if (!p) {
      p = api.types();
      p.catch(() => TYPES.delete(api));
      TYPES.set(api, p);
    }
    return p;
  });
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (s: string) => cap(s.replace(/_/g, " "));
/** Plain text of a cell. */
export const textOf = (c: Cell | undefined) =>
  c === null || c === undefined
    ? ""
    : typeof c === "object"
      ? "name" in c
        ? c.name
        : ""
      : String(c);
/** A field's cell as words: a state's label ("Reddit", not "reddit"), else its text. */
const wordsOf = (meta: RecordMeta, row: Row, key: string) => {
  const t = textOf(row[key]);
  return meta.fields.find((f) => f.key === key)?.states?.[t]?.label ?? t;
};
export const titleOf = (meta: RecordMeta, row: Row) => wordsOf(meta, row, meta.title);
export const subtitleOf = (meta: RecordMeta, row: Row) =>
  meta.subtitle ? wordsOf(meta, row, meta.subtitle) : "";

/** Where an action that asks starts its text: the record's own value of that field (an edit). */
export const startOf = (a: Action, row: Row) =>
  a.ask ? stripMarks(textOf(row[a.ask.from ?? a.ask.field])) : "";

const SKIP = new Set(["INPUT", "TEXTAREA", "SELECT"]);
export const typing = (e: KeyboardEvent) =>
  e.metaKey ||
  e.ctrlKey ||
  e.altKey ||
  (e.target instanceof HTMLElement && (SKIP.has(e.target.tagName) || e.target.isContentEditable));

/** What an empty list says in this view. */
export const emptyOf = (
  empty: RecordTemplateProps["empty"],
  view: string | undefined,
  many: string,
) => (typeof empty === "string" ? empty : empty?.[view ?? ""]) ?? `${cap(many)} show here.`;

/**
 * The actions this record type lists that this viewer may run: `act` unless one says otherwise.
 * `inline` ones (a draft box's) only when asked for, and only those.
 */
export const actsOf = (
  meta: RecordMeta,
  acts: RecordActs | undefined,
  inline = false,
): readonly Action[] =>
  acts
    ? acts.actions.filter(
        (a) =>
          !!a.inline === inline &&
          meta.actions.includes(a.id) &&
          can(acts.viewer, { needs: "act", ...a.requires }),
      )
    : [];

const NO_CALL: Call = () => Promise.reject(new Error("Nothing to run this."));

/**
 * The key that runs one of `actions` on `row`: the first that applies to it, so a mixed list
 * (the Inbox) gives R to a draft's Reject and a DM's Reply alike.
 */
export function keyed(e: KeyboardEvent, actions: readonly Action[], row: Row | undefined) {
  if (!row) return undefined;
  const k = e.key.toLowerCase();
  const mine = actions.filter((x) => applies(x, row));
  // E edits: the action that asks for text, unless one has E for its own key.
  const edit = k === "e" && !mine.some((x) => x.key === "e");
  return mine.find((x) => x.key === k || (edit && x.ask));
}

/**
 * ", R reply, E edit": each key once, as it runs on `row`. With no row, only keys that do the
 * same on every row.
 */
export function KeyHints({ actions, row }: { actions: readonly Action[]; row: Row | undefined }) {
  const by = new Map<string, Action | null>();
  for (const a of actions) {
    if (!a.key || (row && !applies(a, row))) continue;
    const had = by.get(a.key);
    // With a row the first wins, as `keyed` runs it; with none, two labels on one key say nothing.
    if (had === undefined) by.set(a.key, a);
    else if (!row && had && had.label !== a.label) by.set(a.key, null);
  }
  return (
    <>
      {[...by].map(([k, a]) =>
        a ? (
          <span key={k}>
            , <Kbd>{k.toUpperCase()}</Kbd> {a.label.toLowerCase()}
          </span>
        ) : null,
      )}
    </>
  );
}

/** "3 selected", what each bulk action would do to them, and a way out. */
export function Bulk({
  actions,
  rows,
  picked,
  run,
  busy,
  running,
  clear,
}: {
  actions: readonly Action[];
  rows: Row[];
  picked: Set<string>;
  run: (action: Action, ids: (string | number)[]) => void;
  busy: boolean;
  running: { action: string } | null;
  clear: () => void;
}) {
  const chosen = rows.filter((r) => picked.has(String(r.id)));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{num(picked.size)} selected</span>
      {actions
        .filter((a) => a.bulk)
        .map((a) => {
          const ids = chosen.filter((r) => applies(a, r)).map((r) => r.id);
          return ids.length ? (
            <Button
              key={a.id}
              tone="secondary"
              size="dense"
              busy={running?.action === a.id}
              disabled={busy}
              onClick={() => run(a, ids)}
            >
              {a.label} {num(ids.length)}
            </Button>
          ) : null;
        })}
      <button
        type="button"
        onClick={clear}
        className="border-0 bg-transparent p-0 text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2"
      >
        Clear
      </button>
    </span>
  );
}

/** Sentence-case 13px buttons inside the templates, and their type. */
export const ROOT =
  "[--ui-button-case:none] [--ui-button-tracking:0] [--ui-button-weight:500] text-[14px] text-(--ui-ink) [font-variant-numeric:tabular-nums]";

/** A saved view's tabs, with how many rows each holds under the current filters. */
export function ViewTabs({
  meta,
  current,
  counts,
  place,
}: {
  meta: RecordMeta;
  current: string | undefined;
  counts: Record<string, number> | undefined;
  place: Place;
}) {
  if (!meta.views.length) return null;
  return (
    <nav className="flex gap-6 overflow-x-auto border-b border-(--ui-hair)" aria-label="Views">
      {meta.views.map((v, i) => {
        const on = v.id === current;
        return (
          <a
            key={v.id}
            href={place.link({ view: i === 0 ? null : v.id, after: null, sort: null })}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-[13px] font-medium no-underline",
              on
                ? "border-(--ui-ink) text-(--ui-ink)"
                : "border-transparent text-(--ui-ink-2) hover:text-(--ui-ink)",
            )}
          >
            {v.label}
            <span className="text-(--ui-ink-3)">{counts ? num(counts[v.id] ?? 0) : ""}</span>
          </a>
        );
      })}
    </nav>
  );
}

const CHIP =
  "inline-flex h-8 items-center gap-1.5 border border-(--ui-hair) bg-(--ui-paper) px-2.5 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)";

/** A field's filter as a chip: its label, what it's set to, and its control in a popover. */
function FilterChip({ field, place }: { field: FieldMeta; place: Place }) {
  const value = place.params.get(field.key);
  const set = (next: string | null) =>
    place.go(place.link({ [field.key]: next, after: null }), true);
  return (
    <span className="inline-flex">
      <Popover>
        <PopoverTrigger
          className={cn(
            CHIP,
            value && "border-(--ui-ink-3) text-(--ui-ink)",
            value && "border-r-0",
          )}
        >
          {field.label}
          {value ? (
            <span className="max-w-[180px] truncate font-medium">
              : {filterLabel(field, value)}
            </span>
          ) : (
            <ChevronDown className="size-3.5 text-(--ui-ink-3)" />
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 rounded-none p-2 ring-(--ui-hair) shadow-lg">
          <FieldFilter field={field} value={value} onChange={set} />
        </PopoverContent>
      </Popover>
      {value ? (
        <button
          type="button"
          aria-label={`Clear ${field.label}`}
          onClick={() => set(null)}
          className={cn(CHIP, "border-(--ui-ink-3) px-1.5")}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * "Filter": pick a field, then its control. Typing narrows the fields; the ones on screen come
 * first, then the hidden ones, then a search for the typed text.
 */
function FilterPicker({
  filters,
  shown,
  place,
  many,
}: {
  filters: FieldMeta[];
  shown: Set<string>;
  place: Place;
  /** The list's plural, when it searches. */
  many: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [field, setField] = useState<FieldMeta | null>(null);
  const shut = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setText("");
      setField(null);
    }
  };
  const t = text.trim().toLowerCase();
  const match = filters.filter((f) => f.label.toLowerCase().includes(t));
  const groups: [string, FieldMeta[]][] = [
    ["On screen", match.filter((f) => shown.has(f.key))],
    ["Hidden", match.filter((f) => !shown.has(f.key))],
  ];
  const ITEM =
    "flex h-8 w-full items-center px-1.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)";
  return (
    <Popover open={open} onOpenChange={shut}>
      <PopoverTrigger className={CHIP}>
        <ListFilter className="size-3.5" />
        Filter
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 gap-0 rounded-none p-1.5 ring-(--ui-hair) shadow-lg"
      >
        {field ? (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => setField(null)}
              className="flex items-center gap-1 px-1 text-left text-[12px] text-(--ui-ink-2) hover:text-(--ui-ink)"
            >
              <ChevronDown className="size-3.5 rotate-90" />
              {field.label}
            </button>
            <FieldFilter
              field={field}
              value={place.params.get(field.key)}
              onChange={(next) => {
                place.go(place.link({ [field.key]: next, after: null }), true);
                shut(false);
              }}
            />
          </div>
        ) : (
          <div className="grid">
            <input
              // biome-ignore lint/a11y/noAutofocus: the popover opened to type in this.
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                const [first] = match;
                if (e.key === "Enter" && first) setField(first);
              }}
              placeholder="Filter by…"
              aria-label="Filter by"
              className="mb-1 h-8 border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] outline-none placeholder:text-(--ui-ink-3) focus:border-(--ui-ink-2)"
            />
            {groups.map(([label, fields]) =>
              fields.length ? (
                <div key={label} className="grid">
                  <span className="px-1.5 pt-1.5 pb-0.5 text-[11px] text-(--ui-ink-3)">
                    {label}
                  </span>
                  {fields.map((f) => (
                    <button key={f.key} type="button" onClick={() => setField(f)} className={ITEM}>
                      {f.label}
                    </button>
                  ))}
                </div>
              ) : null,
            )}
            {many && t ? (
              <button
                type="button"
                onClick={() => {
                  place.go(place.link({ q: text.trim(), after: null }), true);
                  shut(false);
                }}
                className={cn(ITEM, "mt-1 border-t border-(--ui-hair) text-(--ui-ink-2)")}
              >
                <Search className="mr-2 size-3.5" />
                <span className="truncate">
                  Search {many} for “{text.trim()}”
                </span>
              </button>
            ) : !match.length ? (
              <span className="px-1.5 py-2 text-[13px] text-(--ui-ink-2)">
                No field by that name.
              </span>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The search box: it asks once typing stops. */
export function SearchBox({ place, label }: { place: Place; label: string }) {
  const [text, setText] = useState(place.params.get("q") ?? "");
  const asked = place.params.get("q") ?? "";
  useEffect(() => {
    if (text.trim() === asked) return;
    const t = setTimeout(
      () => place.go(place.link({ q: text.trim() || null, after: null }), true),
      250,
    );
    return () => clearTimeout(t);
  }, [text, asked, place]);
  return (
    <label className="relative flex h-8 w-full items-center sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-(--ui-ink-3)" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Search ${label}`}
        aria-label={`Search ${label}`}
        className="h-8 w-full border border-(--ui-hair) bg-(--ui-paper) pr-2 pl-8 text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) focus:border-(--ui-ink-2)"
      />
    </label>
  );
}

/** Which columns show: the address's `cols`, else the page's, else every field that has one. */
function columnsOf(meta: RecordMeta, params: URLSearchParams, columns?: string[]): FieldMeta[] {
  const all = meta.fields.filter((f) => f.column);
  const picked = params.get("cols")?.split(",") ?? columns;
  if (!picked) return all;
  return all.filter((f) => f.key === meta.title || picked.includes(f.key));
}

function ColumnPicker({
  meta,
  place,
  columns,
}: {
  meta: RecordMeta;
  place: Place;
  columns: string[] | undefined;
}) {
  const all = meta.fields.filter((f) => f.column && f.key !== meta.title);
  const shown = new Set(columnsOf(meta, place.params, columns).map((f) => f.key));
  const fallback = columnsOf(meta, new URLSearchParams(), columns)
    .map((f) => f.key)
    .filter((k) => k !== meta.title)
    .join(",");
  const flip = (key: string) => {
    const next = all
      .filter((f) => (f.key === key ? !shown.has(key) : shown.has(f.key)))
      .map((f) => f.key)
      .join(",");
    place.go(place.link({ cols: next === fallback ? null : next || "none" }), true);
  };
  return (
    <Popover>
      <PopoverTrigger className={CHIP}>
        <Columns3 className="size-3.5" />
        Columns
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 gap-0 rounded-none p-1.5 ring-(--ui-hair) shadow-lg"
      >
        {all.map((f) => (
          <label
            key={f.key}
            className="flex h-8 cursor-pointer items-center gap-2.5 px-1.5 text-[13px] hover:bg-(--ui-hover)"
          >
            <input
              type="checkbox"
              checked={shown.has(f.key)}
              onChange={() => flip(f.key)}
              className="size-3.5 accent-(--ui-ink)"
            />
            {f.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** The ask a list's address makes. */
export function askOf(meta: RecordMeta, params: URLSearchParams): ListAsk {
  const view = params.get("view") ?? meta.views[0]?.id;
  const where: Record<string, unknown> = {};
  for (const f of meta.fields) {
    const w = filterShape(f) ? readFilter(f, params.get(f.key)) : undefined;
    if (w !== undefined) where[f.key] = w;
  }
  const ask: ListAsk = { record: meta.id };
  if (view) ask.view = view;
  if (Object.keys(where).length) ask.where = where;
  const sort = params.get("sort");
  if (sort) ask.sort = sort;
  const q = params.get("q")?.trim();
  if (q) ask.q = q;
  const after = params.get("after");
  if (after) ask.cursor = after;
  return ask;
}

async function download(api: RecordsApi, ask: ListAsk, name: string) {
  const { cursor: _, limit: __, ...rest } = ask;
  const got = await api.export(rest);
  const url = URL.createObjectURL(new Blob([got.csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  return got;
}

/** A sortable column's head: a press sorts by it, a second press flips it. */
function SortHead({
  field,
  place,
  sort,
}: {
  field: FieldMeta;
  place: Place;
  sort: string | undefined;
}) {
  const on = sort === field.key || sort === `-${field.key}`;
  const desc = sort === `-${field.key}`;
  const end = field.column?.align === "end";
  if (!field.sortable) return <span>{field.label}</span>;
  // Numbers and dates start high; words and states start at the top of their order.
  const first = end ? `-${field.key}` : field.key;
  const next = on ? (desc ? field.key : `-${field.key}`) : first;
  const Arrow = desc ? ArrowDown : ArrowUp;
  return (
    <a
      href={place.link({ sort: next, after: null })}
      className={cn(
        "inline-flex items-center gap-1 no-underline hover:text-(--ui-ink)",
        end && "flex-row-reverse",
        on ? "text-(--ui-ink)" : "text-inherit",
      )}
    >
      {field.label}
      {on ? <Arrow className="size-3" /> : null}
    </a>
  );
}

/** The List template: views as tabs, search, a chip per filter, sortable columns, CSV, J/K. */
export function RecordList(props: RecordTemplateProps) {
  const { record, api, place, empty, columns, extras, acts, head, title } = props;
  const types = useTypes(api);
  const meta = types.data?.find((t) => t.id === record);
  if (types.error && !types.data) return <Alert onRetry={types.retry}>{types.error.message}</Alert>;
  if (!meta || !types.data) return <ListSkeleton />;
  return (
    <List
      meta={meta}
      types={types.data}
      api={api}
      place={place}
      empty={empty}
      columns={columns}
      extras={extras}
      acts={acts}
      head={head}
      title={title}
    />
  );
}

export function ListSkeleton() {
  return (
    <div className={cn(ROOT, "grid gap-3")} role="status" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-40 animate-pulse bg-(--ui-fill)" />
      <div className="h-9 w-full animate-pulse bg-(--ui-fill)" />
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={i} className="h-10 w-full animate-pulse bg-(--ui-wash)" />
      ))}
    </div>
  );
}

function List({
  meta,
  types,
  api,
  place,
  empty,
  columns,
  extras,
  acts,
  head,
  title,
}: {
  meta: RecordMeta;
  types: RecordMeta[];
  api: RecordsApi;
  place: Place;
  empty: RecordTemplateProps["empty"];
  columns: string[] | undefined;
  extras: RecordTemplateProps["extras"];
  acts: RecordActs | undefined;
  head: RecordTemplateProps["head"];
  title: string | undefined;
}) {
  const { params } = place;
  const ask = askOf(meta, params);
  const page = useLoad(JSON.stringify(ask), () => api.list(ask), api);
  const rows = page.data?.rows ?? [];
  const cols = columnsOf(meta, params, columns);
  const filters = meta.fields.filter(
    (f) =>
      filterShape(f) && !(filterShape(f) === "words" && f.searchable) && filterShape(f) !== "set",
  );
  const searchable = meta.fields.some((f) => f.searchable);
  const narrowed = !!ask.q || !!ask.where;
  const sort = ask.sort ?? meta.views.find((v) => v.id === ask.view)?.sort;
  const openId = params.get(meta.name.one);
  const [cursor, setCursor] = useState(-1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  /** The rows the last action changed: they wash once the list has read them again. */
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const body = useRef<HTMLTableSectionElement>(null);
  const many = meta.name.many;
  const actions = actsOf(meta, acts);
  const acted = (ids: (string | number)[]) => {
    page.retry();
    setRev((n) => n + 1);
    setPicked(new Set());
    setChanged(new Set(ids.map(String)));
  };
  const { run, busy: acting, running, dialog } = useRun(acts?.call ?? NO_CALL, acted, meta.name);

  const openAt = (i: number, replace = false) => {
    const r = rows[i];
    if (r) place.go(place.link({ [meta.name.one]: String(r.id), tab: null }), replace);
  };
  const openIndex = openId === null ? -1 : rows.findIndex((r) => String(r.id) === openId);

  // J/K walk the rows (or the open records), Enter opens, Escape closes, an action's key runs it.
  const keys = useRef({ cursor, openIndex, rows, openAt, place, one: meta.name.one, actions, run });
  keys.current = { cursor, openIndex, rows, openAt, place, one: meta.name.one, actions, run };
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = keys.current;
      const at = k.openIndex >= 0 ? k.openIndex : k.cursor;
      if (e.key === "j" || e.key === "k") {
        const next = Math.max(0, Math.min(k.rows.length - 1, at + (e.key === "j" ? 1 : -1)));
        setCursor(next);
        if (k.openIndex >= 0) k.openAt(next, true);
        body.current?.children[next]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && k.openIndex < 0 && at >= 0) k.openAt(at);
      else if (e.key === "Escape" && k.openIndex >= 0)
        k.place.go(k.place.link({ [k.one]: null, tab: null }), true);
      else {
        const row = k.rows[at];
        const a = keyed(e, k.actions, row);
        if (a && row) {
          e.preventDefault();
          k.run(a, [row.id], startOf(a, row));
        }
      }
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, []);

  const exportCsv = async () => {
    setBusy("Exporting");
    try {
      const got = await download(api, ask, many);
      setBusy(got.capped ? `First ${num(got.rows)} rows exported` : null);
    } catch (err) {
      setBusy(err instanceof Error ? err.message : String(err));
    }
  };
  const openRow = rows.find((r) => String(r.id) === openId);
  // ⌘K offers this view, the open record's actions, and a search of this list.
  useScope(
    `${meta.id} ${place.link({})} ${openRow ? JSON.stringify(openRow) : ""} ${page.data?.total}`,
    () => ({
      items: [
        ...(openRow
          ? actions
              .filter((a) => applies(a, openRow))
              .map((a) => ({
                label: a.label,
                group: titleOf(meta, openRow),
                hint: a.key?.toUpperCase(),
                run: () => run(a, [openRow.id], startOf(a, openRow)),
              }))
          : []),
        ...actions
          .filter((a) => a.form && !a.each)
          .map((a) => ({ label: a.label, group: cap(many), run: () => run(a, []) })),
        ...(page.data?.total
          ? [
              {
                label: "Export CSV",
                group: "This view",
                icon: "download" as const,
                run: () => void exportCsv(),
              },
            ]
          : []),
        {
          label: "Copy link",
          group: "This view",
          icon: "link",
          run: () => void navigator.clipboard?.writeText(location.href),
        },
      ],
      search: searchable
        ? { label: `Search ${many}`, run: (q: string) => place.go(place.link({ q, after: null })) }
        : undefined,
    }),
  );
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(String(r.id)));
  const pick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
          {title ?? cap(many)}
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {head?.(meta, () => acted([]))}
          {actions.map((a) =>
            a.form && !a.each ? (
              <Button key={a.id} tone="secondary" size="dense" onClick={() => run(a, [])}>
                {a.label}
              </Button>
            ) : null,
          )}
          <ColumnPicker meta={meta} place={place} columns={columns} />
          <Button
            tone="secondary"
            size="dense"
            icon="download"
            disabled={!page.data?.total}
            onClick={() => void exportCsv()}
          >
            <span className="max-sm:hidden">Export CSV</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-3">
        <ViewTabs meta={meta} current={ask.view} counts={page.data?.counts} place={place} />
        <div className="flex flex-wrap items-center gap-2">
          {searchable ? <SearchBox place={place} label={many} /> : null}
          {filters.length ? (
            <FilterPicker
              filters={filters}
              shown={new Set(cols.map((f) => f.key))}
              place={place}
              many={searchable ? many : null}
            />
          ) : null}
          {filters
            .filter((f) => params.get(f.key))
            .map((f) => (
              <FilterChip key={f.key} field={f} place={place} />
            ))}
          {narrowed ? (
            <a
              href={place.link({
                q: null,
                after: null,
                ...Object.fromEntries(filters.map((f) => [f.key, null])),
              })}
              className="px-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
            >
              Clear
            </a>
          ) : null}
          <span className="ml-auto text-[13px] text-(--ui-ink-2)">
            {picked.size ? (
              <Bulk
                actions={actions}
                rows={rows}
                picked={picked}
                run={run}
                busy={acting}
                running={running}
                clear={() => setPicked(new Set())}
              />
            ) : (
              (busy ??
              (page.data
                ? `${num(page.data.total)} ${page.data.total === 1 ? meta.name.one : many}`
                : ""))
            )}
          </span>
        </div>
      </div>

      {page.error && !page.data ? (
        <Alert onRetry={page.retry}>{page.error.message}</Alert>
      ) : (
        <div
          className={cn(
            "max-h-[calc(100dvh-280px)] overflow-auto border-t border-(--ui-hair) transition-opacity",
            page.loading && page.data && "opacity-60",
          )}
        >
          <table
            className="w-full table-fixed border-collapse text-[13px]"
            style={{
              minWidth: 72 + cols.reduce((n, f) => n + widthOf(f, f.key === meta.title), 0),
            }}
          >
            <colgroup>
              <col style={{ width: 36 }} />
              {cols.map((f) => (
                <col key={f.key} style={{ width: widthOf(f, f.key === meta.title) }} />
              ))}
              <col style={{ width: 36 }} />
            </colgroup>
            <thead>
              <tr className="text-[12px] text-(--ui-ink-2)">
                <th className="sticky top-0 z-10 h-9 border-b border-(--ui-hair) bg-(--ui-paper) pl-2.5 text-left">
                  <input
                    type="checkbox"
                    aria-label={`Select every ${meta.name.one} shown`}
                    checked={allPicked}
                    onChange={() =>
                      setPicked(allPicked ? new Set() : new Set(rows.map((r) => String(r.id))))
                    }
                    className="size-3.5 align-middle accent-(--ui-ink)"
                  />
                </th>
                {cols.map((f) => (
                  <th
                    key={f.key}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 h-9 truncate border-b border-(--ui-hair) bg-(--ui-paper) px-3 font-medium",
                      f.column?.align === "end" ? "text-right" : "text-left",
                    )}
                  >
                    <SortHead field={f} place={place} sort={sort} />
                  </th>
                ))}
                <th className="sticky top-0 z-10 border-b border-(--ui-hair) bg-(--ui-paper)" />
              </tr>
            </thead>
            <tbody ref={body}>
              {!page.data
                ? Array.from({ length: 10 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
                    <tr key={i} className="h-10 border-b border-(--ui-hair)">
                      <td colSpan={cols.length + 2} className="px-3">
                        <div className="h-3 w-2/3 animate-pulse bg-(--ui-fill)" />
                      </td>
                    </tr>
                  ))
                : rows.map((r, i) => {
                    const id = String(r.id);
                    const open = id === openId;
                    return (
                      <tr
                        key={id}
                        onClick={(e) => {
                          // Its checkbox, links and buttons do their own thing.
                          if ((e.target as Element).closest("input, a, button")) return;
                          setCursor(i);
                          openAt(i);
                        }}
                        onAnimationEnd={(e) => {
                          if (e.animationName === "ui-changed") setChanged(new Set());
                        }}
                        className={cn(
                          "group h-10 cursor-pointer border-b border-(--ui-hair)",
                          open
                            ? "bg-(--ui-fill)"
                            : i === cursor
                              ? "bg-(--ui-hover)"
                              : "hover:bg-(--ui-hover)",
                          changed.has(id) && !page.loading && "animate-ui-changed",
                        )}
                      >
                        <td className="pl-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${titleOf(meta, r)}`}
                            checked={picked.has(id)}
                            onChange={() => pick(id)}
                            className="size-3.5 align-middle accent-(--ui-ink)"
                          />
                        </td>
                        {cols.map((f) => (
                          <td
                            key={f.key}
                            className={cn(
                              "truncate px-3",
                              f.column?.align === "end" ? "text-right" : "text-left",
                              f.key !== meta.title && "text-(--ui-ink-2)",
                            )}
                          >
                            {f.key === meta.title ? (
                              <a
                                href={place.link({ [meta.name.one]: id, tab: null })}
                                className="font-medium text-(--ui-ink) no-underline"
                              >
                                {titleOf(meta, r)}
                              </a>
                            ) : (
                              <FieldCell field={f} cell={r[f.key]} />
                            )}
                          </td>
                        ))}
                        <td className="pr-2 text-right">
                          <a
                            href={place.page(id)}
                            aria-label={`Open ${titleOf(meta, r)}'s page`}
                            title="Open as a page"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex size-7 items-center justify-center text-(--ui-ink-3) opacity-0 group-hover:opacity-100 hover:bg-(--ui-fill) hover:text-(--ui-ink) focus:opacity-100"
                          >
                            <Maximize2 className="size-3.5" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
            {rows.length && page.data?.totals ? (
              <tfoot>
                <tr className="text-[12px] text-(--ui-ink-2)">
                  <td className="sticky bottom-0 h-9 border-t border-(--ui-hair) bg-(--ui-paper)" />
                  {cols.map((f) => (
                    <td
                      key={f.key}
                      className={cn(
                        "sticky bottom-0 truncate border-t border-(--ui-hair) bg-(--ui-paper) px-3",
                        f.column?.align === "end" ? "text-right" : "text-left",
                      )}
                    >
                      <FieldTotal field={f} total={page.data?.totals[f.key]} to={place.link} />
                    </td>
                  ))}
                  <td className="sticky bottom-0 border-t border-(--ui-hair) bg-(--ui-paper)" />
                </tr>
              </tfoot>
            ) : null}
          </table>
          {page.data && !rows.length ? (
            <div className="grid justify-items-start gap-2 px-3 py-10 text-[14px] text-(--ui-ink-2)">
              {narrowed ? `No ${many} match these filters.` : emptyOf(empty, ask.view, many)}
              {narrowed ? (
                <a
                  href={place.link({
                    q: null,
                    ...Object.fromEntries(filters.map((f) => [f.key, null])),
                  })}
                  className="text-[13px] text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2"
                >
                  Clear filters
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[13px] text-(--ui-ink-2)">
        {rows.length ? (
          <span className="max-sm:hidden">
            <Kbd>J</Kbd> <Kbd>K</Kbd> to move, <Kbd>Enter</Kbd> to open
            <KeyHints actions={actions} row={rows[openIndex >= 0 ? openIndex : cursor]} />
          </span>
        ) : null}
        <span className="ml-auto flex gap-2">
          {ask.cursor ? (
            <Button
              tone="secondary"
              size="dense"
              onClick={() => place.go(place.link({ after: null }))}
            >
              First page
            </Button>
          ) : null}
          {page.data?.next ? (
            <Button
              tone="secondary"
              size="dense"
              onClick={() => place.go(place.link({ after: page.data?.next ?? null }))}
            >
              Next {num(rows.length)}
            </Button>
          ) : null}
        </span>
      </div>

      {openId ? (
        <Panel
          key={openId}
          meta={meta}
          types={types}
          id={openId}
          api={api}
          place={place}
          extras={extras}
          acts={acts}
          index={openIndex}
          count={rows.length}
          step={(d) => openAt(openIndex + d, true)}
          rev={rev}
          onActed={acted}
        />
      ) : null}
      {dialog}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center border border-(--ui-hair) px-1 font-[inherit] text-[11px] text-(--ui-ink-2)">
      {children}
    </kbd>
  );
}

const ICON =
  "inline-flex size-8 border-0 bg-transparent items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) disabled:opacity-30 transition-[background-color,color,scale] duration-150 ease-(--ui-ease) active:scale-[0.94]";

/** A record beside its list: up and down walk the list, a link opens it as a page. */
export function Panel({
  meta,
  types,
  id,
  api,
  place,
  extras,
  acts,
  index,
  count,
  step,
  rev,
  onActed,
}: {
  meta: RecordMeta;
  types: RecordMeta[];
  id: string;
  api: RecordsApi;
  place: Place;
  extras: RecordTemplateProps["extras"];
  acts: RecordActs | undefined;
  index: number;
  count: number;
  step: (by: number) => void;
  rev: number;
  onActed: (changed: (string | number)[]) => void;
}) {
  return (
    <aside
      aria-label={cap(meta.name.one)}
      className={cn(
        ROOT,
        "fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-(--ui-hair) bg-(--ui-paper) shadow-(--ui-shadow) sm:w-[560px]",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-(--ui-hair) px-3">
        <button
          type="button"
          className={ICON}
          aria-label="Previous"
          title="Previous (K)"
          disabled={index <= 0}
          onClick={() => step(-1)}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          className={ICON}
          aria-label="Next"
          title="Next (J)"
          disabled={index < 0 || index >= count - 1}
          onClick={() => step(1)}
        >
          <ChevronDown className="size-4" />
        </button>
        <span className="ml-1 text-[12px] text-(--ui-ink-3)">
          {index >= 0 ? `${num(index + 1)} of ${num(count)}` : ""}
        </span>
        <a
          href={place.page(id)}
          className={cn(ICON, "ml-auto")}
          aria-label="Open as a page"
          title="Open as a page"
        >
          <Maximize2 className="size-3.5" />
        </a>
        <a
          href={place.link({ [meta.name.one]: null, tab: null })}
          className={ICON}
          aria-label="Close"
          title="Close (Esc)"
        >
          <X className="size-4" />
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-10 sm:px-6">
        <RecordBody
          meta={meta}
          types={types}
          id={id}
          api={api}
          place={place}
          extras={extras}
          acts={acts}
          rev={rev}
          onActed={onActed}
        />
      </div>
    </aside>
  );
}

/** The Record template as its own page: back to the list, then the record. */
export function RecordPage({ id, ...props }: RecordTemplateProps & { id: string }) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <Alert onRetry={types.retry}>{types.error.message}</Alert>;
  if (!meta || !types.data) return <ListSkeleton />;
  return (
    <div className={cn(ROOT, "mx-auto grid max-w-[880px] gap-4")}>
      <a
        href={props.place.list}
        className="w-fit text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
      >
        ← {cap(meta.name.many)}
      </a>
      <RecordBody
        meta={meta}
        types={types.data}
        id={id}
        api={props.api}
        place={props.place}
        extras={props.extras}
        acts={props.acts}
      />
    </div>
  );
}

const TAB =
  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-[13px] font-medium no-underline";

/** One record: its head, then tabs for details, each related type, activity and sources. */
export function RecordBody({
  meta,
  types,
  id,
  api,
  place,
  extras,
  acts,
  rev = 0,
  onActed,
}: {
  meta: RecordMeta;
  types: RecordMeta[];
  id: string;
  api: RecordsApi;
  place: Place;
  extras: RecordTemplateProps["extras"];
  acts?: RecordActs | undefined;
  /** Read again when it changes: something acted on this record. */
  rev?: number | undefined;
  onActed?: ((changed: (string | number)[]) => void) | undefined;
}) {
  const got = useLoad(`${meta.id}:${id}:${rev}`, () => api.get({ record: meta.id, id }), api);
  /** An action changed this record: its states wash once they are read again. */
  const [changed, setChanged] = useState(false);
  const acted = (ids: (string | number)[]) => {
    got.retry();
    setChanged(ids.length > 0);
    onActed?.(ids);
  };
  const { run, busy, running, dialog } = useRun(acts?.call ?? NO_CALL, acted, meta.name);
  /** The draft box, when the record holds one: what's typed is saved before any head action. */
  const draftBox = useRef<DraftHandle | null>(null);
  const [lit, pickMark] = useSourcePick();
  const tab = place.params.get("tab") ?? "details";
  const [want, setWant] = useState<string | null>(null);
  const act: RecordAct = async (action, input = {}) => {
    const a = actsOf(meta, acts, true).find((x) => x.id === action);
    if (!a || !acts || !got.data) throw new Error("You can't do that here.");
    const rowId = got.data.row.id as string | number;
    const out = await acts.call(a.handler, { ids: [rowId], ...input });
    acted([rowId]);
    return out;
  };
  // A type with no `load` still gets its extras, with no detail.
  const more = got.data && extras ? extras(got.data.detail, got.data.row, act) : {};
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new read sets the next one.
  useEffect(() => {
    if (!more.poll) return;
    const t = setTimeout(got.retry, more.poll);
    return () => clearTimeout(t);
  }, [got.data]);
  // A chip on another tab opens the sources, then lights its card once it's drawn.
  useEffect(() => {
    if (want && tab === "sources") {
      pickMark(want);
      setWant(null);
    }
  }, [want, tab, pickMark]);

  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  if (!got.data)
    return (
      <div className="grid gap-3" role="status" aria-busy="true" aria-label="Loading">
        <div className="h-6 w-1/2 animate-pulse bg-(--ui-fill)" />
        <div className="h-4 w-1/3 animate-pulse bg-(--ui-fill)" />
        <div className="mt-4 h-24 w-full animate-pulse bg-(--ui-wash)" />
      </div>
    );
  const { row, related, activity } = got.data;
  const sources = more.sources ?? [];
  const cite: CiteTo = {
    order: sources.map((s) => s.mark.toLowerCase()),
    lit,
    pick: (mark) => {
      if (tab === "sources") return pickMark(mark);
      setWant(mark);
      place.go(place.link({ tab: "sources" }), true);
    },
  };
  const states = meta.fields.filter((f) => f.kind === "status" && row[f.key] != null);
  // A draft the record holds is its box, not a field.
  const box = more.draft;
  // Long text and states have their own places below; the key facts are the short rest.
  const long = (f: FieldMeta | undefined) =>
    !!f &&
    (f.kind === "status" || f.kind === "prose" || f.kind === "cited" || f.key === box?.field);
  const keys = meta.fields
    .filter(
      (f) =>
        f.column &&
        f.key !== meta.title &&
        f.key !== meta.subtitle &&
        !long(f) &&
        f.group !== SYSTEM &&
        row[f.key] != null,
    )
    .slice(0, 4);
  const sub = meta.fields.find((f) => f.key === meta.subtitle);
  // Long text reads as its own section, above the facts.
  const cited = meta.fields.filter(
    (f) => (f.kind === "cited" || f.kind === "prose") && row[f.key] && f.key !== box?.field,
  );
  /**
   * An empty field says nothing ("Why it stopped" on a draft), so it isn't drawn. A fact named
   * like a field says it better (an address beside its verdict) and takes its place.
   */
  const told = new Set((more.facts ?? []).map(([label]) => label));
  const rest = meta.fields.filter(
    (f) =>
      f.kind !== "cited" &&
      f.kind !== "prose" &&
      f.key !== meta.title &&
      f.key !== box?.field &&
      row[f.key] != null &&
      row[f.key] !== "" &&
      !told.has(f.label),
  );
  // Grouped fields after the loose ones, in the order declared; "System" (who, when) folded last.
  const named = [...new Set(rest.map((f) => f.group))].filter(
    (g): g is string => !!g && g !== SYSTEM,
  );
  const system = rest.filter((f) => f.group === SYSTEM);
  const lines = (fields: FieldMeta[]) =>
    fields.map((f) => (
      <Line key={f.key} label={f.label}>
        <FieldLine field={f} cell={row[f.key]} cite={cite} />
      </Line>
    ));
  const shown = actsOf(meta, acts).filter((a) => applies(a, row));
  const inline = box ? actsOf(meta, acts, true).filter((a) => applies(a, row)) : [];
  const sendAction = box?.send ? shown.find((a) => a.id === box.send) : undefined;
  /** A head action runs on the saved draft: what's typed in the box goes first. */
  const runHead = (a: Action) =>
    void (draftBox.current?.flush() ?? Promise.resolve(true)).then(
      (ok) => ok && run(a, [row.id], startOf(a, row)),
    );
  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "details", label: "Details" },
    ...related.flatMap((r) => {
      const t = types.find((x) => x.id === r.record);
      return t ? [{ id: t.name.many, label: cap(t.name.many), count: r.count }] : [];
    }),
    ...(activity ? [{ id: "activity", label: "Activity", count: activity.length }] : []),
    ...(more.sources ? [{ id: "sources", label: "Sources", count: sources.length }] : []),
  ];
  const relatedType = types.find(
    (t) => t.name.many === tab && related.some((r) => r.record === t.id),
  );

  return (
    <article className="grid gap-5">
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-3 max-sm:flex-col">
          <div className="min-w-0">
            <h2 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
              {titleOf(meta, row)}
            </h2>
            {sub && !long(sub) && row[sub.key] ? (
              <p className="mt-0.5 line-clamp-2 text-[14px] text-(--ui-ink-2)">
                {subtitleOf(meta, row)}
              </p>
            ) : null}
          </div>
          {shown.length ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {shown.map((a, i) => (
                <Button
                  key={a.id}
                  tone={i === 0 ? "primary" : "secondary"}
                  size="dense"
                  busy={running?.action === a.id}
                  disabled={busy}
                  onClick={() => runHead(a)}
                >
                  {a.label}
                </Button>
              ))}
              {dialog}
            </div>
          ) : null}
        </div>
        {states.length ? (
          <div
            onAnimationEnd={(e) => {
              if (e.animationName === "ui-changed") setChanged(false);
            }}
            className={cn(
              "-mx-2 -my-1 flex flex-wrap gap-x-4 gap-y-1 rounded-(--ui-radius) px-2 py-1 text-[13px]",
              changed && !got.loading && "animate-ui-changed",
            )}
          >
            {states.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1.5">
                <span className="text-(--ui-ink-3)">{f.label}</span>
                <FieldCell field={f} cell={row[f.key]} />
              </span>
            ))}
          </div>
        ) : null}
        {keys.length ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-(--ui-hair) py-3 sm:grid-cols-4">
            {keys.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-[12px] text-(--ui-ink-3)">{f.label}</dt>
                <dd className="mt-0.5 truncate text-[13px]">
                  <FieldCell field={f} cell={row[f.key]} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      <nav
        className="flex gap-5 overflow-x-auto border-b border-(--ui-hair) max-sm:justify-between max-sm:gap-2"
        aria-label="Sections"
      >
        {tabs.map((t) => (
          <a
            key={t.id}
            href={place.link({ tab: t.id === "details" ? null : t.id })}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              TAB,
              tab === t.id
                ? "border-(--ui-ink) text-(--ui-ink)"
                : "border-transparent text-(--ui-ink-2) hover:text-(--ui-ink)",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="text-(--ui-ink-3)">{num(t.count)}</span>
            ) : null}
          </a>
        ))}
      </nav>

      {tab === "activity" && activity ? (
        <Activity lines={activity} one={meta.name.one} />
      ) : tab === "sources" ? (
        sources.length ? (
          <SourceList>
            {sources.map((s, i) => (
              <SourceCard
                key={s.mark}
                id={`src-${s.mark.toLowerCase()}`}
                n={i + 1}
                kind={s.kind}
                meta={s.meta}
                title={s.title}
                sure={s.sure}
                detail={s.detail}
                link={s.link}
                lit={lit === s.mark.toLowerCase()}
              />
            ))}
          </SourceList>
        ) : (
          <Quiet>
            What research finds about this {meta.name.one} shows here, each with its link.
          </Quiet>
        )
      ) : relatedType ? (
        <Related meta={relatedType} of={{ record: meta.id, id }} api={api} one={meta.name.one} />
      ) : (
        <div className="grid gap-6">
          {/* What a draft answers (their words, the thread so far) reads before it. */}
          {more.lead}
          {cited.map((f) => (
            <section key={f.key} className="grid gap-1.5">
              <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{f.label}</h3>
              <p className="text-[14px] leading-[1.65] text-pretty whitespace-pre-line">
                <FieldLine field={f} cell={row[f.key]} cite={cite} />
              </p>
            </section>
          ))}
          {box ? (
            <DraftBox
              key={String(row.id)}
              draft={box}
              id={row.id}
              actions={inline}
              call={acts?.call ?? NO_CALL}
              changed={acted}
              send={sendAction ? () => runHead(sendAction) : undefined}
              handle={draftBox}
            />
          ) : null}
          <dl className={DL}>
            {lines(rest.filter((f) => !f.group))}
            {(more.facts ?? []).map(([label, value]) => (
              <Line key={label} label={label}>
                {value}
              </Line>
            ))}
          </dl>
          {named.map((g) => (
            <section key={g} className="grid gap-1.5">
              <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{g}</h3>
              <dl className={DL}>{lines(rest.filter((f) => f.group === g))}</dl>
            </section>
          ))}
          {system.length ? (
            <details className="group/system">
              <summary className="w-fit cursor-pointer text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
                {SYSTEM}
              </summary>
              <dl className={cn(DL, "mt-1.5")}>{lines(system)}</dl>
            </details>
          ) : null}
          {(more.sections ?? []).map(([title, body]) => (
            <section key={title} className="grid gap-2">
              <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{title}</h3>
              {body}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

const DL = "grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 text-[14px]";

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="border-b border-(--ui-hair) py-2.5 text-[13px] text-(--ui-ink-2)">{label}</dt>
      <dd className="min-w-0 border-b border-(--ui-hair) py-2.5 break-words">{children}</dd>
    </>
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-6 text-[14px] text-(--ui-ink-2)">{children}</p>;
}

/** What happened to a record, newest first. */
function Activity({ lines, one }: { lines: RecordAnswer["activity"] & object; one: string }) {
  if (!lines.length)
    return <Quiet>Emails, replies and findings about this {one} show here as they happen.</Quiet>;
  return (
    <ol className="grid">
      {lines.map((l, i) => {
        const d = dateOf(l.at);
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat; their order is their identity.
            key={i}
            className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-(--ui-hair) py-2.5"
          >
            <time
              dateTime={d?.toISOString()}
              title={d ? exact(d) : undefined}
              className="text-[13px] text-(--ui-ink-3)"
            >
              {d ? relative(d) : ""}
            </time>
            <span className="min-w-0 text-[14px]">
              {l.kind ? <span className="font-medium">{words(l.kind)}</span> : null}
              {l.kind && l.what ? <span className="text-(--ui-ink-3)"> · </span> : null}
              <span className="text-(--ui-ink-2)">{l.what}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A small list of a related type, pointing at this record. */
function Related({
  meta,
  of,
  api,
  one,
}: {
  meta: RecordMeta;
  of: { record: string; id: string };
  api: RecordsApi;
  one: string;
}) {
  const sort = meta.views[0]?.sort;
  const ask: ListAsk = { record: meta.id, of, limit: 25, ...(sort ? { sort } : {}) };
  const page = useLoad(JSON.stringify(ask), () => api.list(ask), api);
  if (page.error && !page.data) return <Alert onRetry={page.retry}>{page.error.message}</Alert>;
  if (!page.data) return <div className="h-24 w-full animate-pulse bg-(--ui-wash)" />;
  if (!page.data.rows.length)
    return (
      <Quiet>
        {cap(meta.name.many)} for this {one} show here.
      </Quiet>
    );
  const cols = meta.fields.filter((f) => f.column).slice(0, 4);
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <thead>
        <tr className="text-[12px] text-(--ui-ink-2)">
          {cols.map((f) => (
            <th
              key={f.key}
              className={cn(
                "h-8 truncate border-b border-(--ui-hair) px-2 font-medium first:w-1/2 first:pl-0",
                f.column?.align === "end" ? "text-right" : "text-left",
              )}
            >
              {f.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {page.data.rows.map((r) => (
          <tr key={String(r.id)} className="h-10 border-b border-(--ui-hair)">
            {cols.map((f, i) => (
              <td
                key={f.key}
                className={cn(
                  "px-2 first:pl-0",
                  f.column?.align === "end" ? "text-right" : "text-left",
                  // The title wraps: a cut-off name or copy line says nothing.
                  i > 0 ? "truncate text-(--ui-ink-2)" : "py-2 break-words",
                )}
              >
                <FieldCell field={f} cell={r[f.key]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
