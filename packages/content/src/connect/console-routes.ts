import type { Need, RouteApps } from "@wren/core/access";

/**
 * SocialAccess's handlers and what each needs (designs/2026-10-07-client-social.md): Account →
 * Social. A client's people see its accounts and connect them; the handlers check their role
 * reaches the Account app. Type imports only.
 */
export const SOCIAL_ACCESS_ROUTES = {
  social: "read",
  connect: "act",
  check: "act",
  disconnect: "act",
} as const satisfies Record<string, Need>;
export const SOCIAL_ACCESS_APPS = {
  "*": "account",
} as const satisfies RouteApps<typeof SOCIAL_ACCESS_ROUTES>;
export const SOCIAL_ACCESS_WRITES: readonly (keyof typeof SOCIAL_ACCESS_ROUTES)[] = [
  "connect",
  "check",
  "disconnect",
];
