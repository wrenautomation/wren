/**
 * Learn's frame: the rail on the left, like a drive. Places with their counts, the collections
 * tree, tags, then sources by kind. Items drop on a collection to move there, or on Watch later,
 * Starred or Archived to mark them. On a phone the rail folds into one button over the page.
 */
import { cx, say } from "@wren/ui";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Inbox,
  Library,
  Link,
  List,
  type LucideIcon,
  Search,
  Star,
} from "@wren/ui/lib/lucide";
import {
  createContext,
  type DragEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCall } from "../../load.js";
import { navigate } from "../../route.js";
import { type Collection, learn, onChanged, type Rail } from "./api.js";
import { Avatar, KIND_LABELS, KIND_TYPE, TypeMark } from "./kinds.js";
import { act, CollectionMenu, markItems, NameDialog, treeOf } from "./menus.js";

/** What a dragged card carries: its ids, or the selection's. */
export const DRAG_ITEMS = "application/x-learn-items";
const DRAG_FOLDER = "application/x-learn-collection";

const EMPTY: Rail = {
  places: { inbox: 0, all: 0, later: 0, starred: 0, saved: 0, archived: 0 },
  collections: [],
  sources: [],
  tags: [],
};

const RailCtx = createContext<{ rail: Rail; ready: boolean }>({ rail: EMPTY, ready: false });
/** The rail's data, for a page inside the frame: collections, tags, sources. */
export const useRail = () => useContext(RailCtx);

const PLACES: {
  id: keyof Rail["places"];
  label: string;
  Icon: LucideIcon;
  drop?: "later" | "star" | "archive";
}[] = [
  { id: "inbox", label: "Inbox", Icon: Inbox },
  { id: "later", label: "Watch later", Icon: Clock, drop: "later" },
  { id: "starred", label: "Starred", Icon: Star, drop: "star" },
  { id: "saved", label: "Saved by you", Icon: Link },
  { id: "all", label: "All items", Icon: List },
  { id: "archived", label: "Archived", Icon: Archive, drop: "archive" },
];

export const PLACE_LABELS: Record<string, string> = Object.fromEntries(
  PLACES.map((p) => [p.id, p.label]),
);

const idsOf = (e: DragEvent): number[] => {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(DRAG_ITEMS)) as unknown;
    return Array.isArray(ids) ? ids.map(Number).filter((n) => n > 0) : [];
  } catch {
    return [];
  }
};

const ROW =
  "group/row relative flex h-8 min-w-0 items-center gap-2 border-0 px-2 text-[13.5px] no-underline transition-colors duration-150";
const ROW_IDLE = "bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)";
const ROW_ON = "bg-(--ui-hover) font-medium text-(--ui-ink)";

function Count({ n, strong }: { n: number; strong?: boolean }) {
  if (!n) return null;
  return (
    <span
      className={cx(
        "ml-auto shrink-0 text-[12px] tabular-nums",
        strong ? "font-semibold text-(--ui-accent)" : "text-(--ui-ink-2)",
      )}
    >
      {n.toLocaleString("en-US")}
    </span>
  );
}

/** A rail row that takes dropped cards. */
function Drop({
  onItems,
  onFolder,
  className,
  children,
}: {
  onItems?: (ids: number[]) => void;
  onFolder?: (id: number) => void;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) =>
    (onItems && e.dataTransfer.types.includes(DRAG_ITEMS)) ||
    (onFolder && e.dataTransfer.types.includes(DRAG_FOLDER));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the keyboard's way is Move to (m).
    <div
      className={cx("relative", className)}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (onItems && e.dataTransfer.types.includes(DRAG_ITEMS)) {
          e.preventDefault();
          const ids = idsOf(e);
          if (ids.length) onItems(ids);
        } else if (onFolder && e.dataTransfer.types.includes(DRAG_FOLDER)) {
          e.preventDefault();
          const id = Number(e.dataTransfer.getData(DRAG_FOLDER));
          if (id) onFolder(id);
        }
      }}
    >
      {/* The ring shows on the row itself. */}
      <div
        className={cx(
          over &&
            "[&>*]:bg-(--ui-accent-wash) [&>*]:text-(--ui-ink) [&>*]:shadow-[inset_0_0_0_1.5px_var(--ui-accent)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex h-7 items-center justify-between px-2">
      <span className="font-semibold text-(--ui-ink-2) text-[11.5px] uppercase tracking-[0.06em]">
        {children}
      </span>
      {action}
    </div>
  );
}

