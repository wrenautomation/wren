/**
 * What sits over a list (designs/2026-10-06-library-and-views.md): its views as tabs, the ones
 * the viewer saved after the built-in ones; search; Filter, as a popover or at phone width one
 * sheet, its likely fields first (`quickFilters`); a pill per filter once set, in plain words
 * ("Campaign is SEC RIA"); Save view; and the list's Display at the end. Five views show as tabs,
 * the rest under More. A list opens on the viewer's last-used view, and the columns he picks
 * stay picked (`list:<record>` in his prefs).
 */
import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { SavedViewLine } from "@wren/core/saved-views";
import { cn } from "cn";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccountFilter, accountFieldOf } from "./accounts.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Button } from "./controls.js";
import { useLoad } from "./data/query.js";
import { useEdit } from "./data/use-edit.js";
import { CheckField, TextField, useEditForm } from "./edit-form.js";
import { Cue, cueOf, FieldFilter, filterParts, filterShape } from "./fields.js";
import {
  type BarField,
  BarGlyph,
  CHIP,
  CHIP_ON,
  POP,
  SearchField,
  useFilterTools,
} from "./filter-bar.js";
import { num, short } from "./format.js";
import { tipProps } from "./hint.js";
import { useHoverPop } from "./hover-pop.js";
import { Icon, type IconName } from "./icons.js";
import { LIST_FORMS } from "./list-search.js";
import { RingSlot } from "./motion.js";
import { Segmented } from "./phone.js";
import type { Place } from "./records.js";
import { TabBar } from "./tab-bar.js";
import { sayFilters, sayRaw, saySaved, sayView } from "./view-says.js";

export type { SavedViewLine };

/** What a viewer keeps (`@wren/core/saved-views`), where the workspace serves it. */
export interface KeepApi {
  views(record: string): Promise<SavedViewLine[]>;
  save(v: {
    id?: number;
    record: string;
    name?: string;
    params?: string;
    shared?: boolean;
  }): Promise<SavedViewLine>;
  remove(id: number): Promise<unknown>;
  move(record: string, ids: number[]): Promise<SavedViewLine[]>;
  prefs(keys?: string[]): Promise<Record<string, unknown>>;
  setPref(key: string, value: unknown): Promise<unknown>;
}

/** A phone's width (Tailwind's `sm`): a list there shows its title and state, not every column. */
/** A phone or a tablet held up: cards, and Filter in a sheet. The phone shell's line too. */
const NARROW = "(max-width: 899.98px)";
export function useNarrow() {
  return useSyncExternalStore(
    (on) => {
      const m = matchMedia(NARROW);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => matchMedia(NARROW).matches,
    () => false,
  );
}

/** The fields a list filters by: every one with a filter shape, so every list has Filter. */
export const filtersOf = (meta: RecordMeta): FieldMeta[] =>
  meta.fields.filter((f) => filterShape(f) && f.key !== "id");

/** How many fields Filter offers first. */
const QUICK = 3;
/** A pick list this short reads at a glance; a longer one is Filter's to search. */
const QUICK_STATES = 12;

/**
 * The fields Filter offers first: the record's `quick`, else the field holding its platform
 * (Site) first, then its short pick lists in order, three at most. None sits on the bar until set.
 */
export function quickFilters(meta: RecordMeta): FieldMeta[] {
  const filters = filtersOf(meta);
  const byKey = new Map(filters.map((f) => [f.key, f]));
  // A declared account leads: which login a row is on is the first thing narrowed by.
  const account = meta.account ? byKey.get(meta.account) : undefined;
  if (meta.quick)
    return [
      ...(account ? [account] : []),
      ...meta.quick.flatMap((k) => (k === meta.account ? [] : (byKey.get(k) ?? []))),
    ];
  const site =
    typeof meta.channel === "object" && meta.channel ? byKey.get(meta.channel.field) : undefined;
  const picks = filters.filter((f) => {
    const n = Object.keys(f.states ?? {}).length;
    return (
      f !== site && f !== account && filterShape(f) === "states" && n >= 2 && n <= QUICK_STATES
    );
  });
  return [...(account ? [account] : []), ...(site ? [site] : []), ...picks].slice(
    0,
    QUICK + (account ? 1 : 0),
  );
}

/** The field holding a row's platform, when the list mixes them: what Group by Site groups on. */
function siteField(meta: RecordMeta): FieldMeta | null {
  if (typeof meta.channel !== "object" || !meta.channel) return null;
  const key = meta.channel.field;
  return meta.fields.find((f) => f.key === key && f.states) ?? null;
}

/**
 * The fields rows may group by: the platform, the account each row is on, then every status or
 * choice field. A choice reaches the web as states too, so one rule groups them all.
 */
export function groupFields(meta: RecordMeta): FieldMeta[] {
  const out: FieldMeta[] = [];
  const add = (f: FieldMeta | null | undefined) => {
    if (f?.states && !out.includes(f)) out.push(f);
  };
  add(siteField(meta));
  add(accountFieldOf(meta));
  for (const f of meta.fields) if (f.kind === "status" || f.kind === "choice") add(f);
  return out;
}

/**
 * The field "By" groups on: the one the record names (`by`), else the platform, else the first
 * status, else the first choice.
 */
export function byField(meta: RecordMeta): FieldMeta | null {
  const fields = groupFields(meta);
  return (
    fields.find((f) => f.key === meta.by) ??
    siteField(meta) ??
    fields.find((f) => f.kind === "status") ??
    fields.find((f) => f.kind === "choice") ??
    null
  );
}

/** The address keys a list's state rides in; `as` is a timeline page's list or axis. */
const STATE = ["view", "q", "sort", "group", "cols", "as", "size"];
const keysOf = (meta: RecordMeta) => [...STATE, ...filtersOf(meta).map((f) => f.key)];

/** What a saved view keeps of the address, keys in order so two read the same. */
export function keptOf(meta: RecordMeta, params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of keysOf(meta).sort()) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}
const sameKept = (a: string, b: string) => {
  const sort = (s: string) => {
    const p = new URLSearchParams(s);
    p.sort();
    return p.toString();
  };
  return sort(a) === sort(b);
};

