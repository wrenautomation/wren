/**
 * Every Restate service the worker serves, built once from settings. Shared by
 * the two hosts: the Node listener (`main.ts`, local/compose) and the Lambda
 * handler (`lambda.ts`, Restate Cloud). Nothing here assumes a process lifetime
 * beyond one invocation: state lives in Restate and Postgres.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Context, ServiceDefinition, VirtualObjectDefinition } from "@restatedev/restate-sdk";
import {
  awsCostExplorer,
  BOOKS_CONSOLE_VIEWS,
  bankOfCanada,
  billsStep,
  dirStore,
  s3Store,
} from "@wren/books";
import { BOOKS_RECORDS } from "@wren/books/records";
import { BOOKS_KEY, makeBooks, makeBooksConsole } from "@wren/books/restate";
import {
  AllBookings,
  CALENDAR,
  CALENDAR_SCOPE,
  CalendarBookings,
  calendarChecks,
  GoogleHost,
} from "@wren/calendar";
import { makeCalendarConsole } from "@wren/calendar/console";
import { CALENDAR_RECORDS } from "@wren/calendar/records";
import {
  type CalendarDeps,
  type ClientCalendarDeps,
  makeCalendar,
  makeClientCalendar,
} from "@wren/calendar/restate";
import {
  activeSenders,
  Broadcast,
  ConsoleTransport,
  campaignPolicy,
  clientReplies,
  defaultLocalChecker,
  emailChecks,
  emailTouchStep,
  expandHome,
  GmailClient,
  GmailTransport,
  gmailPushTopic,
  ImapReader,
  type InboxReader,
  imapClient,
  loadMailboxes,
  loadRoster,
  loadServiceAccountKey,
  mailDomainTargets,
  makeFiller,
  makeNotifier,
  makeVerifier,
  type Notifier,
  type PostmasterClient,
  plainMailer,
  postmasterToken,
  proberHosts,
  RoutedReader,
  RoutedTransport,
  recheckLeads,
  rosterFleet,
  SendPolicy,
  SmtpTransport,
  senderDomain,
  senderFleet,
  sequencesSendScope,
  serviceAccountToken,
  sharedFor,
  type Transport,
  withImap,
} from "@wren/channel-email";
import { briefSettingsOf, briefStep, CALL_BRIEF, makeCallBriefs } from "@wren/channel-email/calls";
import { EMAIL_TOUCH } from "@wren/channel-email/components";
import { emailRecords } from "@wren/channel-email/records";
import {
  type Campaign,
  DISPOSITION_KEY,
  dailyOpenerCapacity,
  inboxPush,
  makeCallBookings,
  makeComposeScheduler,
  makeDigestScheduler,
  makeDisposition,
  makeEmailConsole,
  makeEvolution,
  makeInboxScheduler,
  makeMarketing,
  makeOpensScheduler,
  makePlacementScheduler,
  makePoolScheduler,
  makePostmasterScheduler,
  makeQueueRefresh,
  makeReportScheduler,
  makeResolution,
  makeSendScheduler,
  type SendScope,
} from "@wren/channel-email/restate";
import { EMAIL_CONSOLE_VIEWS, EMAIL_COST_VIEWS } from "@wren/channel-email/views";
import { linkedinContent } from "@wren/channel-linkedin";
import {
  facebookContent,
  instagramContent,
  instagramWebContent,
  metaChecks,
} from "@wren/channel-meta";
import { makeAds, makeAdsWatch } from "@wren/channel-meta/restate";
import { redditApi, redditContent } from "@wren/channel-reddit";
import { searchConsoleChecks, searchConsoleClient } from "@wren/channel-search";
import { heatRecord, sessionRecord, surveyAnswerRecord } from "@wren/channel-search/records";
import { makeSearchWatch, makeSearchWeek } from "@wren/channel-search/restate";
import {
  CalcomBookings,
  type ClientSms,
  clientSms,
  firstTextStep,
  healthFrom,
  NoProvider,
  policyFrom,
  providerFrom,
  pusherFrom,
  SmsNotifier,
  smsChecks,
  TelnyxProvider,
  touchStep,
} from "@wren/channel-sms";
import { TOUCH } from "@wren/channel-sms/components";
import {
  makeSmsConsole,
  makeSmsDesk,
  makeSmsEvents,
  makeSmsSender,
  makeSmsWatch,
  SENDER_KEY,
} from "@wren/channel-sms/restate";
import { tiktokContent } from "@wren/channel-tiktok";
import { xContent } from "@wren/channel-x";
import { youtubeContent } from "@wren/channel-youtube";
import { ingressOf, type Settings } from "@wren/config";
import { clientContent, commentGuide, DEFAULT_VOICE, dmGuide, s3MediaHost } from "@wren/content";
import { mediaRecord, sopRecord, videoRecord } from "@wren/content/records";
import {
  makeContentDesk,
  makeContentMetrics,
  makeContentPlanner,
  makeContentScheduler,
  makeDraftAsk,
  makeMarketingConsole,
  makeSocialDesk,
  makeSocialWatch,
  makeVideoDesk,
} from "@wren/content/restate";
import { contentDrafts, contentPlaybooks } from "@wren/content/schema";
import { resolve as dohResolve } from "@wren/core";
import { makeAccountsConsole } from "@wren/core/accounts/console";
import { askRecord, makeAsk } from "@wren/core/ask";
import { makeAuditSealer } from "@wren/core/audit";
import { CalcomCalendar, type Calendar } from "@wren/core/calendar";
import {
  CustomHostnames,
  clientRecord,
  findClient,
  sendsOn,
  settingsFor,
} from "@wren/core/clients";
import { makeConsolePortal, restateAdmin, restateAdminGet } from "@wren/core/console";
import { asAccount, type Platform, type SiteClient } from "@wren/core/content";
import { sitesHost } from "@wren/core/content/box";
import { ingressSites } from "@wren/core/content/ingress";
import { makeTokenRenewal } from "@wren/core/content/renewal";
import {
  type ChannelsFor,
  type ContentClients,
  DESK,
  journaledSites,
  makeContent,
  restateSites,
} from "@wren/core/content/restate";
import { wrenFacts } from "@wren/core/facts";
import { siteEdge } from "@wren/core/flag-store";
import { delegatedMailbox, type Mailbox, siteMailbox } from "@wren/core/mailbox";
import { MARKETING_RECORDS } from "@wren/core/marketing/records";
import { meteredModel, meteredSites } from "@wren/core/metered";
import { namedFor } from "@wren/core/notify";
import { clientKey, clientOfKey, ingressSend } from "@wren/core/restate";
import { dnsChecks, SETUP_STEP, setupStep } from "@wren/core/setup";
import { makeSetupAgent, SETUP_AGENT } from "@wren/core/setup-agent";
import { makeSetupWatch } from "@wren/core/setup-watch";
import { makeSpine, makeSpineClock, type SpineEvent, spineFire } from "@wren/core/spine";
import { makeTemplatesConsole } from "@wren/core/templates/console";
import { templateRecords } from "@wren/core/templates/records";
import { gate } from "@wren/core/vendors";
import { cachedDb, clientDatabaseName, clientDatabaseUrl, createDb, type Db } from "@wren/db";
import { engagementOf, postUpdate } from "@wren/delivery";
import { s3Files } from "@wren/delivery/files";
import { HEALTH_RECORDS } from "@wren/delivery/health";
import { makeHealthConsole } from "@wren/delivery/health/console";
import { makeDeliveryPortal, makeDeliveryWatch, makeDomainsResolver } from "@wren/delivery/restate";
import { loadLlmEnv, makeLlm, makeTracer } from "@wren/llm";
import {
  adLibraryFor,
  crawlHintsFor,
  discoveryWordsFor,
  exaSearchFor,
  fbGroupsFor,
  LANDERS_BY_NICHE,
  NICHES,
  SMS_SEQUENCES,
  youtubeSearchFor,
} from "@wren/niches";
import { makeNotesConsole, notesContext } from "@wren/notes/console";
import { DRIVE_READ_SCOPE, googleDrive } from "@wren/notes/drive";
import {
  discoverySettingsSchema,
  REACH_SEQUENCES,
  policyFrom as reachPolicyFrom,
  touchStep as reachTouchStep,
  sortStep,
  WREN_AUDIENCE,
} from "@wren/outreach";
import {
  makeReachDesk,
  makeReachSender,
  makeReachWatch,
  makeRedditReads,
  wakeWatch,
} from "@wren/outreach/restate";
import { clientSendScope } from "@wren/reactivation";
import { DEMO_NAME, makeReactivation, makeReactivationPortal } from "@wren/reactivation/restate";
import {
  type BrowserRenderer,
  browserbaseRenderer,
  browserRenderer,
  cdpRenderer,
  PoliteFetcher,
  userAgent,
} from "@wren/research";
import { YOUTUBE_READ_SCOPE, youtubeApi } from "@wren/research/enrichment";
import { s3PageStore } from "@wren/research/pages";
import { RESEARCH_RECORDS } from "@wren/research/records";
import { makeDiscovery, makeEnrichment, makePageArchive } from "@wren/research/restate";
import { makeVoiceConsole } from "@wren/voice/console";
import { CALL_NOW, callNowStep } from "@wren/voice/node";
import { VOICE_RECORDS } from "@wren/voice/records";
import { type Practice, practiceOf, scoreStep, triageStep, mail as watchMail } from "@wren/watch";
import { WATCH_RECORDS } from "@wren/watch/records";
import { makeWatch, makeWatchConsole } from "@wren/watch/restate";
import { desc, eq, max } from "drizzle-orm";
import type { Logger } from "pino";
import { COMPONENTS } from "./components.js";
import { clientMarketing, marketingNumbers } from "./marketing.js";
import { copyRecords } from "./record-edits.js";
import { reviewRecord } from "./review.js";
import { SETUPS } from "./setups.js";
import { WORKFLOWS } from "./workflows.js";

/** The worker's application_name on every connection, kept on each audit event. */
const WORKER_APP = "wren-worker";
/** Wren's intro call on cal.com, the event every live offer's `booking` names. */
const WREN_CALL = { username: "wrenautomation", slug: "call" };

