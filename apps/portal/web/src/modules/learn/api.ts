/**
 * Learn's calls and shapes, as LearnConsole answers them (packages/learn/src/drive.ts). A write
 * says so on the window, so every list, rail and shelf on screen loads again. Every call is in
 * the workspace on screen: Wren's names no client, a client's names its own.
 */
import { call as post } from "../../api.js";
import { WREN } from "../../module.js";

/** The workspace on screen: each page sets it from its props before it loads anything. */
let workspace: string = WREN.id;
export const inWorkspace = (client: string) => {
  workspace = client;
};
/** A client's workspace, or null for Wren's own. */
export const clientOf = (): string | null => (workspace === WREN.id ? null : workspace);
/** A cache key in this workspace. */
export const keyOf = (k: string) => `${workspace}:${k}`;
/** Seen once per item: a client's pictures each need their own grant (./kinds.tsx). */
let mediaFor: (ids: number[]) => void = () => {};
export const onItems = (fn: (ids: number[]) => void) => {
  mediaFor = fn;
};
/** A call in the workspace on screen. */
export const call = <T>(route: string, body: Record<string, unknown>): Promise<T> => {
  const client = clientOf();
  return post<T>(route, client ? { client, ...body } : body);
};
/** Ask for the pictures of what came back, then hand it on. */
const withMedia =
  <T>(ids: (v: T) => number[]) =>
  (v: T) => {
    mediaFor(ids(v));
    return v;
  };

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

/** What a person hears of a source: every post, score 8 and up, or nothing (Today still lists it). */
export type AlertPick = "every" | "top" | "off";

export interface SourceRow extends SourceLine {
  url: string;
  page: string | null;
  tell: "every" | "top" | "digest";
  /** Your own pick here. */
  alert: AlertPick | null;
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

export interface BellLine {
  id: number;
  itemId: number;
  title: string;
  type: ItemType;
  source: string;
  score: number | null;
  line: string | null;
  why: "new" | "score" | "saved";
  at: string;
  seen: boolean;
}
export interface Bell {
  unseen: number;
  alerts: BellLine[];
}

export interface TodayLine {
  id: number;
  title: string;
  type: ItemType;
  url: string;
  source: string;
  score: number | null;
  line: string | null;
  told: "bell" | "digest" | null;
  read: boolean;
  at: string;
}
export interface Today {
  since: string;
  total: number;
  held: number;
  items: TodayLine[];
}

export interface AlertSettings {
  saved: AlertPick;
  perHour: number;
  mail: { on: boolean; may: boolean; to: string };
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

/** The last "I looked" sent: the badge's count waits for it, so it never counts what was just seen. */
let seeing: Promise<unknown> = Promise.resolve();

/** You looked at Items: the badge counts from now. */
export function markSeen() {
  seeing = call("learn/seen", {}).catch(() => undefined);
}

/** Learn's badge: new from sources since you last looked at Items, in `client`'s workspace. */
export async function unseenCount(client: string): Promise<number> {
  await seeing;
  return (await post<{ n: number }>("learn/unseen", client === WREN.id ? {} : { client })).n;
}

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
    }).then(withMedia((b) => b.items.map((c) => c.id))),
  rail: () => call<Rail>("learn/rail", {}),
  home: () =>
    call<Home>("learn/home", {}).then(
      withMedia((h) => [
        ...h.shelves.flatMap((s) => s.items.map((c) => c.id)),
        ...h.continue.map((c) => c.id),
        ...h.top.map((c) => c.id),
      ]),
    ),
  item: (id: string) => call<ItemPage>("learn/item", { id }).then(withMedia((i) => [i.id])),
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
  today: () => call<Today>("learn/today", {}),
  alerts: () => call<AlertSettings>("learn/alerts", {}),
  /** Your pick for a source, or `saved` for links you save. */
  pick: (source: number | "saved", pick: AlertPick) =>
    write("alertPick", { source: String(source), pick }),
  digestMail: (on: boolean) => write<{ on: boolean }>("digestMail", { on }),
};

/** The bell in `client`'s workspace, named outright: the shell draws it outside any Learn page. */
const at = (client: string) => (client === WREN.id ? {} : { client });
export const bell = {
  read: (client: string) => post<Bell>("learn/bell", at(client)),
  seen: (client: string) => post<{ n: number }>("learn/bellSeen", at(client)),
};