/** The link that opens a saved view: everything else the list had, dropped. */
function savedLink(meta: RecordMeta, place: Place, v: SavedViewLine) {
  const drop = Object.fromEntries(keysOf(meta).map((k) => [k, null]));
  return place.link({
    ...drop,
    pg: null,
    ...Object.fromEntries(new URLSearchParams(v.params)),
    sv: String(v.id),
  });
}

const NO_SCOPE = {};

export interface Saved {
  lines: SavedViewLine[];
  ready: boolean;
  reload: () => void;
}

/** The viewer's saved views of a list, read once per list and again after a change. */
export function useSavedViews(keep: KeepApi | undefined, record: string): Saved {
  // The keep api is the scope: every bar on its lists shares one read of each list's views.
  const got = useLoad(
    keep ? `views:${record}` : null,
    async () => (keep ? keep.views(record) : []),
    keep ?? NO_SCOPE,
  );
  const ready = !keep || got.data !== null || got.error !== null;
  return { lines: got.data ?? [], ready, reload: got.retry };
}

/** What a list remembers between visits: its tab (a saved one too), sort, columns, list or axis. */
interface LastUsed {
  sv?: number;
  view?: string;
  sort?: string;
  cols?: string;
  as?: string;
}

/** `as` when it names a form a list still draws. */
const formOf = (v: string | null | undefined) =>
  (LIST_FORMS as readonly (string | null | undefined)[]).includes(v) ? (v as string) : undefined;

/** What the address keeps for next time (`list:<record>` in his prefs). */
export function lastOf(p: URLSearchParams): LastUsed {
  const now: LastUsed = {};
  const sv = Number(p.get("sv"));
  if (Number.isSafeInteger(sv) && sv > 0) now.sv = sv;
  for (const k of ["view", "sort", "cols"] as const) {
    const v = p.get(k);
    if (v) now[k] = v;
  }
  const as = formOf(p.get("as"));
  if (as) now.as = as;
  return now;
}

/**
 * Where a list opens, from what he used last and what the link names: a saved view by its id
 * (`{sv}`), else the address's `change`, else nothing. A link that names a view, a sort or columns
 * wins; one with only filters still gets his columns; a timeline page's list or axis follows him
 * unless the link names it (`as`) or a saved view. A form no longer drawn (cards) is dropped.
 */
export function restoreOf(
  last: LastUsed | undefined,
  p: URLSearchParams,
  filtered: boolean,
  saved: ReadonlySet<number> = new Set(),
): { sv: number } | { change: Record<string, string | null> } | null {
  if (!last) return null;
  const named = ["view", "sv", "sort", "cols"].some((k) => p.has(k));
  const as = formOf(last.as);
  const form = !p.has("as") && !p.has("sv") && as ? { as } : {};
  if (named) return form.as ? { change: form } : null;
  if (last.sv && saved.has(last.sv) && !filtered) return { sv: last.sv };
  const change: Record<string, string | null> = filtered
    ? { cols: last.cols ?? null, ...form }
    : { view: last.view ?? null, sort: last.sort ?? null, cols: last.cols ?? null, ...form };
  return Object.values(change).some(Boolean) ? { change } : null;
}

