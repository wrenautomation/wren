/** Explorer's addresses: a page per root (`/explorer/<root>`), the route in `?at=`, the view in `?view=`. */
import { rootOf } from "@wren/core/paths";
import { EXPLORER_VIEWS, type ExplorerView } from "@wren/ui";
import { href } from "../../route.js";

export const viewOf = (v: string | null): ExplorerView =>
  EXPLORER_VIEWS.includes(v as ExplorerView) ? (v as ExplorerView) : "columns";

/** A route's address: its root's page; the root itself and Columns are the page's own. */
export const explorerHref = (route: string, view: ExplorerView = "columns") => {
  const root = rootOf(route);
  return href(`/explorer/${root}`, {
    at: route === root ? null : route,
    view: view === "columns" ? null : view,
  });
};
