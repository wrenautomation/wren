import type { Need, RouteApps } from "@wren/core/access";

/**
 * PaymentsConsole's handlers (`console.ts`) and what each needs: a client's pay links, read by
 * whoever may see that client; making, approving and connecting Stripe are acts in Payments
 * (approving also checks the client's approver). The edge Worker opens only these and refuses
 * the writes on the demo. Type imports only, so the Worker bundles it alone.
 */
export const PAYMENTS_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  status: "read",
  create: "act",
  fromThread: "act",
  approve: "act",
  decline: "act",
  connect: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; the rest are Payments. */
export const PAYMENTS_CONSOLE_APPS = {
  "*": null,
  status: "payments",
  create: "payments",
  // From a texting thread: the act is in Texts, where the thread is.
  fromThread: { app: "texts", channel: "sms" },
  approve: "payments",
  decline: "payments",
  connect: "payments",
} as const satisfies RouteApps<typeof PAYMENTS_CONSOLE_ROUTES>;
export type PaymentsConsoleRoute = keyof typeof PAYMENTS_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const PAYMENTS_CONSOLE_WRITES: readonly PaymentsConsoleRoute[] = [
  "create",
  "fromThread",
  "approve",
  "decline",
  "connect",
];
