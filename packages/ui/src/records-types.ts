/**
 * What the List and Record templates share: the `RecordsApi` they read through, the `Place` (the
 * address as state), what a page hands them (`RecordTemplateProps`, extras, actions), and the
 * helpers every part reads: a row's title and words, the version a record showed, needs tiers
 * (`tiersOf`), the actions this viewer may run and the keys that run them, a list's walk.
 */

import type { Target } from "@wren/core/access";
import type { EditAsk, Edited, RecordAskAsk, UndoAsk } from "@wren/core/edits";
import type { Cell, RecordMeta } from "@wren/core/records";
import type {
  ExportAsk,
  GetAsk,
  ListAsk,
  RecordAnswer,
  RecordsFile,
  RecordsPage,
  RecordsStat,
  Row,
  StatsAsk,
} from "@wren/core/records/serve";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { can, type Viewer } from "./access.js";
import { type Action, applies, type Call, callOnce } from "./action.js";
import { type Load, useLoad } from "./data/query.js";
import type { RecordDraft } from "./draft.js";
import { cueOf, shownOf } from "./fields.js";
import type { KeyLine } from "./frame.js";
import type { KeepApi } from "./list-bar.js";
import type { PeekLine, PeekSpec } from "./peek.js";
import { type AccessApi, rowTarget } from "./record-access.js";
import { recordKey } from "./save/writes.js";
import { stripMarks } from "./sources.js";

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
export function usePicked(place: Place): [Set<string>, (next: Set<string>) => void] {
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

/**
 * The version each open record draws, by type and id (`RecordBody` sets it). An action with
 * `expect` pressed on a list or a queue sends it, so the server refuses a yes over words the
 * person never saw.
 */
export const SHOWN = new Map<string, string>();

export const shownKey = (record: string, id: string | number) => `${record}\u0000${id}`;

export const shownVersion = (record: string, id: string | number): string | null =>
  SHOWN.get(shownKey(record, id)) ?? null;

/** The version a record's own read names: its detail's `version`, else its row's. */
export function versionIn(detail: unknown, row?: Row | null): string | null {
  const d = detail as { version?: unknown } | null;
  if (d && typeof d.version === "string") return d.version;
  return typeof row?.version === "string" ? row.version : null;
}

/** Record types move with a deploy, not a click: a mount reads them only past this. */
export const TYPES_FRESH_MS = 10 * 60_000;

/**
 * A workspace's record types, under its api's scope: kept on the device with its lists (a named
 * api), so a reload paints the list and its panel before they're read again.
 */
export function useTypes(api: RecordsApi): Load<RecordMeta[]> {
  return useLoad("types", () => api.types(), api, { freshMs: TYPES_FRESH_MS });
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const words = (s: string) => cap(s.replace(/_/g, " "));

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
export const firstWords = (t: string) => stripMarks(t).replace(/\s+/g, " ").trim();

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

export const NO_CALL: Call = () => Promise.reject(new Error("Nothing to run this."));

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

/**
 * A list row's own `act`: its action pressed as one write (`pressAct`), then the list read again.
 * The reply box under a row and the peek's both send through it.
 */
export function rowAct(
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
