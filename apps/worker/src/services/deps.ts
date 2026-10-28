/**
 * The shared objects every domain file wires its services from (`buildDeps`), the module-level
 * helpers more than one domain uses, and the `Deps` type they all take.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Context,
  ObjectContext,
  ServiceDefinition,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk";
import {
  AllBookings,
  CALENDAR_SCOPE,
  CalendarBookings,
  calendarChecks,
  GoogleHost,
} from "@wren/calendar";
import {
  activeSenders,
  ConsoleTransport,
  emailChecks,
  GmailClient,
  GmailTransport,
  InstantlyTransport,
  loadMailboxes,
  loadRoster,
  makeFiller,
  makeNotifier,
  makeVerifier,
  type Notifier,
  type PostmasterClient,
  plainMailer,
  RoutedTransport,
  rosterFleet,
  SendPolicy,
  SmtpTransport,
  type Transport,
} from "@wren/channel-email";
import { mailAccess, mailAppsFrom } from "@wren/channel-email/access/access";
import { mailChecks } from "@wren/channel-email/access/setups";
import { briefSettingsOf, CALL_BRIEF, landerVisits } from "@wren/channel-email/calls";
import type { Campaign } from "@wren/channel-email/restate";
import { metaChecks } from "@wren/channel-meta";
import { searchConsoleChecks, searchConsoleClient } from "@wren/channel-search";
import {
  answerChecks,
  CalcomBookings,
  type ClientSms,
  formCountriesFrom,
  healthFrom,
  keyedProvider,
  meteredProvider,
  NoProvider,
  policyFrom,
  providerFrom,
  pusherFrom,
  SmsNotifier,
  smsChecks,
  TelnyxProvider,
} from "@wren/channel-sms";
import { ingressOf, type Settings } from "@wren/config";
import { commentGuide, DEFAULT_VOICE, dmGuide, s3MediaHost } from "@wren/content";
import {
  liveFrom,
  socialAccess,
  socialAppsFrom,
  socialChecks,
  socialSites,
} from "@wren/content/connect";
import { ourPosts } from "@wren/content/our-posts";
import {
  autoReplyFire,
  type ContentDesk,
  clientDrafting,
  DESK_KEY,
  DESK_UNIT,
  SOCIAL_KEY,
  type SocialPushed,
} from "@wren/content/restate";
import { contentDrafts, contentPlaybooks } from "@wren/content/schema";
import { resolve as dohResolve } from "@wren/core";
import {
  type BroadcastMail,
  EMAIL_DAILY,
  type MailOf,
  PERSONAL_DAILY,
} from "@wren/core/broadcasts";
import { CalcomCalendar } from "@wren/core/calendar";
import { findClient, settingsFor } from "@wren/core/clients";
import { sitesHost } from "@wren/core/content/box";
import { ingressSites } from "@wren/core/content/ingress";
import { DESK, restateSites, type SitesService } from "@wren/core/content/restate";
import { executorFire, type FireTriggers } from "@wren/core/executor";
import { wrenFacts } from "@wren/core/facts";
import { siteEdge } from "@wren/core/flag-store";
import { keyStoreFromEnv } from "@wren/core/keys";
import { delegatedMailbox, type Mailbox, siteMailbox } from "@wren/core/mailbox";
import { linkKey, marketingEnvelope } from "@wren/core/marketing";
import { readMessageSettings } from "@wren/core/message-settings";
import { meteredModel } from "@wren/core/metered";
import { namedFor } from "@wren/core/notify";
import { PortalRefusal } from "@wren/core/portal";
import { answers, clientKey, LIMITS, within } from "@wren/core/restate";
import { dnsChecks } from "@wren/core/setup";
import { vendorKeys } from "@wren/core/vendor-keys";
import { meterTokens } from "@wren/core/vendors";
import { cachedDb, clientDatabaseName, clientDatabaseUrl, createDb, type Db } from "@wren/db";
import { s3Files } from "@wren/delivery/files";
import { askNoteSop } from "@wren/learn";
import {
  type LlmClient,
  llmForKey,
  loadLlmEnv,
  makeLlm,
  makeTracer,
  observeUsage,
  withPart,
} from "@wren/llm";
import { LANDERS_BY_NICHE, NICHES, SMS_SEQUENCES } from "@wren/niches";
import type { NoteTurns } from "@wren/notes/console";
import { DRIVE_READ_SCOPE, googleDrive } from "@wren/notes/drive";
import {
  ArmedLlm,
  type DmPlatform,
  REACH_SEQUENCES,
  policyFrom as reachPolicyFrom,
  savedArms,
} from "@wren/outreach";
import { stripeChecks } from "@wren/payments/setups";
import {
  type BrowserRenderer,
  browserbaseRenderer,
  browserRenderer,
  cdpRenderer,
} from "@wren/research";
import {
  expandHome,
  loadServiceAccountKey,
  postmasterToken,
  type ServiceAccountKey,
  serviceAccountToken,
} from "@wrenautomation/autobrowse/google";
import { InstantlyReader, imapClient, withImap } from "@wrenautomation/autobrowse/mail";
import { userAgent } from "@wrenautomation/weaver/fetch";
import { desc, eq, max } from "drizzle-orm";
import type { Logger } from "pino";
import { COMPONENTS } from "../components.js";

/** The service-account key at `path`; a bad key names wren's env var, not the piece's default. */
export const googleKey = (path: string): ServiceAccountKey =>
  loadServiceAccountKey(path, "WREN_GOOGLE_SERVICE_ACCOUNT");

