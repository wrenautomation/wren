import type { Need, RouteApps } from "@wren/core/access";
import type { PathErrorCode } from "@wren/core/paths";

/** PathsConsole's handlers (designs/2026-11-12-explorer.md). Wren's team only. Type imports only. */
export const PATHS_CONSOLE_ROUTES = {
  columns: "wren:team",
  children: "wren:team",
  whole: "wren:team",
  find: "wren:team",
  map: "wren:team",
  line: "wren:team",
} as const satisfies Record<string, Need>;
/** No one app: Explorer opens in Canon first, then Research and Variants. */
export const PATHS_CONSOLE_APPS = { "*": null } as const satisfies RouteApps<
  typeof PATHS_CONSOLE_ROUTES
>;
export const PATHS_CONSOLE_WRITES: readonly (keyof typeof PATHS_CONSOLE_ROUTES)[] = [];
/** The HTTP status of each path error, on the server and in the portal's mocks. */
export const PATH_ERROR_STATUS = {
  "not-indexed": 404,
  "unknown-path": 404,
  offline: 503,
  blind: 403,
} as const satisfies Record<PathErrorCode, number>;
