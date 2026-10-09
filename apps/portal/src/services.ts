/**
 * The portal's services: the first path part after /api/, the Restate service behind it, and
 * each route's need (`@wren/core/access`), which that service's guard checks. A new product adds
 * a line; a route with no need doesn't type-check, and `test/inventory.test.ts` holds each map to
 * the handlers the service serves.
 */
import {
  BOOKS_CONSOLE_APPS,
  BOOKS_CONSOLE_ROUTES,
  BOOKS_CONSOLE_WRITES,
} from "@wren/books/console-routes";
import {
  CALENDAR_CONSOLE_APPS,
  CALENDAR_CONSOLE_ROUTES,
  CALENDAR_CONSOLE_WRITES,
} from "@wren/calendar/console-routes";
import {
  MAIL_ACCESS_APPS,
  MAIL_ACCESS_ROUTES,
  MAIL_ACCESS_WRITES,
} from "@wren/channel-email/access/console-routes";
import {
  EMAIL_CONSOLE_APPS,
  EMAIL_CONSOLE_ROUTES,
  EMAIL_CONSOLE_WRITES,
} from "@wren/channel-email/console-routes";
import {
  SMS_CONSOLE_APPS,
  SMS_CONSOLE_ROUTES,
  SMS_CONSOLE_WRITES,
} from "@wren/channel-sms/console-routes";
import {
  CONNECTORS_APPS,
  CONNECTORS_ROUTES,
  CONNECTORS_WRITES,
} from "@wren/connectors/console-routes";
import {
  SOCIAL_ACCESS_APPS,
  SOCIAL_ACCESS_ROUTES,
  SOCIAL_ACCESS_WRITES,
} from "@wren/content/connect/routes";
import { type Need, needOf, type Permission, type RouteApps } from "@wren/core/access";
import {
  ACCOUNTS_CONSOLE_APPS,
  ACCOUNTS_CONSOLE_ROUTES,
  ACCOUNTS_CONSOLE_WRITES,
} from "@wren/core/accounts/console-routes";
import { CONSOLE_APPS, CONSOLE_ROUTES, CONSOLE_WRITES } from "@wren/core/console-routes";
import {
  MARKETING_CONSOLE_APPS,
  MARKETING_CONSOLE_ROUTES,
  MARKETING_CONSOLE_WRITES,
} from "@wren/core/marketing/console-routes";
import {
  TEMPLATES_CONSOLE_APPS,
  TEMPLATES_CONSOLE_ROUTES,
  TEMPLATES_CONSOLE_WRITES,
} from "@wren/core/templates/console-routes";
import {
  DEALS_CONSOLE_APPS,
  DEALS_CONSOLE_ROUTES,
  DEALS_CONSOLE_WRITES,
} from "@wren/deals/console-routes";
import {
  HEALTH_CONSOLE_APPS,
  HEALTH_CONSOLE_ROUTES,
  HEALTH_CONSOLE_WRITES,
} from "@wren/delivery/health/console-routes";
import { DELIVERY_APPS, DELIVERY_ROUTES, DELIVERY_WRITES } from "@wren/delivery/routes";
import {
  DOCUMENTS_CONSOLE_APPS,
  DOCUMENTS_CONSOLE_ROUTES,
  DOCUMENTS_CONSOLE_WRITES,
} from "@wren/documents/console-routes";
import {
  LEARN_CONSOLE_APPS,
  LEARN_CONSOLE_ROUTES,
  LEARN_CONSOLE_WRITES,
} from "@wren/learn/console-routes";
import {
  NOTES_CONSOLE_APPS,
  NOTES_CONSOLE_ROUTES,
  NOTES_CONSOLE_WRITES,
} from "@wren/notes/console-routes";
import {
  PAYMENTS_CONSOLE_APPS,
  PAYMENTS_CONSOLE_ROUTES,
  PAYMENTS_CONSOLE_WRITES,
} from "@wren/payments/console-routes";
import { PORTAL_APPS, PORTAL_ROUTES, PORTAL_WRITES } from "@wren/reactivation/portal-routes";
import {
  SITES_CONSOLE_APPS,
  SITES_CONSOLE_ROUTES,
  SITES_CONSOLE_WRITES,
} from "@wren/sites/console-routes";
import {
  VOICE_CONSOLE_APPS,
  VOICE_CONSOLE_ROUTES,
  VOICE_CONSOLE_WRITES,
} from "@wren/voice/console-routes";
import {
  WATCH_CONSOLE_APPS,
  WATCH_CONSOLE_ROUTES,
  WATCH_CONSOLE_WRITES,
} from "@wren/watch/console-routes";

export interface Service {
  /** The Restate service. */
  name: string;
  needs: Readonly<Record<string, Need>>;
  /** Where each route works (`RouteAt`): its app, or null where the handler checks. */
  apps: RouteApps<object>;
  routes: ReadonlySet<string>;
  writes: ReadonlySet<string>;
  /** The largest request body, in bytes; absent, 16 KB. */
  maxBody?: number;
}
const service = <R extends Readonly<Record<string, Need>>>(
  name: string,
  needs: R,
  apps: RouteApps<R>,
  writes: readonly (keyof R & string)[],
  maxBody?: number,
): Service => ({
  name,
  needs,
  apps,
  routes: new Set(Object.keys(needs)),
  writes: new Set(writes),
  ...(maxBody ? { maxBody } : {}),
});

