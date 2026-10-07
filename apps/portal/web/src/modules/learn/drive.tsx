/**
 * Learn's Items: a place from the rail (Inbox, Watch later, a collection, a source), as a feed
 * of cards, a list or a compact list (remembered per viewer). Chips filter by type and by
 * source with counts; sort by newest, score, length, source or title. Select with x or the box,
 * then move, tag, archive or add to an SOP; drag cards onto the rail. Keys: ? lists them.
 * /learn/items/<id> is one item, in place (./item.tsx).
 */
import { Alert, Button, cx, Empty, Input, Loading, relative, usePref } from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import {
  Archive,
  ArchiveRestore,
  ArrowDownUp,
  Check,
  Clock,
  Ellipsis,
  ExternalLink,
  FolderInput,
  Hash,
  Keyboard,
  LayoutGrid,
  List,
  Pin,
  RotateCw,
  Rows3,
  Search,
  Sparkles,
  Star,
  Tag,
  X,
} from "@wren/ui/lib/lucide";
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { keepOf } from "../../records.js";
import { href, navigate, useRoute } from "../../route.js";
import { type Browsed, type Card, type ItemType, learn, type Mark, onChanged } from "./api.js";
import { DRAG_ITEMS, LearnFrame, PLACE_LABELS, useRail } from "./frame.js";
import { ItemView } from "./item.js";
import {
  Avatar,
  KIND_LABELS,
  lengthOf,
  ScoreBadge,
  Thumb,
  TYPE_ORDER,
  TYPES,
  TypeMark,
} from "./kinds.js";
import { SaveBox } from "./learn.js";
import {
  act,
  CollectionMenu,
  KeysDialog,
  MoveDialog,
  many,
  markItems,
  SopDialog,
  TagDialog,
  trailOf,
} from "./menus.js";

type View = "cards" | "list" | "compact";
const VIEWS: { id: View; label: string; Icon: typeof List }[] = [
  { id: "cards", label: "Cards", Icon: LayoutGrid },
  { id: "list", label: "List", Icon: List },
  { id: "compact", label: "Compact", Icon: Rows3 },
];
const SORTS = [
  ["newest", "Newest"],
  ["score", "Score"],
  ["length", "Length"],
  ["source", "Source"],
  ["title", "Title"],
] as const;
const PAGE = 60;
const MAX = 200;

type Dialog = { kind: "move" | "tag" | "sop" | "keys"; ids: number[] } | null;

/** Pieces of a comma list in the address. */
const listOf = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

/** Where an item lives, as its link: the place it was opened from stays in the address. */
const itemHref = (id: number, keep: URLSearchParams) => href(`/learn/items/${id}`, {}, keep);

/** The Items page: a place, or one item. */
export function ItemsPage(_: PageProps) {
  const route = useRoute();
  const id = route.path[2];
  const p = route.params;
  const place = p.get("in") || "inbox";
  const tag = p.get("tag");
  const here = tag && place === "all" ? `tag:${tag}` : place;
  return (
    <LearnFrame here={here}>
      {id ? <ItemView id={id} back={href("/learn/items", {}, p)} /> : <Browse params={p} />}
    </LearnFrame>
  );
}

const EMPTIES: Record<string, ReactNode> = {
  inbox: "You're caught up. New posts from your sources land here, read and scored.",
  later: "Press L on any item, or drag it onto Watch later in the rail, to queue it here.",
  starred: "Press S on an item to star it. Stars stay when you archive.",
  saved: "Links you save show here. Share one from your phone, or paste it above.",
  all: "Everything you save or follow shows here, read and scored against Wren's SOPs.",
  archived: "Press E on an item to archive it. It stays searchable, and E here brings it back.",
};

