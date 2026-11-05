/**
 * Site numbers: the lander's export rolled up daily (`SiteRollup`). Left stopped until the
 * experiments phase. SearchWatch and SearchWeek went 11-04 (WA-1067).
 */

import { makeSiteRollup } from "@wren/starling-search/restate";
import type { AnyService, Deps } from "./deps.js";

export function searchServices(deps: Deps): AnyService[] {
  const { db, edge, settings } = deps;
  return [
    makeSiteRollup({
      db,
      fetch: (url: string, init?: RequestInit) => fetch(url, init),
      siteExport: settings.siteExportToken
        ? { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken }
        : undefined,
      edge: edge ?? undefined,
    }),
  ];
}
