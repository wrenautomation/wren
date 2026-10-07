/**
 * Learn's calls and shapes, as LearnConsole answers them (packages/learn/src/drive.ts). A write
 * says so on the window, so every list, rail and shelf on screen loads again.
 */
import { call } from "../../api.js";

export type ItemType =
  | "youtube"
  | "shorts"
  | "podcast"
  | "newsletter"
  | "blog"
  | "reddit"
  | "x"
  | "instagram"
  | "tiktok"
  | "releases"
  | "link";
export type SourceKind =
  | "youtube"
  | "podcast"
  | "newsletter"
  | "blog"
  | "reddit"
  | "forum"
  | "releases";
export type Sort = "newest" | "score" | "length" | "source" | "title";
export type Mark =
  | "star"
  | "unstar"
  | "pin"
  | "unpin"
  | "later"
  | "unlater"
  | "archive"
  | "unarchive"
  | "read"
  | "unread";

export interface SourceLine {
  id: number;
  name: string;
  kind: SourceKind;
  avatar: string | null;
}

export interface Card {
  id: number;
  title: string;
  type: ItemType;
  url: string;
  thumbnail: string | null;
  duration: number | null;
  chars: number;
  source: SourceLine | null;
  creator: string | null;
  score: number | null;
  summary: string | null;
  status: "unread" | "read" | "archived";
  state: "reading" | "failed" | "mac" | "scoring" | "ready";
  starred: boolean;
  pinned: boolean;
  later: boolean;
  position: number | null;
  collectionId: number | null;
  tags: string[];
  saved: boolean;
  at: string;
}

export interface Browsed {
  place: string;
  sort: Sort;
  items: Card[];
  more: boolean;
  total: number;
  types: Partial<Record<ItemType, number>>;
  sources: (SourceLine & { n: number })[];
}

export interface Collection {
  id: number;
  name: string;
  parentId: number | null;
  n: number;
}

export interface Rail {
  places: Record<"inbox" | "all" | "later" | "starred" | "saved" | "archived", number>;
  collections: Collection[];
  sources: {
    kind: SourceKind;
    sources: (SourceLine & { stopped: boolean; failure: string | null; fresh: number })[];
  }[];
  tags: { tag: string; n: number }[];
}

export interface Home {
  shelves: { type: ItemType; total: number; items: Card[] }[];
  continue: Card[];
  top: Card[];
  sops: {
    id: number;
    sop: string;
    state: "asked" | "added" | "failed";
    error: string | null;
    itemId: number;
    title: string;
    type: ItemType;
    at: string;
  }[];
}

export interface Moment {
  t: number;
  label: string;
}

export interface SopAsk {
  sop: string;
  state: "asked" | "added" | "failed";
  file: string | null;
  error: string | null;
}

export interface ItemPage extends Card {
  text: string;
  transcript: string | null;
  file: string | null;
  mediaUrl: string | null;
  moments: Moment[];
  why: string | null;
  changes: string[];
  verdict: "show" | "hold" | "drop" | null;
  failure: string | null;
  kind: "article" | "video" | "reel" | "episode";
  collection: { id: number; name: string } | null;
  sops: SopAsk[];
}

export interface SourceRow extends SourceLine {
  url: string;
  page: string | null;
  tell: "every" | "top" | "digest";
  failure: string | null;
  stopped: boolean;
  fetchedAt: string | null;
  items: number;
  fresh: number;
  top: number | null;
  last: string | null;
}

export interface BrowseAsk {
  place: string;
  types: string[];
  sources: string[];
  tag: string;
  q: string;
  sort: string;
  limit: number;
}

const CHANGED = "learn:changed";
/** Something changed: lists, the rail and shelves load again. */
export const changed = () => dispatchEvent(new Event(CHANGED));
/** Run `fn` on every change; returns the stop. */
export function onChanged(fn: () => void): () => void {
  addEventListener(CHANGED, fn);
  return () => removeEventListener(CHANGED, fn);
}

const write = async <T>(route: string, body: Record<string, unknown>): Promise<T> => {
  const out = await call<T>(`learn/${route}`, body);
  changed();
  return out;
};

export const learn = {
  browse: (a: BrowseAsk) =>
    call<Browsed>("learn/browse", {
      place: a.place,
      types: a.types,
      sources: a.sources,
      tag: a.tag || null,
      q: a.q || null,
      sort: a.sort,
      limit: a.limit,
    }),
  rail: () => call<Rail>("learn/rail", {}),
  home: () => call<Home>("learn/home", {}),
  item: (id: string) => call<ItemPage>("learn/item", { id }),
  sources: () => call<{ kinds: { kind: SourceKind; sources: SourceRow[] }[] }>("learn/sources", {}),
  mark: (ids: number[], mark: Mark) =>
    write<{ done: string[] }>("mark", { ids: ids.map(String), mark }),
  /** Opened: not new. Quiet: no reload, the page is already showing it. */
  open: (id: number) => call("learn/open", { id: String(id) }),
  progress: (id: number, position: number, duration: number | null) =>
    call("learn/progress", { id: String(id), position, duration }),
  move: (ids: number[], collection: number | null) =>
    write("move", {
      ids: ids.map(String),
      collection: collection === null ? null : String(collection),
    }),
  tag: (ids: number[], add: string[], remove: string[] = []) =>
    write("tag", { ids: ids.map(String), add, remove }),
  toSop: (ids: number[], sop: string) => write("toSop", { ids: ids.map(String), sop }),
  readAgain: (ids: number[]) => write("readAgain", { ids: ids.map(String) }),
  collectionAdd: (name: string, parent: number | null) =>
    write<{ id: string; name: string }>("collectionAdd", {
      name,
      parent: parent === null ? null : String(parent),
    }),
  collectionEdit: (id: number, p: { name?: string; parent?: number | null }) =>
    write("collectionEdit", {
      id: String(id),
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.parent !== undefined ? { parent: p.parent === null ? "" : String(p.parent) } : {}),
    }),
  collectionDrop: (id: number) => write("collectionDrop", { id: String(id) }),
  follow: (url: string, tell: string) =>
    write<{ id: string; name: string; kind: SourceKind; items: number }>("follow", { url, tell }),
  tell: (id: number, tell: string) => write("tell", { ids: [String(id)], tell }),
  unfollow: (id: number) => write("unfollow", { ids: [String(id)] }),
};
