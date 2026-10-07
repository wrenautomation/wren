import type { Need, RouteApps } from "@wren/core/access";

/**
 * SmsConsole's handlers (`restate/console.ts`) and what each needs: a client's texting threads,
 * read by whoever may see that client; `reply` is Wren's team only (the handler checks); `callDone`
 * closes speed to lead's "Call now" for whoever may act in Texts. The edge
 * Worker opens only these and refuses the writes on the demo. Type imports only, so the Worker
 * bundles it alone.
 */
export const SMS_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  reply: "act",
  callDone: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; a reply is Texts. */
export const SMS_CONSOLE_APPS = {
  "*": null,
  reply: { app: "texts", channel: "sms" },
  callDone: { app: "texts", channel: "sms" },
} as const satisfies RouteApps<typeof SMS_CONSOLE_ROUTES>;
export type SmsConsoleRoute = keyof typeof SMS_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const SMS_CONSOLE_WRITES: readonly SmsConsoleRoute[] = ["reply", "callDone"];