function FolderRow({
  c,
  depth,
  hasKids,
  open,
  toggle,
  here,
}: {
  c: Collection;
  depth: number;
  hasKids: boolean;
  open: boolean;
  toggle: () => void;
  here: string;
}) {
  const on = here === `c${c.id}`;
  const pad = ["pl-1", "pl-5", "pl-9", "pl-[3.25rem]", "pl-[4.25rem]"][Math.min(depth, 4)];
  return (
    <Drop
      onItems={(ids) => void act(learn.move(ids, c.id), `Moved to ${c.name}`)}
      onFolder={(id) =>
        id === c.id
          ? undefined
          : void act(learn.collectionEdit(id, { parent: c.id }), `Moved into ${c.name}`)
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragged to nest; the keyboard's way is its menu. */}
      <div
        className={cx(ROW, pad, on ? ROW_ON : ROW_IDLE)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_FOLDER, String(c.id));
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <button
          type="button"
          aria-label={open ? `Fold ${c.name}` : `Unfold ${c.name}`}
          onClick={toggle}
          className={cx(
            "inline-flex size-4 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-(--ui-ink-2)",
            !hasKids && "invisible",
          )}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <a
          href={`/learn/items?in=c${c.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
        >
          {on || open ? (
            <FolderOpen size={15} className="shrink-0" />
          ) : (
            <Folder size={15} className="shrink-0" />
          )}
          <span className="truncate">{c.name}</span>
        </a>
        <span className="group-hover/row:hidden group-focus-within/row:hidden">
          <Count n={c.n} />
        </span>
        <CollectionMenu
          c={c}
          className="hidden group-hover/row:inline-flex group-focus-within/row:inline-flex"
        />
      </div>
    </Drop>
  );
}

function Folders({ rail, here }: { rail: Rail; here: string }) {
  const tree = useMemo(() => treeOf(rail.collections), [rail.collections]);
  const [shut, setShut] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const hidden = new Set<number>();
  for (const c of tree)
    if (
      (c.parentId !== null && hidden.has(c.parentId)) ||
      (c.parentId !== null && shut.has(c.parentId))
    )
      hidden.add(c.id);
  return (
    <>
      <Heading
        action={
          <button
            type="button"
            aria-label="New collection"
            title="New collection"
            onClick={() => setAdding(true)}
            className="inline-flex size-6 items-center justify-center border-0 bg-transparent p-0 text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
          >
            <FolderPlus size={15} />
          </button>
        }
      >
        Collections
      </Heading>
      <Drop
        onFolder={(id) => void act(learn.collectionEdit(id, { parent: null }), "Moved to the top")}
      >
        <div>
          {tree.map((c) =>
            hidden.has(c.id) ? null : (
              <FolderRow
                key={c.id}
                c={c}
                depth={c.depth}
                here={here}
                hasKids={tree.some((x) => x.parentId === c.id)}
                open={!shut.has(c.id) && tree.some((x) => x.parentId === c.id)}
                toggle={() => {
                  const next = new Set(shut);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  setShut(next);
                }}
              />
            ),
          )}
          {!tree.length ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mx-2 mt-1 w-[calc(100%-1rem)] border border-(--ui-hair) border-dashed bg-transparent px-3 py-2.5 text-left text-[12.5px] text-(--ui-ink-2) leading-snug hover:border-(--ui-ink-3) hover:text-(--ui-ink)"
            >
              Make a collection, then drag items onto it. Collections nest like folders.
            </button>
          ) : null}
        </div>
      </Drop>
      {adding ? (
        <NameDialog
          title="New collection"
          action="Create"
          onSave={(name) =>
            learn.collectionAdd(name, null).then((made) => navigate(`/learn/items?in=c${made.id}`))
          }
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

function Sources({ rail, here }: { rail: Rail; here: string }) {
  const [shut, setShut] = useState<Set<string>>(new Set());
  return (
    <>
      <Heading
        action={
          <a
            href="/learn/sources"
            className={cx(
              "text-[12px] no-underline",
              here === "sources" ? "text-(--ui-ink)" : "text-(--ui-ink-2) hover:text-(--ui-ink)",
            )}
          >
            Manage
          </a>
        }
      >
        Sources
      </Heading>
      {!rail.sources.length ? (
        <a
          href="/learn/sources"
          className="mx-2 mt-1 block border border-(--ui-hair) border-dashed px-3 py-2.5 text-[12.5px] text-(--ui-ink-2) leading-snug no-underline hover:border-(--ui-ink-3) hover:text-(--ui-ink)"
        >
          Follow a YouTube channel, podcast, newsletter or blog. New posts land in your Inbox.
        </a>
      ) : null}
      {rail.sources.map((g) => {
        const open = !shut.has(g.kind);
        const fresh = g.sources.reduce((n, s) => n + s.fresh, 0);
        return (
          <div key={g.kind}>
            <button
              type="button"
              onClick={() => {
                const next = new Set(shut);
                if (open) next.add(g.kind);
                else next.delete(g.kind);
                setShut(next);
              }}
              aria-expanded={open}
              className={cx(ROW, ROW_IDLE, "w-full pl-1")}
            >
              <span className="inline-flex size-4 items-center justify-center">
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
              <TypeMark type={KIND_TYPE[g.kind]} size={14} />
              <span className="truncate">{KIND_LABELS[g.kind]}</span>
              <Count n={open ? 0 : fresh} />
            </button>
            {open
              ? g.sources.map((s) => (
                  <a
                    key={s.id}
                    href={`/learn/items?in=s${s.id}`}
                    title={
                      s.failure
                        ? `Last read failed: ${s.failure}`
                        : s.stopped
                          ? "Not followed now"
                          : s.name
                    }
                    className={cx(
                      ROW,
                      "pl-7",
                      here === `s${s.id}` ? ROW_ON : ROW_IDLE,
                      s.stopped && "opacity-60",
                    )}
                  >
                    <Avatar url={s.avatar} name={s.name} size={16} />
                    <span className="truncate">{s.name}</span>
                    {s.failure ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-(--ui-bad)">
                        <span className="sr-only">Failing</span>
                      </span>
                    ) : null}
                    <Count n={s.fresh} />
                  </a>
                ))
              : null}
          </div>
        );
      })}
    </>
  );
}

function RailBody({ here }: { here: string }) {
  const { rail } = useRail();
  return (
    <nav aria-label="Learn" className="flex flex-col pb-8">
      <a href="/learn/overview" className={cx(ROW, here === "home" ? ROW_ON : ROW_IDLE)}>
        <Library size={15} className="shrink-0" />
        Home
      </a>
      <a href="/learn/search" className={cx(ROW, here === "search" ? ROW_ON : ROW_IDLE)}>
        <Search size={15} className="shrink-0" />
        Search
      </a>
      {PLACES.map((p) => {
        const row = (
          <a
            key={p.id}
            href={p.id === "inbox" ? "/learn/items" : `/learn/items?in=${p.id}`}
            className={cx(ROW, here === p.id ? ROW_ON : ROW_IDLE)}
          >
            <p.Icon size={15} className="shrink-0" />
            {p.label}
            <Count n={rail.places[p.id]} strong={p.id === "inbox"} />
          </a>
        );
        const drop = p.drop;
        return drop ? (
          <Drop key={p.id} onItems={(ids) => void markItems(ids, drop)}>
            {row}
          </Drop>
        ) : (
          <div key={p.id}>{row}</div>
        );
      })}
      <Folders rail={rail} here={here} />
      {rail.tags.length ? (
        <>
          <Heading>Tags</Heading>
          <div className="flex flex-wrap gap-1 px-2">
            {rail.tags.slice(0, 24).map((t) => (
              <a
                key={t.tag}
                href={`/learn/items?in=all&tag=${encodeURIComponent(t.tag)}`}
                className={cx(
                  "inline-flex h-6 items-center gap-0.5 px-1.5 text-[12px] no-underline",
                  here === `tag:${t.tag}`
                    ? "bg-(--ui-ink) text-(--ui-on-ink)"
                    : "bg-(--ui-tile) text-(--ui-ink-2) hover:text-(--ui-ink)",
                )}
              >
                <Hash size={11} />
                {t.tag}
              </a>
            ))}
          </div>
        </>
      ) : null}
      <Sources rail={rail} here={here} />
    </nav>
  );
}

/** The rail beside a page. `here` names the row that's lit: a place, `c<id>`, `s<id>`, `home`. */
export function LearnFrame({ here, children }: { here: string; children: ReactNode }) {
  const load = useCall("learn.rail", learn.rail);
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  useEffect(() => {
    if (load.error && !load.data) say.failed(load.error);
  }, [load.error, load.data]);
  const [open, setOpen] = useState(false);
  const rail = load.data ?? EMPTY;
  const label =
    here === "home"
      ? "Home"
      : here === "sources"
        ? "Sources"
        : here === "search"
          ? "Search"
          : (PLACE_LABELS[here] ??
            rail.collections.find((c) => `c${c.id}` === here)?.name ??
            rail.sources.flatMap((g) => g.sources).find((s) => `s${s.id}` === here)?.name ??
            "Browse");
  return (
    <RailCtx.Provider value={{ rail, ready: !!load.data }}>
      <div className="flex min-w-0 gap-8">
        <aside className="hidden w-60 shrink-0 min-[901px]:block">
          <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain pr-1">
            <RailBody here={here} />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-4 min-[901px]:hidden">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="flex h-10 w-full items-center gap-2 border border-(--ui-hair) bg-(--ui-paper) px-3 text-[14px] text-(--ui-ink)"
            >
              <Library size={16} className="text-(--ui-ink-2)" />
              <span className="font-medium">{label}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[13px] text-(--ui-ink-2)">
                {rail.places.inbox ? `${rail.places.inbox} new in Inbox` : "Browse"}
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </span>
            </button>
            {open ? (
              <div
                className="mt-1 border border-(--ui-hair) bg-(--ui-paper) p-1"
                onClickCapture={(e) => {
                  if ((e.target as Element).closest("a")) setOpen(false);
                }}
              >
                <RailBody here={here} />
              </div>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </RailCtx.Provider>
  );
}
