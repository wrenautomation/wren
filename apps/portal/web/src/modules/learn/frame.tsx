/**
 * Learn's places and collections, as tabs in the portal's sidebar like every app's pages: Items
 * (Inbox, Watch later, Starred, Saved by you, All items, Archived), the collections tree, then
 * tags. Cards dropped on a collection move there; on Watch later, Starred or Archived, they're
 * marked. Sources have their own page. Each Learn page sits in `LearnFrame`, which holds the
 * rail's data for it: collections, tags, sources.
 */
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { useCall } from "../../load.js";
import type { ModuleNav } from "../../module.js";
import { inWorkspace, keyOf, learn, type Mark, onChanged, type Rail, unseenCount } from "./api.js";
import { act, markItems, treeOf } from "./menus.js";

/** What a dragged card carries: its ids, or the selection's. */
export const DRAG_ITEMS = "application/x-learn-items";

const EMPTY: Rail = {
  places: { inbox: 0, all: 0, later: 0, starred: 0, saved: 0, archived: 0 },
  collections: [],
  sources: [],
  tags: [],
};

const RailCtx = createContext<{ rail: Rail; ready: boolean }>({ rail: EMPTY, ready: false });
/** The rail's data, for a page inside the frame: collections, tags, sources. */
export const useRail = () => useContext(RailCtx);

const PLACES: { id: keyof Rail["places"]; label: string; drop?: Mark }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "later", label: "Watch later", drop: "later" },
  { id: "starred", label: "Starred", drop: "star" },
  { id: "saved", label: "Saved by you" },
  { id: "all", label: "All items" },
  { id: "archived", label: "Archived", drop: "archive" },
];

export const PLACE_LABELS: Record<string, string> = Object.fromEntries(
  PLACES.map((p) => [p.id, p.label]),
);

/** The ids a drop carries. */
const idsOf = (data: string): number[] => {
  try {
    const ids = JSON.parse(data) as unknown;
    return Array.isArray(ids) ? ids.map(Number).filter((n) => n > 0) : [];
  } catch {
    return [];
  }
};

/** Tags shown in the sidebar, most used first; the rest are a search away. */
const TAGS_SHOWN = 12;

/** Learn's tabs from its data, after Search: places, collections, tags. */
export const learnNav: ModuleNav = {
  after: "search",
  changed: onChanged,
  here: (path, params) => {
    if (path[1] !== "items") return null;
    const place = params.get("in") || "inbox";
    const tag = params.get("tag");
    if (tag && place === "all") return `tag:${tag}`;
    // A source's items: it's reached from Sources.
    if (/^s\d+$/.test(place)) return "sources";
    return `in:${place}`;
  },
  load: async (client) => {
    inWorkspace(client);
    const [rail, unseen] = await Promise.all([learn.rail(), unseenCount(client).catch(() => 0)]);
    return [
      ...PLACES.map((p) => {
        const mark = p.drop;
        return {
          id: `in:${p.id}`,
          label: p.label,
          href: p.id === "inbox" ? "/learn/items" : `/learn/items?in=${p.id}`,
          group: "Items",
          // New from sources since you last looked: what waits on you.
          ...(p.id === "inbox" && unseen ? { count: unseen } : {}),
          ...(mark
            ? {
                drop: {
                  type: DRAG_ITEMS,
                  onDrop: (data: string) => void markItems(idsOf(data), mark),
                },
              }
            : {}),
        };
      }),
      ...treeOf(rail.collections).map((c) => ({
        id: `in:c${c.id}`,
        label: c.name,
        href: `/learn/items?in=c${c.id}`,
        group: "Collections",
        depth: c.depth,
        drop: {
          type: DRAG_ITEMS,
          onDrop: (data: string) => {
            const ids = idsOf(data);
            if (ids.length) void act(learn.move(ids, c.id), `Moved to ${c.name}`);
          },
        },
      })),
      ...rail.tags.slice(0, TAGS_SHOWN).map((t) => ({
        id: `tag:${t.tag}`,
        label: `#${t.tag}`,
        href: `/learn/items?in=all&tag=${encodeURIComponent(t.tag)}`,
        group: "Tags",
      })),
    ];
  },
};

/** A Learn page, with the rail's data loaded for it. */
export function LearnFrame({ children }: { children: ReactNode }) {
  const load = useCall(keyOf("learn.rail"), learn.rail);
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  return (
    <RailCtx.Provider value={{ rail: load.data ?? EMPTY, ready: !!load.data }}>
      {children}
    </RailCtx.Provider>
  );
}
