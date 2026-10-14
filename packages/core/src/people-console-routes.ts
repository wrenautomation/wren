import type { Need, RouteApps } from "./access.js";

/**
 * PeopleConsole's handlers (`./people-console.ts`) and what each needs: a client's People records,
 * read from its own database by whoever may see that client. Wren's own People is the console's.
 * Read only: nothing here sends or changes anything. Type imports only, so the Worker bundles it
 * alone.
 */
export const PEOPLE_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type's own app and channel. */
export const PEOPLE_CONSOLE_APPS = { "*": null } as const satisfies RouteApps<
  typeof PEOPLE_CONSOLE_ROUTES
>;
export type PeopleConsoleRoute = keyof typeof PEOPLE_CONSOLE_ROUTES;
/** None change anything. */
export const PEOPLE_CONSOLE_WRITES: readonly PeopleConsoleRoute[] = [];