function Browse({ params }: { params: URLSearchParams }) {
  const { rail } = useRail();
  const place = params.get("in") || "inbox";
  const types = listOf(params.get("type"));
  const srcs = listOf(params.get("src"));
  const tag = params.get("tag") ?? "";
  const q = params.get("q") ?? "";
  const sort = params.get("sort") || "newest";
  const filters = JSON.stringify({ place, types, srcs, tag, q, sort });
  const [lim, setLim] = useState({ k: filters, n: PAGE });
  const limit = lim.k === filters ? lim.n : PAGE;
  const load = useCall(`learn.browse:${filters}:${limit}`, () =>
    learn.browse({ place, types, sources: srcs, tag, q, sort, limit }),
  );
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);

  const keep = useMemo(() => keepOf(null, { app: "learn", asClient: false }), []);
  const pref = usePref<View>(keep, "learn.view");
  const view: View = pref.value && VIEWS.some((v) => v.id === pref.value) ? pref.value : "cards";

  const data = load.data;
  const items = data?.items ?? [];
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState(-1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const anchor = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // A new place or filter: a fresh selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the filters only.
  useEffect(() => {
    setSel(new Set());
    setFocus(-1);
  }, [filters]);
  // Items gone (archived, moved out): drop them from the selection.
  useEffect(() => {
    setSel((s) => {
      const ids = new Set(items.map((c) => c.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
    setFocus((f) => Math.min(f, items.length - 1));
  }, [items]);

  const set = (patch: Record<string, string | null>, replace = false) =>
    navigate(href("/learn/items", patch, params), replace);

  const targets = useCallback((): number[] => {
    if (sel.size) return [...sel];
    const c = items[focus];
    return c ? [c.id] : [];
  }, [sel, items, focus]);

  const toggle = (id: number, range = false) => {
    const next = new Set(sel);
    const at = items.findIndex((c) => c.id === id);
    if (range && anchor.current !== null) {
      const from = items.findIndex((c) => c.id === anchor.current);
      const [a, b] = from < at ? [from, at] : [at, from];
      for (const c of items.slice(a, b + 1)) next.add(c.id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = id;
    setSel(next);
  };

  // The keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (dialog) return;
      const c = items[focus];
      const ids = targets();
      const one = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      const show = (i: number) => {
        setFocus(i);
        document
          .querySelector(`[data-item="${items[i]?.id}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (e.key === "ArrowDown" && view === "cards") return;
          return one(() => show(Math.min(items.length - 1, focus + 1)));
        case "k":
        case "ArrowUp":
          if (e.key === "ArrowUp" && view === "cards") return;
          return one(() => show(Math.max(0, focus - 1)));
        case "Enter":
        case "o":
          if (c) one(() => navigate(itemHref(c.id, params)));
          return;
        case "x":
          if (c) one(() => toggle(c.id, e.shiftKey));
          return;
        case "s": {
          if (!ids.length) return;
          const all = ids.every((id) => items.find((x) => x.id === id)?.starred);
          return one(() => void markItems(ids, all ? "unstar" : "star"));
        }
        case "e":
          if (!ids.length) return;
          return one(() => void markItems(ids, place === "archived" ? "unarchive" : "archive"));
        case "l": {
          if (!ids.length) return;
          const all = ids.every((id) => items.find((x) => x.id === id)?.later);
          return one(() => void markItems(ids, all ? "unlater" : "later"));
        }
        case "m":
          if (ids.length) one(() => setDialog({ kind: "move", ids }));
          return;
        case "t":
          if (ids.length) one(() => setDialog({ kind: "tag", ids }));
          return;
        case "/":
          return one(() => searchRef.current?.focus());
        case "?":
          return one(() => setDialog({ kind: "keys", ids: [] }));
        case "Escape":
          if (sel.size) one(() => setSel(new Set()));
          return;
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const drag = (e: DragEvent, c: Card) => {
    const ids = sel.has(c.id) ? [...sel] : [c.id];
    e.dataTransfer.setData(DRAG_ITEMS, JSON.stringify(ids));
    e.dataTransfer.setData("text/uri-list", c.url);
    e.dataTransfer.effectAllowed = "move";
    if (ids.length > 1) {
      const ghost = document.createElement("div");
      ghost.textContent = many(ids.length);
      ghost.className =
        "fixed -top-20 left-0 bg-(--ui-ink) px-3 py-1.5 text-[13px] font-semibold text-(--ui-on-ink)";
      document.body.append(ghost);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    }
  };

  const collection = /^c(\d+)$/.exec(place)?.[1];
  const source = /^s(\d+)$/.exec(place)?.[1];
  const col = collection ? rail.collections.find((c) => c.id === Number(collection)) : undefined;
  const src = source
    ? rail.sources.flatMap((g) => g.sources).find((s) => s.id === Number(source))
    : undefined;
  const title = col
    ? col.name
    : src
      ? src.name
      : tag && place === "all"
        ? `#${tag}`
        : (PLACE_LABELS[place] ?? "Items");
  const filtered = types.length > 0 || srcs.length > 0 || !!q || (!!tag && place !== "all");

  const row = {
    params,
    sel,
    focusId: items[focus]?.id ?? null,
    picking: sel.size > 0,
    toggle,
    drag,
    onFocus: (id: number) => setFocus(items.findIndex((c) => c.id === id)),
    dialog: (kind: "move" | "tag" | "sop", ids: number[]) => setDialog({ kind, ids }),
    place,
  };

  return (
    <div className="pb-24">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {col ? (
            <nav
              aria-label="Collection path"
              className="mb-0.5 flex flex-wrap items-center gap-1 text-[12.5px] text-(--ui-ink-2)"
            >
              <span>Collections</span>
              {trailOf(rail.collections, col.id)
                .slice(0, -1)
                .map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1">
                    <span aria-hidden>/</span>
                    <a
                      href={`/learn/items?in=c${c.id}`}
                      className="text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
                    >
                      {c.name}
                    </a>
                  </span>
                ))}
            </nav>
          ) : src ? (
            <p className="mb-0.5 text-[12.5px] text-(--ui-ink-2)">{KIND_LABELS[src.kind]}</p>
          ) : null}
          <div className="flex min-w-0 items-center gap-2.5">
            {src ? <Avatar url={src.avatar} name={src.name} size={32} /> : null}
            <h1 className="truncate font-semibold text-[22px] leading-8 tracking-[-0.01em]">
              {title}
            </h1>
            {data ? (
              <span className="shrink-0 text-[14px] text-(--ui-ink-2) tabular-nums">
                {data.total.toLocaleString("en-US")}
              </span>
            ) : null}
            {col ? <CollectionMenu c={col} /> : null}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchBox inputRef={searchRef} q={q} onAsk={(v) => set({ q: v || null }, true)} />
          <label className="relative inline-flex h-8 items-center border border-(--ui-hair) bg-(--ui-paper) text-[13px] text-(--ui-ink-2)">
            <ArrowDownUp size={14} className="pointer-events-none absolute left-2.5" />
            <span className="sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(e) => set({ sort: e.target.value === "newest" ? null : e.target.value })}
              className="h-full cursor-pointer appearance-none bg-transparent pr-3 pl-8 text-(--ui-ink) outline-none"
            >
              {SORTS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <ViewToggle view={view} onPick={(v) => pref.set(v)} />
          <button
            type="button"
            onClick={() => setDialog({ kind: "keys", ids: [] })}
            className="hidden h-8 items-center gap-1.5 border-0 bg-transparent px-2 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) min-[901px]:inline-flex"
            title="Keys"
          >
            <Keyboard size={15} />
            <span className="sr-only">Keys</span>
          </button>
        </div>
      </header>

      {place === "saved" ? (
        <div className="mb-4">
          <SaveBox />
        </div>
      ) : null}

      <Chips data={data} types={types} srcs={srcs} tag={tag} place={place} set={set} />

      {load.error && !data ? (
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
      ) : !data ? (
        <Loading lines={6} shape={view === "cards" ? "cards" : "lines"} />
      ) : !items.length ? (
        <Empty
          action={
            filtered ? (
              <Button
                size="dense"
                tone="secondary"
                onClick={() =>
                  set({ type: null, src: null, q: null, ...(place !== "all" ? { tag: null } : {}) })
                }
              >
                Clear filters
              </Button>
            ) : place === "inbox" || place === "all" ? (
              <div className="flex flex-wrap justify-center gap-2">
                <a href="/learn/sources" className="text-(--ui-ink) text-[13px]">
                  Follow a source
                </a>
                <span aria-hidden>·</span>
                <a href="/learn/add" className="text-(--ui-ink) text-[13px]">
                  Save a link
                </a>
              </div>
            ) : null
          }
        >
          {filtered
            ? "Nothing here matches these filters."
            : col
              ? "Drag items onto this collection in the rail, or press M on one and pick it."
              : src
                ? "Nothing new from this source. Its next posts show here once read and scored."
                : (EMPTIES[place] ?? EMPTIES.all)}
        </Empty>
      ) : view === "cards" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-5 gap-y-8">
          {items.map((c) => (
            <CardTile key={c.id} c={c} {...row} />
          ))}
        </div>
      ) : view === "list" ? (
        <ListTable
          items={items}
          {...row}
          all={sel.size === items.length}
          pickAll={(on) => setSel(new Set(on ? items.map((c) => c.id) : []))}
        />
      ) : (
        <ul className="m-0 list-none border-(--ui-hair) border-t p-0">
          {items.map((c) => (
            <CompactRow key={c.id} c={c} {...row} />
          ))}
        </ul>
      )}

      {data?.more ? (
        <div className="mt-8 flex justify-center">
          {limit < MAX ? (
            <Button
              size="dense"
              tone="secondary"
              busy={load.loading}
              onClick={() => setLim({ k: filters, n: Math.min(MAX, limit + PAGE) })}
            >
              Show more
            </Button>
          ) : (
            <p className="text-[13px] text-(--ui-ink-2)">
              Showing the first {MAX}. Search or filter to find the rest.
            </p>
          )}
        </div>
      ) : null}

      {sel.size ? (
        <BulkBar
          ids={[...sel]}
          place={place}
          items={items}
          clear={() => setSel(new Set())}
          dialog={(kind) => setDialog({ kind, ids: [...sel] })}
        />
      ) : null}

      {dialog?.kind === "move" ? (
        <MoveDialog
          ids={dialog.ids}
          collections={rail.collections}
          current={
            dialog.ids.length === 1
              ? (items.find((c) => c.id === dialog.ids[0])?.collectionId ?? null)
              : null
          }
          onClose={(done) => {
            setDialog(null);
            if (done) setSel(new Set());
          }}
        />
      ) : dialog?.kind === "tag" ? (
        <TagDialog
          ids={dialog.ids}
          have={
            dialog.ids.length === 1 ? (items.find((c) => c.id === dialog.ids[0])?.tags ?? []) : []
          }
          known={rail.tags.map((t) => t.tag)}
          onClose={(done) => {
            setDialog(null);
            if (done) setSel(new Set());
          }}
        />
      ) : dialog?.kind === "sop" ? (
        <SopDialog
          ids={dialog.ids}
          onClose={(done) => {
            setDialog(null);
            if (done) setSel(new Set());
          }}
        />
      ) : dialog?.kind === "keys" ? (
        <KeysDialog onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function SearchBox({
  q,
  onAsk,
  inputRef,
}: {
  q: string;
  onAsk: (q: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [v, setV] = useState(q);
  useEffect(() => setV(q), [q]);
  useEffect(() => {
    if (v.trim() === q) return;
    const t = setTimeout(() => onAsk(v.trim()), 350);
    return () => clearTimeout(t);
  }, [v, q, onAsk]);
  return (
    <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
      <Search
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--ui-ink-2)"
      />
      <Input
        ref={inputRef}
        type="search"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setV("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search titles and transcripts"
        aria-label="Search titles and transcripts"
        className="h-8 pl-8 text-[13px]"
      />
    </div>
  );
}

function ViewToggle({ view, onPick }: { view: View; onPick: (v: View) => void }) {
  return (
    <fieldset className="m-0 inline-flex h-8 min-w-0 border border-(--ui-hair) bg-(--ui-paper) p-0">
      <legend className="sr-only">View</legend>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={view === v.id}
          title={v.label}
          onClick={() => onPick(v.id)}
          className={cx(
            "inline-flex w-9 items-center justify-center border-0 transition-colors duration-150",
            view === v.id
              ? "bg-(--ui-ink) text-(--ui-on-ink)"
              : "bg-transparent text-(--ui-ink-2) hover:text-(--ui-ink)",
          )}
        >
          <v.Icon size={15} />
          <span className="sr-only">{v.label}</span>
        </button>
      ))}
    </fieldset>
  );
}

const CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-[13px] transition-colors duration-150";
const CHIP_OFF = "border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink-2) hover:text-(--ui-ink)";
const CHIP_ON = "border-(--ui-ink) bg-(--ui-ink) text-(--ui-on-ink)";

function Chips({
  data,
  types,
  srcs,
  tag,
  place,
  set,
}: {
  data: Browsed | null;
  types: string[];
  srcs: string[];
  tag: string;
  place: string;
  set: (patch: Record<string, string | null>) => void;
}) {
  if (!data) return <div className="mb-5 h-8" />;
  const counts = data.types;
  const shown = TYPE_ORDER.filter((t) => counts[t] || types.includes(t));
  const total = shown.reduce((n, t) => n + (counts[t] ?? 0), 0);
  const flip = (list: string[], v: string) =>
    (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(",") || null;
  const sources = place.startsWith("s") ? [] : data.sources;
  const top = sources.slice(0, 8);
  const rest = sources.slice(8);
  return (
    <div className="mb-6 flex flex-col gap-2">
      {shown.length > 1 || types.length ? (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap">
          <button
            type="button"
            className={cx(CHIP, !types.length ? CHIP_ON : CHIP_OFF)}
            onClick={() => set({ type: null })}
          >
            All types
            <span className="tabular-nums opacity-70">{total}</span>
          </button>
          {shown.map((t) => {
            const on = types.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                className={cx(CHIP, on ? CHIP_ON : CHIP_OFF)}
                onClick={() => set({ type: flip(types, t) })}
              >
                <TypeMark type={t as ItemType} size={14} mono={on} />
                {TYPES[t as ItemType].many}
                <span className="tabular-nums opacity-70">{counts[t as ItemType] ?? 0}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {top.length > 1 || srcs.length ? (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap">
          {top.map((s) => {
            const on = srcs.includes(String(s.id));
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                className={cx(CHIP, "pl-1.5", on ? CHIP_ON : CHIP_OFF)}
                onClick={() => set({ src: flip(srcs, String(s.id)) })}
              >
                <Avatar url={s.avatar} name={s.name} size={20} />
                <span className="max-w-40 truncate">{s.name}</span>
                <span className="tabular-nums opacity-70">{s.n}</span>
              </button>
            );
          })}
          {rest.length ? (
            <Popover>
              <PopoverTrigger className={cx(CHIP, CHIP_OFF)}>{rest.length} more</PopoverTrigger>
              <PopoverContent
                align="start"
                className="max-h-80 w-64 gap-0 overflow-y-auto rounded-none bg-(--ui-paper) p-1 text-(--ui-ink) shadow-lg ring-(--ui-hair)"
              >
                {rest.map((s) => {
                  const on = srcs.includes(String(s.id));
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => set({ src: flip(srcs, String(s.id)) })}
                      className="flex h-8 w-full items-center gap-2 border-0 bg-transparent px-2 text-left text-[13px] hover:bg-(--ui-hover)"
                    >
                      <Avatar url={s.avatar} name={s.name} size={16} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {on ? <Check size={14} className="text-(--ui-accent)" /> : null}
                      <span className="text-[12px] text-(--ui-ink-2) tabular-nums">{s.n}</span>
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : null}
      {tag && place !== "all" ? (
        <div>
          <button type="button" className={cx(CHIP, CHIP_ON)} onClick={() => set({ tag: null })}>
            <Hash size={13} />
            {tag}
            <X size={13} aria-label="Clear the tag" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface RowProps {
  params: URLSearchParams;
  sel: Set<number>;
  focusId: number | null;
  picking: boolean;
  place: string;
  toggle: (id: number, range?: boolean) => void;
  drag: (e: DragEvent, c: Card) => void;
  onFocus: (id: number) => void;
  dialog: (kind: "move" | "tag" | "sop", ids: number[]) => void;
}

/** A square box that picks a card; shift picks the run from the last one. */
function PickBox({
  c,
  on,
  toggle,
  className,
}: {
  c: Card;
  on: boolean;
  toggle: RowProps["toggle"];
  className?: string;
}) {
  return (
    <Box
      on={on}
      label={on ? `Unselect ${c.title}` : `Select ${c.title}`}
      onPick={(shift) => toggle(c.id, shift)}
      className={className}
    />
  );
}

/** A checkbox in the kit's square look. */
function Box({
  on,
  label,
  onPick,
  className,
}: {
  on: boolean;
  label: string;
  onPick: (shift: boolean) => void;
  className?: string | undefined;
}) {
  return (
    <label
      className={cx(
        "inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center border transition-colors duration-100 has-focus-visible:outline-2 has-focus-visible:outline-(--ui-accent) has-focus-visible:outline-offset-2",
        on
          ? "border-(--ui-accent) bg-(--ui-accent) text-(--ui-on-accent)"
          : "border-(--ui-ink-3) bg-(--ui-paper) text-transparent hover:border-(--ui-ink)",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={on}
        aria-label={label}
        className="sr-only"
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation();
          onPick(e.shiftKey);
        }}
      />
      <Check size={13} strokeWidth={3} aria-hidden />
    </label>
  );
}

const sourceName = (c: Card) => c.source?.name ?? c.creator ?? (c.saved ? "Saved by you" : "Link");

/** What a card says under its title when it has no summary yet. */
const STATE_LINES: Record<Card["state"], string> = {
  reading: "Reading now. Its summary shows here when it's scored.",
  scoring: "Scoring against Wren's SOPs.",
  mac: "Waits for the Mac to transcribe it.",
  failed: "Couldn't read this one. Read again from its menu.",
  ready: "",
};

function Dot({ c }: { c: Card }) {
  if (c.status !== "unread") return null;
  return (
    <span
      className="mt-[0.45em] inline-block size-2 shrink-0 rounded-full bg-(--ui-accent)"
      title="New"
    >
      <span className="sr-only">New</span>
    </span>
  );
}

function CardTile({ c, ...r }: RowProps & { c: Card }) {
  const on = r.sel.has(c.id);
  const len = lengthOf(c);
  const link = itemHref(c.id, r.params);
  return (
    <article
      data-item={c.id}
      draggable
      onDragStart={(e) => r.drag(e, c)}
      onFocusCapture={() => r.onFocus(c.id)}
      className={cx(
        "group/card relative flex min-w-0 flex-col gap-3 outline-offset-4",
        r.focusId === c.id && "outline-2 outline-(--ui-accent) outline-solid",
      )}
    >
      <div className="relative">
        <a href={link} tabIndex={-1} aria-label={c.title} draggable={false} className="block">
          <Thumb
            card={c}
            className={cx(
              "transition-[filter] duration-200",
              on && "ring-(--ui-accent) ring-[3px]",
              c.status === "archived" && "grayscale",
            )}
          />
        </a>
        <div
          className={cx(
            "absolute top-2 left-2 transition-opacity duration-150",
            on || r.picking
              ? "opacity-100"
              : "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100",
          )}
        >
          <PickBox c={c} on={on} toggle={r.toggle} />
        </div>
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
          <Quick
            label={c.later ? "Off Watch later" : "Watch later"}
            on={c.later}
            onClick={() => void markItems([c.id], c.later ? "unlater" : "later")}
          >
            <Clock size={15} />
          </Quick>
          <Quick
            label={c.starred ? "Unstar" : "Star"}
            on={c.starred}
            onClick={() => void markItems([c.id], c.starred ? "unstar" : "star")}
          >
            <Star size={15} />
          </Quick>
          <Quick
            label={c.status === "archived" ? "Unarchive" : "Archive"}
            onClick={() =>
              void markItems([c.id], c.status === "archived" ? "unarchive" : "archive")
            }
          >
            {c.status === "archived" ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </Quick>
        </div>
        <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1">
          <ScoreBadge score={c.score} />
          {c.pinned ? (
            <span
              className="inline-flex size-5 items-center justify-center bg-(--ui-paper) text-(--ui-ink)"
              title="Pinned"
            >
              <Pin size={12} />
            </span>
          ) : null}
          {c.starred ? (
            <span
              className="inline-flex size-5 items-center justify-center bg-(--ui-paper) text-(--ui-warn)"
              title="Starred"
            >
              <Star size={12} fill="currentColor" />
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 gap-2.5">
        <Avatar url={c.source?.avatar ?? null} name={sourceName(c)} size={32} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 flex gap-1.5 font-semibold text-[14.5px] leading-snug">
            <Dot c={c} />
            <a
              href={link}
              draggable={false}
              className="line-clamp-2 text-(--ui-ink) no-underline hover:underline"
            >
              {c.title}
            </a>
          </h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-(--ui-ink-2)">
            <TypeMark type={c.type} size={13} label={TYPES[c.type]?.label} />
            <span className="truncate">{sourceName(c)}</span>
          </p>
          <p className="m-0 text-[12.5px] text-(--ui-ink-2) tabular-nums">
            {len ? `${len} · ` : ""}
            {relative(new Date(c.at))}
          </p>
          {c.summary || STATE_LINES[c.state] ? (
            <p className="mt-1.5 line-clamp-2 text-[13px] text-(--ui-ink-2) leading-relaxed">
              {c.summary ?? STATE_LINES[c.state]}
            </p>
          ) : null}
        </div>
        <ItemMenu c={c} place={r.place} dialog={r.dialog} className="-mr-1.5 self-start" />
      </div>
    </article>
  );
}

function Quick({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cx(
        "inline-flex size-8 items-center justify-center border-0 bg-(--ui-paper)/95 shadow-sm hover:bg-(--ui-paper)",
        on ? "text-(--ui-accent)" : "text-(--ui-ink)",
      )}
    >
      {children}
    </button>
  );
}

/** Everything one item can do, from its ⋯. */
export function ItemMenu({
  c,
  place,
  dialog,
  className,
}: {
  c: Pick<
    Card,
    "id" | "title" | "url" | "type" | "starred" | "pinned" | "later" | "status" | "state"
  >;
  place: string;
  dialog: (kind: "move" | "tag" | "sop", ids: number[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const mark = (m: Mark) => run(() => void markItems([c.id], m));
  const item =
    "flex h-8 w-full items-center gap-2.5 border-0 bg-transparent px-2.5 text-left text-[13px] text-(--ui-ink) no-underline hover:bg-(--ui-hover)";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${c.title}: more`}
        className={cx(
          "inline-flex size-8 shrink-0 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)",
          className,
        )}
      >
        <Ellipsis size={16} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 gap-0 rounded-none bg-(--ui-paper) p-1 text-(--ui-ink) shadow-lg ring-(--ui-hair)"
      >
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className={item}
          onClick={() => setOpen(false)}
        >
          <ExternalLink size={14} /> Open on {TYPES[c.type]?.site ?? "the page"}
        </a>
        <hr className="my-1 border-(--ui-hair)" />
        <button type="button" className={item} onClick={mark(c.later ? "unlater" : "later")}>
          <Clock size={14} /> {c.later ? "Off Watch later" : "Watch later"}
        </button>
        <button type="button" className={item} onClick={mark(c.starred ? "unstar" : "star")}>
          <Star size={14} /> {c.starred ? "Unstar" : "Star"}
        </button>
        <button type="button" className={item} onClick={mark(c.pinned ? "unpin" : "pin")}>
          <Pin size={14} /> {c.pinned ? "Unpin" : "Pin to the top"}
        </button>
        <button
          type="button"
          className={item}
          onClick={mark(c.status === "unread" ? "read" : "unread")}
        >
          <span className="inline-flex size-3.5 items-center justify-center">
            <span
              className={cx(
                "size-2 rounded-full",
                c.status === "unread" ? "border border-(--ui-ink-2)" : "bg-(--ui-accent)",
              )}
            />
          </span>
          {c.status === "unread" ? "Mark read" : "Mark unread"}
        </button>
        <hr className="my-1 border-(--ui-hair)" />
        <button type="button" className={item} onClick={run(() => dialog("move", [c.id]))}>
          <FolderInput size={14} /> Move to
        </button>
        <button type="button" className={item} onClick={run(() => dialog("tag", [c.id]))}>
          <Tag size={14} /> Tag
        </button>
        <button type="button" className={item} onClick={run(() => dialog("sop", [c.id]))}>
          <Sparkles size={14} /> Add to SOP
        </button>
        {c.state === "failed" ? (
          <button
            type="button"
            className={item}
            onClick={run(() => void act(learn.readAgain([c.id]), "Reading again"))}
          >
            <RotateCw size={14} /> Read again
          </button>
        ) : null}
        <hr className="my-1 border-(--ui-hair)" />
        <button
          type="button"
          className={item}
          onClick={mark(c.status === "archived" || place === "archived" ? "unarchive" : "archive")}
        >
          {c.status === "archived" ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {c.status === "archived" ? "Unarchive" : "Archive"}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ListTable({
  items,
  all,
  pickAll,
  ...r
}: RowProps & { items: Card[]; all: boolean; pickAll: (on: boolean) => void }) {
  const th = "h-9 px-2 text-left font-medium text-[12px] text-(--ui-ink-2)";
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[13.5px]">
        <thead className="border-(--ui-hair) border-b">
          <tr>
            <th className={cx(th, "w-9")}>
              <Box
                on={all}
                label={all ? "Unselect all" : "Select all"}
                onPick={() => pickAll(!all)}
              />
            </th>
            <th className={th}>Title</th>
            <th className={cx(th, "hidden w-44 md:table-cell")}>Source</th>
            <th className={cx(th, "hidden w-24 sm:table-cell")}>Length</th>
            <th className={cx(th, "w-14")}>Score</th>
            <th className={cx(th, "hidden w-24 lg:table-cell")}>Status</th>
            <th className={cx(th, "hidden w-28 sm:table-cell")}>Added</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const on = r.sel.has(c.id);
            return (
              <tr
                key={c.id}
                data-item={c.id}
                draggable
                onDragStart={(e) => r.drag(e, c)}
                onFocusCapture={() => r.onFocus(c.id)}
                className={cx(
                  "border-(--ui-hair) border-b transition-colors duration-100 hover:bg-(--ui-wash)",
                  on && "bg-(--ui-accent-wash)",
                  r.focusId === c.id && "shadow-[inset_3px_0_0_var(--ui-accent)]",
                )}
              >
                <td className="px-2 py-2">
                  <PickBox c={c} on={on} toggle={r.toggle} />
                </td>
                <td className="min-w-0 px-2 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TypeMark type={c.type} size={15} label={TYPES[c.type]?.label} />
                    <Dot c={c} />
                    <a
                      href={itemHref(c.id, r.params)}
                      draggable={false}
                      className={cx(
                        "truncate no-underline hover:underline",
                        c.status === "unread" ? "font-semibold text-(--ui-ink)" : "text-(--ui-ink)",
                      )}
                    >
                      {c.title}
                    </a>
                    {c.pinned ? <Pin size={12} className="shrink-0 text-(--ui-ink-2)" /> : null}
                    {c.starred ? (
                      <Star size={12} fill="currentColor" className="shrink-0 text-(--ui-warn)" />
                    ) : null}
                    {c.tags.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="hidden shrink-0 bg-(--ui-tile) px-1.5 text-[11.5px] text-(--ui-ink-2) xl:inline"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="hidden px-2 py-2 md:table-cell">
                  <span className="flex min-w-0 items-center gap-1.5 text-(--ui-ink-2)">
                    <Avatar url={c.source?.avatar ?? null} name={sourceName(c)} size={16} />
                    <span className="truncate">{sourceName(c)}</span>
                  </span>
                </td>
                <td className="hidden px-2 py-2 text-(--ui-ink-2) tabular-nums sm:table-cell">
                  {lengthOf(c) ?? ""}
                </td>
                <td className="px-2 py-2">
                  <ScoreBadge score={c.score} />
                </td>
                <td className="hidden px-2 py-2 text-(--ui-ink-2) lg:table-cell">
                  {c.status === "unread" ? "New" : c.status === "read" ? "Read" : "Archived"}
                </td>
                <td className="hidden px-2 py-2 text-(--ui-ink-2) sm:table-cell">
                  {relative(new Date(c.at))}
                </td>
                <td className="px-1 py-1">
                  <ItemMenu c={c} place={r.place} dialog={r.dialog} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompactRow({ c, ...r }: RowProps & { c: Card }) {
  const on = r.sel.has(c.id);
  const len = lengthOf(c);
  return (
    <li
      data-item={c.id}
      draggable
      onDragStart={(e) => r.drag(e, c)}
      onFocusCapture={() => r.onFocus(c.id)}
      className={cx(
        "group/row flex h-10 min-w-0 items-center gap-2.5 border-(--ui-hair) border-b px-1 text-[13.5px] transition-colors duration-100 hover:bg-(--ui-wash)",
        on && "bg-(--ui-accent-wash)",
        r.focusId === c.id && "shadow-[inset_3px_0_0_var(--ui-accent)]",
      )}
    >
      <PickBox
        c={c}
        on={on}
        toggle={r.toggle}
        className={cx(
          !on &&
            !r.picking &&
            "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
        )}
      />
      <span className="inline-flex w-2 justify-center">
        {c.status === "unread" ? (
          <span className="size-2 rounded-full bg-(--ui-accent)" title="New" />
        ) : null}
      </span>
      <TypeMark type={c.type} size={15} label={TYPES[c.type]?.label} />
      <a
        href={itemHref(c.id, r.params)}
        draggable={false}
        className={cx(
          "min-w-0 flex-1 truncate no-underline hover:underline",
          c.status === "unread" ? "font-semibold text-(--ui-ink)" : "text-(--ui-ink)",
        )}
      >
        {c.title}
      </a>
      <span className="hidden max-w-44 shrink-0 truncate text-[12.5px] text-(--ui-ink-2) md:inline">
        {sourceName(c)}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-[12.5px] text-(--ui-ink-2) tabular-nums sm:inline">
        {len ?? ""}
      </span>
      <span className="w-7 shrink-0 text-right">
        <ScoreBadge score={c.score} />
      </span>
      <span className="hidden w-24 shrink-0 text-right text-[12.5px] text-(--ui-ink-2) sm:inline">
        {relative(new Date(c.at))}
      </span>
      <ItemMenu c={c} place={r.place} dialog={r.dialog} />
    </li>
  );
}

function BulkBar({
  ids,
  items,
  place,
  clear,
  dialog,
}: {
  ids: number[];
  items: Card[];
  place: string;
  clear: () => void;
  dialog: (kind: "move" | "tag" | "sop") => void;
}) {
  const picked = items.filter((c) => ids.includes(c.id));
  const allLater = picked.length > 0 && picked.every((c) => c.later);
  const allStar = picked.length > 0 && picked.every((c) => c.starred);
  const btn =
    "inline-flex h-9 shrink-0 items-center gap-1.5 border-0 bg-transparent px-2.5 text-[13px] text-(--ui-on-ink) hover:bg-white/10";
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-6 flex justify-center">
      <section
        aria-label="Selected items"
        className="pointer-events-auto flex max-w-full animate-in items-center gap-0.5 overflow-x-auto bg-(--ui-ink) p-1 shadow-lg duration-200 fade-in-0 slide-in-from-bottom-2"
      >
        <span className="shrink-0 px-2.5 font-semibold text-(--ui-on-ink) text-[13px] tabular-nums">
          {ids.length} selected
        </span>
        <button type="button" className={btn} onClick={() => dialog("move")}>
          <FolderInput size={15} /> <span className="hidden sm:inline">Move to</span>
        </button>
        <button type="button" className={btn} onClick={() => dialog("tag")}>
          <Tag size={15} /> <span className="hidden sm:inline">Tag</span>
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => void markItems(ids, allLater ? "unlater" : "later")}
        >
          <Clock size={15} />{" "}
          <span className="hidden sm:inline">{allLater ? "Off later" : "Later"}</span>
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => void markItems(ids, allStar ? "unstar" : "star")}
        >
          <Star size={15} /> <span className="hidden sm:inline">{allStar ? "Unstar" : "Star"}</span>
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => void markItems(ids, place === "archived" ? "unarchive" : "archive")}
        >
          {place === "archived" ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          <span className="hidden sm:inline">{place === "archived" ? "Unarchive" : "Archive"}</span>
        </button>
        <button type="button" className={btn} onClick={() => dialog("sop")}>
          <Sparkles size={15} /> <span className="hidden sm:inline">Add to SOP</span>
        </button>
        <button
          type="button"
          className={cx(btn, "ml-1")}
          onClick={clear}
          aria-label="Clear the selection"
        >
          <X size={15} />
        </button>
      </section>
    </div>
  );
}
