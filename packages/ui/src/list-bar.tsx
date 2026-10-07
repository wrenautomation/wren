/**
 * What sits over a list (designs/2026-10-06-library-and-views.md): its views as tabs, the ones
 * the viewer saved after the built-in ones; search; Filter, as a popover or at phone width one
 * sheet; a pill per filter in plain words ("Campaign is SEC RIA"); and Save view. A list opens on the viewer's last-used
 * view, and the columns he picks stay picked (`list:<record>` in his prefs).
 */
import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { SavedViewLine } from "@wren/core/saved-views";
import { cn } from "cn";
import {
  Bookmark,
  Building2,
  Calendar,
  ChevronLeft,
  CircleDot,
  Hash,
  ListFilter,
  MoreHorizontal,
  Search,
  ToggleLeft,
  Type,
  User,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.js";
import { Button } from "./controls.js";
import { FieldFilter, filterParts, filterShape, inSight, useRoving } from "./fields.js";
import { num } from "./format.js";
import type { Place } from "./records.js";

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
const NARROW = "(max-width: 639px)";
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

/** The address keys a list's state rides in. */
const STATE = ["view", "q", "sort", "cols"];
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
export function savedLink(meta: RecordMeta, place: Place, v: SavedViewLine) {
  const drop = Object.fromEntries(keysOf(meta).map((k) => [k, null]));
  return place.link({
    ...drop,
    after: null,
    ...Object.fromEntries(new URLSearchParams(v.params)),
    sv: String(v.id),
  });
}

export interface Saved {
  lines: SavedViewLine[];
  ready: boolean;
  reload: () => void;
}

/** The viewer's saved views of a list, read once per list and again after a change. */
export function useSaved(keep: KeepApi | undefined, record: string): Saved {
  const [lines, setLines] = useState<SavedViewLine[] | null>(keep ? null : []);
  const [rev, setRev] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new rev reads them again.
  useEffect(() => {
    if (!keep) return;
    let live = true;
    keep
      .views(record)
      .then((l) => live && setLines(l))
      .catch(() => live && setLines([]));
    return () => {
      live = false;
    };
  }, [keep, record, rev]);
  return { lines: lines ?? [], ready: lines !== null, reload: () => setRev((n) => n + 1) };
}

/** What a list remembers between visits: its tab (a saved one too), sort and columns. */
interface LastUsed {
  sv?: number;
  view?: string;
  sort?: string;
  cols?: string;
}

/**
 * Open the list where the viewer left it, then keep where he goes. A link that names a view,
 * a sort or columns wins; one with only filters still gets his columns.
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
  useEffect(() => {
    if (!keep || !saved.ready || done.current === meta.id) return;
    done.current = meta.id;
    if (["view", "sv", "sort", "cols"].some((k) => p.has(k))) return;
    const filtered = keysOf(meta).some((k) => p.has(k));
    keep
      .prefs([key])
      .then((prefs) => {
        const last = prefs[key] as LastUsed | undefined;
        kept.current = JSON.stringify(last ?? {});
        if (!last) return;
        const sv = saved.lines.find((v) => v.id === last.sv);
        if (sv && !filtered) return place.go(savedLink(meta, place, sv), true);
        const change: Record<string, string | null> = filtered
          ? { cols: last.cols ?? null }
          : { view: last.view ?? null, sort: last.sort ?? null, cols: last.cols ?? null };
        if (Object.values(change).some(Boolean)) place.go(place.link(change), true);
      })
      .catch(() => {});
  }, [keep, saved.ready, saved.lines, meta, key, p, place]);

  const now: LastUsed = {};
  const sv = Number(p.get("sv"));
  if (Number.isSafeInteger(sv) && sv > 0) now.sv = sv;
  for (const k of ["view", "sort", "cols"] as const) {
    const v = p.get(k);
    if (v) now[k] = v;
  }
  const json = JSON.stringify(now);
  useEffect(() => {
    if (!keep || done.current !== meta.id || json === kept.current) return;
    const t = setTimeout(() => {
      kept.current = json;
      void keep.setPref(key, json === "{}" ? null : JSON.parse(json)).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [keep, json, key, meta.id]);
}

const TAB =
  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-[13px] font-medium no-underline";
const tabTone = (on: boolean) =>
  on
    ? "border-(--ui-ink) text-(--ui-ink)"
    : "border-transparent text-(--ui-ink-2) hover:text-(--ui-ink)";

/**
 * A list's views as tabs, with how many rows each holds under the current filters; then the
 * viewer's saved ones, the open one with its menu.
 */
export function ViewTabs({
  meta,
  current,
  counts,
  place,
  saved,
  keep,
}: {
  meta: RecordMeta;
  current: string | undefined;
  counts: Record<string, number> | undefined;
  place: Place;
  saved?: Saved | undefined;
  keep?: KeepApi | undefined;
}) {
  const sv = place.params.get("sv");
  const lines = saved?.lines ?? [];
  if (!meta.views.length && !lines.length) return null;
  return (
    <nav className="flex gap-6 overflow-x-auto border-b border-(--ui-hair)" aria-label="Views">
      {meta.views.map((v, i) => {
        const on = v.id === current && !sv;
        return (
          <a
            key={v.id}
            href={place.link({ view: i === 0 ? null : v.id, after: null, sort: null, sv: null })}
            aria-current={on ? "page" : undefined}
            className={cn(TAB, tabTone(on))}
          >
            {v.label}
            <span className="text-(--ui-ink-2)">{counts ? num(counts[v.id] ?? 0) : ""}</span>
          </a>
        );
      })}
      {lines.map((v, i) => {
        const on = String(v.id) === sv;
        return (
          <span key={v.id} className={cn(TAB, "gap-1", tabTone(on))}>
            <a
              href={savedLink(meta, place, v)}
              aria-current={on ? "page" : undefined}
              className="text-inherit no-underline"
            >
              {v.name}
            </a>
            {v.shared ? (
              <span className="text-[11px] font-normal text-(--ui-ink-3)">Team</span>
            ) : null}
            {on && keep && saved ? (
              <SavedMenu view={v} at={i} meta={meta} place={place} keep={keep} saved={saved} />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}

const ITEM =
  "flex h-8 w-full items-center gap-2 border-0 bg-transparent px-1.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) disabled:opacity-40";
const INPUT =
  "h-8 w-full border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) focus:border-(--ui-ink-2)";
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.name);
  const [said, setSaid] = useState<string | null>(null);
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
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setName(view.name);
          setSaid(null);
        }
      }}
    >
      <PopoverTrigger
        aria-label={`${view.name}: options`}
        className="inline-flex size-6 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
      >
        <MoreHorizontal className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-60 gap-0 rounded-none p-1.5 ring-(--ui-hair) shadow-lg"
      >
        <form
          className="grid gap-1.5 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== view.name)
              void run(() => keep.save({ id: view.id, record: meta.id, name: name.trim() }));
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            aria-label="View name"
            className={INPUT}
          />
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kept = keptOf(meta, place.params);
  const sv = saved.lines.find((v) => String(v.id) === place.params.get("sv"));
  const differs = sv ? !sameKept(kept, sv.params) : kept !== "";
  if (!differs || !saved.ready) return null;
  const go = async (fn: () => Promise<SavedViewLine>) => {
    setBusy(true);
    setSaid(null);
    try {
      const v = await fn();
      saved.reload();
      setOpen(false);
      place.go(place.link({ sv: String(v.id) }), true);
    } catch (err) {
      setSaid(sayOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setName("");
          setShared(false);
          setSaid(null);
        }
      }}
    >
      <PopoverTrigger className={CHIP}>
        <Bookmark className="size-3.5" />
        Save view
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 gap-0 rounded-none p-2 ring-(--ui-hair) shadow-lg"
      >
        {sv ? (
          <button
            type="button"
            disabled={busy}
            className={cn(ITEM, "mb-1.5 border-b border-(--ui-hair) pb-1.5")}
            onClick={() => void go(() => keep.save({ id: sv.id, record: meta.id, params: kept }))}
          >
            Update “{sv.name}”
          </button>
        ) : null}
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              void go(() =>
                keep.save({ record: meta.id, name: name.trim(), params: kept, shared }),
              );
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder={sv ? "Or save as a new view" : "Name this view"}
            aria-label="View name"
            className={INPUT}
          />
          <label className="flex items-center gap-2 text-[13px] text-(--ui-ink-2)">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="size-3.5 accent-(--ui-ink)"
            />
            Share with the team
          </label>
          <Button type="submit" size="dense" busy={busy} disabled={!name.trim()}>
            Save view
          </Button>
          {said ? <p className="text-[12px] text-(--ui-bad)">{said}</p> : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Rows per state of each field, under every filter but that field's own (a page's `facets`). */
export type Facets = Record<string, Record<string, number>>;

/** One height, one hairline, one type size for every control in the bar. */
export const CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1.5 border border-(--ui-hair) bg-(--ui-paper) px-2.5 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)";
const PILL =
  "inline-flex h-8 max-w-full min-w-0 items-center border border-(--ui-hair) bg-(--ui-paper) text-[13px] hover:bg-(--ui-hover)";
const POP =
  "w-72 gap-0 overflow-hidden rounded-none bg-(--ui-paper) p-0 text-(--ui-ink) ring-(--ui-hair) shadow-lg";
const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left text-[13px] text-(--ui-ink) select-none";

const NUMBERS = new Set(["number", "money", "percent", "rate", "duration", "score"]);
/** A field's kind as a small icon: a date, a figure, a choice, a person, a company, set or not, words. */
function KindIcon({ field: f }: { field: FieldMeta }) {
  const shape = filterShape(f);
  const Icon =
    f.kind === "date"
      ? Calendar
      : NUMBERS.has(f.kind)
        ? Hash
        : shape === "states"
          ? CircleDot
          : f.kind === "actor" || f.kind === "name"
            ? User
            : f.kind === "company"
              ? Building2
              : shape === "set"
                ? ToggleLeft
                : Type;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-(--ui-ink-3)" />;
}

/**
 * What Filter opens: the fields to pick from (typing narrows them; the ones on screen first,
 * then the hidden ones, then a search for the typed text), then the picked one's control. Arrow
 * keys and Enter move and pick; Back returns to the fields. Each change applies at once.
 */
function FilterPanel({
  filters,
  shown,
  place,
  many,
  start,
  facets,
  close,
  phone,
}: {
  filters: FieldMeta[];
  shown: Set<string>;
  place: Place;
  /** The list's plural, when it searches. */
  many: string | null;
  /** The field to open on: a pill's own. */
  start: FieldMeta | null;
  facets: (() => Promise<Facets | undefined>) | undefined;
  close: () => void;
  /** In the phone's sheet: no keyboard on open, and the sheet scrolls. */
  phone?: boolean;
}) {
  const [field, setField] = useState<FieldMeta | null>(start);
  const [text, setText] = useState("");
  const [counts, setCounts] = useState<{ key: string; of: Facets[string] | undefined }>();
  const id = useId();
  const { params } = place;
  const set = (f: FieldMeta, next: string | null) =>
    place.go(place.link({ [f.key]: next, after: null }), true);

  useEffect(() => {
    if (!field || filterShape(field) !== "states" || !facets) return;
    let live = true;
    facets().then((all) => live && setCounts({ key: field.key, of: all?.[field.key] }));
    return () => {
      live = false;
    };
  }, [field, facets]);

  const t = text.trim().toLowerCase();
  const match = filters.filter((f) => f.label.toLowerCase().includes(t));
  const groups: [string, FieldMeta[]][] = [
    ["On screen", match.filter((f) => shown.has(f.key))],
    ["Hidden", match.filter((f) => !shown.has(f.key))],
  ];
  const order = groups.flatMap(([, fs]) => fs);
  const searching = !!many && !!t;
  const search = () => {
    place.go(place.link({ q: text.trim(), after: null }), true);
    close();
  };
  const nav = useRoving(order.length + (searching ? 1 : 0));
  const pick = (i: number) => {
    const f = order[i];
    if (f) setField(f);
    else if (searching) search();
  };

  if (field) {
    const value = params.get(field.key);
    return (
      <div className="grid">
        <div className="flex h-10 items-center gap-1.5 border-b border-(--ui-hair) px-1">
          <button
            type="button"
            aria-label="Back to fields"
            onClick={() => {
              setField(null);
              setText("");
            }}
            className="inline-flex size-7 items-center justify-center border-0 bg-transparent p-0 text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <KindIcon field={field} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{field.label}</span>
          {value ? (
            <button
              type="button"
              onClick={() => set(field, null)}
              className="h-7 border-0 bg-transparent px-2 text-[12px] text-(--ui-ink-2) hover:text-(--ui-ink)"
            >
              Clear
            </button>
          ) : null}
        </div>
        <FieldFilter
          key={field.key}
          field={field}
          value={value}
          counts={counts?.key === field.key ? counts.of : undefined}
          onChange={(next) => set(field, next)}
        />
      </div>
    );
  }

  const option = (i: number) => `${id}-${i}`;
  return (
    <div className="grid">
      <label className="flex h-10 items-center gap-2 border-b border-(--ui-hair) px-3">
        <Search aria-hidden className="size-3.5 shrink-0 text-(--ui-ink-3)" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the popover opened to type in this.
          autoFocus={!phone}
          role="combobox"
          aria-expanded
          aria-controls={id}
          aria-activedescendant={nav.at >= 0 ? option(nav.at) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            nav.setAt(0);
          }}
          onKeyDown={(e) => nav.keys(e, pick)}
          placeholder="Filter by…"
          aria-label="Filter by"
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3)"
        />
      </label>
      <div
        id={id}
        role="listbox"
        aria-label="Fields"
        className={cn("grid p-1", !phone && "max-h-[min(22rem,60vh)] overflow-y-auto")}
      >
        {groups.map(([label, fields]) =>
          fields.length ? (
            <div key={label} className="grid">
              <span className="px-2 pt-2 pb-1 text-[11px] text-(--ui-ink-3)">{label}</span>
              {fields.map((f) => {
                const i = order.indexOf(f);
                const v = params.get(f.key);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the box's keys pick it.
                  <div
                    key={f.key}
                    id={option(i)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === nav.at}
                    ref={inSight(i === nav.at)}
                    onMouseMove={() => nav.setAt(i)}
                    onClick={() => setField(f)}
                    className={cn(ROW, i === nav.at && "bg-(--ui-hover)")}
                  >
                    <KindIcon field={f} />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    {v ? (
                      <span className="max-w-[45%] truncate text-[12px] text-(--ui-ink-3)">
                        {filterParts(f, v).value}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null,
        )}
        {searching ? (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the box's keys pick it.
          <div
            id={option(order.length)}
            role="option"
            tabIndex={-1}
            aria-selected={nav.at === order.length}
            ref={inSight(nav.at === order.length)}
            onMouseMove={() => nav.setAt(order.length)}
            onClick={search}
            className={cn(
              ROW,
              order.length && "mt-1 border-t border-(--ui-hair)",
              nav.at === order.length && "bg-(--ui-hover)",
            )}
          >
            <Search aria-hidden className="size-3.5 shrink-0 text-(--ui-ink-3)" />
            <span className="truncate text-(--ui-ink-2)">
              Search {many} for “{text.trim()}”
            </span>
          </div>
        ) : !match.length ? (
          <span className="px-2 py-2 text-[13px] text-(--ui-ink-2)">No field by that name.</span>
        ) : null}
      </div>
    </div>
  );
}

/** A set filter in plain words: "Campaign is SEC RIA". Clicking it opens its editor; × drops it. */
function FilterPill({
  field,
  place,
  onOpen,
  panel,
}: {
  field: FieldMeta;
  place: Place;
  /** At phone width: the sheet opens on this field instead. */
  onOpen?: (() => void) | undefined;
  panel: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { op, value } = filterParts(field, place.params.get(field.key) ?? "");
  const face = (
    <>
      <span className="shrink-0 text-(--ui-ink-2)">{field.label}</span>
      <span className="shrink-0 text-(--ui-ink-3)">{op}</span>
      <span className="min-w-0 max-w-[180px] truncate text-(--ui-ink)">{value}</span>
    </>
  );
  const faceClass =
    "inline-flex h-full min-w-0 items-center gap-1 border-0 bg-transparent py-0 pr-1 pl-2.5 text-[13px]";
  return (
    <span className={PILL}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={faceClass}>
          {face}
        </button>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className={faceClass}>{face}</PopoverTrigger>
          <PopoverContent align="start" className={POP}>
            {panel(() => setOpen(false))}
          </PopoverContent>
        </Popover>
      )}
      <button
        type="button"
        aria-label={`Remove ${field.label} filter`}
        onClick={() => place.go(place.link({ [field.key]: null, after: null }), true)}
        className="mr-1 inline-flex size-6 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-(--ui-ink-3) hover:text-(--ui-ink)"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

/** "Filter", with how many are on. */
function FilterFace({ on }: { on: number }) {
  return (
    <>
      <ListFilter className="size-3.5" />
      Filter
      {on ? <span className="text-(--ui-ink) tabular-nums">{on}</span> : null}
    </>
  );
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
}: {
  meta: RecordMeta;
  place: Place;
  /** The fields on screen, offered first by Filter. */
  shown: Set<string>;
  keep?: KeepApi | undefined;
  saved?: Saved | undefined;
  end?: ReactNode;
  /** Rows per state under the other filters, read when a choice opens. */
  facets?: (() => Promise<Facets | undefined>) | undefined;
}) {
  const { params } = place;
  const narrow = useNarrow();
  const filters = filtersOf(meta);
  const searchable = meta.fields.some((f) => f.searchable);
  const many = meta.name.many;
  const on = filters.filter((f) => params.get(f.key));
  const narrowed = !!params.get("q") || on.length > 0;
  const [picker, setPicker] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; start: FieldMeta | null; n: number }>({
    open: false,
    start: null,
    n: 0,
  });
  const openSheet = (start: FieldMeta | null) =>
    setSheet((s) => ({ open: true, start, n: s.n + 1 }));
  const shut = () => setSheet((s) => ({ ...s, open: false }));

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

  const panel = (start: FieldMeta | null, close: () => void, phone = false) => (
    <FilterPanel
      filters={filters}
      shown={shown}
      place={place}
      many={searchable ? many : null}
      start={start}
      facets={counts}
      close={close}
      phone={phone}
    />
  );
  const filter = !filters.length ? null : narrow ? (
    <button
      type="button"
      className={cn(CHIP, on.length && "text-(--ui-ink)")}
      onClick={() => openSheet(null)}
    >
      <FilterFace on={on.length} />
    </button>
  ) : (
    <Popover open={picker} onOpenChange={setPicker}>
      <PopoverTrigger className={cn(CHIP, on.length && "text-(--ui-ink)")}>
        <FilterFace on={on.length} />
      </PopoverTrigger>
      <PopoverContent align="start" className={POP}>
        {panel(null, () => setPicker(false))}
      </PopoverContent>
    </Popover>
  );
  const pills = on.map((f) => (
    <FilterPill
      key={f.key}
      field={f}
      place={place}
      onOpen={narrow ? () => openSheet(f) : undefined}
      panel={(close) => panel(f, close)}
    />
  ));
  const clear = narrowed ? (
    <a
      href={place.link({
        q: null,
        after: null,
        ...Object.fromEntries(filters.map((f) => [f.key, null])),
      })}
      className="inline-flex h-8 shrink-0 items-center px-2 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
    >
      Clear
    </a>
  ) : null;
  const save =
    keep && saved ? <SaveView meta={meta} place={place} keep={keep} saved={saved} /> : null;
  const tail = end ? <span className="ml-auto text-[13px] text-(--ui-ink-2)">{end}</span> : null;
  const search = searchable ? <SearchBox place={place} label={many} /> : null;

  if (!narrow)
    return (
      <div className="flex flex-wrap items-center gap-2">
        {search}
        {filter}
        {pills}
        {clear}
        {save}
        {tail}
      </div>
    );
  return (
    <div className="grid gap-2">
      {search}
      <div className="flex flex-wrap items-center gap-2">
        {filter}
        {save}
        {clear}
        {tail}
      </div>
      {pills.length ? <div className="flex flex-wrap gap-2">{pills}</div> : null}
      <Sheet open={sheet.open} onOpenChange={(o) => (o ? null : shut())}>
        <SheetContent
          // A phone opens it to tap, not type: no keyboard springs up.
          initialFocus={false}
          side="bottom"
          className="max-h-[85dvh] gap-0 rounded-none bg-(--ui-paper) text-(--ui-ink)"
        >
          <SheetHeader className="border-b border-(--ui-hair) p-4">
            <SheetTitle className="text-[15px] font-semibold">Filter</SheetTitle>
          </SheetHeader>
          <div key={sheet.n} className="min-h-0 flex-1 overflow-y-auto">
            {panel(sheet.start, shut, true)}
          </div>
          <SheetFooter className="flex-row justify-between border-t border-(--ui-hair) p-4">
            <Button
              tone="secondary"
              size="dense"
              disabled={!on.length}
              onClick={() =>
                place.go(
                  place.link({
                    after: null,
                    ...Object.fromEntries(filters.map((f) => [f.key, null])),
                  }),
                  true,
                )
              }
            >
              Clear all
            </Button>
            <Button size="dense" onClick={shut}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The search box: it asks once typing stops. */
export function SearchBox({ place, label }: { place: Place; label: string }) {
  const asked = place.params.get("q") ?? "";
  const [text, setText] = useState(asked);
  /** He's typing: his words win until they're in the address. */
  const typed = useRef(false);
  // The address changed from elsewhere (a tab, Clear, a saved view): show what it asks.
  useEffect(() => {
    if (!typed.current) setText(asked);
  }, [asked]);
  useEffect(() => {
    if (!typed.current) return;
    if (text.trim() === asked) {
      typed.current = false;
      return;
    }
    const t = setTimeout(() => {
      typed.current = false;
      place.go(place.link({ q: text.trim() || null, after: null }), true);
    }, 250);
    return () => clearTimeout(t);
  }, [text, asked, place]);
  return (
    <label className="relative flex h-8 w-full items-center sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-(--ui-ink-3)" />
      <input
        type="search"
        value={text}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
        placeholder={`Search ${label}`}
        aria-label={`Search ${label}`}
        className="h-8 w-full border border-(--ui-hair) bg-(--ui-paper) pr-2 pl-8 text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) focus:border-(--ui-ink-2)"
      />
    </label>
  );
}
