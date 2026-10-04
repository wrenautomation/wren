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
  delegatedMailbox,
  dirStore,
  s3Store,
  siteMailbox,
} from "@wren/books";
import { BOOKS_RECORDS } from "@wren/books/records";
import { makeBooks } from "@wren/books/restate";
import {
  activeSenders,
  Broadcast,
  ConsoleTransport,
  campaignPolicy,
  type DomainTarget,
  defaultLocalChecker,
  expandHome,
  GmailClient,
  GmailTransport,
  ImapReader,
  type InboxReader,
  loadMailboxes,
  loadRoster,
  loadServiceAccountKey,
  makeNotifier,
  makeVerifier,
  type Notifier,
  namedDomains,
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
  type Transport,
} from "@wren/channel-email";
import { emailRecords } from "@wren/channel-email/records";
import {
  type Campaign,
  DISPOSITION_KEY,
  dailyOpenerCapacity,
  makeComposeScheduler,
  makeDigestScheduler,
  makeDisposition,
  makeEmailConsole,
  makeInboxScheduler,
  makeOpensScheduler,
  makePoolScheduler,
  makePostmasterScheduler,
  makeQueueRefresh,
  makeReportScheduler,
  makeResolution,
  makeSendScheduler,
  type SendScope,
} from "@wren/channel-email/restate";
import { EMAIL_CONSOLE_VIEWS } from "@wren/channel-email/views";
import { linkedinContent } from "@wren/channel-linkedin";
import { facebookContent, instagramContent, instagramWebContent } from "@wren/channel-meta";
import { makeAds, makeAdsWatch } from "@wren/channel-meta/restate";
import { redditApi, redditContent } from "@wren/channel-reddit";
import { searchConsoleClient } from "@wren/channel-search";
import { makeSearchWatch, makeSearchWeek } from "@wren/channel-search/restate";
import {
  CalcomBookings,
  healthFrom,
  NoProvider,
  policyFrom,
  providerFrom,
  pusherFrom,
  SmsNotifier,
} from "@wren/channel-sms";
import { makeSmsDesk, makeSmsEvents, makeSmsSender, makeSmsWatch } from "@wren/channel-sms/restate";
import { tiktokContent } from "@wren/channel-tiktok";
import { xContent } from "@wren/channel-x";
import { youtubeContent } from "@wren/channel-youtube";
import { ingressOf, type Settings } from "@wren/config";
import { s3MediaHost } from "@wren/content";
import {
  makeContentDesk,
  makeContentMetrics,
  makeContentPlanner,
  makeContentScheduler,
} from "@wren/content/restate";
import { makeAuditSealer } from "@wren/core/audit";
import { CalcomCalendar } from "@wren/core/calendar";
import { clientRecord } from "@wren/core/clients";
import { makeConsolePortal, restateAdmin } from "@wren/core/console";
import type { SiteClient } from "@wren/core/content";
import { sitesHost } from "@wren/core/content/box";
import { ingressSites } from "@wren/core/content/ingress";
import { makeTokenRenewal } from "@wren/core/content/renewal";
import {
  type ChannelsFor,
  DESK,
  journaledSites,
  makeContent,
  restateSites,
} from "@wren/core/content/restate";
import { clientKey, clientOfKey } from "@wren/core/restate";
import { cachedDb, clientDatabaseName, clientDatabaseUrl, createDb } from "@wren/db";
import { s3Files } from "@wren/delivery/files";
import { makeDeliveryPortal, makeDeliveryWatch } from "@wren/delivery/restate";
import { loadLlmEnv, makeLlm, makeTracer } from "@wren/llm";
import {
  crawlHintsFor,
  discoveryWordsFor,
  LANDERS_BY_NICHE,
  NICHES,
  SMS_SEQUENCES,
} from "@wren/niches";
import { REACH_SEQUENCES, policyFrom as reachPolicyFrom } from "@wren/outreach";
import { makeReachDesk, makeReachSender, makeReachWatch } from "@wren/outreach/restate";
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
import { s3PageStore } from "@wren/research/pages";
import { makeDiscovery, makeEnrichment, makePageArchive } from "@wren/research/restate";
import type { Logger } from "pino";

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

