/** An app in the portal: a card on the launcher, and its pages as tabs at /<app>/<page>. */
import type { Access, IconName } from "@wren/ui";
import type { ComponentType } from "react";

/**
 * What every page gets: whose list, whether it's the read-only demo, whether Wren's team is
 * looking (and not viewing as the client), and the URL's query.
 */
export interface PageProps {
  client: string;
  demo: boolean;
  team: boolean;
  params: URLSearchParams;
}

export interface ModulePage {
  /** The second path segment. */
  id: string;
  label: string;
  Page: ComponentType<PageProps>;
  /** Reached by link only, never a tab. */
  hidden?: true;
  /** Who sees it: `{ audience: "client" }` is a signed-in client's own, never on the demo. */
  requires?: Access;
}

export interface Module {
  /** The first path segment. */
  id: string;
  name: string;
  icon: IconName;
  /** One sentence on its launcher card: what it does for the client. */
  blurb: string;
  /** Its card's numbers, and what waits on the viewer. */
  Glance?: ComponentType<PageProps>;
  pages: ModulePage[];
  /**
   * Who sees it, and reaches it: `{ audience: "team" }` is Wren's team in team view only;
   * `{ audience: "client" }` a signed-in client's own, never on the demo (products alone).
   */
  requires?: Access;
  /** Reached from the client's name at top left, never a launcher card. */
  menu?: true;
  /**
   * The app for offers with none of their own: a card only under those. Any other app's card
   * sits under each bought offer that names it (the offer's `app`).
   */
  fallback?: true;
  /** The one button in its head, a page to go to. */
  action?: { page: string; label: string; icon: IconName };
}
