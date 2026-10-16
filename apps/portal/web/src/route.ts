/**
 * The portal's address, on TanStack Router (designs/2026-10-16-portal-libs.md, "Router"): the
 * router (`./router.tsx`) owns history, back and forward, typed search and the redirects. This
 * file is the few calls pages use: `href` builds a link, `navigate` and `go` move, `useRoute`
 * reads where we are. Links are plain <a href>; `./router.tsx` hands a click on one to the router.
 */
import { type AnyRouter, useLocation, useSearch } from "@tanstack/react-router";
import { paramsOf } from "@wren/ui";
import { useMemo } from "react";

export interface Route {
  /** "/reactivation/people" -> ["reactivation", "people"]. */
  path: string[];
  params: URLSearchParams;
}

export type Params = Record<string, string | number | null | undefined>;

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The address this entry was opened from: a phone's back steps back to it. */
    from?: string;
  }
}

/**
 * A link to `path` with `params`, on top of `keep` when given. Empty values are dropped, so
 * defaults keep URLs short, and an empty param removes the kept one.
 */
export function href(path: string, params: Params = {}, keep?: URLSearchParams): string {
  const q = new URLSearchParams([...(keep ?? [])].filter(([, v]) => v !== ""));
  for (const [k, v] of Object.entries(params))
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, String(v));
  const s = q.toString();
  return `${path}${s ? `?${s}` : ""}`;
}

/** The workspace on screen, as the shell last drew it: what a route's loader reads ahead for. */
export interface Workspace {
  /** The client's id, or Wren's. */
  id: string;
  team: boolean;
  demo: boolean;
}
let HERE: Workspace | null = null;
/** The shell says which workspace is on screen; null until it knows. */
export function setWorkspace(w: Workspace | null) {
  HERE = w;
}
export const workspace = (): Workspace | null => HERE;

let ROUTER: AnyRouter | null = null;
/** The router `navigate` moves; `./router.tsx` binds it once made. */
export function bindRouter(router: AnyRouter | null) {
  ROUTER = router;
}

/** Go to `to` inside the app. `replace` swaps the current history entry instead of adding one. */
export function navigate(to: string, replace = false) {
  const here = location.pathname + location.search + location.hash;
  // The same address again (the current page's own link) adds no entry to go back through. Each
  // entry keeps where it came from, so a phone's back button can step back through history.
  const same = replace || to === here;
  const from = same ? (history.state as { from?: string } | null)?.from : here;
  if (!ROUTER) {
    location.assign(to);
    return;
  }
  void ROUTER.navigate({
    href: to,
    replace: same,
    state: from === undefined ? {} : { from },
    // The page keeps its scroll: opening a row is a param, not a new page. The phone shell keeps
    // each page's own place (`useScrollKeep`).
    resetScroll: false,
  });
}

/** Change some params of `path`, keeping the rest of `keep`. */
export function go(path: string, params: Params, keep?: URLSearchParams) {
  navigate(href(path, params, keep));
}

/** A segment as its id: a record's page link encodes it, so an id may hold a slash. */
const segment = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Where we are: the path's segments and the search the router checked, as params. */
export function useRoute(): Route {
  // The address as written, not the router's decoded path: an id's encoded slash stays in its
  // segment.
  const pathname = useLocation({ select: (l) => l.publicHref.split(/[?#]/)[0] ?? "/" });
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const key = JSON.stringify(search);
  // One params object per address: effects that watch it run on a move, not on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is `search` by value.
  const params = useMemo(() => paramsOf(search), [key]);
  const path = useMemo(() => pathname.split("/").filter(Boolean).map(segment), [pathname]);
  return useMemo(() => ({ path, params }), [path, params]);
}
