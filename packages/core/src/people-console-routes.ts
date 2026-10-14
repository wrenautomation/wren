import type { Need, RouteApps } from "./access.js";

/**
 * PeopleConsole's handlers (`./people-console.ts`) and what each needs: a client's People records,
 * read from its own database by whoever may see that client (Wren's own People records are the
 * console's), and segments (B5) in Wren's workspace or a client's: a preview and the editor's
 * lists are reads, a save, an archive or a describe (it asks the model) an act. Nothing here
 * sends. Type imports only, so the Worker bundles it alone.
 */
export const PEOPLE_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  segmentContext: "read",
  segmentPreview: "read",
  segmentDescribe: "act",
  segmentSave: "act",
  segmentArchive: "act",
  segmentRestore: "act",
  segmentRetake: "act",
  memberAdd: "act",
  memberRemove: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type's own app; segments are People's. */
export const PEOPLE_CONSOLE_APPS = {
  "*": "people",
  recordsTypes: null,
  recordsList: null,
  recordsGet: null,
  recordsExport: null,
  recordsStats: null,
} as const satisfies RouteApps<typeof PEOPLE_CONSOLE_ROUTES>;
export type PeopleConsoleRoute = keyof typeof PEOPLE_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const PEOPLE_CONSOLE_WRITES: readonly PeopleConsoleRoute[] = [
  "segmentDescribe",
  "segmentSave",
  "segmentArchive",
  "segmentRestore",
  "segmentRetake",
  "memberAdd",
  "memberRemove",
];
