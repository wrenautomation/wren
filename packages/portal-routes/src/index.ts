/**
 * The portal's services: the first path part after /api/, the service behind it, and each route's
 * need (`@wren/core/access`), which that service's guard checks. A new product adds a line; a route
 * with no need doesn't type-check, and the portal's `test/inventory.test.ts` holds each map to the
 * handlers the service serves. The portal Worker serves these; the box runs their reads (`PORTAL_READS`).
 */
import {
  AERIE_CONSOLE_APPS,
  AERIE_CONSOLE_ROUTES,
  AERIE_CONSOLE_WRITES,
} from "@wren/aerie/console-routes";
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
  CONNECTORS_APPS,
  CONNECTORS_ROUTES,
  CONNECTORS_WRITES,
} from "@wren/connectors/console-routes";
import type { Need, RouteApps } from "@wren/core/access";
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
  PEOPLE_CONSOLE_APPS,
  PEOPLE_CONSOLE_ROUTES,
  PEOPLE_CONSOLE_WRITES,
} from "@wren/core/people/console-routes";
import {
  TEMPLATES_CONSOLE_APPS,
  TEMPLATES_CONSOLE_ROUTES,
  TEMPLATES_CONSOLE_WRITES,
} from "@wren/core/templates/console-routes";
import {
  BILLING_CONSOLE_APPS,
  BILLING_CONSOLE_ROUTES,
  BILLING_CONSOLE_WRITES,
} from "@wren/delivery/billing/console-routes";
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
  FOLDERS_CONSOLE_APPS,
  FOLDERS_CONSOLE_ROUTES,
  FOLDERS_CONSOLE_WRITES,
} from "@wren/folders/console-routes";
import {
  PATHS_CONSOLE_APPS,
  PATHS_CONSOLE_ROUTES,
  PATHS_CONSOLE_WRITES,
} from "@wren/paths/console-routes";
import {
  PAYMENTS_CONSOLE_APPS,
  PAYMENTS_CONSOLE_ROUTES,
  PAYMENTS_CONSOLE_WRITES,
} from "@wren/payments/console-routes";
import {
  PIPELINE_CONSOLE_APPS,
  PIPELINE_CONSOLE_ROUTES,
  PIPELINE_CONSOLE_WRITES,
} from "@wren/pipeline/console-routes";
import {
  PORTAL_APPS,
  PORTAL_MAX_BODY,
  PORTAL_ROUTES,
  PORTAL_WRITES,
} from "@wren/reactivation/portal-routes";
import {
  CANON_CONSOLE_APPS,
  CANON_CONSOLE_ROUTES,
  CANON_CONSOLE_WRITES,
} from "@wren/research/canon-console-routes";
import {
  SITES_CONSOLE_APPS,
  SITES_CONSOLE_ROUTES,
  SITES_CONSOLE_WRITES,
} from "@wren/sites/console-routes";
import {
  MAIL_ACCESS_APPS,
  MAIL_ACCESS_ROUTES,
  MAIL_ACCESS_WRITES,
} from "@wren/starling-email/access/console-routes";
import {
  EMAIL_CONSOLE_APPS,
  EMAIL_CONSOLE_ROUTES,
  EMAIL_CONSOLE_WRITES,
} from "@wren/starling-email/console-routes";
import {
  SOCIAL_ACCESS_APPS,
  SOCIAL_ACCESS_ROUTES,
  SOCIAL_ACCESS_WRITES,
} from "@wren/starling-inbound/connect/routes";
import {
  SMS_CONSOLE_APPS,
  SMS_CONSOLE_ROUTES,
  SMS_CONSOLE_WRITES,
} from "@wren/starling-sms/console-routes";
import {
  VARIANTS_CONSOLE_APPS,
  VARIANTS_CONSOLE_ROUTES,
  VARIANTS_CONSOLE_WRITES,
} from "@wren/variants/console-routes";
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
  /** The largest request body in bytes: one for every route, or per route; the rest keep 16 KB. */
  maxBody?: number | Readonly<Record<string, number>>;
}

