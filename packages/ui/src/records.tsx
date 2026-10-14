/**
 * The List and Record templates (console standard): a record type's rows and one record, drawn
 * from what the server's `recordsTypes` says, never per page. The address is the state: the
 * view, filters, search, sort, columns, page and open record each ride in it.
 */

import type { Target } from "@wren/core/access";
import type { EditAsk, Edited, RecordAskAsk, UndoAsk } from "@wren/core/edits";
import { type Cell, type FieldMeta, type RecordMeta, SYSTEM } from "@wren/core/records";
import type {
  ExportAsk,
  ExportFormat,
  GetAsk,
  ListAsk,
  RecordAnswer,
  RecordsFile,
  RecordsPage,
  RecordsStat,
  Row,
  StatsAsk,
} from "@wren/core/records/serve";
import { cn } from "cn";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Ellipsis,
  Maximize2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { can, canAt, type Viewer } from "./access.js";
import { type Action, applies, blockedOf, type Call, runs, sayBlocked, useRun } from "./action.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Button } from "./controls.js";
import { DraftBox, type DraftHandle, DraftText, type RecordDraft } from "./draft.js";
import {
  ASK_FOCUS,
  ASK_POLL_MS,
  AskClaude,
  EditFields,
  type Editing,
  History,
  thinking,
} from "./edits.js";
import { Empty, LoadFailed } from "./feedback.js";
import {
  actorParts,
  type CiteTo,
  Cue,
  cueOf,
  dateOf,
  dateTip,
  FieldCell,
  FieldLine,
  FieldTotal,
  filterShape,
  readFilter,
  relative,
  shownOf,
  totalSays,
  widthOf,
} from "./fields.js";
import { linkLabel, num } from "./format.js";
import { Segmented as Choice, type KeyLine, showKeys, useFrame, usePageKeys } from "./frame.js";
import { clipProps, tipProps } from "./hint.js";
import { Why } from "./hint-layer.js";
import { GROUP_LABEL, PAGE_TITLE, PageTitle } from "./layout.js";
import {
  CHIP,
  filtersOf,
  type KeepApi,
  ListBar,
  siteField,
  useLastUsed,
  useNarrow,
  useSaved,
  ViewTabs,
} from "./list-bar.js";
import { PageBar } from "./page-bar.js";
import { offsetOf, PAGE_SIZE, pageAt, pagesOf } from "./pager.js";
import { useOpenRecord, useScope } from "./palette-scope.js";
import { BottomSheet, onRefresh, SwipeRow, type Swipes, toneOf, useSheet } from "./phone.js";
import { usePhone } from "./phone-shell.js";
import {
  type AccessApi,
  AskAccess,
  type IssueLine,
  RecordIssues,
  rowTarget,
} from "./record-access.js";
import { recordHead } from "./record-head.js";
import { SourceCard, SourceList, stripMarks, useSourcePick } from "./sources.js";
import { sortTip } from "./view-says.js";

/** The four record calls, bound to a workspace. */
export interface RecordsApi {
  types(): Promise<RecordMeta[]>;
  list(ask: ListAsk): Promise<RecordsPage>;
  get(ask: GetAsk): Promise<RecordAnswer>;
  export(ask: ExportAsk): Promise<RecordsFile>;
  /** A number over a period against the one before, by day: the Overview's tiles. */
  stats?(ask: StatsAsk): Promise<RecordsStat>;
  /** A record's edits (`@wren/core/edits`), where the workspace serves them. */
  edit?(ask: EditAsk): Promise<Edited>;
  undo?(ask: UndoAsk): Promise<Edited>;
  ask?(ask: RecordAskAsk): Promise<{ id: string }>;
  /** Saved views and prefs (`./list-bar.tsx`), where the workspace keeps them. */
  keep?: KeepApi;
  /** Issues and asks for access on a record (`./record-access.tsx`), where the workspace has them. */
  access?: AccessApi;
}

export { SearchBox, ViewTabs } from "./list-bar.js";

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
  /** What the page asks for first, under the header and above the tabs: accounts to connect. */
  top?: ReactNode;
  /** Lines after the fields; one named like a field replaces it. */
  facts?: [string, ReactNode][];
  /** Titled blocks after the fields, such as how the research went. */
  sections?: [string, ReactNode][];
  /**
   * Field groups the extras draw themselves (a post's numbers), or long-text fields by key (a
   * document's words, in its preview): their lines are left out.
   */
  drawn?: readonly string[];
  sources?: RecordSource[];
  /** Read the record again in this many ms: something still works on it (Claude on a draft). */
  poll?: number;
  /** The draft it holds, edited in place first in the details (`DraftBox`). */
  draft?: RecordDraft;
  /**
   * Its own form (a post's platform fields): under the draft's words and above Ask Claude, or
   * first in the details when there is no draft.
   */
  form?: ReactNode;
  /**
   * How it looks where it goes, drawn live (`useDraftText`): beside the details and sticky on a
   * wide page, above them behind a Preview button on a narrow one. The draft box then keeps only
   * its counts.
   */
  aside?: ReactNode;
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

