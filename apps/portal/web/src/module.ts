/** An app in the portal: a card on the launcher, and its pages as tabs at /<app>/<page>. */
import type { IconName } from "@wren/ui";
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
  /** Wren's team only: shown and reachable only in team view. */
  team?: true;
  /** A signed-in client's own: never on the demo, which shows the products alone. */
  noDemo?: true;
  /** Reached from the client's name at top left, never a launcher card. */
  menu?: true;
  /** The offers it serves: its card sits under each one the client bought. */
  offers?: readonly string[];
  /** The plan and paperwork around any offer: its card sits under every one bought. */
  companion?: true;
  /** The one button in its head, a page to go to. */
  action?: { page: string; label: string; icon: IconName };
}