/** The largest body a route takes, in bytes. */
export const bodyLimit = (svc: Service, route: string, fallback: number): number =>
  typeof svc.maxBody === "number" ? svc.maxBody : (svc.maxBody?.[route] ?? fallback);
const service = <R extends Readonly<Record<string, Need>>>(
  name: string,
  needs: R,
  apps: RouteApps<R>,
  writes: readonly (keyof R & string)[],
  maxBody?: number | Readonly<Record<string, number>>,
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
  // Import takes a whole file in the body: those routes may be larger than the rest.
  reactivation: service(
    "ReactivationPortal",
    PORTAL_ROUTES,
    PORTAL_APPS,
    PORTAL_WRITES,
    PORTAL_MAX_BODY,
  ),
  // Views by name, records, the loops, any public handler by its form, a client's components.
  console: service("ConsolePortal", CONSOLE_ROUTES, CONSOLE_APPS, CONSOLE_WRITES),
  // Warm replies, inboxes and campaigns; a client's lead sheet.
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
  // A client's People: the sent log, from its own database.
  people: service(
    "PeopleConsole",
    PEOPLE_CONSOLE_ROUTES,
    PEOPLE_CONSOLE_APPS,
    PEOPLE_CONSOLE_WRITES,
  ),
  // Where an account's spend counts.
  books: service("BooksConsole", BOOKS_CONSOLE_ROUTES, BOOKS_CONSOLE_APPS, BOOKS_CONSOLE_WRITES),
  // The Monitor: William's mail and its rules.
  watch: service("WatchConsole", WATCH_CONSOLE_ROUTES, WATCH_CONSOLE_APPS, WATCH_CONSOLE_WRITES),
  // Variants: batches to pick, calls and anchored notes, guides, the catalog.
  variants: service(
    "VariantsConsole",
    VARIANTS_CONSOLE_ROUTES,
    VARIANTS_CONSOLE_APPS,
    VARIANTS_CONSOLE_WRITES,
  ),
  // Aerie: every task and who does what (board, list, saved views, decisions).
  aerie: service("AerieConsole", AERIE_CONSOLE_ROUTES, AERIE_CONSOLE_APPS, AERIE_CONSOLE_WRITES),
  // Canon › References: the index of Canon's sources, read only.
  canon: service("CanonConsole", CANON_CONSOLE_ROUTES, CANON_CONSOLE_APPS, CANON_CONSOLE_WRITES),
  // Explorer: any product's records as one tree of paths, with links between them.
  paths: service("PathsConsole", PATHS_CONSOLE_ROUTES, PATHS_CONSOLE_APPS, PATHS_CONSOLE_WRITES),
  // One folder tree for chats, subjects and runs.
  folders: service(
    "FoldersConsole",
    FOLDERS_CONSOLE_ROUTES,
    FOLDERS_CONSOLE_APPS,
    FOLDERS_CONSOLE_WRITES,
  ),
  // Clients' health and flags: Wren's rating, an override, a flag's owner and state.
  health: service(
    "HealthConsole",
    HEALTH_CONSOLE_ROUTES,
    HEALTH_CONSOLE_APPS,
    HEALTH_CONSOLE_WRITES,
  ),
  // Money in by bank transfer: put a credit on an invoice, or set it aside.
  billing: service(
    "BillingConsole",
    BILLING_CONSOLE_ROUTES,
    BILLING_CONSOLE_APPS,
    BILLING_CONSOLE_WRITES,
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
  // Offers, funnels, journeys, deals and numbers of the pipeline, and the hand moves on them.
  pipeline: service(
    "PipelineConsole",
    PIPELINE_CONSOLE_ROUTES,
    PIPELINE_CONSOLE_APPS,
    PIPELINE_CONSOLE_WRITES,
  ),
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
 * Every route the portal only reads (its routes less its writes), as `Service/handler`: the box's
 * read lane runs these, so a page never waits on a Lambda cold start (designs/2026-11-09-own-runtime.md, group 5).
 */
export const PORTAL_READS: readonly string[] = Object.values(SERVICES).flatMap((s) =>
  [...s.routes].filter((r) => !s.writes.has(r)).map((r) => `${s.name}/${r}`),
);
