import type { Need, RouteApps } from "@wren/core/access";

/**
 * MailAccess's handlers and what each needs (designs/2026-10-07-mail-access.md): Account → Mail.
 * A client's people read their own mailboxes and connect them; the handlers check their role
 * reaches the Account app. Type imports only.
 */
export const MAIL_ACCESS_ROUTES = {
  mail: "read",
  addMailbox: "act",
  connect: "act",
  consent: "act",
  check: "act",
  done: "act",
} as const satisfies Record<string, Need>;
/** Account → Mail; Done on an email is Marketing → Inbox's. */
export const MAIL_ACCESS_APPS = {
  "*": "account",
  done: "marketing",
} as const satisfies RouteApps<typeof MAIL_ACCESS_ROUTES>;
export const MAIL_ACCESS_WRITES: readonly (keyof typeof MAIL_ACCESS_ROUTES)[] = [
  "addMailbox",
  "connect",
  "consent",
  "check",
  "done",
];