export const POOL_CHAIN = ["PoolScheduler", "Discovery", "Enrichment", "Resolution"];
/**
 * Everything the box serves: the chain; the page archive, which moves rows out of
 * its own disk; and the books' day, which waits on the model and the Mac's desk.
 */
export const BOX_SERVICES = [...POOL_CHAIN, "PageArchive", "Books"];

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

export async function buildServices(
  settings: Settings,
  log: Logger,
  opts: BuildOptions,
): Promise<Services> {
  const { rootDir } = opts;
  const handle = createDb(settings.databaseUrl, {
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
  // Warm replies wait on William, so their pings also text his phone (Discord stays the log).
  const replyNotifier =
    settings.operatorPhone && settings.smsLive && smsProvider.name === "telnyx"
      ? new Broadcast([
          laneNotifier(settings.discordEmailWebhookUrl),
          new SmsNotifier(db, smsProvider, settings.operatorPhone),
        ])
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
    cachedDb(clientDatabaseUrl(settings.databaseUrl, client.database), { app: WORKER_APP });
  const clientDb = (id: string) => openClient({ database: clientDatabaseName(id) });
  const clients = { main: db, open: openClient, policy };
  // One campaign per registered niche: its plan, copy and the inboxes it may send from,
  // each sign-off already pointing at the niche's page. The queue-keeper reads these.
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
          templates: niche.templates,
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
  const services: AnyService[] = [
    // A dead firm site at 30s × 3 tries held one shard ~90s a page; a live one answers in seconds.
    makeEnrichment({
      db,
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
      recheck: recheckLeads,
    }),
    // Discovery probes guessed hosts, most of them parked or dead: a short timeout and
    // one try per URL, or a single company's guesses can eat a Lambda invocation.
    makeDiscovery({
      db,
      fetcher: ua ? new PoliteFetcher(ua, { timeout: 8, retries: 1 }) : null,
      genericWordsFor: discoveryWordsFor,
    }),
    makeResolution({
      db,
      verifier,
      openPool: (max) => createDb(settings.databaseUrl, { max, app: WORKER_APP }),
    }),
    // A plain key is one of Wren's inboxes; `<client>/<mailbox>` is a client's (R4, R12:
    // its mailboxes are in Wren's Workspace, so the same transport and reader serve them).
    makeSendScheduler({
      transport,
      scopeOf: (key) => (clientOfKey(key) ? clientSendScope(clients, key) : wrenScope()),
      tickMs,
      ...emailNotify,
    }),
    makeInboxScheduler({
      reader,
      scopeOf: (key) => {
        const owner = clientOfKey(key);
        return owner
          ? { db: clientDb(owner.client), disposition: clientKey(owner.client, "replies") }
          : { db, disposition: DISPOSITION_KEY };
      },
      syncMs,
      tickMs,
      classify,
      ...emailNotify,
    }),
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
    }),
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
        ...emailNotify,
      }),
    );
  }
  // Deploy calls it once the new version is registered: queued mail takes the new templates.
  services.push(makeQueueRefresh({ db, campaigns, trackOpens: settings.openTracking }));
  // The pool-feeder walks the research chain per niche; what may spend is a setting.
  services.push(
    makePoolScheduler({
      db,
      policy,
      modelStages: settings.poolModelStages,
      freeVerifier: freeVerdicts,
      recheck: {
        horizonDays: settings.verificationHorizonDays,
        policy: (niche) => campaigns.get(niche)?.recontact,
      },
      // A week of the niche's sends ahead of compose; off unless WREN_POOL_PROFILES.
      ...(settings.poolProfiles
        ? {
            profiles: {
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
            },
          }
        : {}),
    }),
  );
  // The digest's mail domains: every sending domain, then the main site and any other
  // domain a signature names. A domain with a ramped inbox was bought for sending, so
  // it must sit on Route 53; DKIM is at the roster's selector, else `google`.
  const siteDomains = new Set([
    new URL(settings.siteBaseUrl).hostname,
    ...roster.flatMap((s) => namedDomains(s.signature?.text ?? "")),
  ]);
  const mailDomains: DomainTarget[] = [
    ...sendingDomains.map((domain) => {
      const on = roster.filter((s) => senderDomain(s) === domain);
      const smtp = on.find((s) => s.transport === "smtp");
      return {
        domain,
        fleet: on.some((s) => s.ramp !== null),
        dkimSelector: on.find((s) => s.dkim)?.dkim ?? "google",
        smtpHost: smtp ? (mailboxes.get(smtp.address)?.smtp.host ?? null) : null,
      };
    }),
    ...[...siteDomains]
      .filter((d) => !sendingDomains.includes(d))
      .map((domain) => ({ domain, fleet: false, dkimSelector: null, smtpHost: null })),
  ];
  if (settings.notify !== "none")
    services.push(
      makeDigestScheduler({
        db,
        notifier,
        policy,
        probers: proberHosts(settings.smtpProbeUrl),
        domains: mailDomains,
        ramps: fleet.ramps ?? {},
      }),
    );
  // Bound only when configured: an object with nothing to pull is better absent than failing every pass.
  if (postmaster) {
    services.push(
      makePostmasterScheduler({ db, client: postmaster, domains: sendingDomains, policy }),
    );
  }
  if (opens) services.push(makeOpensScheduler({ db, ...opens, syncMs, tickMs }));
  // The Friday report mails from a fleet inbox by default: the one mailbox the
  // service account is known to be able to impersonate.
  const reportFrom = settings.reportFrom ?? fleet.senders[0] ?? null;
  const report =
    settings.reportTo && reportFrom ? { to: settings.reportTo, from: reportFrom } : null;
  if (settings.reportTo && !report) log.warn("WREN_REPORT_TO set but no sender to mail from");
  if (report) services.push(makeReportScheduler({ db, transport, mail: report, policy }));
  // Content channels (LinkedIn, YouTube) over autobrowse's `sites` service, as the `Content` service.
  const content = contentFor(settings, log);
  if (content) services.push(makeContent(content));
  // Meta ads over the same `sites` service, as `Ads`. Always bound: a launch on a box without
  // the meta site fails on its own invocation, and nothing spends until `start`.
  services.push(
    makeAds({ ...adsFor(settings), db }),
    makeAdsWatch({ db, pauseAfterUsd: settings.adsPauseAfterUsd, ...adsNotify }),
  );
  // The content loop: ideas → drafts (ContentDesk, paid) → approved drafts posted (ContentScheduler).
  // Always bound: drafting needs no channel; a publish with none configured fails on its row.
  const voice = settings.contentVoicePath ? readFileSync(settings.contentVoicePath, "utf8") : null;
  services.push(
    makeContentDesk({
      db,
      llm,
      platforms: settings.contentChannels,
      tracer,
      ...(voice !== null ? { voice } : {}),
    }),
    makeContentScheduler({ db, linkSite: settings.contentLinkSite ?? null, ...contentNotify }),
    makeContentMetrics({ db, ...contentNotify }),
    // Tomorrow's slots vs scheduled drafts, said once a day; off until `wren content planner start`.
    makeContentPlanner({ db, zone: settings.sendTimezone, ...contentNotify }),
  );
  // autobrowse's tokens made again before they lapse (LinkedIn's 60 days, npm's 90).
  services.push(
    makeTokenRenewal({ db, host: sitesHost(settings.autobrowseInstanceId), ...notify }),
  );
  // The audit log's seals in every database, every 15 minutes; off until `wren audit sealer start`.
  services.push(makeAuditSealer({ main: db, open: openClient, ...notify }));
  // Page HTML a day old moves to the pages bucket; off until `wren pages archive start`.
  services.push(makePageArchive({ db, pages, ...notify }));
  // The books' day: billing mail kept, read and posted, AWS spend in, alerts out;
  // off until `wren books loop start`.
  services.push(
    makeBooks({
      db,
      llm,
      mailboxes: settings.booksMailboxes.map((m) =>
        m.via === "delegated"
          ? delegatedMailbox(gmail, m.address)
          : // Inside the pass's one step, so through the ingress; a Mac that is off is an alert, not a hang.
            siteMailbox(
              ingressSites(ingressOf(settings), {
                caller: "wren:books",
                service: DESK,
                timeoutMs: BOOKS_DESK_TIMEOUT_MS,
              }),
              m.address,
            ),
      ),
      store: settings.booksBucket
        ? s3Store(settings.booksBucket)
        : dirStore(resolve(rootDir, ".books")),
      rates: bankOfCanada(),
      aws: settings.booksAwsUsage ? awsCostExplorer() : null,
      since: settings.booksSince,
      ...notify,
    }),
  );
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
    heldNiches: settings.smsHeldNiches,
    site: settings.siteExportToken
      ? { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken }
      : null,
    bookings: settings.calcomApiKey ? new CalcomBookings(settings.calcomApiKey) : null,
    pusher: pusherFrom(settings),
    llm: classify ? llm : null,
    ...smsNotify,
  };
  services.push(makeSmsSender(sms), makeSmsEvents(sms), makeSmsDesk(sms), makeSmsWatch(sms));
  // Cold outreach on Reddit and LinkedIn, over the Mac's desk worker as each
  // reach account. Always bound: the sender and watch are off until
  // `wren reach queue start` / `wren reach watch start`, and nothing leaves
  // until WREN_REACH_LIVE says so.
  if (!settings.reachLive) log.info("WREN_REACH_LIVE off: reach plans and holds, nothing is sent");
  const reach = {
    db,
    policy: reachPolicyFrom(settings),
    sequences: REACH_SEQUENCES,
    live: settings.reachLive,
    senderName: settings.smsSenderName,
    heldNiches: settings.reachHeldNiches,
    sitesFor: (ctx: Context) => restateSites(ctx, { caller: "wren:reach", service: DESK }),
    ...reachNotify,
  };
  services.push(makeReachSender(reach), makeReachWatch(reach), makeReachDesk(reach));
  // Search: Search Console daily, the answer engines and edit proposals weekly (on the Mac's desk).
  // Bound only with a property named; off until `wren search watch start`.
  if (settings.searchSite && settings.searchOrigin) {
    const search = {
      db,
      console: searchConsoleClient(loadServiceAccountKey(keyPath)),
      site: settings.searchSite,
      origin: settings.searchOrigin,
      fetch: (url: string, init?: RequestInit) => fetch(url, init),
      ...searchNotify,
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
        ...clientsNotify,
      }),
    );
  else log.info("WREN_PORTAL_ORIGIN unset: no DeliveryWatch");
  services.push(
    makeDeliveryPortal({
      main: db,
      demoName: DEMO_NAME,
      files: settings.filesBucket ? s3Files({ bucket: settings.filesBucket }) : undefined,
      watched: portal !== null,
      zone: settings.sendTimezone,
    }),
    makeReactivationPortal({ main: db, open: openClient }),
    makeConsolePortal({
      main: db,
      mainUrl: settings.databaseUrl,
      views: [...EMAIL_CONSOLE_VIEWS, ...BOOKS_CONSOLE_VIEWS],
      records: [...emailRecords(roster, policy), ...BOOKS_RECORDS, clientRecord],
      admin: settings.restateAdminUrl
        ? restateAdmin(settings.restateAdminUrl, settings.restateAuthToken)
        : undefined,
    }),
    makeEmailConsole({ db, senders: roster.map((s) => s.address), policy }),
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
      ...(on.includes("linkedin") ? { linkedin: linkedinContent(sites) } : {}),
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
