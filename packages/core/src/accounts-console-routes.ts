import type { Need, RouteApps } from "./access.js";

/**
 * AccountsConsole's handlers and what each needs (designs/2026-10-07-setup-and-vendors.md): a
 * client's accounts with their setups, and its vendors. Its people read and act on their own
 * steps; the rest is Wren's team, which each handler checks (`teamCan`). Type imports only.
 */
export const ACCOUNTS_CONSOLE_ROUTES = {
  accounts: "read",
  vendors: "read",
  start: "act",
  mark: "act",
  checkNow: "act",
  addAccount: "act",
  setVendor: "act",
  usage: "wren:read",
} as const satisfies Record<string, Need>;
/** All of it is the client's Account app; Wren's usage across clients is the Clients app's. */
export const ACCOUNTS_CONSOLE_APPS = {
  "*": "account",
  usage: "clients",
} as const satisfies RouteApps<typeof ACCOUNTS_CONSOLE_ROUTES>;
export const ACCOUNTS_CONSOLE_WRITES: readonly (keyof typeof ACCOUNTS_CONSOLE_ROUTES)[] = [
  "start",
  "mark",
  "checkNow",
  "addAccount",
  "setVendor",
];
