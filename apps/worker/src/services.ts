/**
 * Every Restate service the worker serves, built once from settings. Shared by
 * the two hosts: the Node listener (`main.ts`, local/compose) and the Lambda
 * handler (`lambda.ts`, Restate Cloud). Nothing here assumes a process lifetime
 * beyond one invocation: state lives in Restate and Postgres.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ServiceDefinition, VirtualObjectDefinition } from "@restatedev/restate-sdk";
import {
  activeSenders,
  ConsoleTransport,
  defaultLocalChecker,
  expandHome,
  GmailClient,
  GmailTransport,
  type InboxReader,
  loadRoster,
  loadServiceAccountKey,
  makeNotifier,
  makeVerifier,
  type PostmasterClient,
  postmasterToken,
  rosterFleet,
  SendPolicy,
  senderDomain,
  type Transport,
} from "@wren/channel-email";
import {
  type Campaign,
  DISPOSITION_KEY,
  makeComposeScheduler,
  makeDigestScheduler,
  makeDisposition,
  makeInboxScheduler,
  makeOpensScheduler,
  makePoolScheduler,
  makePostmasterScheduler,
  makeReportScheduler,
  makeResolution,
  makeSendScheduler,
  oneScope,
} from "@wren/channel-email/restate";
import { linkedinContent } from "@wren/channel-linkedin";
import { facebookContent, instagramContent, instagramWebContent } from "@wren/channel-meta";
import { makeAds, makeAdsWatch } from "@wren/channel-meta/restate";
import { redditApi, redditContent } from "@wren/channel-reddit";
import { searchConsoleClient } from "@wren/channel-search";
import { makeSearchWatch, makeSearchWeek } from "@wren/channel-search/restate";
import { healthFrom, NoProvider, policyFrom, providerFrom } from "@wren/channel-sms";
import { makeSmsDesk, makeSmsEvents, makeSmsSender, makeSmsWatch } from "@wren/channel-sms/restate";
import { tiktokContent } from "@wren/channel-tiktok";
import { xContent } from "@wren/channel-x";
import { youtubeContent } from "@wren/channel-youtube";
import type { Settings } from "@wren/config";
import { s3MediaHost } from "@wren/content";
import {
  makeContentDesk,
  makeContentMetrics,
  makeContentPlanner,
  makeContentScheduler,
} from "@wren/content/restate";
import { makeAuditSealer } from "@wren/core/audit";
import type { SiteClient } from "@wren/core/content";
import { ec2Wake } from "@wren/core/content/box";
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
import { makeDeliveryPortal } from "@wren/delivery/restate";
import { loadLlmEnv, makeLlm, makeTracer } from "@wren/llm";
import {
  crawlHintsFor,
  discoveryWordsFor,
  LANDERS_BY_NICHE,
  NICHES,
  SMS_SEQUENCES,
} from "@wren/niches";
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
import { makeDiscovery, makeEnrichment } from "@wren/research/restate";
import type { Logger } from "pino";

/** The worker's application_name on every connection, kept on each audit event. */
const WORKER_APP = "wren-worker";

export type AnyService =
  | ServiceDefinition<string, unknown>
  | VirtualObjectDefinition<string, unknown>;

