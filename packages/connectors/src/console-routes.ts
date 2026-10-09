import type { Need, RouteApps } from "@wren/core/access";

/**
 * Connectors' handlers and what each needs (designs/2026-10-09-connectors.md): Account →
 * Connectors. A client's people see its apps and connect them. Type imports only.
 */
export const CONNECTORS_ROUTES = {
  connectors: "read",
  connect: "act",
  syncNow: "act",
  disconnect: "act",
} as const satisfies Record<string, Need>;
export const CONNECTORS_APPS = {
  "*": "account",
} as const satisfies RouteApps<typeof CONNECTORS_ROUTES>;
export const CONNECTORS_WRITES: readonly (keyof typeof CONNECTORS_ROUTES)[] = [
  "connect",
  "syncNow",
  "disconnect",
];
