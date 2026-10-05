/**
 * The portal's services: the first path part after /api/, the Restate service behind it, and
 * each route's need (`@wren/core/access`), which that service's guard checks. A new product adds
 * a line; a route with no need doesn't type-check, and `test/inventory.test.ts` holds each map to
 * the handlers the service serves.
 */
import { BOOKS_CONSOLE_ROUTES, BOOKS_CONSOLE_WRITES } from "@wren/books/console-routes";
import { EMAIL_CONSOLE_ROUTES, EMAIL_CONSOLE_WRITES } from "@wren/channel-email/console-routes";
import { SMS_CONSOLE_ROUTES, SMS_CONSOLE_WRITES } from "@wren/channel-sms/console-routes";
import { type Need, needOf, type Permission } from "@wren/core/access";
import { CONSOLE_ROUTES, CONSOLE_WRITES } from "@wren/core/console-routes";
import { DELIVERY_ROUTES, DELIVERY_WRITES } from "@wren/delivery/routes";
import { PORTAL_ROUTES, PORTAL_WRITES } from "@wren/reactivation/portal-routes";
import { WATCH_CONSOLE_ROUTES, WATCH_CONSOLE_WRITES } from "@wren/watch/console-routes";

export interface Service {
  /** The Restate service. */
  name: string;
  needs: Readonly<Record<string, Need>>;
  routes: ReadonlySet<string>;
  writes: ReadonlySet<string>;
}
const service = <R extends Readonly<Record<string, Need>>>(
  name: string,
  needs: R,
  writes: readonly (keyof R & string)[],
): Service => ({ name, needs, routes: new Set(Object.keys(needs)), writes: new Set(writes) });

export const SERVICES: Readonly<Record<string, Service>> = {
  delivery: service("DeliveryPortal", DELIVERY_ROUTES, DELIVERY_WRITES),
  reactivation: service("ReactivationPortal", PORTAL_ROUTES, PORTAL_WRITES),
  // Views by name, records, the loops, any public handler by its form, a client's components.
  console: service("ConsolePortal", CONSOLE_ROUTES, CONSOLE_WRITES),
  // Warm replies, inboxes, campaigns and copy experiments; a client's lead sheet.
  email: service("EmailConsole", EMAIL_CONSOLE_ROUTES, EMAIL_CONSOLE_WRITES),
  // A client's texting threads (O4); replies are Wren's team only.
  sms: service("SmsConsole", SMS_CONSOLE_ROUTES, SMS_CONSOLE_WRITES),
  // Where an account's spend counts.
  books: service("BooksConsole", BOOKS_CONSOLE_ROUTES, BOOKS_CONSOLE_WRITES),
  // The Watch: William's mail and its rules.
  watch: service("WatchConsole", WATCH_CONSOLE_ROUTES, WATCH_CONSOLE_WRITES),
};

/**
 * The permission a call to `<service>/<route>` needs, which the web hides a button behind
 * (a `wren:` need is the same permission, read in Wren's own workspace). Unknown: undefined.
 */
export function permissionOf(path: string): Permission | undefined {
  const [svc = "", route = ""] = path.split("/");
  const need = SERVICES[svc]?.needs[route];
  return need && needOf(need).permission;
}
