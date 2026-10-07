import type { Need } from "./access.js";

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
  // A record's edits (`edits.ts`): the handler checks `run` at Wren too.
  recordsEdit: "wren:run",
  recordsUndo: "wren:run",
  recordsAsk: "wren:run",
  // A viewer's own saved views and prefs, where they look; sharing a view checks `manage`.
  savedViews: "read",
  saveView: "read",
  removeView: "read",
  moveViews: "read",
  prefs: "read",
  setPref: "read",
  addClient: "wren:manage",
  // A handler with an effect needs `effect` too, checked once the handler is known.
  call: "wren:run",
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
