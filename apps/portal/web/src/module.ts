/** A product in the portal: a sidebar group of pages, each at /<product>/<page>. */
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
  icon: IconName;
  Page: ComponentType<PageProps>;
}

export interface Module {
  /** The first path segment. */
  id: string;
  name: string;
  pages: ModulePage[];
  /** Wren's team only: shown and reachable only in team view. */
  team?: true;
  /** The one button in the header while on this product: a page to go to. */
  action?: { page: string; label: string; icon: IconName };
}
