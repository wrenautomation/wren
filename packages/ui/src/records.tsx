/**
 * The List and Record templates (console standard): a record type's rows and one record, drawn
 * from what the server's `recordsTypes` says, never per page. The address is the state: the
 * view, filters, search, sort, columns, page and open record each ride in it.
 */

import type { Target } from "@wren/core/access";
import type { ChangeLine, EditAsk, Edited, RecordAskAsk, UndoAsk } from "@wren/core/edits";
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
  Total,
} from "@wren/core/records/serve";
import { cn } from "cn";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { can, canAt, type Viewer } from "./access.js";
import {
  type Action,
  applies,
  blockedOf,
  type Call,
  callOnce,
  inputOf,
  runningOn,
  runs,
  sayBlocked,
  useHeld,
  useRun,
} from "./action.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Button } from "./controls.js";
import { listChanged } from "./data/delta.js";
import { type Load, readCached, useLoad, writeThrough } from "./data/query.js";
import { DraftBox, DraftText, type RecordDraft } from "./draft.js";
import { type LiveText, liveText } from "./draft-save.js";
import {
  ASK_FOCUS,
  ASK_POLL_MS,
  AskClaude,
  EditFields,
  type Editing,
  History,
  thinking,
} from "./edits.js";
import { Empty, LoadFailed, Loading } from "./feedback.js";
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
import { FoldList, FoldPreview, foldOf } from "./fold.js";
import { initials, linkLabel, money, num } from "./format.js";
import { Segmented as Choice, type KeyLine, showKeys, useFrame, usePageKeys } from "./frame.js";
import { tipProps } from "./hint.js";
import { Why } from "./hint-layer.js";
import { useHoverPop } from "./hover-pop.js";
import { Icon } from "./icons.js";
import { away, NoLink } from "./item-link.js";
import { GROUP_LABEL, PAGE_TITLE, PageTitle } from "./layout.js";
import {
  CHIP,
  CHIP_ON,
  filtersOf,
  groupFields,
  type KeepApi,
  ListBar,
  TAB,
  tabTone,
  useLastUsed,
  useNarrow,
  useSavedViews,
  ViewTabs,
} from "./list-bar.js";
import { PageBar } from "./page-bar.js";
import { offsetOf, PAGE_SIZE, PAGE_SIZES, pageAt, pagesOf, sizeOf } from "./pager.js";
import { useOpenRecord, useScope } from "./palette-scope.js";
import { type PeekLine, type PeekSpec, PeekTitle, PeekView } from "./peek.js";
import { BottomSheet, type Swipes, toneOf, useSheet } from "./phone.js";
import { usePhone } from "./phone-shell.js";
import {
  type AccessApi,
  AskAccess,
  type IssueLine,
  RecordIssues,
  rowTarget,
} from "./record-access.js";
import { recordHead } from "./record-head.js";
import { detailPatch, patchRecord } from "./record-patch.js";
import { AskBox, ReplyFrame, RowActions, rowActsOf } from "./row-acts.js";
import {
  Age,
  avatarOf,
  KIND_ICON,
  Rows,
  type RowsAct,
  type RowsColumn,
  type RowsLine,
  type RowsName,
  type RowsPick,
  type RowsWait,
  stateColor,
  waitFrom,
} from "./rows.js";
import { SaveScope, useSavePage } from "./save/react.js";
import { recordKey } from "./save/writes.js";
import { SourceCard, SourceList, stripMarks, useSourcePick } from "./sources.js";
import { Sweep } from "./sweep.js";
import { TabBar } from "./tab-bar.js";
import { DataTable, type ListLine, scrollerOf, useListTable } from "./table.js";
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
  /** What this history entry keeps beside its address: back there, or on a reload, it returns. */
  entry?: EntryKeep;
}

