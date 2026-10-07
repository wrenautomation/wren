import type { Need, RouteApps } from "@wren/core/access";

/**
 * SitesConsole's handlers and what each needs: the edge Worker opens only these. Every route is
 * in the Sites app; each handler then checks the page owner's access. Type imports only.
 */
export const SITES_CONSOLE_ROUTES = {
  /** The offers and templates a new page starts from. */
  offers: "read",
  detail: "read",
  create: "act",
  save: "act",
  draft: "act",
  ask: "act",
  approve: "act",
  decline: "act",
  retire: "act",
  duplicate: "act",
  add: "act",
  notes: "act",
  /** Hosted forms: an owner's list for a page's section, the builder, publish and retire. */
  forms: "read",
  formDetail: "read",
  formCreate: "act",
  formSave: "act",
  formPublish: "act",
  formUnpublish: "act",
  formRetire: "act",
  /** A client's own pages, on its host: kept to that client. */
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  /** A/B splits at the edge: start, weights, stop, and make a winner the page (To approve). */
  splitStart: "act",
  splitWeights: "act",
  splitStop: "act",
  splitShip: "act",
} as const satisfies Record<string, Need>;

export const SITES_CONSOLE_APPS = { "*": "sites" } as const satisfies RouteApps<
  typeof SITES_CONSOLE_ROUTES
>;

/** Refused on the demo and under View as. */
export const SITES_CONSOLE_WRITES: readonly (keyof typeof SITES_CONSOLE_ROUTES)[] = [
  "create",
  "save",
  "draft",
  "ask",
  "approve",
  "decline",
  "retire",
  "duplicate",
  "add",
  "notes",
  "formCreate",
  "formSave",
  "formPublish",
  "formUnpublish",
  "formRetire",
  "splitStart",
  "splitWeights",
  "splitStop",
  "splitShip",
];