/** A Shop's groups: `names` heads each, `blurbs` says what one is under its heading. */
export interface ShopSections {
  field: string;
  order: readonly string[];
  names: Readonly<Record<string, string>>;
  blurbs?: Readonly<Record<string, string>>;
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
  /** A Shop's groups: its rows by one field's value, in this order, each under its own heading. */
  sections?: ShopSections | undefined;
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
  // A phone's pull to refresh reads it again, and waits for the answer.
  const answered = useRef<(() => void) | null>(null);
  useEffect(
    () =>
      onRefresh(
        () =>
          new Promise<void>((done) => {
            answered.current?.();
            answered.current = done;
            setAttempt((n) => n + 1);
          }),
      ),
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `fn` reads.
  useEffect(() => {
    let live = true;
    const settled = () => {
      answered.current?.();
      answered.current = null;
    };
    setState((s) => ({
      data: seen?.has(key) ? (seen.get(key) as T) : s.data,
      error: null,
      loading: true,
    }));
    fn()
      .then(
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
      )
      .finally(settled);
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
  const f = meta.fields.find((f) => f.key === key);
  return f && t ? shownOf(f, t) : t;
};
export const titleOf = (meta: RecordMeta, row: Row) => wordsOf(meta, row, meta.title);
/** A message's opening words on one line: its line breaks as spaces, its marks dropped. */
const firstWords = (t: string) => stripMarks(t).replace(/\s+/g, " ").trim().slice(0, 200);
export const subtitleOf = (meta: RecordMeta, row: Row) =>
  meta.subtitle ? wordsOf(meta, row, meta.subtitle) : "";
/** The subtitle's cue when it names a platform or a kind (a draft's "LinkedIn"), else null. */
export const subtitleCue = (meta: RecordMeta, row: Row) =>
  meta.subtitle
    ? cueOf(
        meta.fields.find((f) => f.key === meta.subtitle),
        textOf(row[meta.subtitle]),
      )
    : null;

/** Where an action that asks starts its text: the record's own value of that field (an edit). */
export const startOf = (a: Action, row: Row) =>
  a.ask ? stripMarks(textOf(row[a.ask.from ?? a.ask.field])) : "";

const SKIP = new Set(["INPUT", "TEXTAREA", "SELECT"]);
export const typing = (e: KeyboardEvent) =>
  e.metaKey ||
  e.ctrlKey ||
  e.altKey ||
  (e.target instanceof HTMLElement && (SKIP.has(e.target.tagName) || e.target.isContentEditable));

/** Parts that move their own focus with the arrows: a list's walk leaves those keys to them. */
const OWN_ARROWS =
  '[role="menu"],[role="listbox"],[role="dialog"],[role="tablist"],[role="radiogroup"],[role="grid"],[role="slider"],[role="separator"]';

/**
 * A step through a list from a key: ↓ or J one down, ↑ or K one up, else 0. Arrows first; J and K
 * stay for hands on the letters. An arrow inside a part that moves its own focus is that part's.
 */
export function walkKey(e: KeyboardEvent): 1 | -1 | 0 {
  if (e.key === "j" || e.key === "k") return e.key === "j" ? 1 : -1;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return 0;
  if (e.defaultPrevented || e.shiftKey) return 0;
  if (e.target instanceof Element && e.target.closest(OWN_ARROWS)) return 0;
  return e.key === "ArrowDown" ? 1 : -1;
}

/** What an empty list says in this view. */
export const emptyOf = (
  empty: RecordTemplateProps["empty"],
  view: string | undefined,
  many: string,
) => (typeof empty === "string" ? empty : empty?.[view ?? ""]) ?? `${cap(many)} show here.`;

/**
 * The actions this record type lists that this viewer may run: `act` unless one says otherwise.
 * `inline` ones (a draft box's) only when asked for, and only those. Checked where the type sits
 * (its app, its channel if it has one), or where one row sits when `at` names it.
 */
export const actsOf = (
  meta: RecordMeta,
  acts: RecordActs | undefined,
  inline = false,
  at: Target = typeAt(meta),
): readonly Action[] =>
  acts
    ? acts.actions.filter(
        (a) =>
          !!a.inline === inline &&
          meta.actions.includes(a.id) &&
          can(acts.viewer, { needs: "act", at, ...a.requires }),
      )
    : [];

/** Where a type sits: its app, and its channel when the whole type is one. */
const typeAt = (meta: RecordMeta): Target =>
  meta.app === undefined
    ? {}
    : {
        app: meta.app,
        ...(meta.channel === null || typeof meta.channel === "string"
          ? { channel: meta.channel }
          : {}),
      };

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
 * The keys a list's actions answer, for the sheet on ?: each key once, with every action it runs
 * on these rows ("Reply or reject" where a mixed list gives R to both). Keys that run on none of
 * the rows shown are left out.
 */
export function actionKeys(actions: readonly Action[], rows: readonly Row[] = []): KeyLine[] {
  const by = new Map<string, string[]>();
  for (const a of actions) {
    if (!a.key) continue;
    if (rows.length && !rows.some((r) => applies(a, r))) continue;
    const had = by.get(a.key) ?? [];
    if (!had.includes(a.label)) by.set(a.key, [...had, a.label]);
  }
  return [...by].map(([k, labels]) => [
    k.toUpperCase(),
    labels.map((l, i) => (i ? l.toLowerCase() : l)).join(" or "),
  ]);
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
          const ids = chosen.filter((r) => runs(a, r)).map((r) => r.id);
          // Rows it would apply to but can't run on yet: skipped, each reason said once.
          const reasons = chosen.flatMap((r) => (applies(a, r) ? (blockedOf(a, r) ?? []) : []));
          const skipped = reasons.length;
          const why = [...new Set(reasons)];
          return ids.length || skipped ? (
            <span key={a.id} className="inline-flex flex-wrap items-center gap-2">
              {ids.length ? (
                <Button
                  tone="secondary"
                  size="dense"
                  busy={running?.action === a.id}
                  disabled={busy}
                  onClick={() => run(a, ids)}
                >
                  {a.label} {num(ids.length)}
                </Button>
              ) : null}
              {skipped ? (
                <span className="text-(--ui-ink-2)">
                  {a.label} skips {num(skipped)}. {why.join(" ")}
                </span>
              ) : null}
            </span>
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

/** Which columns show: the address's `cols`, else the page's, else every field that has one. */
function columnsOf(meta: RecordMeta, params: URLSearchParams, columns?: string[]): FieldMeta[] {
  const all = meta.fields.filter((f) => f.column);
  const picked = params.get("cols")?.split(",") ?? columns;
  if (!picked) return all;
  return all.filter((f) => f.key === meta.title || picked.includes(f.key));
}

/**
 * How the list shows, in one popover (Linear's Display): its columns, rows grouped by platform
 * where it mixes them, and row height. A phone shows the title and one state whatever is
 * picked, so it has no columns there.
 */
function ListDisplay({
  meta,
  place,
  columns,
  narrow,
}: {
  meta: RecordMeta;
  place: Place;
  columns: string[] | undefined;
  narrow: boolean;
}) {
  const frame = useFrame();
  const site = siteField(meta);
  const all = narrow ? [] : meta.fields.filter((f) => f.column && f.key !== meta.title);
  if (!frame && !site && !all.length) return null;
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
  const grouping = !!site && place.params.get("group") === site.key;
  const label =
    "flex h-8 pointer-coarse:h-11 cursor-pointer items-center gap-2.5 px-1.5 text-[13px] hover:bg-(--ui-hover)";
  return (
    <Popover>
      <PopoverTrigger
        className={cn(CHIP, (grouping || place.params.has("cols")) && "text-(--ui-ink)")}
      >
        <SlidersHorizontal className="size-3.5" />
        Display
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70dvh] w-60 gap-3 overflow-y-auto rounded-none p-3 ring-(--ui-hair) shadow-lg"
      >
        {frame ? (
          <Choice
            label="Rows"
            value={frame.display.density}
            options={[
              ["roomy", "Roomy"],
              ["snug", "Snug"],
            ]}
            onChange={(density) => frame.set({ density })}
          />
        ) : null}
        {site ? (
          <label className={cn(label, "-mx-1.5")}>
            <input
              type="checkbox"
              checked={grouping}
              onChange={() =>
                place.go(place.link({ group: grouping ? null : site.key, pg: null }), true)
              }
              className="size-3.5 accent-(--ui-ink)"
            />
            Group by {site.label.toLowerCase()}
          </label>
        ) : null}
        {all.length ? (
          <fieldset className="m-0 grid min-w-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[12.5px] font-medium text-(--ui-ink-2)">
              Columns
            </legend>
            {all.map((f) => (
              <label key={f.key} className={cn(label, "-mx-1.5")}>
                <input
                  type="checkbox"
                  checked={shown.has(f.key)}
                  onChange={() => flip(f.key)}
                  className="size-3.5 accent-(--ui-ink)"
                />
                {f.label}
              </label>
            ))}
          </fieldset>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** A group's first row: its mark and label across the table, as a band. */
function GroupHead({ field, value, span }: { field: FieldMeta; value: string; span: number }) {
  const state = field.states?.[value];
  const cue = cueOf(field, value);
  return (
    <tr className="h-8 border-b border-(--ui-hair) bg-(--ui-band)">
      <td colSpan={span} className="px-3 text-[12px] font-semibold text-(--ui-ink-2)">
        <span className="inline-flex items-center gap-1.5">
          {cue ? <Cue state={cue} /> : null}
          {state?.label ?? (value || `No ${field.label.toLowerCase()}`)}
        </span>
      </td>
    </tr>
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
  const group = params.get("group");
  if (group && meta.fields.some((f) => f.key === group && f.states)) ask.group = group;
  const q = params.get("q")?.trim();
  if (q) ask.q = q;
  return ask;
}

/** Filter's counts: one row's page with the facets of this address, read when a choice opens. */
export const facetsOf = (api: RecordsApi, ask: ListAsk) => () => {
  const { cursor: _, offset: __, ...rest } = ask;
  return api.list({ ...rest, facets: true, limit: 1 }).then((p) => p.facets);
};

const EXPORT_TYPE = { csv: "text/csv", jsonl: "application/jsonl" } as const;

async function download(api: RecordsApi, ask: ListAsk, name: string, format: ExportFormat) {
  const { cursor: _, limit: __, offset: ___, ...rest } = ask;
  const got = await api.export({ ...rest, format });
  const url = URL.createObjectURL(new Blob([got.body], { type: EXPORT_TYPE[format] }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `${name}.${format}`,
  });
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
  if (!field.sortable)
    return (
      <span className="line-clamp-2" {...clipProps()}>
        {field.label}
      </span>
    );
  // Numbers and dates start high; words and states start at the top of their order.
  const first = end ? `-${field.key}` : field.key;
  const next = on ? (desc ? field.key : `-${field.key}`) : first;
  const Arrow = desc ? ArrowDown : ArrowUp;
  return (
    <a
      href={place.link({ sort: next, pg: null })}
      {...tipProps(sortTip(field, sort, next))}
      className={cn(
        "inline-flex items-center gap-1 no-underline hover:text-(--ui-ink)",
        end && "flex-row-reverse",
        on ? "text-(--ui-ink)" : "text-inherit",
      )}
    >
      <span className="line-clamp-2">{field.label}</span>
      {on ? <Arrow className="size-3 shrink-0" /> : null}
    </a>
  );
}

/** A page whose record isn't served here: its part isn't installed. Said once, not a skeleton forever. */
export function NotHere() {
  return <Empty>This page fills once its part is installed.</Empty>;
}

/** The List template: views as tabs, search, a chip per filter, sortable columns, CSV, ↑/↓. */
export function RecordList(props: RecordTemplateProps) {
  const { record, api, place, empty, columns, extras, acts, head, title } = props;
  const types = useTypes(api);
  const meta = types.data?.find((t) => t.id === record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!types.data) return <ListSkeleton />;
  if (!meta) return <NotHere />;
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

const blank = (c: Cell | undefined) =>
  c === null || c === undefined || c === "" || (Array.isArray(c) && !c.length);

/** A canvas to measure words in the list's own font; null off a browser. */
let pen: CanvasRenderingContext2D | null | undefined;
/**
 * Words' width in characters of 7.2px, the unit the widths count in: measured in the page's
 * 13px font when there is one ("Companies" is 7, not 9), else one per character.
 */
function lenOf(s: string): number {
  if (pen === undefined) {
    try {
      pen =
        typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      pen = null;
    }
  }
  if (!pen) return s.length;
  pen.font = `13px ${getComputedStyle(document.body).fontFamily}`;
  return pen.measureText(s).width / 7.2;
}

/** How many characters a cell takes on screen: a state by its label, a date as "10 minutes ago". */
function charsOf(f: FieldMeta, c: Cell | undefined): number {
  if (blank(c)) return 0;
  if (f.kind === "date") return 14;
  // A state's dot and its gaps take about four characters (measured: "Changed" needs 101px).
  if (f.kind === "status" || f.kind === "verdict")
    return lenOf(f.states?.[String(c)]?.label ?? String(c)) + 4;
  if (f.kind === "choice" || f.words) return lenOf(shownOf(f, String(c)));
  if (f.kind === "link") return lenOf(linkLabel(String(c), f.label));
  if (f.kind === "actor") return lenOf(actorParts(String(c))?.join(" · ") ?? String(c));
  // A score's bar and its gap take about seven characters.
  if (f.kind === "score") return String(c).length + (f.max ? 7 : 0);
  if (Array.isArray(c)) return lenOf(c.join(", "));
  if (c && typeof c === "object") {
    if ("name" in c) return lenOf(c.name);
    if ("amount" in c) return c.amount.toFixed(2).length + 3;
    return `${c.n} of ${c.of}`.length;
  }
  return f.column?.align === "end" ? String(c).length + 3 : lenOf(String(c));
}

/** A cell's width in px: about 7.2 a character at 13px, and the cell's padding. */
const pxOf = (chars: number) => Math.ceil(chars * 7.2) + 24;

/** The most a column grows to fit its cells: its kind's max (set in core), never below its preset. */
const maxOf = (f: FieldMeta) => Math.max(f.column?.max ?? 0, widthOf(f));

/**
 * A column's width for the rows shown: what its head and its widest cell need, within its
 * kind's bounds. A column of "Post" stays narrow, so the title has the room; a firm's name or a
 * short state shows whole.
 */
export function fitOf(f: FieldMeta, rows: Row[]): number {
  if (!rows.length) return widthOf(f);
  // The head may take two lines: its longest word, or half of it, and room for the sort arrow.
  const words = f.label.split(/\s+/);
  const head = Math.max(...words.map(lenOf), Math.ceil(lenOf(f.label) / 2)) + 3;
  const chars = Math.max(head, ...rows.map((r) => charsOf(f, r[f.key])));
  return Math.min(maxOf(f), Math.max(64, pxOf(chars)));
}

/**
 * Each column's width; none takes what the rest leave. That is the title, unless its words are
 * short and a column is cut even at its max: then the title fits its words and the cut columns
 * share the room, so "Redis or Valkey" doesn't sit in half the table while its reason reads
 * "Costliest...".
 */
export function widthsOf(meta: RecordMeta, cols: FieldMeta[], rows: Row[], room?: number) {
  const widths = sharedOf(meta, cols, rows);
  return room ? growRoom(meta, cols, rows, fitRoom(meta, cols, widths, room), room) : widths;
}

/** What a column needs to show every cell whole, past its max. */
const needOf = (f: FieldMeta, rows: Row[]) =>
  Math.max(0, ...rows.map((r) => pxOf(charsOf(f, r[f.key]))));

/** What the title needs to show every row's whole: it reads in a heavier weight. */
const titleNeed = (meta: RecordMeta, rows: Row[]) =>
  Math.ceil(Math.max(0, ...rows.map((r) => lenOf(titleOf(meta, r)))) * 7.6) + 24;

/**
 * Widths that use spare room: a word column cut short grows toward what its cells need before
 * the title takes the rest, sharing with the title by how much each is short.
 */
export function growRoom(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  widths: Record<string, number | undefined>,
  room: number,
) {
  const fixed = cols.reduce((n, f) => n + (widths[f.key] ?? 0), 72);
  const free = cols.filter((f) => widths[f.key] === undefined);
  const want = free.reduce((n, f) => n + (f.key === meta.title ? TITLE_MIN : widthOf(f)), 0);
  const spare = room - fixed - want;
  if (spare <= 0 || !rows.length) return widths;
  const short = cols
    .filter((f) => widths[f.key] !== undefined && YIELDS.has(f.kind))
    .map((f) => [f, needOf(f, rows) - (widths[f.key] ?? 0)] as const)
    .filter(([, d]) => d > 0);
  if (!short.length) return widths;
  const title = free.some((f) => f.key === meta.title);
  const titleShort = title ? Math.max(0, titleNeed(meta, rows) - TITLE_MIN) : 0;
  const share = Math.min(1, spare / short.reduce((n, [, d]) => n + d, titleShort));
  const out = { ...widths };
  for (const [f, d] of short) out[f.key] = (widths[f.key] ?? 0) + Math.floor(d * share);
  return out;
}

/** An element's width as it changes: a list fits its columns to it. */
function useRoom(): [(el: HTMLDivElement | null) => void, number | undefined] {
  const [room, setRoom] = useState<number>();
  const watch = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    watch.current?.disconnect();
    if (!el || typeof ResizeObserver === "undefined") return;
    watch.current = new ResizeObserver(() => setRoom(el.clientWidth));
    watch.current.observe(el);
  }, []);
  return [ref, room];
}

/** The kinds whose words may cut to fit the room: free text, never a state, number or date. */
const YIELDS: ReadonlySet<FieldMeta["kind"]> = new Set([
  "text",
  "name",
  "company",
  "actor",
  "link",
  "tags",
  "choice",
]);
/** The least a list's title keeps, so what the row is stays readable. */
const TITLE_MIN = 220;
/** The least a title gives up to before a column of short values cuts. */
const TITLE_LEAST = 160;
/** A column this wide or less holds short values; it keeps them whole while a longer one can give. */
const SHORT = 168;

/**
 * Widths that fit `room` px: when the columns past the title leave it less than its least, the
 * word columns give up room in proportion, so no column is pushed past the right edge. Long ones
 * (past SHORT) give first, then the title down to TITLE_LEAST; a column of short values cuts,
 * down to its head, only when they can't.
 * Only when every one is at its least does the list scroll sideways.
 */
export function fitRoom(
  meta: RecordMeta,
  cols: FieldMeta[],
  widths: Record<string, number | undefined>,
  room: number,
) {
  // The checkbox and open columns, 36 each.
  const fixed = cols.reduce((n, f) => n + (widths[f.key] ?? 0), 72);
  const free = cols.filter((f) => widths[f.key] === undefined);
  const want = free.reduce((n, f) => n + (f.key === meta.title ? TITLE_MIN : widthOf(f)), 0);
  let over = fixed + want - room;
  if (over <= 0) return widths;
  const yields = cols.filter((f) => widths[f.key] !== undefined && YIELDS.has(f.kind));
  const head = (f: FieldMeta) => Math.max(96, pxOf(f.label.length));
  const out = { ...widths };
  const title = free.some((f) => f.key === meta.title);
  // Long words give first, down to their head; then the title, down to TITLE_LEAST; a short value
  // ("Companies") cuts only when none of them can.
  for (const least of [
    (f: FieldMeta) => ((widths[f.key] ?? 0) > SHORT ? head(f) : Infinity),
    head,
  ]) {
    const floor = (f: FieldMeta) => Math.min(out[f.key] ?? 0, least(f));
    const spare = yields.reduce((n, f) => n + (out[f.key] ?? 0) - floor(f), 0);
    if (least === head && title && over > 0) over -= Math.min(over, TITLE_MIN - TITLE_LEAST);
    if (over <= 0 || spare <= 0) continue;
    const share = Math.min(1, over / spare);
    for (const f of yields) {
      const w = out[f.key] ?? 0;
      const cut = Math.floor((w - floor(f)) * share);
      out[f.key] = w - cut;
      over -= cut;
    }
  }
  return out;
}

/** Each column's width for the rows alone, before the room is known. */
function sharedOf(meta: RecordMeta, cols: FieldMeta[], rows: Row[]) {
  const widths: Record<string, number | undefined> = {};
  for (const f of cols) widths[f.key] = f.key === meta.title ? undefined : fitOf(f, rows);
  const title = cols.find((f) => f.key === meta.title);
  // A title with a message under it keeps the room: the message is what the row is.
  const previews = meta.fields.some((f) => f.key === meta.subtitle && f.kind === "prose");
  if (!title || !rows.length || previews) return widths;
  const cut = cols.filter(
    (f) => f !== title && rows.some((r) => pxOf(charsOf(f, r[f.key])) > maxOf(f)),
  );
  const words = Math.max(title.label.length, ...rows.map((r) => lenOf(titleOf(meta, r))));
  const needs = Math.ceil(words * 7.6) + 24;
  if (!cut.length || needs > 360) return widths;
  widths[title.key] = Math.max(needs, widthOf(title));
  for (const f of cut) widths[f.key] = undefined;
  return widths;
}

/**
 * The columns a list draws: what's picked, less those blank on every row shown or only repeating the title (unless picked
 * by hand), and on a phone the title, the first state that tells the rows apart, and the next fields, three at most.
 */
export function shownColumns(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  { byHand, narrow }: { byHand: boolean; narrow: boolean },
): FieldMeta[] {
  const title = (r: Row) => r[meta.title];
  // A column that mostly says the title again ("Text" whose first line is the "Post", on at least
  // half the rows) is left out: the rest read it on the record's page.
  const repeats = (f: FieldMeta) =>
    f.kind === "text" &&
    rows.filter((r) => {
      const [t, c] = [title(r), r[f.key]];
      return typeof t === "string" && t !== "" && typeof c === "string" && c.startsWith(t);
    }).length *
      2 >=
      rows.length;
  const filled =
    byHand || !rows.length
      ? cols
      : cols.filter(
          (f) => f.key === meta.title || (rows.some((r) => !blank(r[f.key])) && !repeats(f)),
        );
  if (!narrow) return filled;
  const tells = (f: FieldMeta) => new Set(rows.map((r) => String(r[f.key] ?? ""))).size > 1;
  const states = filled.filter((f) => f.key !== meta.title && f.kind === "status");
  const state = states.find(tells) ?? states[0];
  // A card: the title, the state, then the next fields, up to three; a state the same on every
  // row says nothing.
  const rest = filled.filter(
    (f) => f.key !== meta.title && f !== state && (f.kind !== "status" || tells(f)),
  );
  const lead = filled.filter((f) => f.key === meta.title);
  return [...lead, ...(state ? [state] : []), ...rest].slice(0, lead.length + NARROW_FIELDS);
}

/** How many fields a phone's card shows under its title. */
const NARROW_FIELDS = 3;

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
  /** The field rows are grouped by, each group under its band. */
  const grouped = ask.group ? (meta.fields.find((f) => f.key === ask.group) ?? null) : null;
  // The page the address names: `pg` from 1, read as rows to skip.
  const at = pageAt(params.get("pg"));
  const listed: ListAsk = {
    ...ask,
    limit: PAGE_SIZE,
    ...(at > 1 ? { offset: offsetOf(at) } : {}),
  };
  const page = useLoad(JSON.stringify(listed), () => api.list(listed), api);
  const rows = page.data?.rows ?? [];
  const pages = pagesOf(page.data?.total ?? 0);
  const narrow = useNarrow();
  const cols = shownColumns(meta, columnsOf(meta, params, columns), rows, {
    byHand: params.has("cols"),
    narrow,
  });
  // A prose subtitle (a comment's words, a DM) previews under each row's title.
  const preview = meta.fields.find((f) => f.key === meta.subtitle && f.kind === "prose");
  const totals = page.data?.totals;
  const footed = !!rows.length && !!totals && cols.some((f) => totalSays(f, totals[f.key]));
  const [scroller, room] = useRoom();
  const frame = useRef<HTMLDivElement | null>(null);
  const frameRef = useCallback(
    (el: HTMLDivElement | null) => {
      frame.current = el;
      scroller(el);
    },
    [scroller],
  );
  // A new page starts at the top of the list, not wherever the pager was pressed.
  const was = useRef(at);
  useEffect(() => {
    if (was.current === at) return;
    was.current = at;
    frame.current?.scrollTo?.(0, 0);
    frame.current?.scrollIntoView({ block: "nearest" });
  }, [at]);
  // A page past the end (rows left since the link was made) lands on the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: place changes every render.
  useEffect(() => {
    if (page.data && at > pages)
      place.go(place.link({ pg: pages > 1 ? String(pages) : null }), true);
  }, [page.data, at, pages]);
  const widths = widthsOf(meta, cols, rows, narrow ? undefined : room);
  const saved = useSaved(api.keep, meta.id);
  useLastUsed(api.keep, meta, place, saved);
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
  const cards = useRef<HTMLUListElement>(null);
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

  // ↑/↓ (or J/K) walk the rows (or the open records), Enter opens, Escape closes, an action's key runs it.
  const keys = useRef({ cursor, openIndex, rows, openAt, place, one: meta.name.one, actions, run });
  keys.current = { cursor, openIndex, rows, openAt, place, one: meta.name.one, actions, run };
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = keys.current;
      const at = k.openIndex >= 0 ? k.openIndex : k.cursor;
      const step = walkKey(e);
      if (step) {
        e.preventDefault();
        const next = Math.max(0, Math.min(k.rows.length - 1, at + step));
        setCursor(next);
        if (k.openIndex >= 0) k.openAt(next, true);
        (body.current ?? cards.current)
          ?.querySelector(`[data-row="${next}"]`)
          ?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && k.openIndex < 0 && at >= 0) k.openAt(at);
      else if (e.key === "Escape" && k.openIndex >= 0)
        k.place.go(k.place.link({ [k.one]: null, tab: null }), true);
      else {
        const row = k.rows[at];
        const a = keyed(e, k.actions, row);
        if (a && row) {
          e.preventDefault();
          if (!sayBlocked(a, row)) k.run(a, [row.id], startOf(a, row));
        }
      }
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, []);

  const exportAs = async (format: ExportFormat) => {
    setBusy("Exporting");
    try {
      const got = await download(api, ask, many, format);
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
              .filter((a) => runs(a, openRow))
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
                run: () => void exportAs("csv"),
              },
              ...(meta.drafts
                ? [
                    {
                      label: "Export JSONL",
                      group: "This view",
                      icon: "download" as const,
                      run: () => void exportAs("jsonl"),
                    },
                  ]
                : []),
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
        ? { label: `Search ${many}`, run: (q: string) => place.go(place.link({ q, pg: null })) }
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

  const headed = head?.(meta, () => acted([]));
  const forms = actions.filter((a) => a.form && !a.each);
  // Its rows' keys sit in the sheet on ?, not under the list.
  const keyLines = actionKeys(actions, rows);
  usePageKeys(keyLines.length ? { title: `On ${many}`, keys: keyLines } : null);
  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={title ?? cap(many)} />
        {/* One button: the first thing the page makes. The rest wait behind one menu. */}
        <div className="flex items-center gap-2">
          {forms[0] ? (
            <Button size="dense" onClick={() => run(forms[0] as Action, [])}>
              {forms[0].label}
            </Button>
          ) : null}
          <HeadMenu
            items={[
              ...forms.slice(1).map((a) => ({ label: a.label, run: () => run(a, []) })),
              ...(page.data?.total
                ? [
                    { label: "Export CSV", run: () => void exportAs("csv") },
                    ...(meta.drafts
                      ? [{ label: "Export JSONL", run: () => void exportAs("jsonl") }]
                      : []),
                  ]
                : []),
              {
                label: "Copy link",
                run: () => void navigator.clipboard?.writeText(location.href),
              },
              ...(narrow ? [] : [{ label: "Keyboard shortcuts", run: showKeys }]),
            ]}
          />
        </div>
      </div>
      {/* The page's own line (a note, a status, a quick form) under its title, not in its tools. */}
      {headed ? (
        <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden">
          {headed}
        </div>
      ) : null}

      <div className="grid gap-3">
        <ViewTabs
          meta={meta}
          current={ask.view}
          counts={page.data?.counts}
          place={place}
          saved={saved}
          keep={api.keep}
        />
        <ListBar
          meta={meta}
          place={place}
          shown={new Set(cols.map((f) => f.key))}
          keep={api.keep}
          saved={saved}
          facets={facetsOf(api, ask)}
          display={<ListDisplay meta={meta} place={place} columns={columns} narrow={narrow} />}
          end={
            picked.size ? (
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
            )
          }
        />
      </div>

      {page.error && !page.data ? (
        <LoadFailed error={page.error} onRetry={page.retry} />
      ) : (
        <div
          ref={frameRef}
          className={cn(
            // Framed; its last row drops its rule, which the frame draws. A phone's cards scroll
            // with the page, not in a box of their own.
            "border border-(--ui-hair) transition-opacity [&_tbody>tr:last-child]:border-b-0",
            !narrow && "max-h-[calc(100dvh-280px)] overflow-auto",
            page.loading && page.data && "opacity-60",
          )}
        >
          {narrow ? (
            <ul ref={cards} className={cn("list-none", page.data && !rows.length && "hidden")}>
              {!page.data
                ? Array.from({ length: 8 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
                    <li key={i} className="grid gap-2 border-b border-(--ui-hair) px-4 py-4">
                      <div className="h-3.5 w-2/3 animate-pulse bg-(--ui-fill)" />
                      <div className="h-3 w-1/3 animate-pulse bg-(--ui-wash)" />
                    </li>
                  ))
                : rows.map((r, i) => {
                    const id = String(r.id);
                    const g = grouped ? String(r[grouped.key] ?? "") : null;
                    return (
                      <Fragment key={id}>
                        {grouped && (i === 0 || String(rows[i - 1]?.[grouped.key] ?? "") !== g) ? (
                          <li className="sticky top-(--phone-bar,0px) z-2 border-b border-(--ui-hair) [background:linear-gradient(var(--ui-band),var(--ui-band)),var(--ui-paper)] px-4 py-2 text-[12px] font-semibold text-(--ui-ink-2)">
                            <span className="inline-flex items-center gap-1.5">
                              <FieldCell field={grouped} cell={r[grouped.key]} />
                            </span>
                          </li>
                        ) : null}
                        <RowCard
                          meta={meta}
                          row={r}
                          index={i}
                          fields={cols.filter((f) => f.key !== meta.title)}
                          preview={preview}
                          href={place.link({ [meta.name.one]: id, tab: null })}
                          open={id === openId}
                          changed={changed.has(id) && !page.loading}
                          picked={picked.has(id)}
                          onPick={() => pick(id)}
                          onOpen={() => {
                            setCursor(i);
                            openAt(i);
                          }}
                          onSettled={() => setChanged(new Set())}
                          swipes={swipesOf(actions, r, (a) => run(a, [r.id], startOf(a, r)))}
                        />
                      </Fragment>
                    );
                  })}
            </ul>
          ) : (
            <table
              // An empty view shows what fills it, not a row of column heads over nothing.
              className={cn(
                "w-full table-fixed border-collapse text-[13px]",
                page.data && !rows.length && "hidden",
              )}
              style={{
                minWidth: narrow
                  ? undefined
                  : 72 +
                    cols.reduce(
                      (n, f) => n + (widths[f.key] ?? widthOf(f, f.key === meta.title)),
                      0,
                    ),
              }}
            >
              <colgroup>
                <col style={{ width: 36 }} />
                {cols.map((f) => (
                  // A column with no width takes what the others leave; the min width keeps its share.
                  <col
                    key={f.key}
                    style={widths[f.key] === undefined ? undefined : { width: widths[f.key] }}
                  />
                ))}
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr className="text-[12px] text-(--ui-ink-2) [&>th]:font-semibold">
                  <th className="sticky top-0 z-10 h-9 border-b border-(--ui-edge) bg-(--ui-band) pl-2.5 text-left">
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
                        // A long head takes two lines, so its column fits its numbers.
                        "sticky top-0 z-10 h-9 border-b border-(--ui-edge) bg-(--ui-band) px-3 py-1 leading-tight",
                        f.column?.align === "end" ? "text-right" : "text-left",
                      )}
                    >
                      <SortHead field={f} place={place} sort={sort} />
                    </th>
                  ))}
                  <th className="sticky top-0 z-10 border-b border-(--ui-edge) bg-(--ui-band)" />
                </tr>
              </thead>
              <tbody ref={body}>
                {!page.data
                  ? Array.from({ length: 10 }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
                      <tr key={i} className="h-(--layout-row) border-b border-(--ui-hair)">
                        <td colSpan={cols.length + 2} className="px-3">
                          <div className="h-3 w-2/3 animate-pulse bg-(--ui-fill)" />
                        </td>
                      </tr>
                    ))
                  : rows.map((r, i) => {
                      const id = String(r.id);
                      const open = id === openId;
                      const g = grouped ? String(r[grouped.key] ?? "") : null;
                      const head =
                        grouped && (i === 0 || String(rows[i - 1]?.[grouped.key] ?? "") !== g) ? (
                          <GroupHead field={grouped} value={g ?? ""} span={cols.length + 2} />
                        ) : null;
                      return (
                        <Fragment key={id}>
                          {head}
                          <tr
                            data-row={i}
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
                              "group h-(--layout-row) cursor-pointer border-b pointer-coarse:h-12 border-(--ui-hair)",
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
                                {...(narrow && f.key === meta.title ? {} : clipProps())}
                                className={cn(
                                  "px-3",
                                  // On a phone the title takes two lines before it cuts.
                                  // A cut cell drops its break chances: Chrome breaks at <wbr> even
                                  // under nowrap, so "example.com" wrapped onto two lines.
                                  narrow && f.key === meta.title
                                    ? "py-2"
                                    : "truncate [&_wbr]:hidden",
                                  !narrow && f.key === meta.title && preview && "py-1.5",
                                  f.column?.align === "end" ? "text-right" : "text-left",
                                  f.key !== meta.title && "text-(--ui-ink-2)",
                                )}
                              >
                                {f.key === meta.title ? (
                                  <a
                                    href={place.link({ [meta.name.one]: id, tab: null })}
                                    {...clipProps()}
                                    className={cn(
                                      "font-medium text-(--ui-ink) no-underline",
                                      // Cut inside the link, so focusing it never scrolls the cell sideways.
                                      // A phone breaks a long word (an address) rather than clip it.
                                      narrow ? "line-clamp-2 wrap-anywhere" : "block truncate",
                                    )}
                                  >
                                    {titleOf(meta, r) || (
                                      <span className="text-(--ui-ink-3)">-</span>
                                    )}
                                  </a>
                                ) : null}
                                {f.key === meta.title && preview ? (
                                  // A message's first words under who sent it, as a mail list shows.
                                  <span className="block truncate text-[12.5px] text-(--ui-ink-2)">
                                    {firstWords(textOf(r[preview.key]))}
                                  </span>
                                ) : f.key === meta.title ? null : (
                                  <FieldCell field={f} cell={r[f.key]} />
                                )}
                              </td>
                            ))}
                            <td className="pr-2 text-right">
                              <a
                                href={place.page(id)}
                                aria-label={`Open ${titleOf(meta, r)}'s page`}
                                {...tipProps("Open as a page", { as: "none" })}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex size-7 items-center justify-center text-(--ui-ink-3) opacity-0 group-hover:opacity-100 hover:bg-(--ui-fill) hover:text-(--ui-ink) focus:opacity-100"
                              >
                                <Maximize2 className="size-3.5" />
                              </a>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
              </tbody>
              {footed ? (
                <tfoot>
                  <tr className="text-[12px] text-(--ui-ink-2)">
                    <td className="sticky bottom-0 h-9 border-t border-(--ui-edge) bg-(--ui-paper)" />
                    {cols.map((f) => (
                      <td
                        key={f.key}
                        className={cn(
                          "sticky bottom-0 truncate border-t border-(--ui-edge) bg-(--ui-paper) px-3",
                          f.column?.align === "end" ? "text-right" : "text-left",
                        )}
                      >
                        <FieldTotal field={f} total={totals?.[f.key]} to={place.link} />
                      </td>
                    ))}
                    <td className="sticky bottom-0 border-t border-(--ui-edge) bg-(--ui-paper)" />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          )}
          {page.data && !rows.length ? (
            <div className="grid justify-items-start gap-2 px-3 py-10 text-[14px] text-(--ui-ink-2)">
              {narrowed ? `No ${many} match these filters.` : emptyOf(empty, ask.view, many)}
              {!narrowed ? (
                <ElseWhere meta={meta} current={ask.view} counts={page.data.counts} place={place} />
              ) : null}
              {narrowed ? (
                <a
                  href={place.link({
                    q: null,
                    ...Object.fromEntries(filtersOf(meta).map((f) => [f.key, null])),
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

      <PageBar
        place={place}
        page={Math.min(at, pages)}
        pages={pages}
        total={page.data?.total ?? 0}
        shown={rows.length}
        size={PAGE_SIZE}
        narrow={narrow}
      />

      {openId ? (
        <Panel
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

/** A list head's ⋯: what doesn't fit beside the first action, behind one button. */
function HeadMenu({ items }: { items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="More actions"
        {...tipProps("More actions", { as: "none" })}
        className="inline-grid size-8 place-items-center border border-(--ui-hair) bg-transparent pointer-coarse:size-11 max-[900px]:size-11 text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) data-[popup-open]:bg-(--ui-hover)"
      >
        <Ellipsis className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 gap-0 rounded-none p-1 ring-(--ui-hair) shadow-lg"
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            className="flex h-8 w-full items-center border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) pointer-coarse:h-11 pointer-coarse:text-[15px] max-[900px]:h-11 max-[900px]:px-3 max-[900px]:text-[15px]"
            onClick={() => {
              setOpen(false);
              it.run();
            }}
          >
            {it.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A docked action bar floats over the record's foot, so the record ends its height above it:
 * the last lines scroll clear of the buttons.
 */
function dockRoom(bar: HTMLDivElement | null) {
  const article = bar?.closest("article");
  if (!bar || !article) return;
  const fit = () => article.style.setProperty("--dock-h", `${bar.offsetHeight}px`);
  const seen = new ResizeObserver(fit);
  seen.observe(bar);
  return () => {
    seen.disconnect();
    article.style.removeProperty("--dock-h");
  };
}

/**
 * A row's swipes on a phone, as Mail's: right for the first action that moves it on (Approve),
 * left for the ones that set it aside (Skip, Archive), the far one run by a full swipe. Actions
 * that make a record, or run inside its detail, don't swipe.
 */
export function swipesOf(
  actions: readonly Action[],
  row: Row,
  run: (a: Action) => void,
): Swipes | null {
  const can = actions.filter((a) => !a.form && !a.inline && runs(a, row));
  if (!can.length) return null;
  const aside = (a: Action) => toneOf(a.label, false) === "bad";
  const lead = can.find((a) => !aside(a));
  const trail = [...can.filter(aside), ...can.filter((a) => !aside(a) && a !== lead)].slice(0, 2);
  const act = (a: Action, first: boolean) => ({
    id: a.id,
    label: a.label,
    tone: toneOf(a.label, first),
    run: () => run(a),
  });
  return {
    lead: lead ? act(lead, true) : undefined,
    trail: trail.map((a) => act(a, false)),
  };
}

/**
 * One row on a phone: a card a thumb can hit, its title on two lines, the first words under it,
 * then three of its fields. A tap opens the record; the box picks it for the bulk actions.
 */
function RowCard({
  meta,
  row,
  index,
  fields,
  preview,
  href,
  open,
  changed,
  picked,
  onPick,
  onOpen,
  onSettled,
  swipes,
}: {
  meta: RecordMeta;
  row: Row;
  index: number;
  fields: FieldMeta[];
  preview: FieldMeta | undefined;
  href: string;
  open: boolean;
  changed: boolean;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
  onSettled: () => void;
  swipes: Swipes | null;
}) {
  const title = titleOf(meta, row);
  return (
    <SwipeRow
      swipes={swipes}
      data-row={index}
      onTap={(e) => {
        // Its box, links and buttons do their own thing.
        if ((e.target as Element).closest("input, a, button, label")) return;
        onOpen();
      }}
      onAnimationEnd={(e) => {
        if (e.animationName === "ui-changed") onSettled();
      }}
      className={cn(
        "cursor-pointer border-b border-(--ui-hair) last:border-b-0 [&>[data-face]]:flex [&>[data-face]]:min-h-14 [&>[data-face]]:items-start active:[&>[data-face]]:bg-(--ui-hover)",
        open && "[&>[data-face]]:bg-(--ui-fill)",
        changed && "[&>[data-face]]:animate-ui-changed",
      )}
    >
      <label className="grid size-12 flex-none cursor-pointer place-items-center">
        <input
          type="checkbox"
          aria-label={`Select ${title}`}
          checked={picked}
          onChange={onPick}
          className="accent-(--ui-ink)"
        />
      </label>
      <div className="grid min-w-0 flex-1 gap-1 py-3 pr-4">
        <a
          href={href}
          className="line-clamp-2 text-[15px] leading-snug font-medium text-(--ui-ink) no-underline wrap-anywhere"
          {...clipProps()}
        >
          {title || <span className="text-(--ui-ink-3)">-</span>}
        </a>
        {preview ? (
          <span
            className="line-clamp-2 text-[13.5px] leading-snug text-(--ui-ink-2)"
            {...clipProps()}
          >
            {firstWords(textOf(row[preview.key]))}
          </span>
        ) : null}
        {fields.length ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-2) [&>*]:max-w-full [&>*]:min-w-0 [&>*]:truncate">
            {fields.map((f) =>
              blank(row[f.key]) ? null : (
                <span key={f.key} {...tipProps(f.label)}>
                  <FieldCell field={f} cell={row[f.key]} />
                </span>
              ),
            )}
          </span>
        ) : null}
      </div>
    </SwipeRow>
  );
}

/** An empty view points at the first view that has rows: "No DM waits on you." then "All 12". */
function ElseWhere({
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
  const i = meta.views.findIndex((v) => v.id !== current && (counts?.[v.id] ?? 0) > 0);
  const v = meta.views[i];
  if (!v || !counts) return null;
  return (
    <a
      href={place.link({ view: i === 0 ? null : v.id, pg: null, sort: null })}
      className="inline-flex items-center gap-1 text-[13px] text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
    >
      {v.label} <span className="text-(--ui-ink-2)">{num(counts[v.id] ?? 0)}</span>
      <ArrowRight className="size-3.5" aria-hidden />
    </a>
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
  "inline-flex size-8 pointer-coarse:size-11 border-0 bg-transparent items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) disabled:opacity-30 transition-[background-color,color,scale] duration-150 ease-(--ui-ease) active:scale-[0.94]";

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
  const phone = usePhone();
  const shut = place.link({ [meta.name.one]: null, tab: null });
  const body = (
    <RecordBody
      key={id}
      meta={meta}
      types={types}
      id={id}
      api={api}
      place={place}
      extras={extras}
      acts={acts}
      rev={rev}
      onActed={onActed}
      docked
    />
  );
  if (phone)
    // A phone: a sheet over the list, open full height; drag it to half to see the list, or
    // down to shut it.
    return (
      <BottomSheet
        label={cap(meta.name.one)}
        start="large"
        escape={false}
        onClose={() => place.go(shut, true)}
        className={ROOT}
        bodyClassName="px-4 pt-2 pb-[calc(96px+env(safe-area-inset-bottom))]"
        head={
          <div className="flex h-11 items-center gap-1 border-b border-(--ui-hair) px-2">
            <SheetDone />
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-(--ui-ink-2)">
              {index >= 0 ? `${num(index + 1)} of ${num(count)}` : ""}
            </span>
            <button
              type="button"
              className={ICON}
              aria-label="Previous"
              disabled={index <= 0}
              onClick={() => step(-1)}
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              className={ICON}
              aria-label="Next"
              disabled={index < 0 || index >= count - 1}
              onClick={() => step(1)}
            >
              <ChevronDown className="size-4" />
            </button>
            <a href={place.page(id)} className={ICON} aria-label="Open as a page">
              <Maximize2 className="size-3.5" />
            </a>
          </div>
        }
      >
        {body}
      </BottomSheet>
    );
  return (
    <aside
      aria-label={cap(meta.name.one)}
      className={cn(
        ROOT,
        "fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-(--ui-hair) bg-(--ui-paper) shadow-(--ui-shadow) sm:w-[560px]",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-(--ui-hair) bg-(--ui-band) px-3 max-sm:box-content max-sm:h-14 max-sm:pt-[env(safe-area-inset-top)] max-sm:pr-[max(12px,env(safe-area-inset-right))] max-sm:pl-[max(4px,env(safe-area-inset-left))]">
        {/* A phone: the panel is the screen, so the way back leads. */}
        <a
          href={place.link({ [meta.name.one]: null, tab: null })}
          className="inline-flex h-11 items-center gap-1 pr-3 pl-1 text-[15px] font-medium text-(--ui-ink) no-underline sm:hidden"
        >
          <ChevronLeft className="size-5" />
          {cap(meta.name.many)}
        </a>
        <button
          type="button"
          className={ICON}
          aria-label="Previous"
          {...tipProps("Previous", { keys: "K", as: "none" })}
          disabled={index <= 0}
          onClick={() => step(-1)}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          className={ICON}
          aria-label="Next"
          {...tipProps("Next", { keys: "J", as: "none" })}
          disabled={index < 0 || index >= count - 1}
          onClick={() => step(1)}
        >
          <ChevronDown className="size-4" />
        </button>
        <span className="ml-1 text-[12px] text-(--ui-ink-3) max-sm:hidden">
          {index >= 0 ? `${num(index + 1)} of ${num(count)}` : ""}
        </span>
        <a
          href={place.page(id)}
          className={cn(ICON, "ml-auto")}
          aria-label="Open as a page"
          {...tipProps("Open as a page", { as: "none" })}
        >
          <Maximize2 className="size-3.5" />
        </a>
        <a
          href={place.link({ [meta.name.one]: null, tab: null })}
          className={cn(ICON, "max-sm:hidden")}
          aria-label="Close"
          {...tipProps("Close", { keys: "Esc", as: "none" })}
        >
          <X className="size-4" />
        </a>
      </div>
      <div
        key={id}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-10 max-sm:pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6"
      >
        {body}
      </div>
    </aside>
  );
}

/** A sheet's Done, at its head's left as iOS puts it: slides it shut. */
function SheetDone() {
  const sheet = useSheet();
  return (
    <button
      type="button"
      className="h-11 border-0 bg-transparent px-2 text-[16px] font-semibold text-(--ui-link) active:opacity-50"
      onClick={() => sheet?.close()}
    >
      Done
    </button>
  );
}

/** The Record template as its own page: back to the list, then the record. */
export function RecordPage({ id, ...props }: RecordTemplateProps & { id: string }) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!meta || !types.data) return <ListSkeleton />;
  return (
    <div className={cn(ROOT, "mx-auto grid max-w-[880px] gap-4")}>
      {/* A phone's bar at the top leads back there instead. */}
      <a
        href={props.place.list}
        className="w-fit text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink) max-[900px]:in-data-[phone-nav]:hidden"
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
        docked
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
  docked = false,
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
  /** In a panel: on a phone its actions sit in a bar at the thumb, not under the title. */
  docked?: boolean | undefined;
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
  // Issues sit on every record a signed-in login reads, but not on access's own lists.
  const access =
    api.access && acts && !acts.viewer.demo && !meta.id.startsWith("access.") ? api.access : null;
  const issues = useLoad<IssueLine[] | null>(
    `issues:${meta.id}:${id}:${rev}`,
    () => (access ? access.issues({ record: meta.id, id }) : Promise.resolve(null)),
    api,
  );
  /** The draft box, when the record holds one: what's typed is saved before any head action. */
  const draftBox = useRef<DraftHandle | null>(null);
  /** What's typed in that box now, for a live preview beside it; this record's only. */
  const [typed, setTyped] = useState<{ id: string; text: string } | null>(null);
  const [lit, pickMark] = useSourcePick();
  const tab = place.params.get("tab") ?? "details";
  const [want, setWant] = useState<string | null>(null);
  // Where this row sits, for what its head may show: the YouTube editor acts on YouTube's alone.
  const here: Target = got.data ? rowTarget(meta, got.data.row, api.access?.client ?? "") : {};
  if (!api.access) delete here.client;
  const act: RecordAct = async (action, input = {}) => {
    const a = actsOf(meta, acts, true, here).find((x) => x.id === action);
    if (!a || !acts || !got.data) throw new Error("You can't do that here.");
    const rowId = got.data.row.id as string | number;
    const out = await acts.call(a.handler, { ids: [rowId], ...input });
    acted([rowId]);
    return out;
  };
  // A type with no `load` still gets its extras, with no detail.
  const more = got.data && extras ? extras(got.data.detail, got.data.row, act) : {};
  const state = got.data?.edit ?? null;
  // Changing it needs `run` here; the server checks it again.
  const mayEdit =
    !!state &&
    !!api.edit &&
    (!acts || can(acts.viewer, { audience: "team", needs: meta.editNeeds ?? "run" }));
  const editing: Editing | null =
    mayEdit && state
      ? {
          save: async (patch, run) => {
            const out = await (api.edit as NonNullable<RecordsApi["edit"]>)({
              record: meta.id,
              id,
              patch,
              expect: state.version,
              ...(run ? { run } : {}),
            });
            acted(out.change === null ? [] : [id]);
            return out.change;
          },
          undo: async (change) => {
            await api.undo?.({ record: meta.id, id, change });
            acted([id]);
          },
          ...(api.ask
            ? {
                ask: async (message: string) => {
                  await api.ask?.({ record: meta.id, id, message });
                  got.retry();
                },
              }
            : {}),
        }
      : null;
  const poll = more.poll ?? (thinking(state) ? ASK_POLL_MS : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new read sets the next one.
  useEffect(() => {
    if (!poll) return;
    const t = setTimeout(got.retry, poll);
    return () => clearTimeout(t);
  }, [got.data]);
  // ⌘K asks about this record; with edits, its answer lands in the Ask box here.
  useOpenRecord(`${meta.id}:${id}:${tab}:${got.data ? 1 : 0}:${editing ? 1 : 0}`, () =>
    got.data
      ? {
          type: meta.id,
          id,
          title: titleOf(meta, got.data.row),
          one: meta.name.one,
          ask: editing?.ask
            ? async (q: string) => {
                if (tab !== "details") place.go(place.link({ tab: null }), true);
                await editing.ask?.(q);
                dispatchEvent(new Event(ASK_FOCUS));
              }
            : undefined,
        }
      : null,
  );
  // A chip on another tab opens the sources, then lights its card once it's drawn.
  useEffect(() => {
    if (want && tab === "sources") {
      pickMark(want);
      setWant(null);
    }
  }, [want, tab, pickMark]);

  if (got.error && !got.data)
    return <LoadFailed error={got.error} onRetry={got.retry} what={meta.name.one} />;
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
  // A draft the record holds is its box, not a field.
  const box = more.draft;
  // Fields he edits in place draw once, as their inputs.
  const own = new Set(editing ? (meta.edits ?? []) : []);
  // Long text and states have their own places below; the key facts are the short rest.
  const long = (f: FieldMeta | undefined) =>
    !!f &&
    (f.kind === "status" || f.kind === "prose" || f.kind === "cited" || f.key === box?.field);
  // The header says each field once; the Details below leave out what it shows.
  const { sub, states, keys, shown: inHead } = recordHead(meta, row, long);
  const subCue = subtitleCue(meta, row);
  // Long text reads as its own section, above the facts.
  const cited = meta.fields.filter(
    (f) =>
      (f.kind === "cited" || f.kind === "prose") &&
      row[f.key] &&
      f.key !== box?.field &&
      !own.has(f.key) &&
      !more.drawn?.includes(f.key),
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
      !own.has(f.key) &&
      row[f.key] != null &&
      row[f.key] !== "" &&
      !inHead.has(f.key) &&
      !told.has(f.label) &&
      !(f.group && more.drawn?.includes(f.group)),
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
  const shown = actsOf(meta, acts, false, here).filter((a) => applies(a, row));
  const inline = box ? actsOf(meta, acts, true, here).filter((a) => applies(a, row)) : [];
  // A blocked send (a carousel's Approve) leaves the box without one; the head says why.
  const sendAction = box?.send ? shown.find((a) => a.id === box.send && runs(a, row)) : undefined;
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
    ...(activity
      ? [{ id: "activity", label: meta.activityLabel ?? "Activity", count: activity.length }]
      : []),
    ...(state ? [{ id: "history", label: "History", count: state.history.length }] : []),
    ...(access && issues.data
      ? [
          {
            id: "issues",
            label: "Issues",
            count: issues.data.filter((i) => !i.resolvedAt).length,
          },
        ]
      : []),
    ...(more.sources ? [{ id: "sources", label: "Sources", count: sources.length }] : []),
  ];
  const relatedType = types.find(
    (t) => t.name.many === tab && related.some((r) => r.record === t.id),
  );

  return (
    <article className="grid gap-5 max-[900px]:pb-(--dock-h,0px)">
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-3 max-sm:flex-col">
          <div className="min-w-0">
            <h2 className={PAGE_TITLE}>{titleOf(meta, row)}</h2>
            {sub ? (
              <p className="mt-0.5 line-clamp-2 text-[14px] text-(--ui-ink-2)" {...clipProps()}>
                {subCue ? (
                  <span className="mr-1.5 inline-flex align-[-0.1em]">
                    <Cue state={subCue} size={15} />
                  </span>
                ) : null}
                {subtitleOf(meta, row)}
              </p>
            ) : null}
          </div>
          {shown.length ? (
            <div
              ref={docked ? dockRoom : undefined}
              className={cn(
                "flex shrink-0 flex-wrap items-center gap-2",
                // A phone: at the thumb. In a sheet it stays at the screen's foot down to half
                // height, moving as the sheet does (--sheet-y), then rides down with it.
                docked &&
                  "max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-10 max-[900px]:flex-nowrap max-[900px]:overflow-x-auto max-[900px]:border-t max-[900px]:border-(--ui-hair) max-[900px]:[background:linear-gradient(var(--ui-band),var(--ui-band)),var(--ui-paper)] max-[900px]:px-4 max-[900px]:pt-2 max-[900px]:pb-[calc(8px+env(safe-area-inset-bottom))] max-[900px]:[scrollbar-width:none] max-[900px]:[transform:translate3d(0,calc(-1*min(var(--sheet-y,0px),var(--sheet-mid,0px))),0)] max-[900px]:[transition:transform_var(--sheet-t,0ms)_cubic-bezier(0.32,0.72,0,1)] max-[900px]:[&>*]:flex-none",
              )}
            >
              {shown.map((a, i) => (
                <Why
                  key={a.id}
                  text={blockedOf(a, row) ?? (a.key ? a.label : undefined)}
                  keys={blockedOf(a, row) ? undefined : a.key?.toUpperCase()}
                >
                  <Button
                    tone={i === 0 ? "primary" : "secondary"}
                    size={i === 0 ? "next" : "dense"}
                    busy={running?.action === a.id}
                    disabled={busy || !!blockedOf(a, row)}
                    onClick={() => runHead(a)}
                  >
                    {a.label}
                  </Button>
                </Why>
              ))}
              {dialog}
            </div>
          ) : access &&
            !access.readOnly &&
            acts &&
            issues.data &&
            canAt(acts.viewer, "comment", here) ? (
            // Nothing here they may do: raising an issue takes the actions' place.
            <Button
              tone="secondary"
              size="dense"
              className="shrink-0"
              onClick={() => place.go(place.link({ tab: "issues" }), true)}
            >
              Raise issue
            </Button>
          ) : null}
        </div>
        {shown.map((a) => {
          const why = blockedOf(a, row);
          return why ? (
            <p key={a.id} className="m-0 text-[13px] text-(--ui-ink-2)">
              {why}
            </p>
          ) : null;
        })}
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
                <span className="text-(--ui-ink-2)">{f.label}</span>
                <FieldCell field={f} cell={row[f.key]} />
              </span>
            ))}
          </div>
        ) : null}
        {access && acts ? (
          <AskAccess meta={meta} row={row} access={access} viewer={acts.viewer} />
        ) : null}
        {keys.length ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-(--ui-hair) py-3 sm:grid-cols-4">
            {keys.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-[12px] text-(--ui-ink-2)">{f.label}</dt>
                <dd
                  // A fact wraps, never cut: tags at their commas ("Sends messages, Spends
                  // money"), an address anywhere ("dana@northwind.example" stays whole).
                  className="mt-0.5 text-[18px] leading-6 font-semibold tracking-[-0.01em] text-pretty [overflow-wrap:anywhere]"
                >
                  <FieldCell field={f} cell={row[f.key]} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>
      {more.top}

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
        <Activity lines={activity} one={meta.name.one} empty={meta.activityEmpty} />
      ) : tab === "history" && state ? (
        <History meta={meta} lines={state.history} values={state.values} editing={editing} />
      ) : tab === "issues" && access && acts && issues.data ? (
        <RecordIssues
          meta={meta}
          row={row}
          title={titleOf(meta, row)}
          access={access}
          viewer={acts.viewer}
          lines={issues.data}
          reload={issues.retry}
        />
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
        <Beside aside={more.aside} text={typed?.id === id ? typed.text : null}>
          {/* What a draft answers (their words, the thread so far) reads before it. */}
          {more.lead}
          {box ? null : more.form}
          {editing && state ? (
            <>
              <EditFields
                meta={meta}
                state={state}
                editing={editing}
                read={(f) =>
                  row[f.key] != null && row[f.key] !== "" ? (
                    <FieldLine field={f} cell={row[f.key]} cite={cite} />
                  ) : null
                }
              />
              {editing.ask ? <AskClaude meta={meta} turns={state.asks} editing={editing} /> : null}
            </>
          ) : null}
          {cited.map((f) => (
            <section key={f.key} className="grid gap-1.5">
              <h3 className={GROUP_LABEL}>{f.label}</h3>
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
              between={more.form}
              framed={!more.aside}
              onText={more.aside ? (text) => setTyped({ id, text }) : undefined}
            />
          ) : null}
          {rest.some((f) => !f.group) || more.facts?.length ? (
            <dl className={DL}>
              {lines(rest.filter((f) => !f.group))}
              {(more.facts ?? []).map(([label, value]) => (
                <Line key={label} label={label}>
                  {value}
                </Line>
              ))}
            </dl>
          ) : null}
          {named.map((g) => (
            <section key={g} className="grid gap-1.5">
              <h3 className={GROUP_LABEL}>{g}</h3>
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
              <h3 className={GROUP_LABEL}>{title}</h3>
              {body}
            </section>
          ))}
        </Beside>
      )}
    </article>
  );
}

/**
 * The details, with the record's live preview beside them when it has one: on a wide page the
 * preview is the right column and stays in view while the fields scroll; on a narrow one it sits
 * above them, folded behind a Preview button so the fields stay near the top.
 */
function Beside({
  aside,
  text,
  children,
}: {
  aside: ReactNode;
  text: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!aside) return <div className="grid gap-6">{children}</div>;
  return (
    <DraftText.Provider value={text}>
      <div className="@container/record">
        <div
          // Two columns once the record has room for both: about a 1100 px window beside the nav.
          className="grid gap-4 @min-[760px]/record:grid-cols-[minmax(0,1fr)_minmax(0,360px)] @min-[760px]/record:gap-x-10"
        >
          <div className="grid min-w-0 content-start gap-3 @min-[760px]/record:sticky @min-[760px]/record:top-4 @min-[760px]/record:col-start-2 @min-[760px]/record:row-start-1 @min-[760px]/record:max-h-[calc(100dvh-2rem)] @min-[760px]/record:self-start @min-[760px]/record:overflow-y-auto">
            <Button
              tone="secondary"
              size="dense"
              className="w-fit @min-[760px]/record:hidden"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide preview" : "Preview"}
            </Button>
            <div className={open ? "min-w-0" : "hidden min-w-0 @min-[760px]/record:block"}>
              {aside}
            </div>
          </div>
          <div className="grid min-w-0 content-start gap-6 @min-[760px]/record:col-start-1 @min-[760px]/record:row-start-1">
            {children}
          </div>
        </div>
      </div>
    </DraftText.Provider>
  );
}

/** A record's facts as a framed two-column table: labels on the band, values on paper. */
const DL =
  "grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] border border-b-0 border-(--ui-hair) text-[14px]";

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="border-r border-b border-(--ui-hair) bg-(--ui-band) px-3 py-2.5 text-[13px] text-(--ui-ink-2)">
        {label}
      </dt>
      <dd className="min-w-0 border-b border-(--ui-hair) px-3 py-2.5 break-words">{children}</dd>
    </>
  );
}

/** Nothing here yet: a dashed box, so it reads as a place that fills, not as stray text. */
export function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-(--ui-edge) bg-(--ui-wash) px-4 py-6 text-[14px] text-(--ui-ink-2)">
      {children}
    </p>
  );
}

/** What happened to a record, newest first. */
function Activity({
  lines,
  one,
  empty,
}: {
  lines: RecordAnswer["activity"] & object;
  one: string;
  empty?: string | undefined;
}) {
  if (!lines.length)
    return (
      <Quiet>
        {empty ?? `Emails, replies and findings about this ${one} show here as they happen.`}
      </Quiet>
    );
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
              {...(d ? dateTip(d) : {})}
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
  if (page.error && !page.data) return <LoadFailed error={page.error} onRetry={page.retry} />;
  if (!page.data) return <div className="h-24 w-full animate-pulse bg-(--ui-wash)" />;
  if (!page.data.rows.length)
    return (
      <Quiet>
        {cap(meta.name.many)} for this {one} show here.
      </Quiet>
    );
  const cols = meta.fields.filter((f) => f.column).slice(0, 4);
  return (
    <table className="w-full table-fixed border-collapse border border-(--ui-hair) text-[13px] [&_tbody>tr:last-child]:border-b-0">
      <thead>
        <tr className="bg-(--ui-band) text-[12px] text-(--ui-ink-2)">
          {cols.map((f) => (
            <th
              key={f.key}
              className={cn(
                "h-8 truncate border-b border-(--ui-edge) px-2 font-semibold first:w-1/2 first:pl-3",
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
          <tr key={String(r.id)} className="h-(--layout-row) border-b border-(--ui-hair)">
            {cols.map((f, i) => (
              <td
                key={f.key}
                className={cn(
                  "px-2 first:pl-3 last:pr-3",
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