export const SERVICES: Readonly<Record<string, Service>> = {
  delivery: service("DeliveryPortal", DELIVERY_ROUTES, DELIVERY_APPS, DELIVERY_WRITES),
  reactivation: service("ReactivationPortal", PORTAL_ROUTES, PORTAL_APPS, PORTAL_WRITES),
  // Views by name, records, the loops, any public handler by its form, a client's components.
  console: service("ConsolePortal", CONSOLE_ROUTES, CONSOLE_APPS, CONSOLE_WRITES),
  // Warm replies, inboxes, campaigns and copy experiments; a client's lead sheet.
  email: service("EmailConsole", EMAIL_CONSOLE_ROUTES, EMAIL_CONSOLE_APPS, EMAIL_CONSOLE_WRITES),
  // A client's texting threads (O4); replies are Wren's team only.
  sms: service("SmsConsole", SMS_CONSOLE_ROUTES, SMS_CONSOLE_APPS, SMS_CONSOLE_WRITES),
  // A client's Marketing: its drafts, posts, ads and search; a draft's verdict by its approver.
  marketing: service(
    "MarketingConsole",
    MARKETING_CONSOLE_ROUTES,
    MARKETING_CONSOLE_APPS,
    MARKETING_CONSOLE_WRITES,
  ),
  // Where an account's spend counts.
  books: service("BooksConsole", BOOKS_CONSOLE_ROUTES, BOOKS_CONSOLE_APPS, BOOKS_CONSOLE_WRITES),
  // The Monitor: William's mail and its rules.
  watch: service("WatchConsole", WATCH_CONSOLE_ROUTES, WATCH_CONSOLE_APPS, WATCH_CONSOLE_WRITES),
  // Learn: save a link (the box, the phone's Shortcut), follow sources, search, ask for an SOP.
  learn: service("LearnConsole", LEARN_CONSOLE_ROUTES, LEARN_CONSOLE_APPS, LEARN_CONSOLE_WRITES),
  // Clients' health and flags: Wren's rating, an override, a flag's owner and state.
  health: service(
    "HealthConsole",
    HEALTH_CONSOLE_ROUTES,
    HEALTH_CONSOLE_APPS,
    HEALTH_CONSOLE_WRITES,
  ),
  // Booking calendars, Wren's and each client's: the week, the calls, how one went, cancel.
  calendar: service(
    "CalendarConsole",
    CALENDAR_CONSOLE_ROUTES,
    CALENDAR_CONSOLE_APPS,
    CALENDAR_CONSOLE_WRITES,
  ),
  // The voice agent: test calls saved with their turns' timings.
  voice: service("VoiceConsole", VOICE_CONSOLE_ROUTES, VOICE_CONSOLE_APPS, VOICE_CONSOLE_WRITES),
  // The Library's templates: copy that sends waits in To approve for a person's yes.
  templates: service(
    "TemplatesConsole",
    TEMPLATES_CONSOLE_ROUTES,
    TEMPLATES_CONSOLE_APPS,
    TEMPLATES_CONSOLE_WRITES,
  ),
  // Notes: docs with versions and sharing. A sync carries a Yjs update in base64 (up to 4 MB of
  // bytes), under Lambda's 6 MB request.
  notes: service(
    "NotesConsole",
    NOTES_CONSOLE_ROUTES,
    NOTES_CONSOLE_APPS,
    NOTES_CONSOLE_WRITES,
    5_600_000,
  ),
  // Sites: every page we run; new pages from an offer, copy, publish via To approve, retire.
  sites: service("SitesConsole", SITES_CONSOLE_ROUTES, SITES_CONSOLE_APPS, SITES_CONSOLE_WRITES),
  // Text-to-pay: a client's Stripe pay links, made, approved, sent; Stripe connected here.
  payments: service(
    "PaymentsConsole",
    PAYMENTS_CONSOLE_ROUTES,
    PAYMENTS_CONSOLE_APPS,
    PAYMENTS_CONSOLE_WRITES,
  ),
  // Documents: contracts, proposals and estimates from templates, sent to sign, approved here.
  documents: service(
    "DocumentsConsole",
    DOCUMENTS_CONSOLE_ROUTES,
    DOCUMENTS_CONSOLE_APPS,
    DOCUMENTS_CONSOLE_WRITES,
  ),
  // Opportunities: deals in pipelines of stages, for a client and for Wren.
  deals: service("DealsConsole", DEALS_CONSOLE_ROUTES, DEALS_CONSOLE_APPS, DEALS_CONSOLE_WRITES),
  // A client's accounts with their setups, and its vendors: modes, room, the month's usage.
  accounts: service(
    "AccountsConsole",
    ACCOUNTS_CONSOLE_ROUTES,
    ACCOUNTS_CONSOLE_APPS,
    ACCOUNTS_CONSOLE_WRITES,
  ),
  // Account → Mail: a client's mailboxes, its admin's step, each mailbox's sign-in.
  mail: service("MailAccess", MAIL_ACCESS_ROUTES, MAIL_ACCESS_APPS, MAIL_ACCESS_WRITES),
  // Account → Social: a client's own social accounts, each one sign-in.
  social: service("SocialAccess", SOCIAL_ACCESS_ROUTES, SOCIAL_ACCESS_APPS, SOCIAL_ACCESS_WRITES),
  // Account → Connectors: a client's HubSpot, QuickBooks or Jobber, read hourly into its CRM.
  connectors: service("Connectors", CONNECTORS_ROUTES, CONNECTORS_APPS, CONNECTORS_WRITES),
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
