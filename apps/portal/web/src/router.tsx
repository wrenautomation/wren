/**
 * The portal's routes on TanStack Router (designs/2026-10-16-portal-libs.md, "Router"). Code
 * routes, not file routes: the shell (`App`) already picks the page from the modules a login
 * holds, so the routes only check the address and read ahead.
 *
 *   /                      Today, or the one app's first page
 *   /$app                  the app's first page (App picks it from what the login holds)
 *   /$app/$page            a page; its search is typed (`LIST_SEARCH`) and its rows read ahead
 *   /$app/$page/$          a record's own page, or a page's deeper place
 *
 * The address keeps its plain shape (`?status=open&sort=-at`), not the router's JSON one, so
 * every link, saved view and mail link from before still opens. An old page's address
 * (`ListPage.legacy`) and a page that moved apps (`./moved.ts`) redirect to the new one before
 * anything draws.
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { LIST_SEARCH, paramsOf, searchOf } from "@wren/ui";
import { useEffect } from "react";
import { App } from "./App.js";
import { call, type Me } from "./api.js";
import { readCall } from "./load.js";
import { MODULES } from "./modules/index.js";
import { movedTo } from "./moved.js";
import { prefetchPage } from "./records.js";
import { bindRouter, href, navigate, workspace } from "./route.js";

/** A plain left click on a link to another screen of this app, which the router handles. */
export function inApp(e: MouseEvent, here: Location = location): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return null;
  return linkIn(e.target, here);
}

/** The in-app address of the link `target` sits in, if it is one the router takes. */
function linkIn(target: EventTarget | null, here: Location = location): string | null {
  const a = target instanceof Element ? target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download")) return null;
  const to = new URL(a.href);
  if (to.origin !== here.origin) return null;
  // The Worker's own routes, like sign-out on a client's host: a real page load.
  if (/^\/(__auth|api)\//.test(to.pathname)) return null;
  // Same screen, new #fragment: the browser's own jump.
  if (to.hash && to.pathname === here.pathname && to.search === here.search) return null;
  return to.pathname + to.search + to.hash;
}

/**
 * The shell, with plain <a href> links handed to the router. Pages draw links as anchors (the
 * kit is router-agnostic), so one listener takes the click, and a hover reads the page ahead.
 */
function Shell() {
  const router = useRouter();
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const to = inApp(e);
      if (to === null) return;
      e.preventDefault();
      // `navigate` keeps where each entry came from, for the phone's back.
      navigate(to);
    };
    let hovered: string | null = null;
    const hover = (e: Event) => {
      const to = linkIn(e.target);
      if (to === null || to === hovered) return;
      hovered = to;
      // An address, not a typed route: the router reads `href` as it does for `navigate`.
      void router.preloadRoute({ href: to } as never).catch(() => {});
    };
    document.addEventListener("click", click);
    document.addEventListener("pointerover", hover, { passive: true });
    document.addEventListener("focusin", hover);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("pointerover", hover);
      document.removeEventListener("focusin", hover);
    };
  }, [router]);
  return <App />;
}

const root = createRootRoute({
  component: Shell,
  // The keys every list reads, typed; a bad value drops, the rest pass through as they are.
  validateSearch: LIST_SEARCH,
  // Who's signed in, read under the same key `App` reads it by: no second cache.
  loader: () => {
    void readCall("me", () => call<Me>("delivery/me")).catch(() => {});
  },
});

const home = createRoute({ getParentRoute: () => root, path: "/" });
const app = createRoute({ getParentRoute: () => root, path: "$app" });

/** The page `/$app/$page` names, in any module of that id (a client's or Wren's Marketing). */
const pageOf = (appId: string, pageId: string) => {
  for (const m of MODULES) {
    if (m.id !== appId) continue;
    const page = m.pages.find((p) => p.id === pageId);
    if (page) return page;
  }
  return null;
};

const page = createRoute({
  getParentRoute: () => app,
  path: "$page",
  beforeLoad: ({ params, location }) => {
    const moved = movedTo(location.href);
    if (moved) throw redirect({ href: moved, replace: true });
    const found = pageOf(params.app, params.page);
    if (!found || !("legacy" in found) || !found.legacy) return;
    const search = paramsOf(location.search as Record<string, unknown>);
    const change = found.legacy(search);
    if (!change) return;
    const path = location.pathname;
    throw redirect({ href: href(path, change, search), replace: true });
  },
  loaderDeps: ({ search }) => ({ search }),
  // The page's rows, read ahead into the data layer under the key its list reads them by.
  loader: ({ params, deps }) => {
    const here = workspace();
    const found = pageOf(params.app, params.page);
    if (!here || here.demo || !found) return;
    const path = `/${params.app}/${params.page}`;
    void prefetchPage(found, path, here.id, here.team, paramsOf(deps.search));
  },
});
const deeper = createRoute({ getParentRoute: () => page, path: "$" });

const tree = root.addChildren([home, app.addChildren([page.addChildren([deeper])])]);

export const router = createRouter({
  routeTree: tree,
  parseSearch: (s) => searchOf(new URLSearchParams(s)),
  stringifySearch: (search) => {
    const s = paramsOf(search).toString();
    return s ? `?${s}` : "";
  },
  // The page keeps its scroll on a move and the browser restores it on back, as before.
  scrollRestoration: () => false,
  // The data layer decides when a read is old; a hover reads ahead every time it asks.
  defaultPreloadStaleTime: 0,
  // Nothing waits on a loader: they only read ahead.
  defaultPendingMs: Number.POSITIVE_INFINITY,
});
bindRouter(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function PortalRouter() {
  return <RouterProvider router={router} />;
}