export type AnyService =
  | ServiceDefinition<string, unknown>
  | VirtualObjectDefinition<string, unknown>;

export interface Services {
  services: AnyService[];
  /** What was wired, for the startup log line. Never a secret. */
  summary: Record<string, string | number | boolean>;
  close(): Promise<void>;
}

/**
 * The pool chain: research and mailbox checks, waiting on sites and mail servers far
 * longer than it computes. Lambda bills every second of that wait, so with
 * `WREN_POOL_CHAIN_HOST=box` the Postgres box serves it (`box.ts`), next to the data.
 * Restate keeps each service on one deployment: whichever side serves it, the other skips it.
 */
/** One desk call from the books' day; past it the mailbox waits for tomorrow's pass. */
const BOOKS_DESK_TIMEOUT_MS = 120_000;
/** A setup check's read through autobrowse: gives up, never wakes the box; the next round asks again. */
const SETUP_READ_TIMEOUT_MS = 30_000;

export const POOL_CHAIN = ["PoolScheduler", "Discovery", "Enrichment", "Resolution"];
/**
 * Everything the box serves: the chain; the page archive, which moves rows out of
 * its own disk; and the books' day, which waits on the model and the Mac's desk.
 */
export const BOX_SERVICES = [...POOL_CHAIN, "PageArchive", "Books", "Watch", "SocialWatch"];
/** SocialWatch's clock: 07:00-23:00 New York (designs/2026-10-06-social-inbox.md). */
const SOCIAL_ZONE = "America/New_York";

export function servicesFor(
  all: AnyService[],
  here: "box" | "lambda",
  chainHost = process.env.WREN_POOL_CHAIN_HOST,
): AnyService[] {
  const inChain = (s: AnyService) => BOX_SERVICES.includes(s.name);
  if (here === "box") return all.filter(inChain);
  return chainHost === "box" ? all.filter((s) => !inChain(s)) : all;
}

export interface BuildOptions {
  /** Where relative settings paths (roster, llm.env) resolve. */
  rootDir: string;
  /** Postgres pool size; small on Lambda, where every instance has its own. */
  dbPoolMax?: number;
}

/** Through PgBouncer on the box when a pool port is set; each client database's URL follows. */
function pooled({ databaseUrl, databasePoolPort }: Settings): string {
  if (!databasePoolPort) return databaseUrl;
  const url = new URL(databaseUrl);
  url.port = String(databasePoolPort);
  return url.toString();
}

/**
 * Client portals on their own hosts (designs/2026-10-06-custom-domains.md): Cloudflare for SaaS
 * on our zone, with a token that only edits custom hostnames. Unset: adding one says not yet.
 */
function customDomains() {
  const token = process.env.WREN_CLOUDFLARE_SAAS_TOKEN;
  const zone = process.env.WREN_CLOUDFLARE_ZONE_ID;
  const target = process.env.WREN_CUSTOM_DOMAIN_TARGET;
  return {
    ...(target ? { target } : {}),
    ...(token && zone ? { cloudflare: new CustomHostnames({ token, zone }) } : {}),
  };
}

