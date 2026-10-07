/**
 * Sites: every page we run, in one place (designs/2026-10-07-sites.md). Offer landers and
 * listicles as data, rendered at the edge from a template; code pages built in a repo and
 * registered by URL; one tracker and one form into the door for both.
 */

export { makeSitesConsole, pageApprovalId, parsePageApprovalId, sitesApi } from "./console.js";
export * from "./model.js";
export { SITES_RECORDS } from "./records.js";
export { makeSites, SITES, sitesPublicApi } from "./service.js";
