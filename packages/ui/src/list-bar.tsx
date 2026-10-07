/**
 * What sits over a list (designs/2026-10-06-library-and-views.md): its views as tabs, the ones
 * the viewer saved after the built-in ones; search; Filter, as a popover or at phone width one
 * sheet; a chip per filter in plain words; and Save view. A list opens on the viewer's last-used
 * view, and the columns he picks stay picked (`list:<record>` in his prefs).
 */
import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { SavedViewLine } from "@wren/core/saved-views";
import { cn } from "cn";
import { Bookmark, ChevronDown, ListFilter, MoreHorizontal, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.js";
import { Button } from "./controls.js";
import { FieldFilter, filterLabel, filterShape } from "./fields.js";
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
            <span className="text-(--ui-ink-3)">{counts ? num(counts[v.id] ?? 0) : ""}</span>
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

/** At phone width, every filter in one sheet from the bottom. */
function FilterSheet({ filters, place }: { filters: FieldMeta[]; place: Place }) {
  const [open, setOpen] = useState(false);
  const set = filters.filter((f) => place.params.get(f.key)).length;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button type="button" className={CHIP} onClick={() => setOpen(true)}>
        <ListFilter className="size-3.5" />
        Filter{set ? ` · ${set}` : ""}
      </button>
      <SheetContent
        // A phone opens it to tap, not type: no keyboard springs up.
        initialFocus={false}
        side="bottom"
        className="max-h-[85dvh] gap-0 rounded-none bg-(--ui-paper) text-(--ui-ink)"
      >
        <SheetHeader className="border-b border-(--ui-hair) p-4">
          <SheetTitle className="text-[15px] font-semibold">Filter</SheetTitle>
        </SheetHeader>
        <div className="grid gap-5 overflow-y-auto p-4">
          {filters.map((f) => (
            <section key={f.key} className="grid gap-1.5">
              <h3 className="text-[12px] font-medium text-(--ui-ink-2)">{f.label}</h3>
              <FieldFilter
                field={f}
                value={place.params.get(f.key)}
                onChange={(next) => place.go(place.link({ [f.key]: next, after: null }), true)}
              />
            </section>
          ))}
        </div>
        <SheetFooter className="flex-row justify-between border-t border-(--ui-hair) p-4">
          <Button
            tone="secondary"
            size="dense"
            disabled={!set}
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
          <Button size="dense" onClick={() => setOpen(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The bar under a list's tabs: search, Filter (a sheet on a phone), a chip per filter, Clear,
 * Save view; `end` sits at the right (the count, or bulk actions).
 */
export function ListBar({
  meta,
  place,
  shown,
  keep,
  saved,
  end,
}: {
  meta: RecordMeta;
  place: Place;
  /** The fields on screen, offered first by Filter. */
  shown: Set<string>;
  keep?: KeepApi | undefined;
  saved?: Saved | undefined;
  end?: ReactNode;
}) {
  const { params } = place;
  const narrow = useNarrow();
  const filters = filtersOf(meta);
  const searchable = meta.fields.some((f) => f.searchable);
  const many = meta.name.many;
  const narrowed = !!params.get("q") || filters.some((f) => params.get(f.key));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {searchable ? <SearchBox place={place} label={many} /> : null}
      {filters.length ? (
        narrow ? (
          <FilterSheet filters={filters} place={place} />
        ) : (
          <FilterPicker
            filters={filters}
            shown={shown}
            place={place}
            many={searchable ? many : null}
          />
        )
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
      {keep && saved ? <SaveView meta={meta} place={place} keep={keep} saved={saved} /> : null}
      {end ? <span className="ml-auto text-[13px] text-(--ui-ink-2)">{end}</span> : null}
    </div>
  );
}

export const CHIP =
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
