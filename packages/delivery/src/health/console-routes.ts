import type { Need, RouteApps } from "@wren/core/access";

/**
 * HealthConsole's handlers (`./console.ts`) and what each needs: Wren's team, at Wren, in the
 * Clients app. Reading is the console's records. Type imports only, so the edge Worker bundles it.
 */
export const HEALTH_CONSOLE_ROUTES = {
  rate: "wren:run",
  override: "wren:run",
  clearOverride: "wren:run",
  flagRaise: "wren:run",
  flagTake: "wren:run",
  flagOwn: "wren:run",
  flagAddress: "wren:run",
  flagClear: "wren:run",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): the Clients app. */
export const HEALTH_CONSOLE_APPS = { "*": "clients" } as const satisfies RouteApps<
  typeof HEALTH_CONSOLE_ROUTES
>;
export const HEALTH_CONSOLE_WRITES: readonly (keyof typeof HEALTH_CONSOLE_ROUTES)[] = [
  "rate",
  "override",
  "clearOverride",
  "flagRaise",
  "flagTake",
  "flagOwn",
  "flagAddress",
  "flagClear",
];
