import type { Need, RouteApps } from "@wren/core/access";
import { AERIE_ROUTES, AERIE_WRITES, type AerieRoute } from "@wrenautomation/aerie/routes";

/** AerieConsole's handlers: Aerie's own route table, Wren's team only; no app scope until tenants (phase 6, then `aerie` in APPS). Browser-safe. */
export const AERIE_CONSOLE_ROUTES = Object.fromEntries(
  AERIE_ROUTES.map((k) => [k, "wren:team"]),
) as Record<AerieRoute, "wren:team"> satisfies Record<string, Need>;
export const AERIE_CONSOLE_APPS = { "*": null } as const satisfies RouteApps<
  typeof AERIE_CONSOLE_ROUTES
>;
export const AERIE_CONSOLE_WRITES: readonly AerieRoute[] = AERIE_WRITES;