export interface Services {
  services: AnyService[];
  /** What was wired, for the startup log line. Never a secret. */
  summary: Record<string, string | number | boolean>;
  close(): Promise<void>;
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
  });
  const notify = settings.notify === "none" ? {} : { notifier };

  // The send loop: console prints until cutover flips WREN_SEND_TRANSPORT=gmail.
  // The roster names the live fleet; without one nothing may send, so a missing
  // file degrades to an empty fleet rather than a worker that will not start.
  const policy = SendPolicy.fromSettings(settings);
  const roster = (() => {
    try {
      return loadRoster(resolve(rootDir, settings.sendersFile), new Set(NICHES.map((n) => n.name)));
    } catch (err) {
      log.warn({ err: (err as Error).message }, "no sender roster: the send loop sends nothing");
      return [];
    }
  })();
  const fleet = rosterFleet(roster, activeSenders(roster), Object.fromEntries(LANDERS_BY_NICHE));
  const wrenScope = oneScope({
    db,
    policy,
    fleet,
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
          sequences: niche.sequences,
          offers: niche.offers,
          offerFacts: niche.offerFacts,
          templates: niche.templates,
          factsView: niche.factsView,
          senders: active.map((s) => s.address),
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
  const transport: Transport =
    settings.sendTransport === "gmail" ? new GmailTransport(gmail) : new ConsoleTransport();

  // The inbox side reads the real mailboxes whatever the send transport: replies,
  // bounces and unsubscribes to the Python fleet's sends are still ours to act on.
  const reader: InboxReader = gmail;
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

  const services: AnyService[] = [
    makeEnrichment({
      db,
      fetcher: ua ? new PoliteFetcher(ua) : null,
      llm,
      renderer,
      tracer,
      robotsMode: settings.robotsMode,
      crawlHintsFor,
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
      scopeOf: (key) => (clientOfKey(key) ? clientSendScope(clients, key) : wrenScope(key)),
      tickMs,
      ...notify,
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
      ...notify,
    }),
    makeDisposition({
      dbOf: (key) => {
        const owner = clientOfKey(key);
        return owner ? clientDb(owner.client) : db;
      },
      llm,
      tracer,
      tracing: settings.tracing,
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
        ...notify,
      }),
    );
  }
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
    }),
  );
  if (settings.notify !== "none") services.push(makeDigestScheduler({ db, notifier, policy }));
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
    makeAdsWatch({ db, pauseAfterUsd: settings.adsPauseAfterUsd, ...notify }),
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
    makeContentScheduler({ db, linkSite: settings.contentLinkSite ?? null, ...notify }),
    makeContentMetrics({ db, ...notify }),
    // Tomorrow's slots vs scheduled drafts, said once a day; off until `wren content planner start`.
    makeContentPlanner({ db, zone: settings.sendTimezone, ...notify }),
  );
  // autobrowse's tokens made again before they lapse (LinkedIn's 60 days, npm's 90); the box is woken for it.
  const wake = settings.autobrowseInstanceId ? ec2Wake(settings.autobrowseInstanceId) : undefined;
  services.push(makeTokenRenewal({ db, ...(wake ? { wake } : {}), ...notify }));
  // The audit log's seals in every database, every 15 minutes; off until `wren audit sealer start`.
  services.push(makeAuditSealer({ main: db, open: openClient, ...notify }));
  // Cold SMS. Always bound: the sender is off until `wren sms queue start`, and a real
  // provider sends nothing until WREN_SMS_LIVE (the registered campaign) says so.
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
  const sms = {
    db,
    provider: smsProvider,
    policy: policyFrom(settings),
    health: healthFrom(settings),
    live: settings.smsLive,
    sequences: SMS_SEQUENCES,
    senderName: settings.smsSenderName,
    heldNiches: settings.smsHeldNiches,
    llm: classify ? llm : null,
    ...notify,
  };
  services.push(makeSmsSender(sms), makeSmsEvents(sms), makeSmsDesk(sms), makeSmsWatch(sms));
  // Search: Search Console daily, the answer engines and edit proposals weekly (on the Mac's desk).
  // Bound only with a property named; off until `wren search watch start`.
  if (settings.searchSite && settings.searchOrigin) {
    const search = {
      db,
      console: searchConsoleClient(loadServiceAccountKey(keyPath)),
      site: settings.searchSite,
      origin: settings.searchOrigin,
      fetch: (url: string, init?: RequestInit) => fetch(url, init),
      ...notify,
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
  services.push(
    makeDeliveryPortal({ main: db, demoName: DEMO_NAME }),
    makeReactivationPortal({ main: db, open: openClient }),
    makeReactivation({
      main: db,
      open: openClient,
      crm: { verifier, checker: defaultLocalChecker(), llm: classify ? llm : null },
      freeVerify: freeVerdicts,
      transport,
      ...notify,
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
      notify: notifier.name,
      postmaster: postmaster !== null,
      opens: opens !== null,
      report: report !== null,
      content: settings.contentChannels.join(",") || "none",
      ads: settings.metaAdAccountId ?? "first account",
      content_voice: voice !== null ? "file" : "default",
      sms: smsProvider.name,
      sms_live: settings.smsLive,
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
  const wake = settings.autobrowseInstanceId ? ec2Wake(settings.autobrowseInstanceId) : undefined;
  log.info({ wake: settings.autobrowseInstanceId ?? "none" }, "autobrowse box wake");
  const host = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  log.info({ mediaBucket: settings.mediaBucket ?? "none" }, "media host");
  const meta = {
    ...(host ? { host } : {}),
    ...(settings.metaPageId ? { pageId: settings.metaPageId } : {}),
  };
  // Reddit: its API with wren's own token, or the Mac's desk worker; no box to wake either way.
  const reddit = redditFrom(settings, on, log);
  return (ctx) => {
    const sites = restateSites(ctx, { caller: "wren:content", wake });
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

/** The `Ads` service's dependencies: the box (woken like the content channels), the account and Page. */
function adsFor(settings: Settings): Parameters<typeof makeAds>[0] {
  const wake = settings.autobrowseInstanceId ? ec2Wake(settings.autobrowseInstanceId) : undefined;
  const host = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  return {
    sitesFor: (ctx) => restateSites(ctx, { caller: "wren:ads", wake }),
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
