/**
 * The List template: `RecordList` reads the type and draws `List`, the rows under the list bar
 * with their views, filters, sort, tiers (Needs you, For info), picks and the bulk bar (`Bulk`),
 * the reply box under a row, and the open record beside or docked. ↑/↓ (J/K) walk, keys run
 * actions on the cursor row.
 */

import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { ExportFormat, ListAsk, RecordsPage, Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Action,
  applies,
  blockedOf,
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
import { readCached, useLoad } from "./data/query.js";
import { Empty, LoadFailed } from "./feedback.js";
import {
  Cue,
  cueOf,
  FieldCell,
  FieldTotal,
  filterShape,
  readFilter,
  totalSays,
  widthOf,
} from "./fields.js";
import { FoldPreview, foldOf } from "./fold.js";
import { initials, num } from "./format.js";
import { showKeys, usePageKeys } from "./frame.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./layout.js";
import { filtersOf, ListBar, useLastUsed, useNarrow, useSavedViews, ViewTabs } from "./list-bar.js";
import { PageBar } from "./page-bar.js";
import { cursorAt, offsetOf, pageAt, pagesOf, sizeOf } from "./pager.js";
import { useScope } from "./palette-scope.js";
import {
  columnsOf,
  dockedOf,
  fitColumns,
  ListDisplay,
  ListSkeleton,
  ROOT,
  shownColumns,
  titleLeast,
  useRoom,
  widthsOf,
} from "./records-columns.js";
import { Panel, type PeekWire } from "./records-panel.js";
import { swipesOf, withReply } from "./records-swipes.js";
import {
  actionKeys,
  actsOf,
  cap,
  emptyOf,
  firstWords,
  keyed,
  type Late,
  type Needs,
  NO_CALL,
  type Place,
  type RecordActs,
  type RecordsApi,
  type RecordTemplateProps,
  type RowReplyBox,
  rowAct,
  shownVersion,
  startOf,
  TYPES_FRESH_MS,
  textOf,
  tiersOf,
  titleOf,
  typing,
  usePicked,
  useTypes,
  versionIn,
  waitsOn,
  walkKey,
  walkTo,
} from "./records-types.js";
import { AskBox, ReplyFrame, rowActsOf } from "./row-acts.js";
import {
  Age,
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
import { type ListLine, scrollerOf, useListTable } from "./table.js";
import { sortTip } from "./view-says.js";

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
  const pg = params.get("pg");
  const at = pageAt(pg);
  const size = sizeOf(params);
  const cursor = cursorAt(pg);
  const from = cursor ? { cursor } : at > 1 ? { offset: offsetOf(at, size) } : {};
  return { ...askOf(meta, params), limit: size, ...from };
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
        next={page.data?.next ?? null}
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