/** A history entry's own keep (the router's state): never in a link someone else opens. */
export interface EntryKeep {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/** The rows picked on this history entry, as kept there. */
function keptPicks(place: Place): Set<string> | null {
  const kept = place.entry?.get("picked");
  return Array.isArray(kept) ? new Set(kept.map(String)) : null;
}

/**
 * The rows picked, kept on the history entry: a reload or back to it picks them again, and a
 * link someone else opens picks none.
 */
function usePicked(place: Place): [Set<string>, (next: Set<string>) => void] {
  const [picked, setPicked] = useState<Set<string>>(() => keptPicks(place) ?? new Set());
  const now = useRef(picked);
  now.current = picked;
  const set = useCallback(
    (next: Set<string>) => {
      setPicked(next);
      place.entry?.set("picked", next.size ? [...next] : undefined);
    },
    [place.entry],
  );
  // Another entry (back, forward, a new filter): its own picks, else these carry onto it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a move gives a new params object.
  useEffect(() => {
    const kept = keptPicks(place);
    if (kept) setPicked(kept);
    else if (now.current.size) place.entry?.set("picked", [...now.current]);
  }, [place.params]);
  return [picked, set];
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
  /** Art over the head, before the title: what a part in the Shop does, drawn large. */
  hero?: ReactNode;
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
  /**
   * Its newest items for the peek, up to three: who, where, when and the words. A type that
   * keeps an activity needs none of this: the peek reads that.
   */
  recent?: PeekLine[];
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
 * this record with `input`, then the record read again. With `patch`, the action's answer
 * patches the page instead (`patch(detail, answer)` answers the new detail and row fields, or
 * null to read again). It throws what the handler refused. Each press is a write in `WRITES`
 * with its own request id, under `record`: a box reads how its press went from there
 * (`useLastWrite(act.record)`), after a remount or a reload too.
 */
export type RecordAct = ((
  action: string,
  input?: Record<string, unknown>,
  o?: { patch?: ActPatch | undefined },
) => Promise<unknown>) & {
  /** This record's key in `WRITES`. */
  readonly record?: string;
};
export type ActPatch = (
  detail: unknown,
  answer: unknown,
) => { detail?: unknown; row?: Record<string, unknown> } | null;

/**
 * A record's own action, pressed (a reply box's Send, an editor's button): one write in
 * `WRITES` with its own request id, its words kept with it until the server answers.
 */
export function pressAct(
  call: Call,
  a: Action,
  id: string | number,
  record: string,
  input: Record<string, unknown>,
) {
  return callOnce(
    call,
    a.handler,
    [id],
    { ids: [id], ...input },
    {
      what: a.id,
      label: a.label,
      records: [record],
      input: Object.keys(input).length ? input : null,
    },
  );
}

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
  /** A Shop card's art, across its top in place of the icon: what the record does, drawn. */
  art?: ((row: Row) => ReactNode) | undefined;
  /** `readAt`: the tick its read left (`useLoad`'s `at`), for the extras' own `useSaved`. */
  extras?:
    | ((detail: unknown, row: Row, act: RecordAct, readAt: number) => RecordExtras)
    | undefined;
  acts?: RecordActs | undefined;
  /** What the page adds beside a list's title, such as a form that adds one; `reload` reads again. */
  head?: ((meta: RecordMeta, reload: () => void) => ReactNode) | undefined;
  /**
   * The page's own reply box (a conversation's, which picks the channel): a list row's Reply
   * opens it under the row, from the record's detail. Its `act` runs the type's inline actions.
   * `when` names the rows it answers, as field → states; every row when left out.
   */
  reply?: RowReplyBox | undefined;
  /**
   * The rows that wait on the viewer, as field → states (a page's `count`). A list puts them first
   * under "Needs you", each edged with the wren mark, and the rest under "For info", quieter.
   */
  needs?: Needs | undefined;
  /**
   * The wait the list watches: `field` holds when the person began to wait, `promise` is how long
   * they may ("24h"). The field draws as a wait, rows past the promise read late, and the foot and
   * each group's fold count them.
   */
  late?: Late | undefined;
  /**
   * What a row click opens: a peek (properties, the newest activity, the reply box or main
   * action) with the full record one click on. `false` opens the whole record in the panel.
   */
  peek?: false | PeekSpec | undefined;
  /** More of how the list shows, first in its bar's display: a page's Timeline or List. */
  display?: ReactNode;
}

/** A page's reply box under a list row, and the rows it answers. */
export interface RowReplyBox {
  when?: Needs | undefined;
  box: (detail: unknown, row: Row, act: RecordAct) => ReactNode;
}

/**
 * A list's watched wait: the field that holds its start, and the promise. With no promise the
 * field only reads as how long ago (People's last touch): never late, no count in the foot.
 */
export interface Late {
  field: string;
  promise?: string | undefined;
  /** Only rows whose `field` holds one of `values` can read late; the rest show their age. */
  open?: { field: string; values: readonly string[] } | undefined;
}

/** Field → the states in which a row waits on the viewer. */
export type Needs = Readonly<Record<string, readonly string[]>>;

/** Whether `row` waits on the viewer: every field `needs` names holds one of its states. */
export const waitsOn = (needs: Needs, row: Row) =>
  Object.entries(needs).every(([k, states]) => states.includes(String(row[k] ?? "")));

/**
 * The rows that wait first, the rest after, each tier in its own order, and how many wait.
 * A list grouped or sorted by hand keeps its own order, so its tiers stay unsplit (`split` -1).
 */
export function tiersOf(rows: Row[], needs: Needs | undefined, keep: boolean) {
  if (!needs || keep) return { rows, split: -1 };
  const first = rows.filter((r) => waitsOn(needs, r));
  if (!first.length || first.length === rows.length) return { rows, split: -1 };
  return { rows: [...first, ...rows.filter((r) => !waitsOn(needs, r))], split: first.length };
}

export type { Load } from "./data/query.js";
export { useLoad };

/**
 * The version each open record draws, by type and id (`RecordBody` sets it). An action with
 * `expect` pressed on a list or a queue sends it, so the server refuses a yes over words the
 * person never saw.
 */
const SHOWN = new Map<string, string>();
const shownKey = (record: string, id: string | number) => `${record}\u0000${id}`;
export const shownVersion = (record: string, id: string | number): string | null =>
  SHOWN.get(shownKey(record, id)) ?? null;
/** The version a record's own read names: its detail's `version`, else its row's. */
export function versionIn(detail: unknown, row?: Row | null): string | null {
  const d = detail as { version?: unknown } | null;
  if (d && typeof d.version === "string") return d.version;
  return typeof row?.version === "string" ? row.version : null;
}

/** Record types move with a deploy, not a click: a mount reads them only past this. */
const TYPES_FRESH_MS = 10 * 60_000;
/**
 * A workspace's record types, under its api's scope: kept on the device with its lists (a named
 * api), so a reload paints the list and its panel before they're read again.
 */
export function useTypes(api: RecordsApi): Load<RecordMeta[]> {
  return useLoad("types", () => api.types(), api, { freshMs: TYPES_FRESH_MS });
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
const firstWords = (t: string) => stripMarks(t).replace(/\s+/g, " ").trim();
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

/**
 * The row a walk key lands on: `step` rows on from `at`, past those a shut group hides; at the
 * end it stays, and from no row it takes the first in view. -1 when every row is hidden.
 */
export function walkTo(
  at: number,
  step: 1 | -1,
  count: number,
  hidden: (i: number) => boolean,
): number {
  for (let i = at + step; i >= 0 && i < count; i += step) if (!hidden(i)) return i;
  if (at >= 0 && at < count && !hidden(at)) return at;
  for (let i = 0; i < count; i++) if (!hidden(i)) return i;
  return -1;
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
  running: { action: string; ids: readonly (string | number)[] } | null;
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
                  busy={runningOn(running, a.id, ids)}
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

/** The templates' type. Buttons follow the tokens, as everywhere. */
export const ROOT = "text-[14px] text-(--ui-ink) [font-variant-numeric:tabular-nums]";

/**
 * Which columns show: the address's `cols` in its order (the title first), else the page's,
 * else every field that has one.
 */
export function columnsOf(
  meta: RecordMeta,
  params: URLSearchParams,
  columns?: string[],
): FieldMeta[] {
  const all = meta.fields.filter((f) => f.column);
  const cols = params.get("cols")?.split(",");
  if (cols) {
    const title = all.filter((f) => f.key === meta.title);
    const rest = cols.flatMap((k) => all.filter((f) => f.key === k && f.key !== meta.title));
    return [...title, ...rest];
  }
  // A page's own columns always carry the record's declared account; a viewer may take it off.
  const picked = columns && meta.account ? [...columns, meta.account] : columns;
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
  const pop = useHoverPop();
  const all = narrow ? [] : meta.fields.filter((f) => f.column && f.key !== meta.title);
  // Group by its platform, the account each row is on, or any status or choice: one at a time.
  const groups = groupFields(meta);
  if (!frame && !groups.length && !all.length) return null;
  const shown = new Set(columnsOf(meta, place.params, columns).map((f) => f.key));
  const fallback = columnsOf(meta, new URLSearchParams(), columns)
    .map((f) => f.key)
    .filter((k) => k !== meta.title)
    .join(",");
  // The shown columns in their order, then the rest; each change writes the order to `cols`.
  const order = columnsOf(meta, place.params, columns)
    .map((f) => f.key)
    .filter((k) => k !== meta.title);
  const listed = [
    ...order.flatMap((k) => all.filter((f) => f.key === k)),
    ...all.filter((f) => !order.includes(f.key)),
  ];
  const write = (keys: string[]) => {
    const next = keys.join(",");
    place.go(place.link({ cols: next === fallback ? null : next || "none" }), true);
  };
  const flip = (key: string) =>
    write(shown.has(key) ? order.filter((k) => k !== key) : [...order, key]);
  const raise = (key: string) => {
    const i = order.indexOf(key);
    if (i < 1) return;
    const next = [...order];
    next.splice(i - 1, 2, key, order[i - 1] as string);
    write(next);
  };
  const grouping = groups.some((f) => place.params.get("group") === f.key);
  const label =
    "flex h-8 pointer-coarse:h-11 cursor-pointer items-center gap-2.5 px-1.5 text-[13px] hover:bg-(--ui-hover)";
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        className={cn(CHIP, (grouping || place.params.has("cols")) && CHIP_ON)}
      >
        <Icon name="sliders" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>Display</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70dvh] w-60 gap-3 overflow-y-auto p-3">
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
        <Choice
          label="Per page"
          value={String(sizeOf(place.params))}
          options={PAGE_SIZES.map((n) => [String(n), String(n)] as const)}
          onChange={(n) =>
            place.go(place.link({ size: Number(n) === PAGE_SIZE ? null : n, pg: null }), true)
          }
        />
        {groups.map((g) => {
          const on = place.params.get("group") === g.key;
          return (
            <label key={g.key} className={cn(label, "-mx-1.5")}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => place.go(place.link({ group: on ? null : g.key, pg: null }), true)}
                className="size-3.5 accent-(--ui-ink)"
              />
              Group by {g.label.toLowerCase()}
            </label>
          );
        })}
        {all.length ? (
          <fieldset className="m-0 grid min-w-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[12.5px] font-medium text-(--ui-ink-2)">
              Columns
            </legend>
            {listed.map((f) => (
              <div key={f.key} className="-mx-1.5 flex items-center">
                <label className={cn(label, "min-w-0 flex-1")}>
                  <input
                    type="checkbox"
                    checked={shown.has(f.key)}
                    onChange={() => flip(f.key)}
                    className="size-3.5 accent-(--ui-ink)"
                  />
                  {f.label}
                </label>
                {order.indexOf(f.key) > 0 ? (
                  <button
                    type="button"
                    aria-label={`Move ${f.label.toLowerCase()} left`}
                    {...tipProps("Move left")}
                    onClick={() => raise(f.key)}
                    className="grid size-7 pointer-coarse:size-11 place-items-center text-(--ui-ink-3) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
                  >
                    <Icon name="arrowUp" className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </fieldset>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A row's title by whether it waits on the viewer: what waits reads heavier, what is for info
 * reads quieter, and a page that names nothing waiting keeps the one weight.
 */
const TITLE_WEIGHT: Record<string, string> = {
  true: "font-semibold text-(--ui-ink)",
  false: "font-normal text-(--ui-ink-2)",
  null: "font-semibold text-(--ui-ink)",
};

/** A tier's name and count: "Needs you 4" or "For info 9". */
export function TierLabel({ needs, n }: { needs: boolean; n: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={needs ? "text-(--ui-ink)" : undefined}>
        {needs ? "Needs you" : "For info"}
      </span>
      <span className="font-normal text-(--ui-ink-3) tabular-nums">{num(n)}</span>
    </span>
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

/** The page of rows an address asks for: its filters, sort and group, `pg`'s slice. */
export function pageAskOf(meta: RecordMeta, params: URLSearchParams): ListAsk {
  const at = pageAt(params.get("pg"));
  const size = sizeOf(params);
  return { ...askOf(meta, params), limit: size, ...(at > 1 ? { offset: offsetOf(at, size) } : {}) };
}

/**
 * Read an address's rows ahead into the data layer, under the key the list reads them by: a
 * route's loader calls it on a hover or a move, so the list paints from the cache. The record's
 * type comes from the cached types; none cached yet, it reads nothing.
 */
export async function prefetchList(
  api: RecordsApi,
  record: string,
  params: URLSearchParams,
): Promise<void> {
  const types = await readCached(api, "types", () => api.types(), TYPES_FRESH_MS);
  const meta = types.find((t) => t.id === record);
  if (!meta) return;
  const asked = pageAskOf(meta, params);
  await readCached(api, JSON.stringify(asked), () => api.list(asked));
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
  dir,
}: {
  field: FieldMeta;
  place: Place;
  sort: string | undefined;
  /** Which way the table sorts by this column, if it does. */
  dir: false | "asc" | "desc";
}) {
  const on = dir !== false;
  const desc = dir === "desc";
  const end = field.column?.align === "end";
  if (!field.sortable) return <span className="whitespace-normal">{field.label}</span>;
  // Numbers and dates start high; words and states start at the top of their order.
  const first = end ? `-${field.key}` : field.key;
  const next = on ? (desc ? field.key : `-${field.key}`) : first;
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
      <span className="whitespace-normal">{field.label}</span>
      {on ? <Icon name={desc ? "arrowDown" : "arrowUp"} className="size-3 shrink-0" /> : null}
    </a>
  );
}

/** A page whose record isn't served here: its part isn't installed. Said once, not a skeleton forever. */
export function NotHere() {
  return <Empty>This page fills once its part is installed.</Empty>;
}

/** The List template: views as tabs, search, a chip per filter, sortable columns, CSV, ↑/↓. */
export function RecordList(props: RecordTemplateProps) {
  const {
    record,
    api,
    place,
    empty,
    columns,
    extras,
    acts,
    head,
    title,
    needs,
    late,
    reply,
    display,
    peek,
  } = props;
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
      needs={needs}
      late={late}
      reply={reply}
      display={display}
      peek={peek}
    />
  );
}

const blank = (c: Cell | undefined) =>
  c === null || c === undefined || c === "" || (Array.isArray(c) && !c.length);

/** A canvas to measure words in the list's own font; null off a browser. */
let pen: CanvasRenderingContext2D | null | undefined;
/**
 * Words' width in characters of 7.2px, the unit the widths count in: measured in the list's
 * 14px font when there is one ("Companies" is 7.5, not 9), else one per character.
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
  pen.font = `14px ${getComputedStyle(document.body).fontFamily}`;
  return pen.measureText(s).width / 7.2;
}

/** How many characters a cell takes on screen: a state by its label, a date as "10 minutes ago". */
function charsOf(f: FieldMeta, c: Cell | undefined): number {
  if (blank(c)) return 0;
  if (f.kind === "date") return 14;
  // A state's dot and its gaps take about four characters (measured: "Changed" needs 101px).
  if (f.kind === "status" || f.kind === "verdict")
    return lenOf(f.states?.[String(c)]?.label ?? String(c)) + 4;
  // A choice's mark or tint takes about three characters, as a state's dot does.
  if (f.kind === "choice" || f.words)
    return lenOf(shownOf(f, String(c))) + (cueOf(f, String(c)) ? 3 : 0);
  if (f.kind === "link") return lenOf(linkLabel(String(c), f.label));
  if (f.kind === "actor") return lenOf(actorParts(String(c))?.join(" · ") ?? String(c));
  // A score's bar and its gap are 48px, about seven characters; the digits run wider than the
  // average character, so one more keeps "100" whole.
  if (f.kind === "score") return String(c).length + (f.max ? 8 : 0);
  if (Array.isArray(c)) return lenOf(c.join(", "));
  if (c && typeof c === "object") {
    if ("name" in c) return lenOf(c.name);
    if ("amount" in c) return lenOf(money(c.amount, c.currency)) + 1;
    return `${c.n} of ${c.of}`.length;
  }
  return f.column?.align === "end" ? String(c).length + 3 : lenOf(String(c));
}

/** A cell's width in px: about 7.2 a character at 14px, and the cell's padding. */
const pxOf = (chars: number) => Math.ceil(chars * 7.2) + 24;

/** The most a column grows before the others have their words: its kind's max (set in core), never below its preset. */
const maxOf = (f: FieldMeta) => Math.max(f.column?.max ?? 0, widthOf(f));

/** The checkbox gutter and the actions column, as `Rows` draws them. */
const FIXED = 28 + 44;
/** A head reads at 12.5px; the measure counts in the cells' 14px. */
const HEAD = 12.5 / 14;
/** A head's kind icon and its gap (21px); the sorted one also its arrow (16px). */
const headExtra = (sorted: boolean) => 3 + (sorted ? 2.3 : 0);
/** A title's words read heavier: 7.6px a character. */
const titlePx = (chars: number, mark: number) => Math.ceil(chars * 7.6) + 24 + mark;
/** The least a list's title keeps, so what the row is stays readable. */
const TITLE_LEAST = 160;
/** A column this wide or less holds short words: it fills before a long one grows. */
const SHORT = 168;
/** The title's words on one line count to here before the other columns grow past their max. */
const TITLE_WANT = 360;

/** The kinds whose words wrap in their cell: free text and names, never a state, number or date. */
const YIELDS: ReadonlySet<FieldMeta["kind"]> = new Set([
  "text",
  "name",
  "company",
  "actor",
  "link",
  "tags",
]);

/** A cell's words, when they may wrap; null for one that keeps its line (a state, a figure, a date). */
function cellWords(f: FieldMeta, c: Cell | undefined): string | null {
  if (blank(c) || !YIELDS.has(f.kind) || f.words) return null;
  if (f.kind === "link") return linkLabel(String(c), f.label);
  if (f.kind === "actor") return actorParts(String(c))?.join(" · ") ?? String(c);
  if (Array.isArray(c)) return c.join(", ");
  if (c && typeof c === "object") return "name" in c ? c.name : null;
  return String(c);
}

/** The widest word of `s` in characters: a line breaks at a space or after a hyphen. */
const longestWord = (s: string) => Math.max(0, ...s.split(/\s+|(?<=-)/).map(lenOf));

/**
 * A column's three widths in px. `least`: no word breaks (its longest word, its head's longest
 * word, a state or a date whole). `want`: its widest cell on one line, up to its kind's max.
 * `need`: every cell on one line.
 */
type Span = { least: number; want: number; need: number };

function headSpan(label: string, sorted: boolean): Span {
  const words = label.split(/\s+/).map(lenOf);
  const extra = headExtra(sorted);
  const least = pxOf(Math.max(...words) * HEAD + extra);
  // A head may take two lines: its longest word, or half of it.
  const want = pxOf(Math.max(...words, lenOf(label) / 2) * HEAD + extra);
  return { least, want, need: want };
}

function spanOf(f: FieldMeta, rows: Row[], total: Total | undefined, sorted: boolean): Span {
  const head = headSpan(f.label, sorted);
  const sum = total && "sum" in total ? pxOf(lenOf(money(total.sum, total.currency)) + 1) : 0;
  let least = Math.max(48, head.least, sum);
  let need = Math.max(48, head.want, sum);
  for (const r of rows) {
    const whole = pxOf(charsOf(f, r[f.key]));
    const words = cellWords(f, r[f.key]);
    need = Math.max(need, whole);
    least = Math.max(least, words === null ? whole : pxOf(longestWord(words)));
  }
  // One word longer than the kind's max (a link) breaks inside it.
  least = Math.min(least, Math.max(maxOf(f), head.least));
  return { least, want: Math.max(least, Math.min(need, maxOf(f))), need: Math.max(least, need) };
}

function titleSpan(meta: RecordMeta, f: FieldMeta, rows: Row[], sorted: boolean): Span {
  const head = headSpan(f.label, sorted);
  // A person's initials sit in an avatar before the name (22px and its gap).
  const mark = f.kind === "name" ? 30 : 0;
  let least = Math.max(TITLE_LEAST, head.least);
  let need = least;
  for (const r of rows) {
    const t = titleOf(meta, r);
    need = Math.max(need, titlePx(lenOf(t), mark));
    least = Math.max(least, titlePx(longestWord(t), mark));
  }
  least = Math.min(least, TITLE_WANT);
  // A title with a message under it (a DM, a comment) wants the room: the message is what the row is.
  const previews = meta.fields.some((m) => m.key === meta.subtitle && m.kind === "prose");
  const want = previews ? Math.max(need, TITLE_WANT) : Math.min(need, TITLE_WANT);
  return { least, want: Math.max(least, want), need: Math.max(least, need, want) };
}

/**
 * A column's width for the rows shown, before the room is known: what its head and its widest
 * cell need on one line, within its kind's max. A figure's head takes two lines as a word's does.
 */
export function fitOf(f: FieldMeta, rows: Row[], total?: Total, sorted = false): number {
  return rows.length ? spanOf(f, rows, total, sorted).want : widthOf(f);
}

/** The title's least width: no word of any title shown breaks. `Rows` keeps it as the name's min. */
export function titleLeast(meta: RecordMeta, rows: Row[], sort?: string | undefined): number {
  const f = meta.fields.find((m) => m.key === meta.title);
  if (!f) return TITLE_LEAST;
  return titleSpan(meta, f, rows, sort?.replace(/^-/, "") === f.key).least;
}

/**
 * Each column's width; the title has none and takes what the rest leave. With the room known,
 * every column starts at its least (no word breaks), then the spare room goes, by how short each
 * is: first to a column of short words, then to each one's words on one line within its max, then
 * past it. Only when the leasts alone are wider than the room does the list scroll sideways; its
 * actions stay at the right edge.
 */
export function widthsOf(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  room?: number,
  totals?: Record<string, Total>,
  sort?: string | undefined,
): Record<string, number | undefined> {
  const span = spansOf(meta, cols, rows, totals, sort);
  const out: Record<string, number | undefined> = {};
  if (!room || !rows.length) {
    for (const f of cols) out[f.key] = f.key === meta.title ? undefined : span(f).want;
    return out;
  }
  const w = new Map(cols.map((f) => [f.key, span(f).least]));
  let spare = room - FIXED - cols.reduce((n, f) => n + span(f).least, 0);
  // A column of short words ("Company event checks") fills first: whole, it costs little.
  const passes = [
    (f: FieldMeta) => (span(f).want <= SHORT ? span(f).want : 0),
    (f: FieldMeta) => span(f).want,
    (f: FieldMeta) => span(f).need,
  ];
  for (const goal of passes) {
    if (spare <= 0) break;
    const short = cols
      .map((f) => [f, goal(f) - (w.get(f.key) ?? 0)] as const)
      .filter(([, d]) => d > 0);
    const all = short.reduce((n, [, d]) => n + d, 0);
    if (!all) continue;
    const share = Math.min(1, spare / all);
    for (const [f, d] of short) {
      const add = Math.floor(d * share);
      w.set(f.key, (w.get(f.key) ?? 0) + add);
      spare -= add;
    }
  }
  for (const f of cols) out[f.key] = f.key === meta.title ? undefined : w.get(f.key);
  return out;
}

/** Each column's span for the rows shown: the title's from its words, a field's from its cells. */
function spansOf(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  totals?: Record<string, Total>,
  sort?: string | undefined,
): (f: FieldMeta) => Span {
  const by = sort?.replace(/^-/, "");
  const spans = new Map(
    cols.map((f) => [
      f.key,
      f.key === meta.title
        ? titleSpan(meta, f, rows, f.key === by)
        : rows.length
          ? spanOf(f, rows, totals?.[f.key], f.key === by)
          : { least: widthOf(f), want: widthOf(f), need: widthOf(f) },
    ]),
  );
  return (f) => spans.get(f.key) as Span;
}

/**
 * The columns a list shows in its room (F1 `.nt`: it never scrolls sideways): the title, then each
 * column in order while it fits on one line, or wrapped at SHORT when longer. One that doesn't is left out of view; it stays
 * a Display pick away and on the record. Columns picked by hand all show, and scroll if they must.
 */
export function fitColumns(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  room: number | undefined,
  totals?: Record<string, Total>,
  sort?: string | undefined,
): FieldMeta[] {
  if (!room || !rows.length) return cols;
  const span = spansOf(meta, cols, rows, totals, sort);
  // A column costs its one line up to SHORT, a longer one wraps there: shown, it reads at a glance.
  const cost = (f: FieldMeta) => Math.max(span(f).least, Math.min(span(f).want, SHORT));
  let used = FIXED + cols.reduce((n, f) => n + (f.key === meta.title ? span(f).least : 0), 0);
  return cols.filter((f) => {
    if (f.key === meta.title) return true;
    if (used + cost(f) > room) return false;
    used += cost(f);
    return true;
  });
}

/**
 * A list's columns beside a docked record (`.nt-pk .nt`): the title, the first column, and the
 * time it waits, else its first date, each while the half holds its words.
 */
export function dockedOf(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  room: number | undefined,
  wait: string | undefined,
  totals?: Record<string, Total>,
  sort?: string | undefined,
): FieldMeta[] {
  const title = cols.filter((f) => f.key === meta.title);
  const rest = cols.filter((f) => f.key !== meta.title);
  const when = rest.find((f) => f.key === wait) ?? rest.find((f, i) => i > 0 && f.kind === "date");
  // The time comes first when the half holds one of the two.
  const pair = [when, rest[0]].filter((f, i, a): f is FieldMeta => !!f && a.indexOf(f) === i);
  const kept = new Set(fitColumns(meta, [...title, ...pair], rows, room, totals, sort));
  return [...title, ...[rest[0], when].filter((f): f is FieldMeta => !!f && kept.has(f))].filter(
    (f, i, a) => a.indexOf(f) === i,
  );
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

/**
 * The columns a list draws: what's picked, less those blank on every row shown or only repeating the title (unless picked
 * by hand), and on a phone the title, the first state that tells the rows apart, and the next fields, three at most.
 */
export function shownColumns(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  { byHand, narrow, wait }: { byHand: boolean; narrow: boolean; wait?: string | undefined },
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
  // A phone row: the title, the state, then the next fields, up to three; a state the same on every
  // row says nothing.
  // The wait a page watches comes first after its state, then the account a row is on: on a phone
  // it says who sends.
  const rest = filled
    .filter((f) => f.key !== meta.title && f !== state && (f.kind !== "status" || tells(f)))
    .sort(
      (a, b) =>
        Number(b.key === wait) - Number(a.key === wait) ||
        Number(b.key === meta.account) - Number(a.key === meta.account),
    );
  const lead = filled.filter((f) => f.key === meta.title);
  return [...lead, ...(state ? [state] : []), ...rest].slice(0, lead.length + NARROW_FIELDS);
}

/** How many fields a phone row shows under its title. */
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
  needs,
  late,
  reply,
  display,
  peek,
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
  needs: Needs | undefined;
  late: Late | undefined;
  reply: RecordTemplateProps["reply"];
  display: ReactNode;
  peek: RecordTemplateProps["peek"];
}) {
  const { params } = place;
  const ask = askOf(meta, params);
  /** The field rows are grouped by, each group under its band. */
  const grouped = ask.group ? (meta.fields.find((f) => f.key === ask.group) ?? null) : null;
  // The page the address names: `pg` from 1, read as rows to skip.
  const at = pageAt(params.get("pg"));
  const narrow = useNarrow();
  const asked: ListAsk = pageAskOf(meta, params);
  const page = useLoad<RecordsPage>(
    JSON.stringify(asked),
    (before) => listChanged((a) => api.list(a), asked, before),
    api,
  );
  // Other rows read while these show. The artifact's Refresh: old data stays, never dimmed.
  const refresh = page.loading && !!page.data;
  // A view's tab turns the ring while its rows read; the pager's count does for another page.
  const settledView = useRef(ask.view);
  if (!page.loading) settledView.current = ask.view;
  const viewing = refresh && settledView.current !== ask.view;
  // Rows set aside wait out their undo off the list; it reads again once their call lands.
  const held = useHeld(meta.name.many);
  const landed = useRef(held.landed);
  useEffect(() => {
    if (landed.current === held.landed) return;
    landed.current = held.landed;
    page.retry();
  }, [held.landed, page.retry]);
  const many = meta.name.many;
  const actions = actsOf(meta, acts);
  // A row an optimistic press sends stays, washed, its word and the ring on it, till the server
  // answers (design language, "Optimistic"). Other held rows leave at once.
  const going = new Map<string, string>();
  for (const [id, what] of held.going) {
    const word = actions.find((a) => a.id === what)?.optimistic;
    if (word) going.set(id, word);
  }
  const goingKey = [...going.keys()].join(" ");
  /** The rows the last action changed: they wash once the list has read them again. */
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [picked, setPicked] = usePicked(place);
  const [rev, setRev] = useState(0);
  const acted = (ids: (string | number)[]) => {
    page.retry();
    setRev((n) => n + 1);
    setPicked(new Set());
    setChanged(new Set(ids.map(String)));
  };
  const {
    run,
    send,
    busy: acting,
    running,
    dialog,
  } = useRun(acts?.call ?? NO_CALL, acted, meta.name, {
    versionOf: (id) =>
      shownVersion(meta.id, id) ??
      versionIn(
        null,
        page.data?.rows.find((r) => String(r.id) === String(id)),
      ),
  });
  // What waits on the viewer comes first; `split` is where "For info" starts.
  const loaded = page.data?.rows;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `goingKey` is `going`, new each render.
  const { rows: tiered, split } = useMemo(
    () =>
      tiersOf(
        (loaded ?? []).filter((r) => !held.ids.has(String(r.id)) || going.has(String(r.id))),
        needs,
        !!grouped || !!ask.sort,
      ),
    [loaded, needs, grouped, ask.sort, held.ids, goingKey],
  );
  /** Whether a row waits on the viewer; null where the page names nothing that waits. */
  const waits = (r: Row) => (needs ? waitsOn(needs, r) : null);
  // One clock for the page: every row's wait reads against the moment its rows loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page of rows is a new moment.
  const now = useMemo(() => new Date(), [loaded]);
  /** How long a row has waited and whether that is late; null where it has no start or no promise. */
  const waitOf = (r: Row): RowsWait | null => {
    if (!late) return null;
    const open = !late.open || late.open.values.includes(textOf(r[late.open.field]));
    return waitFrom(textOf(r[late.field]), late.promise, open, now);
  };
  const size = sizeOf(params);
  const pages = pagesOf(page.data?.total ?? 0, size);
  const sort = ask.sort ?? meta.views.find((v) => v.id === ask.view)?.sort;
  // The rows on TanStack Table: it groups them (a group's band, or "Needs you" and "For info"),
  // orders the columns as the address says, and keeps which rows are picked.
  // Columns picked in Display all show; the page's own fit the room.
  const byHand = params.has("cols");
  const table = useListTable({
    meta,
    rows: tiered,
    cols: shownColumns(meta, columnsOf(meta, params, columns), tiered, {
      byHand,
      narrow,
      wait: late?.promise ? late.field : undefined,
    }),
    sort,
    group: grouped,
    split,
    picked,
    onPicked: setPicked,
  });
  const { rows, cols } = table;
  // A prose subtitle (a comment's words, a DM) previews under each row's title.
  const preview = meta.fields.find((f) => f.key === meta.subtitle && f.kind === "prose");
  const totals = page.data?.totals;
  const footed = !!rows.length && !!totals && cols.some((f) => totalSays(f, totals[f.key]));
  const [scroller, room] = useRoom();
  const frame = useRef<HTMLDivElement | null>(null);
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const frameRef = useCallback(
    (el: HTMLDivElement | null) => {
      frame.current = el;
      setFrameEl(el);
      scroller(el);
    },
    [scroller],
  );
  // The rows scroll with the page: the shell's scroller, or the window on a phone.
  const pageScroller = useMemo(() => (frameEl ? scrollerOf(frameEl) : null), [frameEl]);
  // A new page starts at the top of the list, not wherever the pager was pressed.
  const was = useRef(at);
  useEffect(() => {
    if (was.current === at) return;
    was.current = at;
    const el = frame.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [at]);
  // A page past the end (rows left since the link was made) lands on the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: place changes every render.
  useEffect(() => {
    if (page.data && at > pages)
      place.go(place.link({ pg: pages > 1 ? String(pages) : null }), true);
  }, [page.data, at, pages]);
  const openId = params.get(meta.name.one);
  // A record opened on a wide screen docks beside the list, peek or whole; never over the rows.
  const docked = !!openId && !narrow;
  const fitted = byHand || narrow ? cols : fitColumns(meta, cols, rows, room, totals, sort);
  const drawnCols = docked ? dockedOf(meta, cols, rows, room, late?.field, totals, sort) : fitted;
  const widths = widthsOf(meta, drawnCols, rows, narrow ? undefined : room, totals, sort);
  const saved = useSavedViews(api.keep, meta.id);
  useLastUsed(api.keep, meta, place, saved);
  const searchable = meta.fields.some((f) => f.searchable);
  const narrowed = !!ask.q || !!ask.where;
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  /** The row a box is open under: an action's words (a reason, a reply), or the page's reply. */
  const [boxed, setBoxed] = useState<{ id: string; action: Action | null } | null>(null);
  /** A row's action from where it sits: one that asks for words opens a box under the row. */
  const rowRun = (a: Action, r: Row) => {
    if (sayBlocked(a, r)) return;
    if (a.ask) setBoxed({ id: String(r.id), action: a });
    else run(a, [r.id], startOf(a, r));
  };
  const replyTo = reply ? (r: Row) => setBoxed({ id: String(r.id), action: null }) : null;
  /** Reply on this row, when the page answers it. */
  const replyOn = (r: Row) =>
    replyTo && (!reply?.when || waitsOn(reply.when, r)) ? () => replyTo(r) : null;
  const boxFor = (r: Row) => {
    if (boxed?.id !== String(r.id)) return null;
    const close = () => setBoxed(null);
    const a = boxed.action;
    if (!a)
      return reply ? (
        <RowReply
          meta={meta}
          api={api}
          acts={acts}
          row={r}
          reply={reply}
          acted={acted}
          close={close}
        />
      ) : null;
    return askBox(a, r, close);
  };
  /** The words an action asks for, typed in a box: under its row, or in its peek. */
  const askBox = (a: Action, r: Row, close: () => void) => {
    const start = startOf(a, r);
    return (
      <AskBox
        action={a}
        start={start}
        keep={`ask:${meta.id}:${String(r.id)}:${a.id}`}
        close={close}
        send={(text) => {
          const field = a.ask?.field ?? "text";
          return send(a, [r.id], inputOf(a, { ids: [r.id], [field]: start }, text));
        }}
      />
    );
  };

  // The bands and rows to draw, a row's open box (a reason, a reply) as its own line under it.
  const drawn: (ListLine | { kind: "box"; key: string; row: Row })[] = [];
  /** The group each row sits in, by its place among the rows: a shut group's rows leave the walk. */
  const groupOfRow: (string | undefined)[] = [];
  let inGroup: string | undefined;
  for (const l of table.lines) {
    drawn.push(l);
    if (l.kind === "group") inGroup = l.key;
    else if (l.kind === "tier") inGroup = undefined;
    else {
      groupOfRow[l.index] = inGroup;
      if (boxed?.id === l.key) drawn.push({ kind: "box", key: `box:${l.key}`, row: l.row });
    }
  }
  /** The groups shut by a press on their head. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = useCallback(
    (key: string) =>
      setFolded((was) => {
        const next = new Set(was);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const hidden = (i: number) => {
    const g = groupOfRow[i];
    return g !== undefined && folded.has(g);
  };

  const openAt = (i: number, replace = false) => {
    const r = rows[i];
    if (r) place.go(place.link({ [meta.name.one]: String(r.id), tab: null }), replace);
  };
  const openIndex = openId === null ? -1 : rows.findIndex((r) => String(r.id) === openId);
  // A record set aside from its own panel leaves with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: place changes every render.
  useEffect(() => {
    if (openId !== null && held.ids.has(openId))
      place.go(place.link({ [meta.name.one]: null, tab: null }), true);
  }, [openId, held.ids]);

  // ↑/↓ (or J/K) walk the rows (or the open records), Enter opens, Escape closes, an action's key runs it.
  const keys = useRef({
    cursor,
    openIndex,
    rows,
    hidden,
    openAt,
    place,
    one: meta.name.one,
    actions,
    run,
    rowRun,
    replyOn,
  });
  keys.current = {
    cursor,
    openIndex,
    rows,
    hidden,
    openAt,
    place,
    one: meta.name.one,
    actions,
    run,
    rowRun,
    replyOn,
  };
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = keys.current;
      const at = k.openIndex >= 0 ? k.openIndex : k.cursor;
      const step = walkKey(e);
      if (step) {
        e.preventDefault();
        const next = walkTo(at, step, k.rows.length, k.hidden);
        if (next < 0) return;
        setCursor(next);
        if (k.openIndex >= 0) k.openAt(next, true);
      } else if (e.key === "Enter" && k.openIndex < 0 && at >= 0) k.openAt(at);
      else if (e.key === "Escape" && k.openIndex >= 0)
        k.place.go(k.place.link({ [k.one]: null, tab: null }), true);
      else {
        const row = k.rows[at];
        const a = keyed(e, k.actions, row);
        if (a && row) {
          e.preventDefault();
          // With the record open, its words are asked beside it, as before.
          if (k.openIndex < 0) k.rowRun(a, row);
          else if (!sayBlocked(a, row)) k.run(a, [row.id], startOf(a, row));
        } else if (
          row &&
          k.replyOn(row) &&
          k.openIndex < 0 &&
          e.key === "r" &&
          !e.metaKey &&
          !e.ctrlKey
        ) {
          e.preventDefault();
          k.replyOn(row)?.();
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
  // What the rows part draws: the record's fields as its columns, the title as the name, the
  // table's lines (groups, tiers, rows, a row's open box) as its lines.
  const titleField = meta.fields.find((f) => f.key === meta.title);
  const nameCol: RowsName<Row> = {
    label: titleField?.label ?? cap(meta.name.one),
    icon: titleField ? KIND_ICON[titleField.kind] : "text",
    sort:
      titleField && cols.includes(titleField) ? (
        <SortHead field={titleField} place={place} sort={sort} dir={table.sorted(titleField.key)} />
      ) : undefined,
    width: widths[meta.title],
    // Its least: no word of a title shown breaks; past it, the list scrolls sideways.
    min: titleLeast(meta, rows, sort),
    title: (r) => titleOf(meta, r),
    href: (r) => place.link({ [meta.name.one]: String(r.id), tab: null }),
    weight: (r) => TITLE_WEIGHT[String(waits(r))] ?? "",
    // A person's name shows as initials in a round avatar.
    avatar: titleField?.kind === "name" ? (r) => initials(titleOf(meta, r)) || null : undefined,
    sub:
      preview || meta.fold
        ? (r) => {
            const quiet = waits(r) === false;
            const messages = foldOf(meta, r);
            // One person's messages in one thread: the newest, each marked.
            if (messages)
              return narrow ? (
                <FoldPreview
                  messages={messages}
                  lines={3}
                  quiet={quiet}
                  className="text-[13.5px] leading-snug"
                />
              ) : (
                <FoldPreview messages={messages} quiet={quiet} className="text-[12.5px]" />
              );
            // A message's first words under who sent it, as a mail list shows.
            return preview ? (
              <span
                className={cn(
                  narrow
                    ? "text-[13.5px] leading-snug"
                    : "block wrap-anywhere whitespace-normal text-[12.5px]",
                  quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)",
                )}
              >
                {firstWords(textOf(r[preview.key]))}
              </span>
            ) : null;
          }
        : undefined,
  };
  const columnsFor = cols
    .filter((f) => f.key !== meta.title)
    .map<RowsColumn<Row>>((f, i) => ({
      key: f.key,
      label: f.label,
      icon: KIND_ICON[f.kind],
      align: f.column?.align === "end" ? "end" : undefined,
      width: widths[f.key],
      min: widthOf(f),
      sort: <SortHead field={f} place={place} sort={sort} dir={table.sorted(f.key)} />,
      // When it happened reads quieter than what it is; a watched wait draws as its own.
      quiet: f.kind === "date" && f.key !== late?.field,
      // A phone's row shows one beside the name: the watched wait, else the first of them.
      phone: late?.promise ? f.key === late.field : i === 0,
      total: footed ? <FieldTotal field={f} total={totals?.[f.key]} to={place.link} /> : undefined,
      cell: (r) => {
        const w = f.key === late?.field ? waitOf(r) : null;
        return w ? <Age {...w} /> : <FieldCell field={f} cell={r[f.key]} />;
      },
    }));
  const rowLines = drawn.map<RowsLine<Row>>((l) => {
    if (l.kind === "row") return l;
    if (l.kind === "box") return { kind: "box", key: l.key, node: boxFor(l.row) };
    if (l.kind === "tier")
      return { kind: "tier", key: l.key, head: <TierLabel needs={l.needs} n={l.n} /> };
    const state = l.field.states?.[l.value];
    const cue = cueOf(l.field, l.value);
    return {
      kind: "group",
      key: l.key,
      color: stateColor(state),
      label: (
        <>
          {cue?.mark ? <Cue state={cue} /> : null}
          {state?.label ?? (l.value || `No ${l.field.label.toLowerCase()}`)}
        </>
      ),
    };
  });
  const pickOf: RowsPick = {
    picked: table.picked,
    toggle: (id) => table.toggle(id),
    all: table.all,
    some: table.some,
    toggleAll: table.toggleAll,
    count: picked.size,
  };
  const actOf = (r: Row): RowsAct => {
    const replies = replyOn(r);
    const { main, more } = rowActsOf(actions, r, !!replies);
    return {
      main,
      more,
      reply: replies,
      page: place.page(String(r.id)),
      busy: acting,
      run: (a) => rowRun(a, r),
    };
  };
  /** The peek's pieces, from the same row actions and reply box the row uses; none: the whole record. */
  const peeked: PeekWire | undefined =
    peek === false
      ? undefined
      : {
          fields: peek?.fields
            ? peek.fields.flatMap((k) => meta.fields.find((f) => f.key === k) ?? [])
            : columnsOf(meta, params, columns).filter((f) => f.key !== meta.title),
          reply,
          replyOn: (r) => !!replyOn(r),
          actsOf: (r) => rowActsOf(actions, r, !!replyOn(r)),
          press: rowRun,
          ask: askBox,
          busyOn: (a, r) => runningOn(running, a.id, [r.id]),
        };
  const headed = head?.(meta, () => acted([]));
  const forms = actions.filter((a) => a.form && !a.each);
  // Its rows' keys sit in the sheet on ?, not under the list.
  const keyLines = actionKeys(actions, rows);
  usePageKeys(keyLines.length ? { title: `On ${many}`, keys: keyLines } : null);
  // The columns the room holds; beside a docked record, the name, one column and its time.
  const drawnColumns = columnsFor.filter((c) => drawnCols.some((f) => f.key === c.key));
  const panel = openId ? (
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
      peek={peeked}
      listRow={openRow}
      docked={docked}
    />
  ) : null;
  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={title ?? cap(many)} />
        {/* One button: the first thing the page makes. The rest wait behind one menu. */}
        <div className="flex items-center gap-2">
          {forms[0] ? (
            <Button tone="primary" size="dense" onClick={() => run(forms[0] as Action, [])}>
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

      <ViewTabs
        meta={meta}
        current={ask.view}
        counts={page.data?.counts}
        place={place}
        saved={saved}
        keep={api.keep}
        loading={viewing}
      />

      {
        // A flat list (William, 10-21): its tools over the rows, on the page, no panel and no
        // scroll of its own. The page scrolls the rows. A peek docks at its right and stays in view.
        // min-w-0: a grid item's least width is its table's, which pushed the list past the page
        // and fed the room measure its own overflow.
        <div
          className={cn(
            "min-w-0",
            docked && "grid grid-cols-[minmax(0,1fr)_minmax(0,420px)] items-start gap-4",
          )}
        >
          <div className={cn("min-w-0", "[&_tbody>tr:last-child]:border-b-0")}>
            <div className="pb-2">
              <ListBar
                meta={meta}
                place={place}
                compact={docked}
                shown={new Set(cols.map((f) => f.key))}
                keep={api.keep}
                saved={saved}
                facets={facetsOf(api, ask)}
                display={
                  <>
                    {display}
                    <ListDisplay meta={meta} place={place} columns={columns} narrow={narrow} />
                  </>
                }
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
                    busy
                  )
                }
              />
            </div>
            {page.error && !page.data ? (
              <div className="pb-3.5">
                <LoadFailed error={page.error} onRetry={page.retry} />
              </div>
            ) : (
              <div ref={frameRef}>
                <Rows
                  label={many}
                  noun={meta.name.one}
                  // What the room holds; docked, its name, one column and its time (`.nt-pk .nt`).
                  columns={drawnColumns}
                  name={nameCol}
                  lines={rowLines}
                  loading={!page.data}
                  empty={!!page.data && !rows.length}
                  pick={pickOf}
                  // Beside the peek a row is a name to pick: its tools are in the peek.
                  act={docked ? undefined : actOf}
                  open={{
                    id: openId,
                    onOpen: (_, i) => {
                      setCursor(i);
                      openAt(i);
                    },
                  }}
                  cursor={cursor}
                  rowState={(r) => {
                    const id = String(r.id);
                    return { going: going.get(id), changed: changed.has(id) && !page.loading };
                  }}
                  onSettled={() => setChanged(new Set())}
                  wait={late?.promise ? waitOf : undefined}
                  group={grouped ? { folded, toggle: toggleGroup } : undefined}
                  scroller={pageScroller}
                  narrow={narrow}
                  swipes={(r) =>
                    withReply(
                      swipesOf(actions, r, (a) => rowRun(a, r)),
                      replyOn(r),
                    )
                  }
                />
                {page.data && !rows.length ? (
                  <div className="grid justify-items-start gap-2 px-3 py-10 text-[14px] text-(--ui-ink-2)">
                    {narrowed ? `No ${many} match these filters.` : emptyOf(empty, ask.view, many)}
                    {!narrowed ? (
                      <ElseWhere
                        meta={meta}
                        current={ask.view}
                        counts={page.data.counts}
                        place={place}
                      />
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
          </div>
          {docked ? panel : null}
        </div>
      }

      <PageBar
        place={place}
        page={Math.min(at, pages)}
        pages={pages}
        total={page.data?.total ?? 0}
        shown={rows.length}
        size={size}
        narrow={narrow}
      />

      {openId && !docked ? panel : null}
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
        <Icon name="more" className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-0 p-1">
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

/** A phone row's swipes with the page's Reply added on the left, when the page has one. */
export function withReply(swipes: Swipes | null, reply: (() => void) | null): Swipes | null {
  if (!reply) return swipes;
  const act = { id: "reply", label: "Reply", icon: "reply", tone: "ink" as const, run: reply };
  return { lead: swipes?.lead, trail: [...(swipes?.trail ?? []).slice(0, 1), act] };
}

/**
 * A list row's own `act`: its action pressed as one write (`pressAct`), then the list read again.
 * The reply box under a row and the peek's both send through it.
 */
function rowAct(
  meta: RecordMeta,
  api: RecordsApi,
  acts: RecordActs | undefined,
  row: Row,
  acted: (ids: (string | number)[]) => void,
): RecordAct {
  const here: Target = rowTarget(meta, row, api.access?.client ?? "");
  if (!api.access) delete here.client;
  const record = recordKey(meta.name.many, String(row.id));
  return Object.assign(
    async (action: string, input: Record<string, unknown> = {}) => {
      const a = actsOf(meta, acts, true, here).find((x) => x.id === action);
      if (!a || !acts) throw new Error("You can't do that here.");
      const out = await pressAct(acts.call, a, row.id, record, input);
      acted([row.id]);
      return out;
    },
    { record },
  );
}

/** The page's own reply box under a row, from the record's detail. */
function RowReply({
  meta,
  api,
  acts,
  row,
  reply,
  acted,
  close,
}: {
  meta: RecordMeta;
  api: RecordsApi;
  acts: RecordActs | undefined;
  row: Row;
  reply: RowReplyBox;
  acted: (ids: (string | number)[]) => void;
  close: () => void;
}) {
  const id = String(row.id);
  const got = useLoad(`${meta.id}:${id}:reply`, () => api.get({ record: meta.id, id }), api);
  const act = rowAct(meta, api, acts, row, acted);
  return (
    <ReplyFrame close={close}>
      {got.data ? (
        reply.box(got.data.detail, got.data.row, act)
      ) : got.error ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : (
        <div className="h-28 animate-pulse rounded-(--ui-radius) bg-(--ui-fill)" />
      )}
    </ReplyFrame>
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
      <Icon name="arrow" className="size-3.5" />
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

/** The peek head's buttons, as the artifact's `.ib`: 28px, the leaf corner, the accent hover. */
const PEEK_ICON =
  "inline-grid size-7 flex-none cursor-pointer place-items-center border-0 bg-transparent p-0 text-(--ui-ink-3) no-underline transition-[background-color,color,opacity] duration-150 [border-radius:4px_10px_4px_10px] hover:bg-(--ui-accent-tint) hover:text-(--ui-link) focus-visible:bg-(--ui-accent-tint) focus-visible:text-(--ui-link) disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:size-11 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:[stroke-width:1.9]";

/** What the peek takes from the list: the same row actions and reply box the row itself uses. */
export interface PeekWire {
  /** The properties, in order. */
  fields: FieldMeta[];
  reply: RowReplyBox | undefined;
  /** Whether the page's reply answers this row. */
  replyOn: (row: Row) => boolean;
  /** The row's actions, as its row draws them: icons first, the rest behind ⋯. */
  actsOf: (row: Row) => { main: Action[]; more: Action[] };
  /** The row's own press (`rowRun`): the write, the Undo toast. */
  press: (action: Action, row: Row) => void;
  /** The box an action that asks for words types them in. */
  ask: (action: Action, row: Row, close: () => void) => ReactNode;
  busyOn: (action: Action, row: Row) => boolean;
}

/**
 * A record beside its list: up and down walk the list, a link opens it as a page. With `peek`
 * its body is the peek (`./peek.tsx`); without, the whole record.
 */
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
  peek,
  listRow,
  docked = false,
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
  peek?: PeekWire | undefined;
  /** The row as the list holds it: the peek's head before its own read lands. */
  listRow?: Row | undefined;
  /** The peek sits in the list's panel, at its right (artifact `.nt-pk`), not over the page. */
  docked?: boolean;
}) {
  const phone = usePhone();
  const shut = place.link({ [meta.name.one]: null, tab: null });
  /** An action that asks for words, its box open in the peek's body; another row's never shows. */
  const [asking, setAsking] = useState<{ id: string; action: Action } | null>(null);
  // The peek reads the record as the full one does (same key, same cache), once, for its head
  // and its body. Another row's answer, held while this one reads, never draws here.
  const got = useLoad<RecordAnswer>(
    peek ? `${meta.id}:${id}:${rev}` : null,
    () => api.get({ record: meta.id, id }),
    api,
  );
  const read = got.data && String(got.data.row.id) === id ? got.data : null;
  const row = peek ? (read?.row ?? listRow ?? null) : null;
  const title = row ? titleOf(meta, row) : "";
  const named = meta.fields.find((f) => f.key === meta.title)?.kind === "name";
  const avatar = named ? avatarOf(title) : null;
  const body = peek ? (
    <PeekContent
      key={id}
      meta={meta}
      id={id}
      api={api}
      place={place}
      extras={extras}
      acts={acts}
      onActed={onActed}
      wire={peek}
      got={got}
      read={read}
      row={row}
      asking={asking?.id === id ? asking.action : null}
      stopAsking={() => setAsking(null)}
    />
  ) : (
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
  // At exactly 900px the shell says phone and the list docks: the list wins, so its half isn't empty.
  if (phone && !docked)
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
            <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal text-center text-[13px] text-(--ui-ink-2)">
              {index >= 0 ? `${num(index + 1)} of ${num(count)}` : ""}
            </span>
            {peek && row ? (
              <PeekActs
                wire={peek}
                row={row}
                title={title}
                ask={(action) => setAsking({ id, action })}
              />
            ) : (
              <>
                <button
                  type="button"
                  className={ICON}
                  aria-label="Previous"
                  disabled={index <= 0}
                  onClick={() => step(-1)}
                >
                  <Icon name="up" className="size-4" />
                </button>
                <button
                  type="button"
                  className={ICON}
                  aria-label="Next"
                  disabled={index < 0 || index >= count - 1}
                  onClick={() => step(1)}
                >
                  <Icon name="down" className="size-4" />
                </button>
              </>
            )}
            <a href={place.page(id)} className={ICON} aria-label="Open as a page">
              <Icon name="expand" className="size-3.5" />
            </a>
          </div>
        }
      >
        {peek && row ? <PeekTitle avatar={avatar} title={title} className="mb-3" /> : null}
        {body}
      </BottomSheet>
    );
  const aside = (
    <aside
      aria-label={cap(meta.name.one)}
      className={cn(
        ROOT,
        docked
          ? // Beside the flat list: a raised panel that stays in view while the page scrolls the rows.
            "sticky top-4 flex min-w-0 flex-col overflow-clip rounded-(--ui-radius-panel) bg-(--ui-paper) shadow-(--ui-raise)"
          : // Off a phone it floats: inset from the edges, a sheet's corners, clipped to them.
            "fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-(--ui-paper) shadow-(--ui-shadow) sm:inset-y-2 sm:right-2 sm:w-[440px] sm:overflow-clip sm:rounded-(--ui-leaf-sheet)",
      )}
    >
      {docked ? null : (
        // A floating panel is a leaf (artifact `.modal`): the sweep on its round tips.
        <div className="max-sm:hidden">
          <Sweep radius={18} />
        </div>
      )}
      {peek ? (
        // The peek's head (artifact `.pk header`): who it is, then its row's actions (William,
        // 10-24: in place of the walk, which J and K still do), the whole record and the close.
        <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-4">
          {row ? (
            <PeekTitle avatar={avatar} title={title} className="flex-1" />
          ) : (
            <span className="flex-1" />
          )}
          {row ? (
            <PeekActs
              wire={peek}
              row={row}
              title={title}
              ask={(action) => setAsking({ id, action })}
            />
          ) : null}
          <a
            href={place.page(id)}
            className={PEEK_ICON}
            aria-label="Open"
            {...tipProps("Open the full record", { as: "none" })}
          >
            <Icon name="expand" />
          </a>
          <a
            href={shut}
            className={PEEK_ICON}
            aria-label="Close"
            {...tipProps("Close", { keys: "Esc", as: "none" })}
          >
            <Icon name="close" />
          </a>
        </div>
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-(--ui-hair) bg-(--ui-band) px-3 max-sm:box-content max-sm:h-14 max-sm:pt-[env(safe-area-inset-top)] max-sm:pr-[max(12px,env(safe-area-inset-right))] max-sm:pl-[max(4px,env(safe-area-inset-left))]">
          {/* A phone: the panel is the screen, so the way back leads. */}
          <a
            href={shut}
            className="inline-flex h-11 items-center gap-1 pr-3 pl-1 text-[15px] font-medium text-(--ui-ink) no-underline sm:hidden"
          >
            <Icon name="left" className="size-5" />
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
            <Icon name="up" className="size-4" />
          </button>
          <button
            type="button"
            className={ICON}
            aria-label="Next"
            {...tipProps("Next", { keys: "J", as: "none" })}
            disabled={index < 0 || index >= count - 1}
            onClick={() => step(1)}
          >
            <Icon name="down" className="size-4" />
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
            <Icon name="expand" className="size-3.5" />
          </a>
          <a
            href={shut}
            className={cn(ICON, "max-sm:hidden")}
            aria-label="Close"
            {...tipProps("Close", { keys: "Esc", as: "none" })}
          >
            <Icon name="close" className="size-4" />
          </a>
        </div>
      )}
      <div
        key={id}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10 max-sm:pb-[calc(96px+env(safe-area-inset-bottom))]",
          peek ? "px-[18px] pt-3" : "px-4 pt-5 sm:px-6",
          // A long record scrolls inside one screen, not down the page.
          docked && "max-h-[calc(100dvh-160px)] pb-4",
        )}
      >
        {body}
      </div>
    </aside>
  );
  return aside;
}

/**
 * The peek's body (`./peek.tsx`) from the record's one read: its properties, its newest items
 * (the type's own, else its activity) and, to act, the page's reply box or the row's main action.
 */
function PeekContent({
  meta,
  id,
  api,
  place,
  extras,
  acts,
  onActed,
  wire,
  got,
  read,
  row,
  asking,
  stopAsking,
}: {
  meta: RecordMeta;
  id: string;
  api: RecordsApi;
  place: Place;
  extras: RecordTemplateProps["extras"];
  acts: RecordActs | undefined;
  onActed: (changed: (string | number)[]) => void;
  wire: PeekWire;
  got: Load<RecordAnswer>;
  read: RecordAnswer | null;
  row: Row | null;
  /** An action that asks for words, its box open here. */
  asking: Action | null;
  stopAsking: () => void;
}) {
  if (got.error && !read)
    return <LoadFailed error={got.error} onRetry={got.retry} what={meta.name.one} />;
  if (!row) return <Loading heading lines={4} />;
  const act = rowAct(meta, api, acts, row, onActed);
  const more = read && extras ? extras(read.detail, read.row, act, got.at) : {};
  const recent: PeekLine[] | null = read
    ? (more.recent ??
      read.activity?.slice(0, 3).map((l) => ({
        who: l.kind ? words(l.kind) : undefined,
        at: l.at,
        text: l.what,
      })) ??
      null)
    : null;
  const reply =
    asking != null
      ? wire.ask(asking, row, stopAsking)
      : read && wire.reply && wire.replyOn(read.row)
        ? wire.reply.box(read.detail, read.row, act)
        : null;
  return (
    <PeekView
      props={[
        ...wire.fields,
        // Its links (the post, the permalink), so the page they lead to is a click from the peek.
        ...meta.fields.filter(
          (f) => f.kind === "link" && !wire.fields.includes(f) && !blank(row[f.key]),
        ),
      ].map((f) => ({
        label: f.label,
        node: blank(row[f.key]) ? null : <FieldCell field={f} cell={row[f.key]} />,
      }))}
      recent={recent}
      waiting={!read}
      reply={reply}
      openHref={place.page(id)}
    />
  );
}

/** The peek's actions at its head's right, as its row draws them: icons, the rest behind ⋯. */
function PeekActs({
  wire,
  row,
  title,
  ask,
}: {
  wire: PeekWire;
  row: Row;
  title: string;
  ask: (action: Action) => void;
}) {
  const { main, more } = wire.actsOf(row);
  if (!main.length && !more.length) return null;
  return (
    <RowActions
      still
      title={title}
      main={main}
      more={more}
      reply={null}
      busy={[...main, ...more].some((a) => wire.busyOn(a, row))}
      run={(a) => (a.ask ? ask(a) : wire.press(a, row))}
    />
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
export function RecordPage({
  id,
  back,
  wide = false,
  ...props
}: RecordTemplateProps & {
  id: string;
  /** Where the back link leads, when not the list: a record opened inside another page. */
  back?: { href: string; label: string } | undefined;
  /** The page's whole width, not a reading column: an editor. */
  wide?: boolean | undefined;
}) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!meta || !types.data) return <ListSkeleton />;
  return (
    <div className={cn(ROOT, "mx-auto grid gap-4", wide ? "max-w-none" : "max-w-[880px]")}>
      {/* A phone's bar at the top leads back there instead. */}
      <a
        href={back?.href ?? props.place.list}
        className={cn(
          "w-fit text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)",
          !back && "max-[900px]:in-data-[phone-nav]:hidden",
        )}
      >
        ← {back?.label ?? cap(meta.name.many)}
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
  const { run, busy, running, done, dialog } = useRun(acts?.call ?? NO_CALL, acted, meta.name, {
    // What this page draws: a yes names it, so one over newer words is refused.
    versionOf: (rowId) =>
      String(rowId) === id || String(rowId) === String(got.data?.row.id)
        ? (versionIn(got.data?.detail, got.data?.row) ?? version.current.now)
        : null,
  });
  // Issues sit on every record a signed-in login reads, but not on access's own lists.
  const access =
    api.access && acts && !acts.viewer.demo && !meta.id.startsWith("access.") ? api.access : null;
  const issues = useLoad<IssueLine[] | null>(
    `issues:${meta.id}:${id}:${rev}`,
    () => (access ? access.issues({ record: meta.id, id }) : Promise.resolve(null)),
    api,
  );
  /** What's typed in that box now, for a live preview beside it; this record's only. */
  const [typed] = useState(liveText);
  const [lit, pickMark] = useSourcePick();
  const tab = place.params.get("tab") ?? "details";
  const [want, setWant] = useState<string | null>(null);
  // Where this row sits, for what its head may show: the YouTube editor acts on YouTube's alone.
  const here: Target = got.data ? rowTarget(meta, got.data.row, api.access?.client ?? "") : {};
  if (!api.access) delete here.client;
  /** Every box on this record: a head action saves them all first. */
  const boxes = useSavePage();
  const record = recordKey(meta.name.many, id);
  const act: RecordAct = Object.assign(
    async (
      action: string,
      input: Record<string, unknown> = {},
      o: { patch?: ActPatch | undefined } = {},
    ) => {
      const a = actsOf(meta, acts, true, here).find((x) => x.id === action);
      if (!a || !acts || !got.data) throw new Error("You can't do that here.");
      const rowId = got.data.row.id as string | number;
      const out = await pressAct(acts.call, a, rowId, record, input);
      const patch = o.patch;
      // The answer says what changed: the page shows it with no read again.
      if (patch?.(got.data.detail, out))
        writeThrough(
          api,
          detailPatch(meta.id, rowId, (detail) => patch(detail, out)),
        );
      else acted([rowId]);
      return out;
    },
    { record },
  );
  // A type with no `load` still gets its extras, with no detail.
  const more = got.data && extras ? extras(got.data.detail, got.data.row, act, got.at) : {};
  const state = got.data?.edit ?? null;
  /**
   * The version the next edit names: a save's answer moves it at once, before the page draws
   * that answer, so two saves in a row never send the same one. A new read moves it too.
   */
  const version = useRef<{ read: string | null; now: string | null }>({ read: null, now: null });
  if (state && state.version !== version.current.read)
    version.current = { read: state.version, now: state.version };
  const drawn = got.data ? versionIn(got.data.detail, got.data.row) : null;
  useEffect(() => {
    if (!drawn) return;
    const k = shownKey(meta.id, id);
    SHOWN.set(k, drawn);
    return () => {
      if (SHOWN.get(k) === drawn) SHOWN.delete(k);
    };
  }, [meta.id, id, drawn]);
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
              expect: version.current.now ?? state.version,
              ...(run ? { run } : {}),
            });
            version.current = { read: out.version, now: out.version };
            // The page shows it now, History line too: a save never reads the record again.
            const keys = Object.keys(patch);
            const fields = Object.fromEntries(
              keys.map((k) => [k, k in out.values ? out.values[k] : patch[k]]),
            );
            const change: ChangeLine | null =
              out.change === null
                ? null
                : {
                    id: out.change,
                    at: new Date().toISOString(),
                    by: "You",
                    via: run ? "claude" : "person",
                    before: Object.fromEntries(keys.map((k) => [k, state.values[k] ?? null])),
                    after: fields,
                    undoes: null,
                    undone: false,
                  };
            patchRecord(api, meta.id, id, fields, { version: out.version, change });
            return out.change;
          },
          undo: async (change) => {
            await api.undo?.({ record: meta.id, id, change });
            acted([id]);
          },
          // A stale save: theirs read again, so Keep mine names the version it now sees.
          reread: () => got.retry(),
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
  const folded = foldOf(meta, row);
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
      // The record's version is what a yes names, never a fact to read.
      f.key !== "version" &&
      // A folded row's messages read as their own list.
      f.key !== meta.fold &&
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
  /** A head action runs on what's saved: every box on the page (words, fields, slides) goes first. */
  const runHead = (a: Action) =>
    void boxes.flush().then((ok) => ok && run(a, [row.id], startOf(a, row)));
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

  const view = (
    <article className="grid gap-5 max-[900px]:pb-(--dock-h,0px)">
      <header className="grid gap-3">
        {more.hero}
        {/* The title keeps a readable width: when the actions don't fit beside it, they wrap
            under it (a sheet with five actions). */}
        <div className="flex flex-wrap items-start justify-between gap-3 max-sm:flex-col">
          <div className="min-w-0 sm:flex-[1_1_16rem]">
            {/* A title with no spaces (a profile link) breaks, not runs under the actions. */}
            <h2 className={`${PAGE_TITLE} wrap-anywhere`}>{titleOf(meta, row)}</h2>
            {sub ? (
              <p className="mt-0.5 text-[14px] text-(--ui-ink-2)">
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
                  "max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-10 max-[900px]:border-t max-[900px]:border-(--ui-hair) max-[900px]:[background:linear-gradient(var(--ui-band),var(--ui-band)),var(--ui-paper)] max-[900px]:px-4 max-[900px]:pt-2 max-[900px]:pb-[calc(8px+env(safe-area-inset-bottom))] max-[900px]:[transform:translate3d(0,calc(-1*min(var(--sheet-y,0px),var(--sheet-mid,0px))),0)] max-[900px]:[transition:transform_var(--sheet-t,0ms)_cubic-bezier(0.32,0.72,0,1)] max-[900px]:[&>*]:flex-none",
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
                    busy={runningOn(running, a.id, [row.id])}
                    done={runningOn(done, a.id, [row.id])}
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

      <nav className="relative flex gap-0.5 overflow-x-auto pb-1.5" aria-label="Sections">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={place.link({ tab: t.id === "details" ? null : t.id })}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(TAB, tabTone(tab === t.id))}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="text-(--ui-ink-3)">{num(t.count)}</span>
            ) : null}
            {tab === t.id ? <TabBar row={`sections:${meta.id}`} /> : null}
          </a>
        ))}
      </nav>

      {tab === "activity" && activity ? (
        <Activity
          lines={activity}
          one={meta.name.one}
          empty={meta.activityEmpty}
          links={!!meta.activityLinks}
        />
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
        <Beside aside={more.aside} text={typed}>
          {/* What a draft answers (their words, the thread so far) reads before it. */}
          {more.lead}
          {box ? null : more.form}
          {editing && state ? (
            <>
              <EditFields
                meta={meta}
                id={id}
                at={got.at}
                state={state}
                editing={editing}
                read={(f) =>
                  row[f.key] != null && row[f.key] !== "" ? (
                    <FieldLine field={f} cell={row[f.key]} cite={cite} />
                  ) : null
                }
              />
              {editing.ask ? (
                <AskClaude meta={meta} id={id} turns={state.asks} editing={editing} />
              ) : null}
            </>
          ) : null}
          {folded && meta.fold && !more.drawn?.includes(meta.fold) ? (
            <section className="grid gap-1.5">
              <h3 className={GROUP_LABEL}>Their messages, newest first</h3>
              <FoldList messages={folded} current={String(row.id)} />
            </section>
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
              wrote={(text, v) =>
                patchRecord(api, meta.id, row.id as string | number, {
                  [box.field]: text,
                  ...(v ? { version: v } : {}),
                })
              }
              at={got.at}
              send={sendAction ? () => runHead(sendAction) : undefined}
              sending={
                sendAction
                  ? {
                      record: recordKey(meta.name.many, row.id as string | number),
                      what: sendAction.id,
                    }
                  : undefined
              }
              between={more.form}
              framed={!more.aside}
              onText={more.aside ? typed.set : undefined}
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
  return <SaveScope page={boxes}>{view}</SaveScope>;
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
  text: LiveText;
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

/** A record's facts as label and value, no frame and no rules (the artifact's `.pk dl`). */
const DL = "m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13.5px]";

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-(--ui-ink-3)">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
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
  links,
}: {
  lines: RecordAnswer["activity"] & object;
  one: string;
  empty?: string | undefined;
  /** Each line opens its own page, or says it has none and offers where it sits. */
  links?: boolean;
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
              {links && l.link ? (
                <>
                  <span className="text-(--ui-ink-3)"> · </span>
                  <a
                    href={l.link}
                    {...(away(l.link) ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
                  >
                    Open it
                  </a>
                </>
              ) : null}
              {links && !l.link ? (
                <NoLink note="No link for this one" context={l.context} className="mt-0.5" />
              ) : null}
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
  const page = useLoad<RecordsPage>(
    JSON.stringify(ask),
    (before) => listChanged((a) => api.list(a), ask, before),
    api,
  );
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
    <DataTable
      look="plain"
      data={page.data.rows}
      rowKey={(r) => String(r.id)}
      columns={cols.map((f) => ({
        key: f.key,
        label: f.label,
        end: f.column?.align === "end",
        cell: (r: Row) => <FieldCell field={f} cell={r[f.key]} />,
      }))}
    />
  );
}
