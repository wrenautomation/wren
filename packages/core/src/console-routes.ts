import type { Need, RouteApps } from "./access.js";

/**
 * ConsolePortal's handlers (`console.ts`) and what each needs. With no `client` the need is
 * checked at Wren's own apps. Installs need `manage`, which only an admin holds on the team
 * (pricing is William's). Type imports only, so the edge Worker bundles it alone.
 */
export const CONSOLE_ROUTES = {
  view: "wren:read",
  loops: "wren:read",
  setLoop: "wren:run",
  // The team's records at Wren; a client's catalog (console.component) at that client.
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  // A record's edits (`edits.ts`): the handler checks `run` at Wren, or `act` on that row.
  recordsEdit: "wren:act",
  recordsUndo: "wren:act",
  recordsAsk: "wren:act",
  // A viewer's own saved views and prefs, where they look; sharing a view checks `manage`.
  savedViews: "read",
  saveView: "read",
  removeView: "read",
  moveViews: "read",
  prefs: "read",
  setPref: "read",
  // The Library's snippets: the team reads them anywhere it drafts, changes them at Wren.
  snippets: "read",
  snippetAdd: "wren:run",
  snippetRemove: "wren:run",
  // Flags: the team at Wren, a release decision (the handler checks `manage`).
  flagAdd: "wren:run",
  flagRemove: "wren:run",
  // Experiments: Start and Ship put a variant live on the site (the handler checks `manage`).
  experimentAdd: "wren:run",
  experimentStart: "wren:run",
  experimentShip: "wren:run",
  experimentStop: "wren:run",
  experimentRemove: "wren:run",
  addClient: "wren:manage",
  // Any handler needs `run` over all of Wren, or `act` on the row its record type declares the
  // call for (`callOn`). A handler with an effect needs `effect` too.
  call: "wren:act",
  setLook: "manage",
  install: "manage",
  configure: "manage",
  uninstall: "manage",
  ask: "manage",
  // A workflow's wiring, saved for Wren or a client from the canvas: the team's.
  workflowSave: "wren:manage",
  // A failed spine step, run again: it may send, so it needs what an effect does.
  retryEvent: "wren:effect",
  // A held unit runs again, a paused source resumes.
  releaseHold: "wren:run",
  // Ask: a question to Claude Code on William's Mac, read only (`ask.ts`).
  question: "wren:run",
  // The Team page: an admin's.
  teamSet: "wren:team",
  teamRemove: "wren:team",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`); null where the handler checks the record type. */
export const CONSOLE_APPS = {
  // Records, saved views, prefs and calls: the handler checks each record type.
  "*": null,
  view: "outbound",
  loops: "loops",
  setLoop: "loops",
  flagAdd: "loops",
  flagRemove: "loops",
  experimentAdd: "marketing",
  experimentStart: "marketing",
  experimentShip: "marketing",
  experimentStop: "marketing",
  experimentRemove: "marketing",
  snippetAdd: "library",
  snippetRemove: "library",
  addClient: "clients",
  setLook: "account",
  install: "marketplace",
  configure: "marketplace",
  uninstall: "marketplace",
  ask: "marketplace",
  workflowSave: "workflows",
  retryEvent: "workflows",
  releaseHold: "workflows",
  question: "ask",
  teamSet: "team",
  teamRemove: "team",
} as const satisfies RouteApps<typeof CONSOLE_ROUTES>;
export type ConsoleRoute = keyof typeof CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const CONSOLE_WRITES: readonly ConsoleRoute[] = [
  "setLoop",
  "recordsEdit",
  "recordsUndo",
  "recordsAsk",
  "saveView",
  "removeView",
  "moveViews",
  "setPref",
  "snippetAdd",
  "snippetRemove",
  "flagAdd",
  "flagRemove",
  "experimentAdd",
  "experimentStart",
  "experimentShip",
  "experimentStop",
  "experimentRemove",
  "addClient",
  "call",
  "setLook",
  "install",
  "configure",
  "uninstall",
  "ask",
  "workflowSave",
  "retryEvent",
  "releaseHold",
  "question",
  "teamSet",
  "teamRemove",
];