/**
 * Open the list where the viewer left it, then keep where he goes (`restoreOf`).
 */
export function useLastUsed(
  keep: KeepApi | undefined,
  meta: RecordMeta,
  place: Place,
  saved: Saved,
) {
  const key = `list:${meta.id}`;
  const done = useRef<string | null>(null);
  const kept = useRef<string>("");
  const p = place.params;
  // read-ok: once per list, the last place it was left, to go back to; not a list to keep.
  useEffect(() => {
    if (!keep || !saved.ready || done.current === meta.id) return;
    done.current = meta.id;
    if (p.has("sv") || (p.has("as") && ["view", "sort", "cols"].some((k) => p.has(k)))) return;
    const filtered = keysOf(meta).some((k) => k !== "as" && p.has(k));
    keep
      .prefs([key])
      .then((prefs) => {
        const last = prefs[key] as LastUsed | undefined;
        kept.current = JSON.stringify(last ?? {});
        const to = restoreOf(last, p, filtered, new Set(saved.lines.map((v) => v.id)));
        const sv = to && "sv" in to ? saved.lines.find((v) => v.id === to.sv) : undefined;
        if (sv) place.go(savedLink(meta, place, sv), true);
        else if (to && "change" in to) place.go(place.link(to.change), true);
      })
      .catch(() => {});
  }, [keep, saved.ready, saved.lines, meta, key, p, place]);

  const json = JSON.stringify(lastOf(p));
  useEffect(() => {
    if (!keep || done.current !== meta.id || json === kept.current) return;
    const t = setTimeout(() => {
      kept.current = json;
      void keep.setPref(key, json === "{}" ? null : JSON.parse(json)).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [keep, json, key, meta.id]);
}

/** A view's tab: a small pill (the artifact's `.nt-top` buttons), 13 px 600, a leaf of 4 and 10; the row's `TabBar` slides the tint behind the one on screen. */
export const TAB =
  "relative isolate flex shrink-0 items-center gap-1.5 rounded-[4px_10px_4px_10px] px-[9px] py-1.5 text-[13px] font-semibold no-underline transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-accent-wash) motion-reduce:transition-none";
export const tabTone = (on: boolean) =>
  on ? "text-(--ui-active) hover:bg-transparent" : "text-(--ui-ink-3) hover:text-(--ui-ink)";

/** How many views show as tabs; the rest wait under More. */
export const TABS = 5;

/**
 * Which views show as tabs: the default, then the next by declared order (built-in, then
 * saved), five at most. A built-in view with no rows waits under More unless it is the
 * default. While counts are unknown, declared order alone.
 */
export function splitViews<T extends string>(
  ids: readonly T[],
  counts: Record<string, number> | undefined,
  saved: readonly T[] = [],
  max = TABS,
): { tabs: T[]; more: T[] } {
  const tabs: T[] = [];
  const more: T[] = [];
  ids.forEach((id, i) => {
    const empty = !!counts && i > 0 && !counts[id];
    (tabs.length < max && !empty ? tabs : more).push(id);
  });
  for (const id of saved) (tabs.length < max ? tabs : more).push(id);
  return { tabs, more };
}

/** A view as a tab: its link, its count, whether it's open. */
export interface ViewTab {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
  on: boolean;
  /** The open view's rows still read: the ring turns after its label. */
  busy?: boolean | undefined;
  /** What the tab keeps, in words, on hover. */
  tip?: string | undefined;
  /** The viewer's own view: no count; `menu` sits on it while open. */
  saved?: boolean | undefined;
  /** A word after its name ("Team"). */
  badge?: string | undefined;
}
type MoreView = ViewTab;

/** The views past the tabs, behind one button that names the open one when it's among them. */
function MoreViews({ views, phone }: { views: MoreView[]; phone?: boolean }) {
  const pop = useHoverPop();
  if (!views.length) return null;
  const on = views.find((v) => v.on);
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        className={cn(
          phone
            ? // The segmented control's height and ground (`.ui-seg`), so the two read as one row.
              "flex shrink-0 items-center gap-1 self-stretch rounded-[10px] border-0 bg-(--ui-fill) px-3 text-[13.5px] text-(--ui-ink-2) aria-expanded:text-(--ui-ink)"
            : cn(TAB, "border-0 bg-transparent", tabTone(!!on)),
          on && "text-(--ui-ink)",
        )}
      >
        {on ? on.label : "More"}
        {on && on.count !== undefined ? (
          <span className="text-(--ui-ink-2)">{num(on.count)}</span>
        ) : null}
        <Icon name="down" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent aria-label="More views" align="start" className={cn(POP, "w-60 p-1")}>
        <nav aria-label="More views" className="grid">
          {views.map((v) => (
            <a
              key={v.id}
              href={v.href}
              aria-current={v.on ? "page" : undefined}
              {...tipProps(v.tip)}
              onClick={() => pop.setOpen(false)}
              className={cn(
                ITEM,
                "justify-between no-underline aria-[current=page]:font-semibold",
                phone && "h-11 text-[15px]",
              )}
            >
              <span className="min-w-0 wrap-anywhere whitespace-normal">{v.label}</span>
              {v.count !== undefined ? (
                <span className="text-(--ui-ink-2) tabular-nums">{num(v.count)}</span>
              ) : null}
            </a>
          ))}
        </nav>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A list's views as tabs, with how many rows each holds under the current filters, then the
 * viewer's saved ones, the open one with its menu: five at most, the rest under More.
 */
export function ViewTabs({
  meta,
  current,
  counts,
  place,
  saved,
  keep,
  loading = false,
}: {
  meta: RecordMeta;
  current: string | undefined;
  counts: Record<string, number> | undefined;
  place: Place;
  saved?: Saved | undefined;
  keep?: KeepApi | undefined;
  /** The open view's rows still read: the ring turns on its tab. */
  loading?: boolean | undefined;
}) {
  const sv = place.params.get("sv");
  const lines = saved?.lines ?? [];
  const narrow = useNarrow();
  if (!meta.views.length && !lines.length) return null;
  const all: (ViewTab & { line?: SavedViewLine; at?: number })[] = [
    ...meta.views.map((v, i) => ({
      id: v.id,
      label: v.label,
      href: place.link({ view: i === 0 ? null : v.id, pg: null, sort: null, sv: null }),
      count: counts ? (counts[v.id] ?? 0) : undefined,
      on: v.id === current && !sv,
      busy: v.id === current && !sv ? loading : undefined,
      tip: sayView(meta, v),
    })),
    ...lines.map((v, at) => ({
      id: `sv:${v.id}`,
      label: v.name,
      href: savedLink(meta, place, v),
      on: String(v.id) === sv,
      busy: String(v.id) === sv ? loading : undefined,
      tip: `${saySaved(meta, v.params)}${v.shared ? " · Shared with the team" : ""}`,
      saved: true,
      badge: v.shared ? "Team" : undefined,
      line: v,
      at,
    })),
  ];
  const split = splitViews(
    meta.views.map((v) => v.id),
    counts,
    lines.map((v) => `sv:${v.id}`),
  );
  const byId = new Map(all.map((v) => [v.id, v]));
  const open = all.find((v) => v.on && v.line);
  const menu =
    open?.line && keep && saved ? (
      <SavedMenu
        view={open.line}
        at={open.at ?? 0}
        meta={meta}
        place={place}
        keep={keep}
        saved={saved}
      />
    ) : null;
  return (
    <ViewStrip
      tabs={split.tabs.flatMap((id) => byId.get(id) ?? [])}
      more={split.more.flatMap((id) => byId.get(id) ?? [])}
      menu={menu}
      row={`views:${meta.id}`}
      narrow={narrow}
    />
  );
}

/**
 * Views as tabs (artifact `.nt-top` tabs), the rest under More; the open saved view carries
 * `menu`. A phone: iOS's segmented control, More and the menu beside it.
 */
export function ViewStrip({
  tabs,
  more,
  menu,
  row,
  narrow,
}: {
  tabs: ViewTab[];
  more: ViewTab[];
  menu?: ReactNode;
  /** The underline's row: one per strip (`TabBar`). */
  row: string;
  narrow: boolean;
}) {
  const open = [...tabs, ...more].find((v) => v.on && v.saved);
  if (narrow)
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Segmented label="Views" className="min-w-0 flex-1" items={tabs} />
        <MoreViews views={more} phone />
        {open ? menu : null}
      </div>
    );
  return (
    <nav className="relative flex gap-0.5 overflow-x-auto" aria-label="Views">
      {tabs.map((v) =>
        v.saved ? (
          <span key={v.id} data-tab="" className={cn(TAB, "gap-1 [--ui-gap:4px]", tabTone(v.on))}>
            <a
              href={v.href}
              aria-current={v.on ? "page" : undefined}
              {...tipProps(v.tip)}
              className="max-w-48 wrap-anywhere whitespace-normal text-inherit no-underline"
            >
              {v.label}
            </a>
            {v.badge ? (
              <span className="text-[11px] font-normal text-(--ui-ink-3)">{v.badge}</span>
            ) : null}
            <RingSlot on={!!v.busy} />
            {v.on ? menu : null}
            {v.on ? <TabBar row={row} /> : null}
          </span>
        ) : (
          <a
            key={v.id}
            href={v.href}
            aria-current={v.on ? "page" : undefined}
            {...tipProps(v.tip)}
            className={cn(TAB, "[--ui-gap:6px]", tabTone(v.on))}
          >
            <span className="max-w-48 wrap-anywhere whitespace-normal">{v.label}</span>
            <span className="text-(--ui-ink-2)">{v.count !== undefined ? short(v.count) : ""}</span>
            <RingSlot on={!!v.busy} />
            {v.on ? <TabBar row={row} /> : null}
          </a>
        ),
      )}
      <MoreViews views={more} />
      {open && more.includes(open) ? menu : null}
    </nav>
  );
}

const ITEM =
  "flex h-8 pointer-coarse:h-11 w-full items-center gap-2 rounded-(--ui-leaf-nav) border-0 bg-transparent px-1.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-accent-wash) disabled:opacity-40";
/** A field in the bar (the artifact's `.finp`): a hairline, a leaf of 6 and 10. */
const INPUT =
  "h-8 pointer-coarse:h-11 w-full rounded-[6px_10px_6px_10px] border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) focus-visible:border-(--ui-focus) focus-visible:shadow-[0_0_0_1px_var(--ui-focus)]";
/** A view's name box: the bar's field over the kit's input. */
const NAME_BOX = cn(INPUT, "md:text-[13px]");
const sayOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The open saved view's menu: rename, share, move, delete. */
function SavedMenu({
  view,
  at,
  meta,
  place,
  keep,
  saved,
}: {
  view: SavedViewLine;
  at: number;
  meta: RecordMeta;
  place: Place;
  keep: KeepApi;
  saved: Saved;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const pop = useHoverPop({ onOpen: () => setSaid(null) });
  const setOpen = pop.setOpen;
  const named = useEdit(`view:${view.id}:name`, view.name);
  const name = named.value;
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, close = true) => {
    setBusy(true);
    setSaid(null);
    try {
      await fn();
      saved.reload();
      if (close) setOpen(false);
    } catch (err) {
      setSaid(sayOf(err));
    } finally {
      setBusy(false);
    }
  };
  const ids = saved.lines.map((v) => v.id);
  const move = (by: number) => {
    const next = [...ids];
    const [it] = next.splice(at, 1);
    if (it !== undefined) next.splice(at + by, 0, it);
    return run(() => keep.move(meta.id, next), false);
  };
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        aria-label={`${view.name}: options`}
        {...tipProps("Options", { as: "none" })}
        className="inline-flex size-6 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
      >
        <Icon name="more" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        aria-label={`${view.name}: options`}
        align="start"
        className="w-60 gap-0 p-1.5"
      >
        <form
          className="grid gap-1.5 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== view.name)
              void run(async () => {
                await keep.save({ id: view.id, record: meta.id, name: name.trim() });
                named.saved(name);
              });
          }}
        >
          <input {...named.field} maxLength={60} aria-label="View name" className={INPUT} />
        </form>
        <button
          type="button"
          disabled={busy}
          className={ITEM}
          onClick={() =>
            void run(() => keep.save({ id: view.id, record: meta.id, shared: !view.shared }))
          }
        >
          {view.shared ? "Only me" : "Share with the team"}
        </button>
        <button
          type="button"
          disabled={busy || at === 0}
          className={ITEM}
          onClick={() => void move(-1)}
        >
          Move left
        </button>
        <button
          type="button"
          disabled={busy || at === ids.length - 1}
          className={ITEM}
          onClick={() => void move(1)}
        >
          Move right
        </button>
        <button
          type="button"
          disabled={busy}
          className={cn(ITEM, "text-(--ui-bad)")}
          onClick={() =>
            void run(async () => {
              await keep.remove(view.id);
              place.go(place.link({ sv: null }), true);
            })
          }
        >
          Delete view
        </button>
        {said ? <p className="px-1.5 pt-1 text-[12px] text-(--ui-bad)">{said}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Save view: shown once the list differs from the open view. On a saved view he may change, it
 * updates that one or saves a new one.
 */
function SaveView({
  meta,
  place,
  keep,
  saved,
}: {
  meta: RecordMeta;
  place: Place;
  keep: KeepApi;
  saved: Saved;
}) {
  const kept = keptOf(meta, place.params);
  const sv = saved.lines.find((v) => String(v.id) === place.params.get("sv"));
  const differs = sv ? !sameKept(kept, sv.params) : kept !== "";
  if (!differs || !saved.ready) return null;
  return (
    <SaveViewPop
      record={meta.id}
      save={(v) => keep.save({ ...v, record: meta.id, params: kept })}
      open={sv}
      onSaved={(v) => {
        saved.reload();
        place.go(place.link({ sv: String(v.id) }), true);
      }}
    />
  );
}

/** A view as Save view sees it: what Update names. */
export interface SaveViewLine {
  id: number;
  name: string;
}

/**
 * The Save view chip and its popover: Update the open view, or save under a new name, the
 * viewer's own or shared. A list's bar, the Map's views and Aerie's tasks use it; `save` keeps
 * the screen as the caller's store holds it.
 */
export function SaveViewPop<V extends SaveViewLine>({
  record,
  save,
  open: sv,
  share = true,
  names,
  onSaved,
}: {
  /** Whose draft the name box keeps (a record id, "map"). */
  record: string;
  /** Update when `id` is set; else a new view named `name`. */
  save: (v: { id?: number; name?: string; shared?: boolean }) => Promise<V>;
  /** The saved view on screen, which Update overwrites. */
  open?: V | undefined;
  /** Offer "Share with the team": the store keeps shared views. */
  share?: boolean;
  /** The viewer's view names, when a new view under one replaces it. */
  names?: readonly string[] | undefined;
  onSaved: (v: V) => void;
}) {
  const form = useEditForm({
    key: `view:new:${record}`,
    defaults: { name: "", shared: false },
  });
  const [said, setSaid] = useState<string | null>(null);
  const pop = useHoverPop({
    onOpen: () => {
      form.setValue("shared", false);
      setSaid(null);
    },
  });
  const setOpen = pop.setOpen;
  const name = form.watch("name");
  const taken = names?.includes(name.trim()) ? name.trim() : null;
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<V>) => {
    setBusy(true);
    setSaid(null);
    try {
      const v = await fn();
      setOpen(false);
      onSaved(v);
      return true;
    } catch (err) {
      setSaid(sayOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = form.onSend(
    (v) =>
      v.name.trim()
        ? go(() =>
            save(share ? { name: v.name.trim(), shared: v.shared } : { name: v.name.trim() }),
          )
        : false,
    { clear: true },
  );
  return (
    <Popover {...pop.root}>
      <PopoverTrigger {...pop.trigger} className={CHIP}>
        <Icon name="bookmark" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>Save view</span>
      </PopoverTrigger>
      <PopoverContent aria-label="Save view" align="start" className="w-64 gap-0 p-2">
        {sv ? (
          <button
            type="button"
            disabled={busy}
            className={cn(ITEM, "mb-1.5 border-b border-(--ui-hair) pb-1.5")}
            onClick={() => void go(() => save({ id: sv.id }))}
          >
            Update “{sv.name}”
          </button>
        ) : null}
        <form className="grid gap-2" onSubmit={(e) => void submit(e)}>
          <TextField
            form={form}
            name="name"
            maxLength={60}
            placeholder={sv ? "Or save as a new view" : "Name this view"}
            aria-label="View name"
            box={NAME_BOX}
          />
          {share ? (
            <CheckField
              form={form}
              name="shared"
              label="Share with the team"
              className="text-[13px] text-(--ui-ink-2)"
            />
          ) : null}
          {taken ? (
            <p className="text-[12px] text-(--ui-ink-2)">Replaces your view “{taken}”.</p>
          ) : null}
          <Button tone="primary" type="submit" size="dense" busy={busy} disabled={!name.trim()}>
            {taken ? "Replace view" : "Save view"}
          </Button>
          {said ? <p className="text-[12px] text-(--ui-bad)">{said}</p> : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Rows per state of each field, under every filter but that field's own (a page's `facets`). */
export type Facets = Record<string, Record<string, number>>;

const NUMBERS = new Set(["number", "money", "percent", "rate", "duration", "score"]);
/** A field's kind as a small icon: a date, a figure, a choice, a person, a company, set or not, words. */
function kindIcon(f: FieldMeta): IconName {
  const shape = filterShape(f);
  return f.kind === "date"
    ? "calendar"
    : NUMBERS.has(f.kind)
      ? "hash"
      : shape === "states"
        ? "dot"
        : f.kind === "actor" || f.kind === "name"
          ? "user"
          : f.kind === "company"
            ? "building"
            : shape === "set"
              ? "toggle"
              : "text";
}

/** One field's control, with its counts read when it opens. */
function FieldBody({
  field,
  place,
  facets,
}: {
  field: FieldMeta;
  place: Place;
  facets: (() => Promise<Facets | undefined>) | undefined;
}) {
  const [counts, setCounts] = useState<Facets[string] | undefined>();
  const value = place.params.get(field.key);
  const set = (next: string | null) => place.go(place.link({ [field.key]: next, pg: null }), true);
  // read-ok: `facets` is the list's own read (its records api); this takes one field's counts.
  useEffect(() => {
    if (filterShape(field) !== "states" || !facets) return;
    let live = true;
    facets().then((all) => live && setCounts(all?.[field.key]));
    return () => {
      live = false;
    };
  }, [field, facets]);
  return <FieldFilter key={field.key} field={field} value={value} counts={counts} onChange={set} />;
}

/** A records list's fields as the bar's: on screen first, the likely ones (`first`) leading each. */
function barFieldsOf(
  filters: FieldMeta[],
  o: {
    place: Place;
    shown: Set<string>;
    first: Set<string>;
    facets: (() => Promise<Facets | undefined>) | undefined;
  },
): BarField[] {
  const { place, shown, first } = o;
  const lead = (f: FieldMeta) => (first.has(f.key) ? 0 : 1);
  const on = filters.filter((f) => shown.has(f.key)).sort((a, b) => lead(a) - lead(b));
  const off = filters.filter((f) => !shown.has(f.key)).sort((a, b) => lead(a) - lead(b));
  return [...on, ...off].map((f) => {
    const raw = place.params.get(f.key);
    // The picked platforms' marks or kinds' tints lead the value: "Platform is [YT] YouTube".
    const cues =
      raw && filterShape(f) === "states" ? raw.split(",").flatMap((id) => cueOf(f, id) ?? []) : [];
    return {
      key: f.key,
      label: f.label,
      icon: kindIcon(f),
      set: raw
        ? {
            ...filterParts(f, raw),
            say: sayRaw(f, raw),
            cues: cues.length
              ? cues.slice(0, 3).map((c) => <Cue key={c.label} state={c} />)
              : undefined,
          }
        : null,
      editor: <FieldBody field={f} place={place} facets={o.facets} />,
      clear: () => place.go(place.link({ [f.key]: null, pg: null }), true),
      section: shown.has(f.key) ? "On screen" : "Hidden",
    };
  });
}

/**
 * The bar under a list's tabs: search, Filter, a pill per filter, Clear, Save view; `end` sits at
 * the right (the count, or bulk actions). At phone width Filter and Save view share a row, the
 * pills flow under them, and Filter is a sheet from the bottom.
 */
export function ListBar({
  meta,
  place,
  shown,
  keep,
  saved,
  end,
  facets,
  display,
  compact = false,
}: {
  meta: RecordMeta;
  place: Place;
  /** Beside a docked peek (artifact `.nt-pk .nt-top`): the one line, the tools without words. */
  compact?: boolean;
  /** The fields on screen, offered first by Filter. */
  shown: Set<string>;
  keep?: KeepApi | undefined;
  saved?: Saved | undefined;
  end?: ReactNode;
  /** Rows per state under the other filters, read when a choice opens. */
  facets?: (() => Promise<Facets | undefined>) | undefined;
  /** How the list shows (columns, grouping, rows), last on the bar. */
  display?: ReactNode;
}) {
  const { params } = place;
  const narrow = useNarrow();
  const filters = filtersOf(meta);
  const searchable = meta.fields.some((f) => f.searchable);
  const many = meta.name.many;
  const on = filters.filter((f) => params.get(f.key));
  // The record's account has its own chip on the bar; its filter shows there, not as a pill.
  const account = accountFieldOf(meta);
  const accountChip =
    account && Object.keys(account.states ?? {}).length >= 2 ? (
      <AccountFilter meta={meta} place={place} />
    ) : null;
  const first = useMemo(() => new Set(quickFilters(meta).map((f) => f.key)), [meta]);
  const narrowed = !!params.get("q") || on.length > 0;

  // Counts are read once per address, when a choice first asks.
  const load = useRef(facets);
  load.current = facets;
  const key = params.toString();
  const has = !!facets;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new address reads them again.
  const counts = useMemo(() => {
    if (!has) return undefined;
    let got: Promise<Facets | undefined> | null = null;
    return () => {
      got ??= (load.current?.() ?? Promise.resolve(undefined)).catch(() => undefined);
      return got;
    };
  }, [key, has]);

  const fields = barFieldsOf(filters, { place, shown, first, facets: counts });
  const tools = useFilterTools({
    fields,
    narrow,
    search: searchable
      ? { many, ask: (q: string) => place.go(place.link({ q, pg: null }), true) }
      : undefined,
    say: sayFilters(params, filters),
    clearAll: () =>
      place.go(
        place.link({ pg: null, ...Object.fromEntries(filters.map((f) => [f.key, null])) }),
        true,
      ),
  });
  const filter = tools.tool;
  const pills = tools.pills((f) => !(accountChip && f.key === account?.key));
  const clear = narrowed ? (
    <a
      href={place.link({
        q: null,
        pg: null,
        ...Object.fromEntries(filters.map((f) => [f.key, null])),
      })}
      className={CHIP}
    >
      Clear
    </a>
  ) : null;
  const save =
    keep && saved ? <SaveView meta={meta} place={place} keep={keep} saved={saved} /> : null;
  const tail =
    end || display ? (
      <span className="flex items-center gap-0.5 text-[13px] text-(--ui-ink-3)">
        {end}
        {display}
      </span>
    ) : null;
  const search = searchable ? <SearchBox place={place} label={many} glass={compact} /> : null;
  // Table or By <field>: the one setting that folds the rows into groups, kept in `?group=`.
  const grouped = groupFields(meta).find((f) => f.key === params.get("group")) ?? null;
  const by = grouped ?? byField(meta);
  const shape = by ? (
    <nav
      aria-label="Show rows as"
      className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {[
        { id: "table", label: "Table", glyph: "table" as const, on: !grouped, at: null },
        {
          id: "by",
          label: `By ${by.label.toLowerCase()}`,
          glyph: "group" as const,
          on: !!grouped,
          at: by.key,
        },
      ].map((v) => (
        <a
          key={v.id}
          href={place.link({ group: v.at, pg: null })}
          aria-current={v.on ? "page" : undefined}
          className={cn(CHIP, v.on && CHIP_ON)}
        >
          <BarGlyph name={v.glyph} />
          {v.label}
        </a>
      ))}
    </nav>
  ) : null;

  // The artifact's `.nt-top`: the views at the left, the tools at the right.
  if (!narrow && !compact)
    // A side control: the bar hugs its parts, never the page's width.
    return (
      <div className="flex w-fit max-w-full flex-wrap items-center gap-2">
        {/* Whole, never clipped: beside a peek the tools wrap under it instead. */}
        {shape ? <div className="flex flex-none">{shape}</div> : null}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
          {accountChip}
          {pills}
          {clear}
          {filter}
          {search}
          {save}
          {tail}
        </div>
      </div>
    );
  // A phone, or a list beside its peek, keeps the one line (artifact `.nt-top` at 720px): the
  // tools drop their words.
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {shape}
        <div className="ml-auto flex min-w-0 items-center gap-0.5 [&_[data-hp]]:sr-only">
          {accountChip}
          {clear}
          {filter}
          {search}
          {save}
          {tail}
        </div>
      </div>
      {pills.length ? <div className="flex flex-wrap gap-0.5">{pills}</div> : null}
      {tools.sheet}
    </div>
  );
}

/** The search box on a records list: `?q=`, back to the first page. */
export function SearchBox({
  place,
  label,
  glass = false,
}: {
  place: Place;
  label: string;
  /** The glass alone at any width, as a phone's (a list beside its peek). */
  glass?: boolean;
}) {
  return (
    <SearchField
      asked={place.params.get("q") ?? ""}
      ask={(q) => place.go(place.link({ q, pg: null }), true)}
      label={label}
      glass={glass}
    />
  );
}
