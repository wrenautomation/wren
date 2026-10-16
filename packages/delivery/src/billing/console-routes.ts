import type { Need, RouteApps } from "@wren/core/access";

/**
 * BillingConsole's handlers (`./console.ts`) and what each needs: Wren's team with the money
 * permission, in the Money app (To approve lists the credits that wait, too). Type imports
 * only, so the edge Worker bundles it.
 */
export const BILLING_CONSOLE_ROUTES = {
  match: "wren:money",
  dismiss: "wren:money",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): Money, wherever the credit is answered from. */
export const BILLING_CONSOLE_APPS = { "*": "money" } as const satisfies RouteApps<
  typeof BILLING_CONSOLE_ROUTES
>;
export const BILLING_CONSOLE_WRITES: readonly (keyof typeof BILLING_CONSOLE_ROUTES)[] = [
  "match",
  "dismiss",
];
