import type { Need, RouteApps } from "@wren/core/access";

/** BooksConsole's handlers and what each needs: the edge Worker opens only these. Type imports only. */
export const BOOKS_CONSOLE_ROUTES = {
  setAccount: "wren:money",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): Money. */
export const BOOKS_CONSOLE_APPS = { "*": "money" } as const satisfies RouteApps<
  typeof BOOKS_CONSOLE_ROUTES
>;
export const BOOKS_CONSOLE_WRITES: readonly (keyof typeof BOOKS_CONSOLE_ROUTES)[] = ["setAccount"];
