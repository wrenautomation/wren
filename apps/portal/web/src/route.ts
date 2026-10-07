/**
 * Path routes: /reactivation/people?filter=moved&person=12. The URL is the state, so back,
 * reload and shared links all land on the same screen. Links are plain <a href>; a click on one
 * inside the app moves without a reload.
 */
import { useEffect, useState } from "react";

export interface Route {
  /** "/reactivation/people" -> ["reactivation", "people"]. */
  path: string[];
  params: URLSearchParams;
}

export type Params = Record<string, string | number | null | undefined>;

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

const MOVED = "wren:route";

/** Go to `to` inside the app. `replace` swaps the current history entry instead of adding one. */
export function navigate(to: string, replace = false) {
  // The same address again (the current page's own link) adds no entry to go back through.
  if (replace || to === location.pathname + location.search + location.hash)
    history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  dispatchEvent(new Event(MOVED));
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

const read = (): Route => ({
  path: location.pathname.split("/").filter(Boolean).map(segment),
  params: new URLSearchParams(location.search),
});

/** A plain left click on a link to another screen of this app, which we handle without a reload. */
function inApp(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return null;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download")) return null;
  const to = new URL(a.href);
  if (to.origin !== location.origin) return null;
  // The Worker's own routes, like sign-out on a client's host: a real page load.
  if (/^\/(__auth|api)\//.test(to.pathname)) return null;
  // Same screen, new #fragment: the browser's own jump.
  if (to.hash && to.pathname === location.pathname && to.search === location.search) return null;
  return to.pathname + to.search + to.hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const moved = () => setRoute(read());
    const click = (e: MouseEvent) => {
      const to = inApp(e);
      if (to === null) return;
      e.preventDefault();
      navigate(to);
    };
    addEventListener("popstate", moved);
    addEventListener(MOVED, moved);
    document.addEventListener("click", click);
    return () => {
      removeEventListener("popstate", moved);
      removeEventListener(MOVED, moved);
      document.removeEventListener("click", click);
    };
  }, []);
  return route;
}