export async function buildServices(
  settings: Settings,
  log: Logger,
  opts: BuildOptions,
): Promise<Services> {
  const { rootDir } = opts;
  const databaseUrl = pooled(settings);
  const handle = createDb(databaseUrl, {
    app: WORKER_APP,
    ...(opts.dbPoolMax ? { max: opts.dbPoolMax } : {}),
  });
  const db = handle.db;

  // Key fleets and provider keys live in llm.env (or the host's env); never logged.
  loadLlmEnv(settings.llmEnvPath, rootDir);
  const llm = makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
  const ua = settings.fetchContact ? userAgent(settings.fetchContact) : null;
  if (!ua) log.warn("WREN_FETCH_CONTACT unset: crawl and render will refuse until it is");
  const verifier = await makeVerifier(settings.verifier, {
    smtpProbeUrl: settings.smtpProbeUrl ?? null,
    smtpProbeToken: settings.smtpProbeToken ?? null,
    smtpHelo: settings.smtpHelo ?? null,
  });
  // Real verdicts for free (smtp): the chain verifies mailboxes itself and compose
  // waits for them. The fake is never that: its rows would gate real sends.
  const freeVerdicts = verifier.authoritative && !verifier.costsCredits;
  const renderer = ua ? rendererFor(settings, ua, log) : null;
  // Nudges to the operator: replies, bounces, pauses, a dry pool, stage errors, the
  // morning digest. Discord with no URL refuses here, at start, not at the first reply.
  const notifier = makeNotifier(settings.notify, {
    discordWebhookUrl: settings.discordWebhookUrl ?? null,
    discordPingUserId: settings.discordPingUserId ?? null,
  });
  const notify = settings.notify === "none" ? {} : { notifier };
  // Each sales channel pings its own Discord channel when its webhook is set; else the main one.
  const laneNotifier = (url: string | undefined): Notifier =>
    settings.notify === "discord" && url
      ? makeNotifier("discord", {
          discordWebhookUrl: url,
          discordPingUserId: settings.discordPingUserId ?? null,
        })
      : notifier;
  const lane = (url: string | undefined) =>
    settings.notify === "none" ? {} : { notifier: laneNotifier(url) };
  const emailNotify = lane(settings.discordEmailWebhookUrl);
  const smsNotify = lane(settings.discordSmsWebhookUrl);
  const reachNotify = lane(settings.discordReachWebhookUrl);
  const adsNotify = lane(settings.discordAdsWebhookUrl);
  const contentNotify = lane(settings.discordContentWebhookUrl);
  const searchNotify = lane(settings.discordSearchWebhookUrl);
  const clientsNotify = lane(settings.discordClientsWebhookUrl);

  // SMS: a real provider sends nothing until WREN_SMS_LIVE (the registered campaign) says so.
  // The fake pretends to send: on Lambda (prod) it is refused and no provider runs instead.
  let smsProvider = providerFrom(settings);
  if (smsProvider.name === "fake" && process.env.AWS_LAMBDA_FUNCTION_NAME) {
    log.error("WREN_SMS_PROVIDER=fake refused in prod: running with no sms provider");
    smsProvider = new NoProvider();
  }
  if (smsProvider.name === "none")
    log.info("no sms provider: texts queue, nothing is sent, looked up or synced");
  else if (smsProvider.name === "fake")
    log.warn("WREN_SMS_PROVIDER=fake pretends to send: local dry runs only");
  else if (!settings.smsLive)
    log.info("WREN_SMS_LIVE off: the sms sender queues but sends nothing");
  // A text to William's phone, once the registered campaign is live.
  const operatorText =
    settings.operatorPhone && settings.smsLive && smsProvider.name === "telnyx"
      ? new SmsNotifier(db, smsProvider, settings.operatorPhone)
      : null;
  // Warm replies wait on William, so their pings also text his phone (Discord stays the log).
  const replyNotifier = operatorText
    ? new Broadcast([laneNotifier(settings.discordEmailWebhookUrl), operatorText])
    : laneNotifier(settings.discordEmailWebhookUrl);

  // The send loop: console prints until cutover flips WREN_SEND_TRANSPORT=gmail.
  // The roster names the live fleet; without one nothing may send, so a missing
  // file degrades to an empty fleet rather than a worker that will not start.
  const policy = SendPolicy.fromSettings(settings);
  // SMTP/IMAP logins for the roster's smtp inboxes; error messages never carry a value.
  const mailboxes = (() => {
    try {
      return loadMailboxes(settings.mailboxesFile);
    } catch (err) {
      log.warn({ err: (err as Error).message }, "no mailboxes file: smtp inboxes cannot load");
      return loadMailboxes(undefined);
    }
  })();
  const roster = (() => {
    try {
      return loadRoster(
        resolve(rootDir, settings.sendersFile),
        new Set(NICHES.map((n) => n.name)),
        new Set(mailboxes.keys()),
      );
    } catch (err) {
      log.warn({ err: (err as Error).message }, "no sender roster: the send loop sends nothing");
      return [];
    }
  })();
  const fleet = rosterFleet(roster, activeSenders(roster), Object.fromEntries(LANDERS_BY_NICHE));
  // Cold email offers two open times on Wren's call (the offers' booking page);
  // a yes is proposed to William, who books it.
  const calendar = settings.calcomApiKey
    ? new CalcomCalendar(settings.calcomApiKey, WREN_CALL)
    : null;
  if (!calendar)
    log.info('WREN_CALCOM_API_KEY unset: emails say "early next week" and no yes is proposed');
  // Each tick reads the console's campaign overrides, so a kill switch or opener stop needs no deploy.
  const wrenScope = async (): Promise<SendScope> => ({
    db,
    policy: await campaignPolicy(db, policy),
    fleet,
    calendar,
    // The pixel goes into mail only when asked; the host alone just enables the opens pull.
    pixelBaseUrl: settings.openTracking ? (settings.pixelBaseUrl ?? null) : null,
  });
  // Each client's own database, pooled per client; its name follows from the id.
  const openClient = (client: { database: string }) =>
    cachedDb(clientDatabaseUrl(databaseUrl, client.database), { app: WORKER_APP });
  const clientDb = (id: string) => openClient({ database: clientDatabaseName(id) });
  const clients = { main: db, open: openClient, policy };
  // Drive import reads as the service account (a doc shared with it), else by public link; the
  // key loads on first use, so a worker without one still starts.
  let driveKey: ReturnType<typeof loadServiceAccountKey> | null = null;
  let driveToken: (() => Promise<string>) | null = null;
  const driveKeyOf = () =>
    (driveKey ??= loadServiceAccountKey(expandHome(settings.googleServiceAccount)));
  const notesDeps = {
    main: db,
    open: openClient,
    files: settings.filesBucket ? s3Files({ bucket: settings.filesBucket }) : undefined,
    zone: settings.sendTimezone,
    drive: googleDrive({
      token: () => {
        driveToken ??= serviceAccountToken(driveKeyOf(), { scopes: [DRIVE_READ_SCOPE] });
        return driveToken();
      },
      who: () => driveKeyOf().clientEmail,
    }),
  };
  // A client's cal.com is its autobrowse login (`clients.accounts.calcom`), read through the desk.
  const calcomSites = ingressSites(ingressOf(settings), {
    caller: "wren:calcom",
    ...sitesHost(settings.autobrowseInstanceId),
    timeoutMs: BOOKS_DESK_TIMEOUT_MS,
  });
  const clientBookings = (account: string) =>
    new CalcomBookings((q) => calcomSites.call("calcom", "GET", "/v2/bookings", q, account));
  // One campaign per registered niche: its plan, copy and the inboxes it may send from,
  // each sign-off already pointing at the niche's page. The queue-keeper reads these.
  // Casual names and prompt slots, cached in `fills`. No keys for it is a loud start, not
  // a quiet fallback to the rule-based names.
  const fill =
    settings.fillLlm === "none" ? null : makeFiller(db, makeLlm(settings.fillLlm, process.env));
  const campaigns = new Map<string, Campaign>(
    NICHES.map((niche) => {
      const active = activeSenders(roster, niche.name);
      return [
        niche.name,
        {
          niche: niche.name,
          plan: niche.plan,
          mailsRoleInboxes: niche.mailsRoleInboxes,
          sequences: niche.sequences,
          offers: niche.offers,
          offerFacts: niche.offerFacts,
          site: settings.siteBaseUrl,
          factsView: niche.factsView,
          senders: active.map((s) => s.address),
          ramps: fleet.ramps ?? {},
          signatures: Object.fromEntries(
            active.flatMap((s) =>
              s.signature ? [[s.address, s.signature.forPage(niche.lander).text]] : [],
            ),
          ),
          companyLocation: niche.companyLocation,
          recontact: niche.recontact,
          ...(fill ? { fill } : {}),
        },
      ];
    }),
  );
  const keyPath = expandHome(settings.googleServiceAccount);
  const gmail = new GmailClient({ keyPath });
  // Inboxes on their own login send over SMTP and are read over IMAP; the rest go through Gmail.
  const smtpInboxes = roster.flatMap((s) => {
    const mailbox = s.transport === "smtp" ? mailboxes.get(s.address) : undefined;
    return mailbox ? [[s.address, mailbox] as const] : [];
  });
  const transport: Transport =
    settings.sendTransport === "gmail"
      ? new RoutedTransport(
          new GmailTransport(gmail),
          new Map(smtpInboxes.map(([address, m]) => [address, new SmtpTransport(m)])),
        )
      : new ConsoleTransport();

  // The inbox side reads the real mailboxes whatever the send transport: replies,
  // bounces and unsubscribes to the Python fleet's sends are still ours to act on.
  const reader: InboxReader = new RoutedReader(
    gmail,
    new Map(smtpInboxes.map(([address, m]) => [address, new ImapReader(m)])),
  );
  // Reply disposition only pays for a real model; the fake would label nothing useful.
  const classify = settings.llm !== "fake";
  const tracer = makeTracer(settings.tracing);
  const syncMs = settings.daemonSyncSeconds * 1000;
  const tickMs = settings.daemonTickSeconds * 1000;
  // Gmail push for the inboxes Gmail reads (prod only: a local run must not move prod's watches).
  const imap = new Set(smtpInboxes.map(([address]) => address));
  const watch =
    settings.sendTransport === "gmail"
      ? async (sender: string) =>
          imap.has(sender)
            ? null
            : gmail.watch(sender, gmailPushTopic(loadServiceAccountKey(keyPath).clientEmail))
      : undefined;

  // Postmaster answers for the account that registered the domains; without
  // one named there is no daily pull, and the worker says so once at start.
  const postmaster: PostmasterClient | null = settings.postmasterUser
    ? {
        fetch: (url, init) => fetch(url, init),
        token: await postmasterToken(loadServiceAccountKey(keyPath), settings.postmasterUser),
      }
    : null;
  if (!postmaster) log.info("WREN_POSTMASTER_USER unset: no daily Postmaster pull");
  const sendingDomains = [...new Set(roster.map((s) => senderDomain(s)))];

  // The open-pixel pull needs both the host and its export bearer; the bearer
  // stays in settings and the request header, never in a log line or a ledger row.
  const opens =
    settings.pixelBaseUrl && settings.pixelExportToken
      ? { baseUrl: settings.pixelBaseUrl, exportToken: settings.pixelExportToken }
      : null;
  if (settings.pixelBaseUrl && !opens)
    log.warn("WREN_PIXEL_BASE_URL set without WREN_PIXEL_EXPORT_TOKEN: opens are not pulled");

  const pages = settings.pagesBucket ? s3PageStore(settings.pagesBucket) : null;
  // Read-only YouTube as the service account, minted on first read: a worker without the
  // key still starts, and the stage then stops on its errors.
  let youtubeToken: (() => Promise<string>) | null = null;
  const youtube = youtubeApi(() => {
    youtubeToken ??= serviceAccountToken(loadServiceAccountKey(keyPath), {
      scopes: [YOUTUBE_READ_SCOPE],
    });
    return youtubeToken();
  });
  // Our own booking calendar: Google as the account the settings name, by delegation on the
  // calendar scope, minted on first use; mail from portal@.
  const calendarKey = () => loadServiceAccountKey(keyPath);
  const googleCalendar = new GoogleHost((account) =>
    serviceAccountToken(calendarKey(), { scopes: [CALENDAR_SCOPE], subject: account }),
  );
  // The booker's mail from portal@ under the calendar owner's name; unset, no booker mail at all.
  const bookerMailer =
    settings.portalFrom && settings.portalMailbox
      ? (name: string) =>
          plainMailer(gmail, {
            mailbox: settings.portalMailbox as string,
            from: settings.portalFrom as string,
            name,
          })
      : null;
  const calendarDeps: CalendarDeps = {
    db,
    calendar: "wren",
    settings: async () => (await settingsFor(db, null))[CALENDAR] ?? {},
    host: googleCalendar,
    shared: settings.siteExportToken ?? null,
    site: settings.siteBaseUrl.replace(/\/+$/, ""),
    send: bookerMailer?.("Wren") ?? null,
    fire: spineFire,
  };
  // A client's booking calendar: its database, its connected Google account, its host. Its mail
  // and Google's invite wait on its sends flag (`ownerDeps`).
  const clientCalendarDeps: ClientCalendarDeps = {
    main: db,
    open: openClient,
    host: googleCalendar,
    shared: settings.siteExportToken ?? null,
    portal: settings.portalOrigin ?? "https://app.wrenautomation.com",
    mailer: bookerMailer,
    fire: spineFire,
  };
  // Site flags, pushed to the lander's edge on every change and each search pass.
  const edge = settings.siteEdgeToken
    ? siteEdge(settings.siteBaseUrl, settings.siteEdgeToken)
    : undefined;
  // The lander's recorded views: the export lists them, the files bucket signs their chunks.
  const sessions =
    settings.siteExportToken && settings.filesBucket
      ? {
          site: { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken },
          signGet: s3Files({ bucket: settings.filesBucket }).getUrl,
        }
      : undefined;
  const services: AnyService[] = [
    // A dead firm site at 30s × 3 tries held one shard ~90s a page; a live one answers in seconds.
    makeEnrichment({
      db,
      clientDb,
      fetcher: ua ? new PoliteFetcher(ua, { timeout: 10, retries: 2 }) : null,
      llm,
      renderer,
      tracer,
      robotsMode: settings.robotsMode,
      crawlHintsFor,
      pages,
      // `profiles` runs inside the unit's ctx.run, so through the ingress; a Mac that is off fails fast.
      sites: ingressSites(ingressOf(settings), {
        caller: "wren:profiles",
        ...sitesHost(settings.autobrowseInstanceId),
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      linkedin: settings.poolLinkedin ?? null,
      recheck: recheckLeads,
      youtube,
      // autobrowse's `meta` site (Graph business_discovery); inside a unit's ctx.run, so the ingress.
      instagram: ingressSites(ingressOf(settings), {
        caller: "wren:instagram",
        ...sitesHost(settings.autobrowseInstanceId),
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      // Meta's Ad Library and public groups signed out (`fb-public`), on the Mac's home IP; a Mac that is off fails the stage fast.
      desk: ingressSites(ingressOf(settings), {
        caller: "wren:ad-library",
        service: DESK,
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      adsFor: adLibraryFor,
      groupsFor: fbGroupsFor,
      // Exa's company index through `web` (an api route, so the sites service, not the desk).
      exaSites: ingressSites(ingressOf(settings), {
        caller: "wren:exa-search",
        ...sitesHost(settings.autobrowseInstanceId),
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      exaFor: exaSearchFor,
      youtubeSearchFor,
    }),
    // Discovery probes guessed hosts, most of them parked or dead: a short timeout and
    // one try per URL, or a single company's guesses can eat a Lambda invocation.
    makeDiscovery({
      db,
      clientDb,
      fetcher: ua ? new PoliteFetcher(ua, { timeout: 8, retries: 1 }) : null,
      genericWordsFor: discoveryWordsFor,
    }),
    makeResolution({
      db,
      clientDb,
      verifier,
      openPool: (max, client) =>
        createDb(
          client ? clientDatabaseUrl(databaseUrl, clientDatabaseName(client)) : databaseUrl,
          { max, app: WORKER_APP },
        ),
    }),
    // A plain key is one of Wren's inboxes; `<client>/<mailbox>` is a client's (R4, R12:
    // its mailboxes are in Wren's Workspace, so the same transport and reader serve them).
    makeSendScheduler({
      transport,
      // Email sequences first (its caps), else reactivation's; neither = the loop stops.
      scopeOf: async (key) =>
        clientOfKey(key)
          ? ((await sequencesSendScope(clients, key)) ?? (await clientSendScope(clients, key)))
          : wrenScope(),
      tickMs,
      ...emailNotify,
    }),
    makeInboxScheduler({
      reader,
      scopeOf: (key) => {
        const owner = clientOfKey(key);
        return owner
          ? {
              db: clientDb(owner.client),
              disposition: clientKey(owner.client, "replies"),
              // A bounce or opt-out in a client's inbox suppresses everywhere.
              shared: sharedFor(db, owner.client),
              client: owner.client,
            }
          : { db, disposition: DISPOSITION_KEY, client: null };
      },
      syncMs,
      tickMs,
      classify,
      ...(watch ? { watch } : {}),
      ...emailNotify,
      fire: spineFire,
    }),
    inboxPush,
    makeDisposition({
      dbOf: (key) => {
        const owner = clientOfKey(key);
        return owner ? clientDb(owner.client) : db;
      },
      llm,
      tracer,
      tracing: settings.tracing,
      // Code proposes each warm reply's answer; only William's approve books or sends.
      invites: calendar
        ? { calendar, notifier: replyNotifier, copies: campaigns, send: { transport, fleet } }
        : null,
      // A client's warm replies on its sequences (email.replies): the same proposals, its
      // mailboxes, Wren's approve. Its mail offers no times, so nothing is booked by code.
      clientInvites: async (client) => {
        const on = await clientReplies(db, client);
        if (!on?.settings.niche) return null;
        const bookings = on.calcom ? clientBookings(on.calcom) : null;
        const clientCalendar: Calendar = {
          name: bookings ? "cal.com (client)" : "none",
          open: async () => [],
          book: async () => {
            throw new Error("a client's mail offers no times: nothing to book");
          },
          booked: async (email) => (bookings ? bookings.booked(email) : false),
        };
        return {
          calendar: clientCalendar,
          notifier: replyNotifier,
          copies: campaigns,
          send: { transport, fleet: senderFleet(on.settings) },
          niches: [on.settings.niche],
        };
      },
    }),
    // cal.com's booking webhook, through the phone Worker: a booked lead stops getting mail.
    // A client's comes in by its own path and secret, into its database.
    makeCallBookings({ db, clientDb, fire: spineFire }),
    // The lander's signup form and preference center, through the phone Worker. Wren's own
    // lists only; the confirm email goes from portal@.
    makeMarketing({
      db,
      shared: settings.siteExportToken ?? null,
      site: settings.siteBaseUrl.replace(/\/+$/, ""),
      send:
        settings.portalFrom && settings.portalMailbox
          ? plainMailer(gmail, {
              mailbox: settings.portalMailbox,
              from: settings.portalFrom,
              name: "Wren",
            })
          : null,
    }),
    // Our booking calendar, through the phone Worker's /calendar door; its portal buttons.
    makeCalendar(calendarDeps),
    makeClientCalendar(clientCalendarDeps),
    makeCalendarConsole({ wren: calendarDeps, clients: clientCalendarDeps }),
    // The voice agent's portal writes: test calls saved (designs/2026-10-06-voice-agent.md).
    makeVoiceConsole({ db }),
    // The Library's templates: save, publish (copy that sends waits in To approve), approve.
    makeTemplatesConsole({ db }),
    // Notes: docs in every workspace, Yjs in each one's own database (designs/2026-10-07-notes.md).
    makeNotesConsole(notesDeps),
  ];
  // The queue-keeper is bound only when asked to hold a queue; 0 means every enrollment is by hand.
  if (settings.composeDaysAhead > 0) {
    services.push(
      makeComposeScheduler({
        db,
        policy,
        campaigns,
        daysAhead: settings.composeDaysAhead,
        verificationHorizonDays: settings.verificationHorizonDays,
        trackOpens: settings.openTracking,
        roleInboxNeedsVerdict: freeVerdicts,
        clientDb,
        ...emailNotify,
      }),
    );
  }
  // Deploy calls it once the new version is registered: queued mail takes the new templates.
  services.push(makeQueueRefresh({ db, campaigns, trackOpens: settings.openTracking }));
  // Copy experiments tick daily; with none running a pass does nothing.
  // Its tiers name their own models in each experiment's settings (Cohere by default).
  const evolveLlms = new Map<string, ReturnType<typeof makeLlm>>();
  const llmFor = (spec: string) => {
    let client = evolveLlms.get(spec);
    if (!client) {
      client = makeLlm(spec, process.env);
      evolveLlms.set(spec, client);
    }
    return client;
  };
  services.push(
    makeEvolution({ db, campaigns, policy, trackOpens: settings.openTracking, llmFor }),
  );
  // The pool-feeder walks the research chain per niche; what may spend is a setting.
  // A week of the niche's sends ahead of compose: the queue `profiles` and `signals` read.
  const queueAhead = {
    ahead: async (niche: string, now: Date) =>
      7 *
      dailyOpenerCapacity(
        await campaignPolicy(db, policy),
        niche,
        campaigns.get(niche)?.senders ?? [],
        now,
        fleet.ramps,
      ),
    horizonDays: settings.verificationHorizonDays,
  };
  services.push(
    makePoolScheduler({
      db,
      clientDb,
      policy,
      modelStages: settings.poolModelStages,
      freeVerifier: freeVerdicts,
      youtube: true,
      instagram: true,
      adLibrary: true,
      fbGroups: true,
      exaSearch: true,
      youtubeSearch: true,
      recheck: {
        horizonDays: settings.verificationHorizonDays,
        policy: (niche) => campaigns.get(niche)?.recontact,
      },
      // Metered: off unless WREN_POOL_PROFILES.
      ...(settings.poolProfiles ? { profiles: queueAhead } : {}),
      // Free; idle until a collector is built, then each one's `on` setting.
      signals: queueAhead,
    }),
  );
  const mailDomains = mailDomainTargets(roster, mailboxes, settings.siteBaseUrl);
  if (settings.notify !== "none")
    services.push(
      makeDigestScheduler({
        db,
        notifier: laneNotifier(settings.discordEmailWebhookUrl),
        policy,
        probers: proberHosts(settings.smtpProbeUrl),
        domains: mailDomains,
        ramps: fleet.ramps ?? {},
        placement: settings.placementSeeds.length > 0,
      }),
    );
  // A plain note and the newest opener from each ramped inbox to the seed Gmails once a send
  // day, read back from their labels; a failing plain test pauses the domain.
  // Off until `PlacementScheduler/fleet/start`, idle with no seeds.
  services.push(
    makePlacementScheduler({
      db,
      policy,
      transport,
      fleet,
      niches: Object.fromEntries(roster.map((s) => [s.address, s.niches])),
      seeds: settings.placementSeeds,
      notifier: laneNotifier(settings.discordEmailWebhookUrl),
      sitesFor: (ctx) =>
        restateSites(ctx, {
          caller: "wren:placement",
          ...sitesHost(settings.autobrowseInstanceId),
        }),
    }),
  );
  // Bound only when configured: an object with nothing to pull is better absent than failing every pass.
  if (postmaster) {
    services.push(
      // A client's `PostmasterScheduler/<client>/daily` reads its verified domains into its database.
      makePostmasterScheduler({
        db,
        client: postmaster,
        domains: sendingDomains,
        policy,
        clientDb,
      }),
    );
  }
  // Tracking off: only mail sent while it was on can still open, so hourly is enough.
  const opensMs = settings.openTracking ? syncMs : 3_600_000;
  if (opens) services.push(makeOpensScheduler({ db, ...opens, syncMs: opensMs, tickMs }));
  // The Friday report mails from a fleet inbox by default: the one mailbox the
  // service account is known to be able to impersonate.
  const reportFrom = settings.reportFrom ?? fleet.senders[0] ?? null;
  const report =
    settings.reportTo && reportFrom ? { to: settings.reportTo, from: reportFrom } : null;
  if (settings.reportTo && !report) log.warn("WREN_REPORT_TO set but no sender to mail from");
  if (report) services.push(makeReportScheduler({ db, transport, mail: report, policy }));
  // Content channels (LinkedIn, YouTube) over autobrowse's `sites` service, as the `Content` service.
  const content = contentFor(settings, log);
  if (content) services.push(makeContent(content, contentClientsFor(settings, db)));
  // Meta ads over the same `sites` service, as `Ads`. Always bound: a launch on a box without
  // the meta site fails on its own invocation, and nothing spends until `start`.
  services.push(
    makeAds({ ...adsFor(settings), db }),
    makeAdsWatch({ db, pauseAfterUsd: settings.adsPauseAfterUsd, ...adsNotify }),
  );
  // The content loop: ideas → drafts (ContentDesk, paid) → approved drafts posted (ContentScheduler).
  // Always bound: drafting needs no channel; a publish with none configured fails on its row.
  const voice = settings.contentVoicePath ? readFileSync(settings.contentVoicePath, "utf8") : null;
  // A draft's stored files (thumbnail, cover, the video) signed for its field editor.
  const mediaSigner = settings.mediaBucket
    ? { bucket: settings.mediaBucket, host: s3MediaHost({ bucket: settings.mediaBucket }) }
    : undefined;
  // The Monitor's model (the gateway on prod): mail triage, reach DMs, a client's drafts.
  const watchLlm = settings.watchLlm === "none" ? null : makeLlm(settings.watchLlm, process.env);
  services.push(
    makeContentDesk({
      db,
      llm,
      platforms: settings.contentChannels,
      zone: settings.sendTimezone,
      tracer,
      // A client's drafts: its database, the watch's model metered on its own gate.
      clients: { clientDb, llm: watchLlm },
      ...(voice !== null ? { voice } : {}),
      // A post field's file (thumbnail, subtitles, cover) goes up to the media bucket.
      ...(settings.mediaBucket ? { media: { bucket: settings.mediaBucket } } : {}),
    }),
    // A client's Marketing in the portal: its drafts, posts, ads and search; verdicts to its desk.
    makeMarketingConsole({ db, open: openClient, records: clientMarketing(mediaSigner) }),
    makeContentScheduler({
      db,
      // A post's replies come in through reach's watch: it reads warm from now.
      posted: (ctx, p, client) => {
        if (p === "reddit" || p === "linkedin") wakeWatch(ctx, client);
      },
      clientDb,
      ...contentNotify,
    }),
    makeContentMetrics({ db, clientDb, ...contentNotify }),
    // Tomorrow's slots vs scheduled drafts, said once a day; off until `wren content planner start`.
    makeContentPlanner({ db, clientDb, zone: settings.sendTimezone, ...contentNotify }),
    // Comments, activity and followers on our own accounts. Reads only; off until `wren social start`.
    makeSocialWatch({
      db,
      clientDb,
      platforms: settings.contentChannels,
      zone: SOCIAL_ZONE,
      ...contentNotify,
      ...(operatorText && settings.notify !== "none" ? { texter: operatorText } : {}),
    }),
    makeSocialDesk({ db, zone: SOCIAL_ZONE }),
    // Ask Claude on any draft: the desk's Claude Code rewrites, Wren writes. Nothing sends.
    makeDraftAsk(db),
    makeVideoDesk(db),
  );
  // autobrowse's tokens made again before they lapse (LinkedIn's 60 days, npm's 90).
  services.push(
    makeTokenRenewal({ db, host: sitesHost(settings.autobrowseInstanceId), ...notify }),
  );
  // The audit log's seals in every database, every 15 minutes; off until `wren audit sealer start`.
  services.push(makeAuditSealer({ main: db, open: openClient, ...notify }));
  // Page HTML a day old moves to the pages bucket; off until `wren pages archive start`.
  services.push(makePageArchive({ db, pages, ...notify }));
  const mailboxOf =
    (caller: string) =>
    (m: Settings["booksMailboxes"][number]): Mailbox =>
      m.via === "delegated"
        ? delegatedMailbox(gmail, m.address)
        : // Inside the pass's one step, so through the ingress; a Mac that is off is an alert, not a hang.
          siteMailbox(
            ingressSites(ingressOf(settings), {
              caller,
              service: DESK,
              timeoutMs: BOOKS_DESK_TIMEOUT_MS,
            }),
            m.address,
          );
  // The books' day: billing mail kept, read and posted, AWS spend in, alerts out;
  // off until `wren books loop start`.
  services.push(
    makeBooks({
      db,
      llm,
      mailboxes: settings.booksMailboxes.map(mailboxOf("wren:books")),
      store: settings.booksBucket
        ? s3Store(settings.booksBucket)
        : dirStore(resolve(rootDir, ".books")),
      rates: bankOfCanada(),
      aws: settings.booksAwsUsage ? awsCostExplorer() : null,
      since: settings.booksSince,
      ...notify,
    }),
  );
  // The Monitor: new mail every 15 minutes, onto the `watch` workflow; off until `wren watch start`.
  const watchBoxes = settings.watchMailboxes.length
    ? settings.watchMailboxes
    : settings.booksMailboxes;
  // Gmail push wakes the Monitor (designs/2026-10-06-mail-push.md); prod only, as the inboxes' watches.
  const watchVia = new Map(watchBoxes.map((m) => [m.address.toLowerCase(), m.via]));
  const watchSites = ingressSites(ingressOf(settings), {
    caller: "wren:watch",
    service: DESK,
    timeoutMs: BOOKS_DESK_TIMEOUT_MS,
  });
  const watchPush =
    settings.sendTransport === "gmail"
      ? async (address: string): Promise<number | null> => {
          const via = watchVia.get(address.toLowerCase());
          if (via === "delegated")
            return gmail.watch(address, gmailPushTopic(loadServiceAccountKey(keyPath).clientEmail));
          if (!settings.watchSiteTopic) return null;
          const r = await watchSites.call<{ expiration: string }>(
            "gmail",
            "POST",
            "/gmail/v1/users/me/watch",
            { topicName: settings.watchSiteTopic, labelIds: ["INBOX"] },
            address,
          );
          return Number(r.expiration);
        }
      : undefined;
  services.push(
    makeWatch({
      db,
      mailboxes: watchBoxes.map(mailboxOf("wren:watch")),
      ...(watchPush ? { watch: watchPush } : {}),
    }),
  );
  services.push(makeWatchConsole(db, watchLlm));
  // Health and flags: Wren's rating, an override, a flag taken, addressed or cleared.
  services.push(makeHealthConsole(db));
  // Cold SMS. Always bound: the sender is off until `wren sms queue start`.
  const sms = {
    db,
    provider: smsProvider,
    policy: policyFrom(settings),
    health: healthFrom(settings),
    live: settings.smsLive,
    campaignId: settings.telnyxCampaignId ?? null,
    sequences: SMS_SEQUENCES,
    senderName: settings.smsSenderName,
    bookingLink: settings.smsBookingLink ?? null,
    heldNiches: settings.smsHeldNiches,
    site: settings.siteExportToken
      ? { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken }
      : null,
    // Calls on our calendar and, while it still takes them, cal.com.
    bookings: new AllBookings([
      new CalendarBookings(db),
      ...(settings.calcomApiKey ? [new CalcomBookings(settings.calcomApiKey)] : []),
    ]),
    pusher: pusherFrom(settings),
    llm: classify ? llm : null,
    ...smsNotify,
    clientDb,
  };
  // A client's texts: its database and messaging profile in Wren's Telnyx account, its
  // cal.com login for reminders, Wren's rules. No site forms, no phone-app pushes.
  /** A client's calls its reminders read: its own calendar's, its cal.com's; none = null. */
  const bookingsOf = (plan: Extract<ClientSms, { kind: "work" }>) => {
    const sources = [
      ...(plan.calendar ? [new CalendarBookings(clientDb(plan.client.id), plan.client.id)] : []),
      ...(plan.calcom ? [clientBookings(plan.calcom)] : []),
    ];
    return sources.length ? new AllBookings(sources) : null;
  };
  const clientTexts = {
    ...sms,
    forClient: (plan: Extract<ClientSms, { kind: "work" }>) => ({
      ...sms,
      db: clientDb(plan.client.id),
      provider:
        smsProvider.name === "telnyx" && settings.telnyxApiKey
          ? new TelnyxProvider({ apiKey: settings.telnyxApiKey, messagingProfileId: plan.profile })
          : smsProvider,
      campaignId: plan.campaignId,
      senderName: plan.senderName ?? sms.senderName,
      bookingLink: plan.bookingLink,
      site: null,
      bookings: bookingsOf(plan),
      pusher: null,
      ...(sms.notifier ? { notifier: namedFor(sms.notifier, plan.client.id) } : {}),
    }),
  };
  /** Why texts can't leave now, or null: the global gate, the client's texts, the provider. */
  const textsWhy = (provider: string, off: string | null) =>
    !settings.smsLive
      ? "WREN_SMS_LIVE is off"
      : off
        ? `texts are off: ${off}`
        : provider === "none"
          ? "no SMS provider (WREN_SMS_PROVIDER)"
          : null;
  /** Whose texts a spine step runs on: Wren's, a client's with texts on, or why they're off. */
  const textsOf = async (client: string | null) => {
    if (!client) return { deps: sms, off: null };
    const plan = await clientSms(db, client);
    return plan.kind === "work"
      ? { deps: clientTexts.forClient(plan), off: null }
      : { deps: { ...sms, db: clientDb(client), bookings: null }, off: plan.why };
  };
  services.push(
    makeSmsSender(clientTexts),
    makeSmsEvents({ ...sms, fire: spineFire }),
    makeSmsDesk(clientTexts),
    makeSmsWatch(clientTexts),
    makeSmsConsole({ db, open: openClient }),
  );
  // Cold outreach on Reddit and LinkedIn, over the Mac's desk worker as each
  // reach account. Always bound: the sender and watch are off until
  // `wren reach queue start` / `wren reach watch start`, and nothing leaves
  // until WREN_REACH_LIVE says so.
  if (!settings.reachLive) log.info("WREN_REACH_LIVE off: reach plans and holds, nothing is sent");
  const reach = {
    db,
    fire: spineFire,
    policy: reachPolicyFrom(settings),
    sequences: REACH_SEQUENCES,
    live: settings.reachLive,
    senderName: settings.smsSenderName,
    heldNiches: settings.reachHeldNiches,
    sitesFor: (ctx: Context) => restateSites(ctx, { caller: "wren:reach", service: DESK }),
    postedAt: async (p: "reddit" | "linkedin") => {
      const [r] = await db
        .select({ at: max(contentDrafts.publishedAt) })
        .from(contentDrafts)
        .where(eq(contentDrafts.platform, p));
      return r?.at ? r.at.toISOString() : null;
    },
    // DM drafts in the watch's model, steered by the `outbound-copy` SOP and his DM edits.
    // Comments on others' LinkedIn posts: the comments SOP and his voice. Both claim only his
    // facts (Shop → Facts for drafts).
    drafts: {
      llm: watchLlm,
      guide: (p: "reddit" | "linkedin") => dmGuide(db, p),
      commentGuide: (p: "reddit" | "linkedin") => commentGuide(db, p),
      voice: voice ?? DEFAULT_VOICE,
      facts: () => wrenFacts(db),
    },
    // A client's runs: its database, the same model metered on its own gate, its own SOPs.
    clients: {
      clientDb,
      llm: watchLlm,
      dmGuide: (d: Db, p: "reddit" | "linkedin") => dmGuide(d, p),
      facts: (d: Db) => playbooksOf(d),
    },
    ...reachNotify,
  };
  services.push(
    makeReachSender(reach),
    makeReachWatch(reach),
    makeReachDesk(reach),
    // Reddit discovery reads signed out; drafts in the content voice, researched against the SOPs.
    makeRedditReads({
      ...reach,
      discovery: {
        llm: watchLlm,
        voice: voice ?? DEFAULT_VOICE,
        facts: () => playbooksOf(db),
        truths: () => wrenFacts(db),
        // Wren's saved block (Shop → Reddit discovery); a bad one reads as the default.
        audience: async () => {
          const got = discoverySettingsSchema.safeParse(
            (await settingsFor(db, null))["reddit.discovery"] ?? {},
          );
          return got.success ? got.data : WREN_AUDIENCE;
        },
      },
    }),
  );
  // Search: Search Console daily, the answer engines and edit proposals weekly (on the Mac's desk).
  // Bound only with a property named; off until `wren search watch start`.
  if (settings.searchSite && settings.searchOrigin) {
    const search = {
      db,
      console: searchConsoleClient(loadServiceAccountKey(keyPath)),
      site: settings.searchSite,
      origin: settings.searchOrigin,
      fetch: (url: string, init?: RequestInit) => fetch(url, init),
      // A client's `SearchWatch/<client>/daily` reads into its own database.
      clientDb,
      ...searchNotify,
      ...(settings.siteExportToken
        ? { siteExport: { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken } }
        : {}),
      ...(edge ? { edge } : {}),
    };
    services.push(
      makeSearchWatch(search),
      makeSearchWeek({
        ...search,
        llm,
        desk: (ctx) => restateSites(ctx, { caller: "wren:search-week", service: DESK }),
      }),
    );
  } else log.info("WREN_SEARCH_SITE/WREN_SEARCH_ORIGIN unset: no search loop");
  // The client portal (apps/portal): delivery for every client, each product's
  // own pages, and one reactivation loop per client.
  // DeliveryWatch mails clients from portal@ and pings us when one could feel forgotten.
  const portal = settings.portalOrigin ?? null;
  // A booked call's brief: Wren's or the client's database, its settings, the worker's model.
  const callBriefs = {
    dbFor: (client: string | null) => (client ? clientDb(client) : db),
    settingsFor: async (client: string | null) =>
      briefSettingsOf((await settingsFor(db, client))[CALL_BRIEF]),
    llm,
  };
  if (portal)
    services.push(
      makeDeliveryWatch({
        main: db,
        send:
          settings.portalFrom && settings.portalMailbox
            ? plainMailer(gmail, {
                mailbox: settings.portalMailbox,
                from: settings.portalFrom,
                name: "Wren",
              })
            : null,
        app: portal,
        zone: settings.sendTimezone,
        fire: spineFire,
        ...clientsNotify,
      }),
    );
  else log.info("WREN_PORTAL_ORIGIN unset: no DeliveryWatch");
  // What account setups check: DNS over HTTPS, Telnyx's 10DLC status, the roster's warmup and
  // the placement tests, Search Console's property list, a calendar's free/busy as its address,
  // and the client's ad account through autobrowse's `meta`. Free reads, all of them.
  // Setup alerts reach Wren's team on the clients lane, named for the client; none with
  // WREN_NOTIFY=none. Parts that need facts pause when one is lost.
  const setupLane = (client: string | null): Notifier | null => {
    if (settings.notify === "none") return null;
    const lane = laneNotifier(settings.discordClientsWebhookUrl);
    return client ? namedFor(lane, client) : lane;
  };
  const setupParts = COMPONENTS.filter((c) => c.requires.facts.length > 0);
  const setupChecks = {
    ...dnsChecks(dohResolve),
    ...searchConsoleChecks(() => searchConsoleClient(loadServiceAccountKey(keyPath))),
    ...calendarChecks(googleCalendar),
    ...metaChecks(
      ingressSites(ingressOf(settings), {
        caller: "wren:setup",
        service: sitesHost(settings.autobrowseInstanceId).service,
        timeoutMs: SETUP_READ_TIMEOUT_MS,
      }),
    ),
    ...(smsProvider.registration
      ? smsChecks(db, smsProvider.registration, settings.telnyxCampaignId ?? null)
      : {}),
    ...emailChecks({
      dbOf: async (client) => (client === null ? db : clientDb(client)),
      warmupOf: async (address) => {
        const w = roster.find((x) => x.address === address)?.ramp?.warmupStart;
        return w
          ? {
              start: new Date(Date.UTC(w.year, w.month - 1, w.day)),
              step: policy.warmupStep,
              limit: policy.warmupLimit,
            }
          : null;
      },
      // Signs in and out, reading nothing: IMAP for an inbox on its own login, else one Gmail list.
      signIn: async (address) => {
        if (!roster.some((x) => x.address === address)) return null;
        const m = imap.has(address) ? mailboxes.get(address) : undefined;
        if (m) {
          await withImap(imapClient(m.imap), async () => {});
          return "imap";
        }
        await gmail.listMessages(address, "in:inbox", { maxResults: 1 });
        return "gmail";
      },
    }),
  };
  services.push(
    makeDeliveryPortal({
      main: db,
      demoName: DEMO_NAME,
      files: settings.filesBucket ? s3Files({ bucket: settings.filesBucket }) : undefined,
      watched: portal !== null,
      zone: settings.sendTimezone,
      app: portal ?? undefined,
      domains: customDomains(),
    }),
    makeDomainsResolver({ main: db }),
    makeReactivationPortal({ main: db, open: openClient }),
    makeAsk(db),
    makeCallBriefs({
      ...callBriefs,
      // The email lane: a count and a link, named for the client. None with WREN_NOTIFY=none.
      notifierFor: (client) => {
        if (settings.notify === "none") return null;
        const lane = laneNotifier(settings.discordEmailWebhookUrl);
        return client ? namedFor(lane, client) : lane;
      },
      portal,
    }),
    makeSpine({
      main: db,
      clientDb,
      workflows: WORKFLOWS,
      components: COMPONENTS,
      // Parts register here as they move onto the spine; the rest keep arrivals and stop.
      steps: {
        // Account setups. With WREN_SETUP_AGENT a done-for-you step goes to SetupAgent on its
        // first round; off, it waits on Wren's team. Its alerts (stuck, waiting, done, lost)
        // tell the team on the clients lane.
        [SETUP_STEP]: setupStep({
          main: db,
          setups: SETUPS,
          checks: setupChecks,
          agent: settings.setupAgent
            ? (job, key) =>
                ingressSend(ingressOf(settings), { service: SETUP_AGENT, handler: "run" }, key, job)
            : null,
          notifierFor: setupLane,
          parts: setupParts,
        }),
        // A follow-up touch (no step) also reads the clients and why texts can't go now.
        [TOUCH]: touchStep(async (client) => {
          const { deps, off } = await textsOf(client);
          return { ...deps, main: db, off: textsWhy(deps.provider.name, off) };
        }),
        // Speed to lead's first text: live only with WREN_SMS_LIVE and the client's texts on.
        "sms.forms": firstTextStep(async (client) => {
          const { deps: d, off } = await textsOf(client);
          const why = textsWhy(d.provider.name, off);
          return {
            db: d.db,
            live: why === null,
            why,
            policy: d.policy,
            provider: d.provider,
            senderName: d.senderName,
            bookingLink: d.bookingLink ?? null,
            nudge: (key) =>
              ingressSend(
                ingressOf(settings),
                {
                  service: "SmsSender",
                  key: client ? clientKey(client, SENDER_KEY) : SENDER_KEY,
                  handler: "sync",
                },
                key,
              ),
          };
        }),
        // Speed to lead's call: "Call now" for the rep. No dialer until voice is set up.
        [CALL_NOW]: callNowStep(async (client) => {
          const { deps: d } = await textsOf(client);
          return { db: d.db, bookings: d.bookings ?? null, dialer: null };
        }),
        [EMAIL_TOUCH]: emailTouchStep((client) => (client ? clientDb(client) : db)),
        // A booked call's brief: built now, pinged to the team before the call.
        [CALL_BRIEF]: briefStep({
          ...callBriefs,
          queue: (ask, delayMs, key) =>
            ingressSend(
              ingressOf(settings),
              { service: "CallBriefs", handler: "send" },
              key,
              ask,
              delayMs,
            ),
        }),
        "reach.touch": reachTouchStep(
          db,
          { sequences: reach.sequences, sender: reach.senderName },
          clientDb,
          { off: () => (settings.reachLive ? null : "WREN_REACH_LIVE is off") },
        ),
        "watch.triage": triageStep(db, watchLlm),
        "watch.score": scoreStep(db, watchLlm, () => practicesOf(db)),
        // A bill in the Monitor's mail runs the books now; the books' pass is the box's.
        "books.bills": billsStep({
          mailOf: async (id) =>
            (
              await db
                .select({ fromAddress: watchMail.fromAddress, subject: watchMail.subject })
                .from(watchMail)
                .where(eq(watchMail.id, id))
            )[0] ?? null,
          runBooks: (key) =>
            ingressSend(
              ingressOf(settings),
              { service: "Books", key: BOOKS_KEY, handler: "sync" },
              key,
            ),
        }),
        // The Monitor's model: both read a few lines and answer in one.
        "comments.sort": sortStep(
          db,
          watchLlm,
          (p) => commentGuide(db, p as Platform),
          // A client's comment sorts in its database; the model only with the part installed and
          // its `models` gate open, metered. Else the words alone.
          async (client) => {
            const d = clientDb(client);
            const c = await findClient(db, client);
            const ok =
              !!c && "comments.sort" in c.products && (await gate(db, client, "models", 1)).ok;
            return {
              db: d,
              llm:
                ok && watchLlm
                  ? meteredModel(watchLlm, {
                      main: db,
                      client,
                      part: "comments.sort",
                      now: () => new Date(),
                    })
                  : null,
              guide: (p) => commentGuide(d, p as Platform),
            };
          },
          () => wrenFacts(db),
        ),
      },
      rule: async (when: string, e: SpineEvent) => {
        const r = await llm.complete(
          `Rule: ${when}\n\nEvent (${e.kind}, ${e.subject}):\n${JSON.stringify(e.data).slice(0, 4000)}`,
          { system: "Does the event pass the rule? Answer yes or no.", maxTokens: 5 },
        );
        return /^\s*yes/i.test(r.text);
      },
    }),
    // Each Schedule node's clock: started by publish and approve, a tick at each slot.
    makeSpineClock({ main: db, workflows: WORKFLOWS, components: COMPONENTS }),
    // Rechecks done setups on their repeat; off until started by hand.
    makeSetupWatch({
      main: db,
      setups: SETUPS,
      checks: setupChecks,
      parts: setupParts,
      notifierFor: setupLane,
      ...notify,
    }),
    // Done-for-you steps in the owner's autobrowse; only queued with WREN_SETUP_AGENT.
    makeSetupAgent({
      main: db,
      setups: SETUPS,
      parts: setupParts,
      wake: sitesHost(settings.autobrowseInstanceId).wake,
    }),
    // A client's accounts and vendors. No key store: the role can't write SSM yet (William's).
    makeAccountsConsole({
      db,
      setups: SETUPS,
      agent: settings.setupAgent,
      checks: new Set(Object.keys(setupChecks)),
      keys: null,
      env: "prod",
      parts: setupParts,
    }),
    makeConsolePortal({
      main: db,
      mainUrl: databaseUrl,
      setups: SETUPS,
      edge,
      views: EMAIL_CONSOLE_VIEWS,
      moneyViews: [...EMAIL_COST_VIEWS, ...BOOKS_CONSOLE_VIEWS],
      records: [
        ...emailRecords(roster, policy),
        ...BOOKS_RECORDS,
        ...WATCH_RECORDS,
        ...CALENDAR_RECORDS,
        ...VOICE_RECORDS,
        ...RESEARCH_RECORDS,
        ...marketingNumbers(mediaSigner),
        // Replays: read live from the lander, chunks signed from the files bucket. Heatmaps draw
        // on the newest one; without them, their counts still show.
        ...(sessions ? [sessionRecord(sessions), surveyAnswerRecord(sessions.site)] : []),
        heatRecord(sessions),
        // Videos: previews and stills signed from the media bucket (step 2 puts them there).
        videoRecord(
          settings.mediaBucket
            ? { bucket: settings.mediaBucket, host: s3MediaHost({ bucket: settings.mediaBucket }) }
            : undefined,
        ),
        // The Library's Media (the same files, one row each) and SOPs.
        mediaRecord(
          settings.mediaBucket
            ? { bucket: settings.mediaBucket, host: s3MediaHost({ bucket: settings.mediaBucket }) }
            : undefined,
        ),
        sopRecord,
        ...copyRecords(settings.smsSenderName),
        ...MARKETING_RECORDS,
        ...templateRecords(WORKFLOWS),
        clientRecord,
        // Each client's health and the flags about it (Clients).
        ...HEALTH_RECORDS,
        reviewRecord(),
        askRecord,
      ],
      components: COMPONENTS,
      workflows: WORKFLOWS,
      // A component's client loops start and stop with it, when this worker binds them.
      bound: (service) => services.some((x) => x.name === service),
      // "Ask for this": a line on the client's running project, where Wren answers, and a ping.
      asked: async (client, by, c) => {
        const e = await engagementOf(db, client.id).catch(() => null);
        if (e) await postUpdate(db, e, { body: `Asked for ${c.name}.`, author: by });
        await laneNotifier(settings.discordClientsWebhookUrl).notify(
          `Clients: ${client.id} asks for ${c.name}`,
          `${by} asked in the Marketplace.${e ? " It's on their project's updates: answer there." : ""}`,
          "action",
        );
      },
      admin: settings.restateAdminUrl
        ? restateAdmin(settings.restateAdminUrl, settings.restateAuthToken)
        : undefined,
      adminGet: settings.restateAdminUrl
        ? restateAdminGet(settings.restateAdminUrl, settings.restateAuthToken)
        : undefined,
      // Ask Claude reads the asker's own notes that match.
      askContext: (req, q) => notesContext(notesDeps, req, q),
    }),
    makeEmailConsole({
      db,
      senders: roster.map((s) => s.address),
      policy,
      campaigns,
      llmFor,
      clients,
    }),
    makeBooksConsole(db),
    makeReactivation({
      main: db,
      open: openClient,
      crm: { verifier, checker: defaultLocalChecker(), llm: classify ? llm : null },
      freeVerify: freeVerdicts,
      transport,
      ...clientsNotify,
    }),
  );

  return {
    services,
    summary: {
      llm: llm.name,
      classify,
      verifier: verifier.name,
      renderer: renderer ? settings.renderer : "none",
      transport: transport.name,
      senders: fleet.senders.length,
      compose_days_ahead: settings.composeDaysAhead,
      pool_model_stages: settings.poolModelStages,
      pool_profiles: settings.poolProfiles,
      notify: notifier.name,
      postmaster: postmaster !== null,
      opens: opens !== null,
      placement_seeds: settings.placementSeeds.length,
      report: report !== null,
      content: settings.contentChannels.join(",") || "none",
      ads: settings.metaAdAccountId ?? "first account",
      content_voice: voice !== null ? "file" : "default",
      sms: smsProvider.name,
      sms_live: settings.smsLive,
      reach_live: settings.reachLive,
      sms_alerts: Boolean(settings.smsPushPublicKey),
    },
    close: () => handle.close(),
  };
}

/**
 * Where Reddit calls go when `reddit` is on: its API with wren's own token
 * when WREN_REDDIT_* is set, else the Mac's desk worker (Reddit refused Wren
 * an API client on 2026-09-29; its browser legs need a home IP). Null when off.
 */
/** Each pushed SOP's newest text. */
async function playbooksOf(db: Db): Promise<{ label: string; text: string }[]> {
  const rows = await db
    .selectDistinctOn([contentPlaybooks.sop], {
      sop: contentPlaybooks.sop,
      text: contentPlaybooks.text,
    })
    .from(contentPlaybooks)
    .orderBy(contentPlaybooks.sop, desc(contentPlaybooks.createdAt));
  return rows.map((r) => ({ label: r.sop, text: r.text }));
}

/** The radar scores against each pushed SOP's newest text. */
const practicesOf = async (db: Db): Promise<Practice[]> =>
  (await playbooksOf(db)).map((r) => practiceOf(r.label, r.text));

function redditFrom(
  settings: Settings,
  on: readonly string[],
  log: Logger,
): SiteClient | "desk" | null {
  if (!on.includes("reddit")) return null;
  const { redditClientId, redditClientSecret, redditRefreshToken, redditUsername } = settings;
  if (!redditClientId || !redditClientSecret || !redditRefreshToken || !redditUsername) {
    log.info("reddit through the Mac's desk worker (no WREN_REDDIT_* API client)");
    return "desk";
  }
  return redditApi({
    clientId: redditClientId,
    clientSecret: redditClientSecret,
    refreshToken: redditRefreshToken,
    username: redditUsername,
  });
}

/** The content channels per invocation, or null (with one log line) when none is configured. */
function contentFor(settings: Settings, log: Logger): ChannelsFor | null {
  const on = settings.contentChannels;
  if (on.length === 0) {
    log.info("WREN_CONTENT_CHANNELS empty: no Content service");
    return null;
  }
  const sitesAt = sitesHost(settings.autobrowseInstanceId);
  log.info({ sites: sitesAt.service.name }, "autobrowse sites host");
  const host = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  log.info({ mediaBucket: settings.mediaBucket ?? "none" }, "media host");
  const meta = {
    ...(host ? { host } : {}),
    ...(settings.metaPageId ? { pageId: settings.metaPageId } : {}),
  };
  // Reddit: its API with wren's own token, or the Mac's desk worker, whatever the sites host.
  const reddit = redditFrom(settings, on, log);
  return (ctx) => {
    const sites = restateSites(ctx, { caller: "wren:content", ...sitesAt });
    return {
      // Wren's own login (William, 10-06): bare `linkedin` is his personal account, never used here.
      ...(on.includes("linkedin")
        ? { linkedin: linkedinContent(asAccount(sites, "linkedin@wren")) }
        : {}),
      ...(reddit
        ? {
            reddit: redditContent(
              reddit === "desk"
                ? restateSites(ctx, { caller: "wren:content", service: DESK })
                : journaledSites(ctx, reddit),
            ),
          }
        : {}),
      ...(on.includes("youtube") ? { youtube: youtubeContent(sites, host ? { host } : {}) } : {}),
      ...(on.includes("x") ? { x: xContent(sites, host ? { host } : {}) } : {}),
      // The Graph path needs a hosted URL and a Facebook Page (WREN_META_PAGE_ID);
      // until both exist the browser composer posts, fetching the signed URL itself.
      ...(on.includes("instagram")
        ? {
            instagram:
              host && settings.metaPageId
                ? instagramContent(sites, meta)
                : instagramWebContent(sites, host ? { host } : {}),
          }
        : {}),
      ...(on.includes("facebook") ? { facebook: facebookContent(sites, meta) } : {}),
      ...(on.includes("tiktok") ? { tiktok: tiktokContent(sites, host ? { host } : {}) } : {}),
    };
  };
}

/**
 * A client's content channels: its own LinkedIn and Reddit logins, only where Wren's are on
 * (WREN_CONTENT_CHANNELS), every read through its vendor gate. Posts wait on its live flag.
 */
function contentClientsFor(settings: Settings, db: Db): ContentClients {
  const on = settings.contentChannels;
  const sitesAt = sitesHost(settings.autobrowseInstanceId);
  return {
    channels: async (ctx, client, part) => {
      const logins = await ctx.run(`${client} logins`, async () => {
        const c = await clientContent(db, client, part);
        return c.kind === "work" ? c.logins : {};
      });
      const scope = {
        main: db,
        client,
        part,
        now: () => new Date(),
        step: <T>(name: string, fn: () => Promise<T>) => ctx.run(name, fn),
      };
      const metered = (sites: SiteClient, account: string) =>
        asAccount(meteredSites(sites, scope), account);
      const caller = `wren:content:${client}`;
      return {
        ...(logins.linkedin && on.includes("linkedin")
          ? {
              linkedin: linkedinContent(
                metered(restateSites(ctx, { caller, ...sitesAt }), logins.linkedin),
              ),
            }
          : {}),
        ...(logins.reddit && on.includes("reddit")
          ? {
              reddit: redditContent(
                metered(restateSites(ctx, { caller, service: DESK }), logins.reddit),
              ),
            }
          : {}),
      };
    },
    sends: async (client) => {
      const c = await findClient(db, client);
      return !!c && sendsOn(c, "content.posting");
    },
  };
}

/** The `Ads` service's dependencies: the sites host (as the content channels), the account and Page. */
function adsFor(settings: Settings): Parameters<typeof makeAds>[0] {
  const sitesAt = sitesHost(settings.autobrowseInstanceId);
  const host = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  return {
    sitesFor: (ctx) => restateSites(ctx, { caller: "wren:ads", ...sitesAt }),
    ...(settings.metaAdAccountId ? { adAccountId: settings.metaAdAccountId } : {}),
    ...(settings.metaPageId ? { pageId: settings.metaPageId } : {}),
    ...(host ? { host } : {}),
  };
}

/** The render tier for this host: a local chromium, or Browserbase where none can run. */
function rendererFor(
  settings: Settings,
  ua: string,
  log: Logger,
): (() => Promise<BrowserRenderer>) | null {
  if (settings.renderer === "local") return () => browserRenderer(ua);
  if (settings.renderer === "cdp") {
    const connectUrl = settings.cdpUrl;
    if (!connectUrl) {
      log.warn("WREN_RENDERER=cdp without WREN_CDP_URL: no render tier");
      return null;
    }
    return () => cdpRenderer(ua, { connectUrl });
  }
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    log.warn("WREN_RENDERER=browserbase without BROWSERBASE_API_KEY/PROJECT_ID: no render tier");
    return null;
  }
  return () => browserbaseRenderer(ua, { apiKey, projectId });
}