/** The worker's application_name on every connection, kept on each audit event. */
export const WORKER_APP = "wren-worker";

/** Wren's intro call on cal.com, the event every live offer's `booking` names. */
const WREN_CALL = { username: "wrenautomation", slug: "call" };

/** One desk call from the books' day; past it the mailbox waits for tomorrow's pass. */
export const BOOKS_DESK_TIMEOUT_MS = 120_000;

/** A setup check's read through autobrowse: gives up, never wakes the box; the next round asks again. */
const SETUP_READ_TIMEOUT_MS = 30_000;

/** Through PgBouncer on the box when a pool port is set; each client database's URL follows. */
function pooled({ databaseUrl, databasePoolPort }: Settings): string {
  if (!databasePoolPort) return databaseUrl;
  const url = new URL(databaseUrl);
  url.port = String(databasePoolPort);
  return url.toString();
}

/** Each pushed SOP's newest text. */
export async function playbooksOf(db: Db): Promise<{ label: string; text: string }[]> {
  const rows = await db
    .selectDistinctOn([contentPlaybooks.sop], {
      sop: contentPlaybooks.sop,
      text: contentPlaybooks.text,
    })
    .from(contentPlaybooks)
    .orderBy(contentPlaybooks.sop, desc(contentPlaybooks.createdAt));
  return rows.map((r) => ({ label: r.sop, text: r.text }));
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

export type AnyService =
  | ServiceDefinition<string, unknown>
  | VirtualObjectDefinition<string, unknown>;

export interface BuildOptions {
  /** Where relative settings paths (roster, llm.env) resolve. */
  rootDir: string;
  /** Postgres pool size; small on Lambda, where every instance has its own. */
  dbPoolMax?: number;
}

/**
 * Everything the domain files share, built once from settings before any service is: the
 * database, the model clients, notifiers, the fleet and its transport, each client's doors, and
 * the closures more than one domain wires in (texts, reach, mail, setups, briefs). `bound`
 * answers whether a service name is served here; the console portal asks it per call.
 */
export async function buildDeps(
  settings: Settings,
  log: Logger,
  opts: BuildOptions,
  bound: (service: string) => boolean,
) {
  // The executor hears every trigger; a reply also reaches AutoReply.
  const fireAll: FireTriggers = (ctx, req) => {
    executorFire(ctx, req);
    autoReplyFire(ctx, req);
  };
  const { rootDir } = opts;
  const databaseUrl = pooled(settings);
  const handle = createDb(databaseUrl, {
    app: WORKER_APP,
    ...(opts.dbPoolMax ? { max: opts.dbPoolMax } : {}),
  });
  const db = handle.db;
  // Key fleets and provider keys live in llm.env (or the host's env); never logged.
  loadLlmEnv(settings.llmEnvPath, rootDir);
  // Every Anthropic response of Wren's own, once, at the client seam: tokens and dollars on the
  // `anthropic` vendor, on the part that asked (a call's `opts.part`, else the default named
  // here). Other providers pass through. A write that fails is logged, never the model call.
  // Calls run inside their caller's journaled step, so a replay returns the journaled answer
  // and writes no second row.
  const counted = <L extends LlmClient>(m: L, part: string): L =>
    m.provider === "anthropic"
      ? observeUsage(m, {
          part,
          warn: (line) => log.warn(line),
          record: (r) =>
            meterTokens(db, {
              model: r.model,
              part: r.part,
              warn: (line) => log.warn(line),
              usage: {
                input: r.usage.input,
                output: r.usage.output,
                cacheRead: r.usage.cache_read,
                cacheWrite: r.usage.cache_write,
              },
            }),
        })
      : m;
  const llm = counted(
    makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel }),
    "llm",
  );
  const ua = settings.fetchContact ? userAgent(settings.fetchContact) : null;
  if (!ua) log.warn("WREN_FETCH_CONTACT unset: crawl and render will refuse until it is");
  // Clients' own keys, sealed in main (designs/2026-10-07-key-store.md). The private key comes
  // from its own SSM parameter; without it saving a key says the store isn't set up.
  const keys = keyStoreFromEnv(db, process.env);
  if (!keys) log.info("WREN_KEYSTORE_KEY unset: clients' own keys can't be saved or used here");
  // Client social accounts (designs/2026-10-07-client-social.md): Wren's apps and each account's
  // token in the key store, never printed; their API calls go straight to each platform.
  const clientSocial = socialAccess({
    main: db,
    apps: socialAppsFrom(keys, process.env),
    keys,
    origin: settings.portalOrigin ?? null,
    fetch,
    live: liveFrom(settings.socialLive),
  });
  const socialApi = socialSites({
    connection: clientSocial.connection,
    tokenOf: clientSocial.tokenOf,
    broke: clientSocial.broke,
    fetch,
  });
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
  const smsNotify = lane(settings.discordSmsWebhookUrl);
  const reachNotify = lane(settings.discordReachWebhookUrl);
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
  // Wren's own texts on Wren's key, metered; a client's go through `keyedProvider` below.
  const wrenSms = smsProvider.name === "telnyx" ? meteredProvider(smsProvider, db) : smsProvider;
  // A text to William's phone, once the registered campaign is live.
  const operatorText =
    settings.operatorPhone && settings.smsLive && smsProvider.name === "telnyx"
      ? new SmsNotifier(db, wrenSms, settings.operatorPhone)
      : null;
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
  // Each client's own database, pooled per client; its name follows from the id.
  const openClient = (client: { database: string }) =>
    cachedDb(clientDatabaseUrl(databaseUrl, client.database), { app: WORKER_APP });
  const clientDb = (id: string) => openClient({ database: clientDatabaseName(id) });
  // Drive import reads as the service account (a doc shared with it), else by public link; the
  // key loads on first use, so a worker without one still starts.
  let driveKey: ServiceAccountKey | null = null;
  let driveToken: (() => Promise<string>) | null = null;
  const driveKeyOf = () => (driveKey ??= googleKey(expandHome(settings.googleServiceAccount)));
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
    settings.fillLlm === "none"
      ? null
      : makeFiller(db, counted(makeLlm(settings.fillLlm, process.env), "fills"));
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
  // Transactional and marketing mail from portal@ (confirm links, newsletter issues); null without it.
  const portalMail =
    settings.portalFrom && settings.portalMailbox
      ? plainMailer(gmail, {
          mailbox: settings.portalMailbox,
          from: settings.portalFrom,
          name: "Wren",
        })
      : null;
  // People broadcasts' email (B6): Wren's own, from portal@ with the marketing envelope. Null
  // without portal@, the lander's link key or a postal address: email broadcasts then refuse.
  const shared = settings.siteExportToken;
  const postal = settings.marketingPostal;
  const broadcastMail: BroadcastMail | null =
    portalMail && settings.portalFrom && shared && postal
      ? {
          send: portalMail,
          domain: settings.portalFrom.split("@")[1]?.toLowerCase() ?? "",
          daily: EMAIL_DAILY,
          envelope: (address, topic) =>
            marketingEnvelope({
              key: linkKey(shared),
              site: settings.siteBaseUrl.replace(/\/+$/, ""),
              address,
              topic: topic.name,
              postal,
              why: `You signed up for ${topic.publicName}.`,
            }),
        }
      : null;
  // Inboxes on their own login send over SMTP and are read over IMAP; the rest go through Gmail.
  const smtpInboxes = roster.flatMap((s) => {
    const mailbox = s.transport === "smtp" ? mailboxes.get(s.address) : undefined;
    return mailbox ? [[s.address, mailbox] as const] : [];
  });
  // Inboxes only Instantly holds are read through its API and never sent from.
  const instantlyInboxes = settings.instantlyApiKey
    ? roster.filter((s) => s.transport === "instantly").map((s) => s.address)
    : [];
  if (!settings.instantlyApiKey && roster.some((s) => s.transport === "instantly"))
    log.info("WREN_INSTANTLY_API_KEY unset: the roster's instantly inboxes are not read");
  const instantlyReader = settings.instantlyApiKey
    ? new InstantlyReader({ apiKey: settings.instantlyApiKey })
    : null;
  const readOnly = new InstantlyTransport();
  const transport: Transport =
    settings.sendTransport === "gmail"
      ? new RoutedTransport(
          new GmailTransport(gmail),
          new Map<string, Transport>([
            ...smtpInboxes.map(([address, m]) => [address, new SmtpTransport(m)] as const),
            ...instantlyInboxes.map((address) => [address, readOnly] as const),
          ]),
        )
      : new ConsoleTransport();
  // Reply disposition only pays for a real model; the fake would label nothing useful.
  const classify = settings.llm !== "fake";
  const tracer = makeTracer(settings.tracing);
  // Gmail push for the inboxes Gmail reads (prod only: a local run must not move prod's watches).
  const noPush = new Set([...smtpInboxes.map(([address]) => address), ...instantlyInboxes]);
  // Postmaster answers for the account that registered the domains; without
  // one named there is no daily pull, and the worker says so once at start.
  const postmaster: PostmasterClient | null = settings.postmasterUser
    ? {
        fetch: (url, init) => fetch(url, init),
        token: await postmasterToken(googleKey(keyPath), settings.postmasterUser),
      }
    : null;
  if (!postmaster) log.info("WREN_POSTMASTER_USER unset: no daily Postmaster pull");
  // The open-pixel pull needs both the host and its export bearer; the bearer
  // stays in settings and the request header, never in a log line or a ledger row.
  const opens =
    settings.pixelBaseUrl && settings.pixelExportToken
      ? { baseUrl: settings.pixelBaseUrl, exportToken: settings.pixelExportToken }
      : null;
  if (settings.pixelBaseUrl && !opens)
    log.warn("WREN_PIXEL_BASE_URL set without WREN_PIXEL_EXPORT_TOKEN: opens are not pulled");
  // Our own booking calendar: Google as the account the settings name, by delegation on the
  // calendar scope, minted on first use; mail from portal@.
  const calendarKey = () => googleKey(keyPath);
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
  const notesDeps = {
    main: db,
    open: openClient,
    files: settings.filesBucket ? s3Files({ bucket: settings.filesBucket }) : undefined,
    zone: settings.sendTimezone,
    // A mention in a note mailed from portal@, linking to the portal.
    mail: bookerMailer
      ? {
          send: bookerMailer("Wren"),
          portal: settings.portalOrigin ?? "https://app.wrenautomation.com",
        }
      : undefined,
    // Selected words to drafts (the workspace's ContentDesk) or into an SOP (Learn's asks).
    turns: {
      draft: async (
        ctx: Context,
        o: { client: string | null; text: string; by: string },
      ): Promise<void> => {
        const client = o.client;
        if (client) {
          const plan = await ctx.run("plan", () => clientDrafting(db, client));
          if (!plan.ok) throw new PortalRefusal(plan.why, 409);
        }
        ctx
          .objectSendClient<ContentDesk>(
            { name: "ContentDesk" },
            client ? clientKey(client, DESK_UNIT) : DESK_KEY,
          )
          .add({ text: o.text, source: "note" });
      },
      sop: (o: Parameters<NoteTurns["sop"]>[0]) => askNoteSop(db, o.db, o),
    },
    // Turn into cards: Claude proposes, the person picks. Only where a real model runs.
    write:
      settings.llm === "fake"
        ? null
        : (p: string) => llm.complete(p, { maxTokens: 4000 }).then((r) => r.text),
    drive: googleDrive({
      token: () => {
        driveToken ??= serviceAccountToken(driveKeyOf(), { scopes: [DRIVE_READ_SCOPE] });
        return driveToken();
      },
      who: () => driveKeyOf().clientEmail,
    }),
  };
  // Site flags, pushed to the lander's edge on every change and each search pass.
  const edge = settings.siteEdgeToken
    ? siteEdge(settings.siteBaseUrl, settings.siteEdgeToken)
    : undefined;
  // The Friday report mails from a fleet inbox by default: the one mailbox the
  // service account is known to be able to impersonate.
  const reportFrom = settings.reportFrom ?? fleet.senders[0] ?? null;
  const report =
    settings.reportTo && reportFrom ? { to: settings.reportTo, from: reportFrom } : null;
  if (settings.reportTo && !report) log.warn("WREN_REPORT_TO set but no sender to mail from");
  const voice = settings.contentVoicePath ? readFileSync(settings.contentVoicePath, "utf8") : null;
  // A draft's stored files (thumbnail, cover, the video) signed for its field editor.
  const mediaSigner = settings.mediaBucket
    ? { bucket: settings.mediaBucket, host: s3MediaHost({ bucket: settings.mediaBucket }) }
    : undefined;
  // The Monitor's model: mail triage, the inbox, a client's drafts. Reach drafts have their own, below.
  const watchLlm =
    settings.watchLlm === "none" ? null : counted(makeLlm(settings.watchLlm, process.env), "watch");
  // Reach drafts (thread replies, comments on others' posts, comment answers, DMs): each item's
  // model is its arm of the saved `drafts.model` test (default gateway free chain against
  // Cohere), apart from the Monitor's model; everything else the reach code asks goes to
  // `reachLlm` (Haiku). Clients keep watchLlm. designs/2026-10-14-draft-models.md.
  const armClients = new Map<string, ReturnType<typeof makeLlm> | null>();
  const armClient = (model: string) => {
    if (!armClients.has(model)) {
      try {
        armClients.set(model, counted(makeLlm(model, process.env), "drafts"));
      } catch {
        // No keys here (a laptop without the gateway): the arm is skipped, not the drafting.
        armClients.set(model, null);
      }
    }
    return armClients.get(model) ?? null;
  };
  // Reach's other calls (search words, ranking, judging a place) on a cheap model, not the Monitor's.
  const reachLlm = watchLlm ? (armClient(settings.reachLlm) ?? watchLlm) : null;
  const draftsLlm = reachLlm
    ? new ArmedLlm(withPart(reachLlm, "drafts"), savedArms(db), armClient)
    : null;
  // Google user data goes only to a model that doesn't train on it (Limited Use); none by default.
  const googleLlm =
    settings.googleLlm === "none"
      ? null
      : counted(makeLlm(settings.googleLlm, process.env), "google");
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
  // Learn's thumbnails and avatars, kept in the media bucket by the Monitor's pass.
  const mediaBucket = settings.mediaBucket;
  const sms = {
    db,
    provider: wrenSms,
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
    // Site applicants: the countries their texts may go to, and the email from William after.
    formCountries: formCountriesFrom(settings),
    formMail: plainMailer(gmail, {
      mailbox: settings.formMailFrom,
      from: settings.formMailFrom,
      name: settings.formMailName,
    }),
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
  // A client's texts: its database and messaging profile, on its own Telnyx key or Wren's
  // (gated and metered on its share; a client with no mode stays on Wren's, metered), its
  // cal.com login for reminders, Wren's rules. Its reply labels run on its own model key or
  // Wren's, metered. No site forms, no phone-app pushes. Built per pass: keys cached for one.
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
          ? keyedProvider({
              client: plan.client.id,
              keys: vendorKeys({
                main: db,
                keys,
                env: { WREN_TELNYX_API_KEY: settings.telnyxApiKey },
                unset: "managed",
              }),
              managed: new TelnyxProvider({
                apiKey: settings.telnyxApiKey,
                messagingProfileId: plan.profile,
              }),
              own: (apiKey) => new TelnyxProvider({ apiKey, messagingProfileId: plan.profile }),
            })
          : smsProvider,
      llm: sms.llm
        ? meteredModel(sms.llm, {
            main: db,
            client: plan.client.id,
            part: "sms.classify",
            now: () => new Date(),
            store: keys,
            own: llmForKey,
            unset: "managed",
          })
        : null,
      campaignId: plan.campaignId,
      senderName: plan.senderName ?? sms.senderName,
      bookingLink: plan.bookingLink,
      site: null,
      bookings: bookingsOf(plan),
      pusher: null,
      ...(sms.notifier ? { notifier: namedFor(sms.notifier, plan.client.id) } : {}),
    }),
  };
  const reach = {
    db,
    fire: fireAll,
    policy: reachPolicyFrom(settings),
    sequences: REACH_SEQUENCES,
    live: settings.reachLive,
    senderName: settings.smsSenderName,
    heldNiches: settings.reachHeldNiches,
    // Each desk call waits at most `LIMITS.desk`: a paused one never holds a reach loop's key.
    sitesFor: (ctx: Context) =>
      restateSites(ctx, { caller: "wren:reach", service: DESK, limitMs: LIMITS.desk }),
    // One quick ask of the desk before a watch pass: a status read, off the Mac's own registry.
    deskUp: (ctx: Context) =>
      answers(
        ctx,
        ctx.serviceClient<SitesService>(DESK).status({ site: "linkedin" }),
        "desk/status",
      ),
    // Pushes and tab watchers on our logins (designs/2026-10-12-push-everywhere.md).
    pushes: (ctx: ObjectContext) =>
      within(ctx, ctx.objectClient<SocialPushed>({ name: "SocialPushed" }, SOCIAL_KEY).reach(), {
        ms: LIMITS.quick,
        call: "SocialPushed/reach",
      }),
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
      llm: draftsLlm,
      guide: (p: DmPlatform) => dmGuide(db, p),
      commentGuide: (p: Parameters<typeof commentGuide>[1]) => commentGuide(db, p),
      voice: voice ?? DEFAULT_VOICE,
      facts: () => wrenFacts(db),
      // What we've posted: comments draw on it instead of retelling the other post.
      ours: () => ourPosts(db),
    },
    // A client's runs: its database, the same model metered on its own gate, its own SOPs.
    clients: {
      clientDb,
      llm: watchLlm,
      keys,
      dmGuide: (d: Db, p: DmPlatform) => dmGuide(d, p),
      facts: (d: Db) => playbooksOf(d),
    },
    ...reachNotify,
  };
  // A booked call's brief: Wren's or the client's database, its settings, the worker's model.
  // Wren's calls read the lander's export for the lead's visits; a client's have no lander.
  const landerSite = settings.siteExportToken
    ? landerVisits({ baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken })
    : null;
  const callBriefs = {
    dbFor: (client: string | null) => (client ? clientDb(client) : db),
    siteFor: (client: string | null) => (client ? null : landerSite),
    settingsFor: async (client: string | null) =>
      briefSettingsOf((await settingsFor(db, client))[CALL_BRIEF]),
    llm,
    // A client's brief questions on its own model key or Wren's, metered on its share.
    llmFor: (client: string) =>
      meteredModel(llm, {
        main: db,
        client,
        part: "calls.brief",
        now: () => new Date(),
        store: keys,
        own: llmForKey,
        unset: "managed",
      }),
  };
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
  // Client mail (designs/2026-10-07-mail-access.md): Wren's mail apps from settings or the key
  // store; each mailbox's refresh token in the key store, never printed.
  const mailApps = mailAppsFrom(
    {
      googleId: settings.mailGoogleClientId,
      googleSecret: settings.mailGoogleClientSecret,
      microsoftId: settings.mailMicrosoftClientId,
      microsoftSecret: settings.mailMicrosoftClientSecret,
    },
    keys,
  );
  const clientMail = mailAccess({
    main: db,
    apps: mailApps,
    keys,
    origin: settings.portalOrigin ?? null,
    fetch,
  });
  /**
   * Where a workspace's email marketing leaves: Wren's from portal@; a client's from the mailbox it
   * picked in Account → Messaging, with its postal address, under its name. Same footer and
   * one-click unsubscribe; the links name the client, so they change its records.
   */
  const mailOf: MailOf = async (client, cdb) => {
    if (!client) return broadcastMail ?? { unset: "Email isn't set up here" };
    if (!shared) return { unset: "Email isn't set up here" };
    const rules = await readMessageSettings(cdb);
    if (!rules.sender)
      return { unset: "Needs setup: pick the mailbox it sends from in Account → Messaging" };
    if (!rules.postal)
      return { unset: "Needs setup: add your postal address in Account → Messaging" };
    const [box, c] = await Promise.all([
      clientMail.marketingSenderOf(client, rules.sender).catch((err: unknown) => {
        if (err instanceof PortalRefusal) return { unset: err.message };
        throw err;
      }),
      findClient(db, client),
    ]);
    if ("unset" in box) return box;
    const postal = rules.postal;
    return {
      domain: box.address.split("@")[1] ?? "",
      daily: box.personal ? PERSONAL_DAILY : EMAIL_DAILY,
      send: (m) => box.send({ ...m, fromName: c?.name ?? null }),
      envelope: (address, topic) =>
        marketingEnvelope({
          key: linkKey(shared),
          site: settings.siteBaseUrl.replace(/\/+$/, ""),
          address,
          topic: topic.name,
          postal,
          why: `You signed up for ${topic.publicName}.`,
          client,
        }),
    };
  };
  const setupChecks = {
    // Wren's mail apps, a Workspace domain's test read, a tenant's consent, each mailbox's token.
    ...mailChecks({ main: db, apps: mailApps, access: clientMail, fetch }),
    // Each connected social account's token, refreshed and read once an hour.
    ...socialChecks({ main: db, access: clientSocial }),
    ...dnsChecks(dohResolve),
    ...stripeChecks(db),
    ...searchConsoleChecks(() => searchConsoleClient(googleKey(keyPath))),
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
    // A call seen to the number; Google's review form for the Place ID (one GET).
    ...answerChecks(async (client) => (client === null ? db : clientDb(client)), fetch),
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
      // Signs in and out, reading nothing: IMAP for an inbox on its own login, Instantly's
      // list for one it holds, else one Gmail list.
      signIn: async (address) => {
        if (!roster.some((x) => x.address === address)) return null;
        if (instantlyReader && instantlyInboxes.includes(address)) {
          await instantlyReader.listMessages(address, `after:${Math.floor(Date.now() / 1000)}`);
          return "instantly";
        }
        const m = noPush.has(address) ? mailboxes.get(address) : undefined;
        if (m) {
          await withImap(imapClient(m.imap), async () => {});
          return "imap";
        }
        await gmail.listMessages(address, "in:inbox", { maxResults: 1 });
        return "gmail";
      },
    }),
  };
  return {
    bookerMailer,
    calendar,
    callBriefs,
    campaigns,
    classify,
    clientBookings,
    clientDb,
    clientMail,
    clientSocial,
    clientTexts,
    clientsNotify,
    databaseUrl,
    db,
    draftsLlm,
    edge,
    fireAll,
    fleet,
    freeVerdicts,
    gmail,
    googleCalendar,
    googleLlm,
    handle,
    instantlyInboxes,
    instantlyReader,
    keyPath,
    keys,
    lane,
    laneNotifier,
    llm,
    mailOf,
    mailboxOf,
    mailboxes,
    mediaBucket,
    mediaSigner,
    noPush,
    notesDeps,
    notifier,
    notify,
    openClient,
    opens,
    operatorText,
    policy,
    portalMail,
    postmaster,
    reach,
    reachNotify,
    renderer,
    report,
    rootDir,
    roster,
    setupChecks,
    setupLane,
    setupParts,
    sms,
    smsProvider,
    smtpInboxes,
    socialApi,
    tracer,
    transport,
    ua,
    verifier,
    voice,
    watchLlm,
    settings,
    log,
    bound,
  };
}

/** What `buildDeps` returns: the one parameter every domain file takes. */
export type Deps = Awaited<ReturnType<typeof buildDeps>>;
