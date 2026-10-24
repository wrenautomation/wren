/**
 * Search: Search Console daily, the answer engines and edit proposals weekly.
 */
import { searchConsoleClient } from "@wren/channel-search";
import { makeSearchWatch, makeSearchWeek } from "@wren/channel-search/restate";
import { DESK, restateSites } from "@wren/core/content/restate";
import { type AnyService, type Deps, googleKey } from "./deps.js";

/** The search domain's services, in the order they were served from `services.ts`. */
export function searchServices(deps: Deps): AnyService[] {
  const { clientDb, db, edge, keyPath, lane, llm, log, settings } = deps;
  const searchNotify = lane(settings.discordSearchWebhookUrl);
  const services: AnyService[] = [];
  // Search: Search Console daily, the answer engines and edit proposals weekly (on the Mac's desk).
  // Bound only with a property named; off until `wren search watch start`.
  if (settings.searchSite && settings.searchOrigin) {
    const search = {
      db,
      console: searchConsoleClient(googleKey(keyPath)),
      site: settings.searchSite,
      origin: settings.searchOrigin,
      fetch: (url: string, init?: RequestInit) => fetch(url, init),
      // A client's `SearchWatch/<client>/daily` reads into its own database.
      clientDb,
      ...searchNotify,
      ...(settings.siteExportToken
        ? { siteExport: { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken } }
        : {}),
      ...(edge ? { edge } : {}),
    };
    services.push(
      makeSearchWatch(search),
      makeSearchWeek({
        ...search,
        llm,
        desk: (ctx) => restateSites(ctx, { caller: "wren:search-week", service: DESK }),
      }),
    );
  } else log.info("WREN_SEARCH_SITE/WREN_SEARCH_ORIGIN unset: no search loop");
  return services;
}
