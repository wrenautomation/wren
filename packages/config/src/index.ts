import { resolve } from "node:path";
import { z } from "zod";

export { loadEnvFile } from "./env-file.js";

/**
 * Inboxes to read, `address:via` comma-separated. `delegated` reads a Workspace inbox through the
 * service account; `autobrowse` reads a personal Gmail, read-only, through autobrowse's `gmail` site.
 */
const mailboxes = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const at = x.lastIndexOf(":");
        return { address: x.slice(0, at), via: x.slice(at + 1) };
      }),
  )
  .pipe(
    z.array(z.object({ address: z.string().email(), via: z.enum(["delegated", "autobrowse"]) })),
  );

/** All process settings. Read once at startup, passed down explicitly. */
export const settingsSchema = z.object({
  databaseUrl: z.string().url(),
  /**
   * The worker's port through PgBouncer on the database box (transaction mode); unset connects
   * straight to Postgres. Only the worker uses it: the CLI and migrations stay direct, since
   * they set session parameters (the audit actor) a pooled connection can't keep.
   */
  databasePoolPort: z.coerce.number().int().positive().optional(),
  restateIngressUrl: z.string().url().default("http://127.0.0.1:8080"),
  /** Bearer for the ingress (Restate Cloud API key); unset for a local Restate. */
  restateAuthToken: z.string().min(1).optional(),
  /** Restate's admin API (port 9070): the console reads loop state here. Unset, the Loops read refuses. */
  restateAdminUrl: z.string().url().optional(),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  /** Contact for the outbound User-Agent (email or URL). Required before any fetch. */
  fetchContact: z.string().min(1).optional(),
  /** warn: log robots disallows and fetch anyway (stamped on the row); enforce: skip. */
  robotsMode: z.enum(["warn", "enforce"]).default("warn"),
  /** "fake" | "anthropic" | "<provider>[:model]". Never defaults to a paid provider. */
  llm: z.string().min(1).default("fake"),
  /** Anthropic model id used when llm is "anthropic". */
  llmModel: z.string().min(1).default("claude-haiku-4-5-20251001"),
  /** Path of the key-fleet env file, relative to the project root. */
  llmEnvPath: z.string().min(1).default("llm.env"),
  /**
   * The model behind AI fills: casual names and template prompt slots
   * (designs/2026-10-05-ai-fills.md). A `makeLlm` spec (prod: "cohere"); "none" keeps the
   * rule-based names. Never defaults to a paid provider.
   */
  fillLlm: z.string().min(1).default("none"),
  tracing: z.enum(["none"]).default("none"),
  /**
   * Mailbox verifier: `smtp` = our prober service on the database box (Lambda has no
   * port 25), `smtp-direct` = probe from this host, `fake` never touches the network.
   */
  verifier: z.enum(["fake", "smtp", "smtp-direct"]).default("fake"),
  /** The prober service (the mailifier package, on the DB box): base URL and its bearer. */
  smtpProbeUrl: z.string().min(1).optional(),
  smtpProbeToken: z.string().min(1).optional(),
  /** HELO name for smtp-direct; forward and reverse DNS should agree on it. */
  smtpHelo: z.string().min(1).optional(),

  // ---- send policy (parsed and range-checked by SendPolicy in channel-email) ----
  /** IANA zone the fleet window is read in. */
  sendTimezone: z.string().min(1).default("America/Chicago"),
  /** Comma-separated send days, mon..sun or full names. */
  sendDays: z.string().min(1).default("mon,tue,wed,thu,fri"),
  /** Holiday calendars nothing sends on: us, ca, year_end (Dec 24 to Jan 1). none = no holidays. */
  sendHolidays: z.string().default("us,ca,year_end"),
  sendWindowStart: z.string().min(1).default("08:00"),
  sendWindowEnd: z.string().min(1).default("17:00"),
  /** The lead's own window on the lead's clock. Both or neither. */
  sendLeadWindowStart: z.string().min(1).optional(),
  sendLeadWindowEnd: z.string().min(1).optional(),
  /** Flat daily cap per inbox, or the ceiling a ramp climbs to. */
  coldSendsPerInboxPerDay: z.coerce.number().int().default(5),
  /** YYYY-MM-DD the ramp starts; unset = flat cap at the ceiling. */
  coldSendsRampStart: z.string().min(1).optional(),
  coldSendsRampFrom: z.coerce.number().int().default(5),
  coldSendsRampStep: z.coerce.number().int().default(2),
  coldSendsRampEveryDays: z.coerce.number().int().default(3),
  /**
   * Warmup emails for each cold one (email-infra SOP: 2 to 1). An inbox whose roster
   * ramp names `warmup_start` sends at most its day's warmup ÷ this, cold.
   */
  warmupPerCold: z.coerce.number().int().default(2),
  /** Instantly's warmup climb on fleet inboxes: +step a day to limit (autobrowse `WARMUP`). */
  warmupStep: z.coerce.number().int().default(2),
  warmupLimit: z.coerce.number().int().default(60),
  sendGapMinMinutes: z.coerce.number().default(8),
  sendGapMaxMinutes: z.coerce.number().default(20),
  /** Fleet-wide brake on new conversations per day; unset = unlimited. */
  newOpenersPerDay: z.coerce.number().int().optional(),
  /** Per-campaign brake on new conversations, "agencies=0,recruiting=40"; a niche not named has none. */
  nicheOpenersPerDay: z.string().default(""),
  /** Niches whose bounces the kill switch ignores and whose sends its pauses do not stop, "agencies". */
  killSwitchOffFor: z.string().default(""),
  /** Operator nudges: none | console | discord (needs the webhook URL, a secret). */
  notify: z.enum(["none", "console", "discord"]).default("none"),
  discordWebhookUrl: z.string().min(1).optional(),
  /**
   * One Discord channel per sales channel, so each one's pings stay apart. Unset = the
   * main webhook, which keeps the digest and system pings (tokens, audit seals).
   */
  discordEmailWebhookUrl: z.string().min(1).optional(),
  discordSmsWebhookUrl: z.string().min(1).optional(),
  discordReachWebhookUrl: z.string().min(1).optional(),
  discordAdsWebhookUrl: z.string().min(1).optional(),
  discordContentWebhookUrl: z.string().min(1).optional(),
  discordSearchWebhookUrl: z.string().min(1).optional(),
  discordClientsWebhookUrl: z.string().min(1).optional(),
  /** William's Discord user id: pings (replies, bookings, breakage) @mention him; routine reports post silent. */
  discordPingUserId: z
    .string()
    .regex(/^\d{15,25}$/)
    .optional(),
  /** William's phone (E.164): warm-reply pings are texted here too, from a number in its country. */
  operatorPhone: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/)
    .optional(),
  /** Send days of approved openers the queue-keeper holds ahead of the fleet (0 = off). */
  composeDaysAhead: z.coerce.number().int().min(0).default(3),
  /** Which pool-feeder stages may call the model: none (free groundwork), pick, all (+extraction). */
  poolModelStages: z.enum(["none", "pick", "all"]).default("none"),
  /**
   * The pool-feeder's `profiles` stage: LinkedIn pages of the people next in the
   * queue, from Exa's cache (metered) and Google. Off by default.
   */
  poolProfiles: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /**
   * The LinkedIn account `profiles` reads logged in as (step 5), by its address:
   * a research alt, never William's own. Unset = the stage never logs in.
   */
  poolLinkedin: z.string().min(1).optional(),
  /** A lead whose only VALID check is older than this counts as unverified at compose. */
  verificationHorizonDays: z.coerce.number().int().default(45),
  resendCooldownDays: z.coerce.number().int().default(30),
  reconcileGraceMinutes: z.coerce.number().default(10),
  bouncePauseRate: z.coerce.number().default(0.02),
  bouncePauseMinBounces: z.coerce.number().int().default(2),
  healthWindowDays: z.coerce.number().int().default(7),
  /**
   * Seed Gmails each ramped inbox mails its newest opener to once a send day,
   * comma-separated; each needs autobrowse Gmail consent. Empty = no placement checks.
   */
  placementSeeds: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().email())),
  /** https://host of the open-pixel endpoint; unset = no pixel host at all. */
  pixelBaseUrl: z.string().min(1).optional(),
  /**
   * Put the open pixel into outgoing mail. Off by default: opens still sync
   * from whatever earlier sends carried, but new mail stays pixel-free.
   */
  openTracking: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** The pixel host's /export bearer, shared with the worker. A secret: never logged, never in argv. */
  pixelExportToken: z.string().min(1).optional(),
  /** The lander, where email sign-off links point; `wren email clicks` reads its /api/export. */
  siteBaseUrl: z.string().url().default("https://wrenautomation.com"),
  /** The lander's /api/export bearer (its EXPORT_TOKEN secret). A secret: never logged, never in argv. */
  siteExportToken: z.string().min(1).optional(),
  /** The lander's /api/edge bearer (its EDGE_TOKEN secret): flags pushed there. A secret. */
  siteEdgeToken: z.string().min(1).optional(),
  /**
   * The Workspace user Postmaster answers for — the account that registered
   * the domains at postmaster.google.com. Unset = no daily pull.
   */
  postmasterUser: z.string().min(1).optional(),
  /** The Search Console property (`sc-domain:example.com`) the service account owns. Unset = no SearchWatch. */
  searchSite: z.string().min(1).optional(),
  /** The site it answers for (`https://example.com`): sitemap, pages, `/llms.txt`. */
  searchOrigin: z.string().url().optional(),
  /** Where the Friday report goes; unset = no ReportScheduler. */
  reportTo: z.string().email().optional(),
  /** The mailbox it is sent from (must be one the service account may impersonate); default = the first fleet sender. */
  reportFrom: z.string().email().optional(),
  /** Path of the Google service-account key (domain-wide delegation), or its JSON inline. */
  googleServiceAccount: z.string().min(1).default("~/.config/wren/wren-sender.json"),
  /** "local" launches Playwright chromium; "cdp" / "browserbase" connect to a remote one (Lambda). */
  renderer: z.enum(["local", "cdp", "browserbase"]).default("local"),
  /** The remote chromium's DevTools URL for renderer=cdp. Carries its token: a secret. */
  cdpUrl: z.string().min(1).optional(),
  /** Path of the sender roster (TOML). */
  sendersFile: z.string().min(1).default("senders_config.toml"),
  /** Path of the SMTP/IMAP logins (JSON, address → {smtp, imap}) for the roster's `transport = "smtp"` inboxes. A secret. */
  mailboxesFile: z.string().min(1).optional(),
  /** "console" prints; "gmail" sends for real. Console until cutover. */
  sendTransport: z.enum(["console", "gmail"]).default("console"),
  daemonTickSeconds: z.coerce.number().int().default(60),
  daemonSyncSeconds: z.coerce.number().int().default(120),
  /** Content platforms served through autobrowse's `sites` Restate service; empty = no `Content` service. */
  contentChannels: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(z.enum(["linkedin", "reddit", "youtube", "x", "instagram", "facebook", "tiktok"])),
    ),
  /** A markdown file with the posting voice in William's words; unset = the built-in voice. Relative to the project root. */
  contentVoicePath: z.string().min(1).optional(),
  /** An S3 bucket a local media file is hosted in (presigned URL) for platforms that only take URLs. Unset = URLs only. */
  mediaBucket: z.string().min(1).optional(),
  /** The private S3 bucket for client files (`clients/<id>/`); unset = the portal refuses uploads. */
  filesBucket: z.string().min(1).optional(),
  /** The private S3 bucket archived page HTML moves to (`pages/<id>.html.gz`); unset = pages stay in Postgres. */
  pagesBucket: z.string().min(1).optional(),
  /** The client portal (`https://app.<domain>`); unset = no DeliveryWatch. */
  portalOrigin: z.string().url().optional(),
  /** Client mail comes from this address, sent through `portalMailbox`; either unset = pings only. */
  portalFrom: z.string().email().optional(),
  /** A mailbox the service account may impersonate that can send as `portalFrom`. */
  portalMailbox: z.string().email().optional(),
  /** The S3 bucket per-lead demo videos are published to (`v/<id>.*`); unset = `wren video demo render` refuses. */
  videosBucket: z.string().min(1).optional(),
  /** Where the CDN serves that bucket, no trailing slash ("https://d123.cloudfront.net"). */
  videosOrigin: z.string().url().optional(),
  /** The watch page a video's id is appended to; the email links here. */
  videosWatchBase: z.string().url().default("https://wrenautomation.com/v/"),
  /** The ffmpeg binary videos are encoded with. */
  ffmpeg: z.string().min(1).default("ffmpeg"),
  /** The yt-dlp command SOP sources are read with (split on spaces: `uvx yt-dlp`). */
  ytDlp: z.string().min(1).default("yt-dlp"),
  /** Where SOP folders live (relative to the repo root): private, not this repo. */
  sopsDir: z.string().min(1).default("../sops"),
  /** The autobrowse checkout whose CLI (and tokens) `sop add drive:` runs. */
  autobrowseDir: z.string().min(1).default("../autobrowse"),
  /** The private S3 bucket that keeps every email and PDF the books read (under `books/`); unset = the local `.books/` directory. */
  booksBucket: z.string().min(1).optional(),
  /** Inboxes the books read bills from. */
  booksMailboxes: mailboxes,
  /** Inboxes the Monitor reads, as `booksMailboxes`; unset, the books' own. */
  watchMailboxes: mailboxes,
  /**
   * Gmail push for site-read inboxes: a Pub/Sub topic in autobrowse's OAuth client's project
   * (Gmail publishes nowhere else). Unset, those inboxes are polled (designs/2026-10-06-mail-push.md).
   */
  watchSiteTopic: z.string().min(1).optional(),
  /** The model for mail the Monitor's rules can't settle (`makeLlm`); `none` shows it all. */
  watchLlm: z.string().min(1).default("none"),
  /** The first day the books cover; imports look no further back. */
  booksSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default("2026-08-01"),
  /** The books' day takes in AWS spend per service from Cost Explorer (one billed request a day). */
  booksAwsUsage: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** The Facebook Page the `facebook`/`instagram` channels post as; the first Page when unset. */
  metaPageId: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
  /** The ad account `wren ads` works in (`act_…` or bare id); the first account on the token when unset. */
  metaAdAccountId: z
    .string()
    .regex(/^(act_)?[0-9]+$/)
    .optional(),
  /** `AdsWatch`: 7-day spend that, with no clicks and no results, pauses a launch (default $50). */
  adsPauseAfterUsd: z.coerce.number().positive().default(50),
  /**
   * Reddit's API, called straight from wren (no autobrowse on the path): an
   * approved OAuth app and a permanent refresh token from its consent. All
   * three set = the `reddit` channel exists; any missing = it does not.
   */
  redditClientId: z.string().min(1).optional(),
  redditClientSecret: z.string().min(1).optional(),
  redditRefreshToken: z.string().min(1).optional(),
  /** The account posting, for Reddit's required User-Agent (`… (by /u/<name>)`). */
  redditUsername: z.string().min(1).optional(),
  /**
   * SMS (packages/channel-sms). `none` (the default) has no carrier: nothing is
   * sent, looked up or synced. `fake` is for tests and local dry runs only: it
   * pretends to send, so never set it on a deploy. `telnyx` needs the key and the
   * messaging profile. Nothing leaves Telnyx until WREN_SMS_LIVE is true: set it
   * only once the 10DLC campaign is approved as registered.
   */
  smsProvider: z.enum(["none", "fake", "telnyx"]).default("none"),
  telnyxApiKey: z.string().min(1).optional(),
  telnyxMessagingProfileId: z.string().min(1).optional(),
  /** The 10DLC campaign US numbers go on; SmsWatch attaches them once carriers approve it. */
  telnyxCampaignId: z.string().min(1).optional(),
  /** Telnyx's webhook public key (portal: Keys & Credentials → Public Key), for the phone Worker. */
  telnyxPublicKey: z.string().min(1).optional(),
  smsLive: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /**
   * Wren's "Wren mail" OAuth apps (designs/2026-10-07-mail-access.md). Unset: read from the key
   * store under the client `wren` (`wren keys put`), else Account → Mail says "Needs setup".
   * The secrets are secrets: never logged, never in argv.
   */
  mailGoogleClientId: z.string().min(1).optional(),
  mailGoogleClientSecret: z.string().min(1).optional(),
  mailMicrosoftClientId: z.string().min(1).optional(),
  mailMicrosoftClientSecret: z.string().min(1).optional(),
  /**
   * Client social platforms whose app review passed (designs/2026-10-07-client-social.md), comma
   * separated: `facebook,instagram,youtube,tiktok,google_business`. X and LinkedIn need none.
   * Wren's social apps themselves come from env (`WREN_SOCIAL_<APP>_CLIENT_ID`, in SSM env-2), else
   * the key store (`SOCIAL_<APP>_CLIENT_ID`).
   */
  socialLive: z.string().default(""),
  /** Hand done-for-you setup steps to autobrowse `do` in the account owner's autobrowse. Off: they wait on Wren's team. */
  setupAgent: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Campaign-wide texts per fleet day, whatever the pool's size. */
  smsDailyCap: z.coerce.number().int().positive().default(1000),
  /** Most texts one phone gets in any 31 days. The consent line promises "Up to 4 texts a month": never above it. */
  smsMonthlyPerContact: z.coerce.number().int().positive().max(4).default(4),
  /** A fully ramped number's texts per day. */
  smsNumberCap: z.coerce.number().int().positive().default(200),
  smsRampStart: z.coerce.number().int().positive().default(20),
  smsRampStep: z.coerce.number().int().nonnegative().default(20),
  smsRampEveryDays: z.coerce.number().int().positive().default(2),
  /** Most numbers in the pool (PH-D10). */
  smsMaxNumbers: z.coerce.number().int().positive().max(5).default(5),
  /** Lead-local send window, HH:MM–HH:MM; clamped to 08:00–20:00 whatever is set. */
  smsWindow: z
    .string()
    .regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/)
    .default("10:00-17:00"),
  /** ISO weekdays texts may land on (1 = Monday). */
  smsDays: z
    .string()
    .default("1,2,3,4,5")
    .transform((s) => s.split(",").map((x) => Number(x.trim())))
    .pipe(z.array(z.number().int().min(1).max(7)).min(1)),
  /** A form lead's window (they asked to hear from us), lead-local; ends with the 20:00 clamp. */
  smsFormWindow: z
    .string()
    .regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/)
    .default("08:00-20:00"),
  /** ISO weekdays a form lead's texts may land on. */
  smsFormDays: z
    .string()
    .default("1,2,3,4,5,6,7")
    .transform((s) => s.split(",").map((x) => Number(x.trim())))
    .pipe(z.array(z.number().int().min(1).max(7)).min(1)),
  /** The booking link Wren's texts quote as `{booking_link}`; a client's is its texts setting. */
  smsBookingLink: z.string().url().optional(),
  /** Least seconds between two texts from one number. */
  smsGapSeconds: z.coerce.number().int().positive().default(20),
  /** Who a text says it is from: `{sender}` in the copy. */
  smsSenderName: z.string().min(1).default("William"),
  /** Cal.com API key: the form follow-up asks it whether an applicant already booked. Unset = no check. */
  calcomApiKey: z.string().min(1).optional(),
  /** Web push keys: the phone app's reply alerts. Both unset = no alerts (`npx web-push generate-vapid-keys`). */
  smsPushPublicKey: z.string().min(1).optional(),
  smsPushPrivateKey: z.string().min(1).optional(),
  /** Who sends the alerts, for the push services. */
  smsPushSubject: z.string().min(1).default("mailto:william@wrenautomation.com"),
  /**
   * Which contact bases the sender may text: `opt_in` (they gave us the number
   * for this) and/or `published` (on their own site). Must match what the
   * registered campaign says about how numbers are obtained.
   */
  smsBases: z
    .string()
    .default("opt_in")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(["published", "opt_in"])).min(1)),
  /** Niches the SMS channel never reads, enrolls or texts (William's holds). */
  smsHeldNiches: z
    .string()
    .default("sec_ria")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  /**
   * Cold outreach on Reddit and LinkedIn (packages/outreach). Off = the loop
   * queues and reads but sends nothing. Accounts are autobrowse credential
   * keys (`reddit@alt`), never william@wrenautomation's own logins.
   */
  reachLive: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Fleet-local send window, HH:MM-HH:MM. */
  reachWindow: z
    .string()
    .regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/)
    .default("10:00-17:00"),
  reachDays: z
    .string()
    .default("1,2,3,4,5")
    .transform((s) => s.split(",").map((x) => Number(x.trim())))
    .pipe(z.array(z.number().int().min(1).max(7)).min(1)),
  reachGapSeconds: z.coerce.number().int().positive().default(120),
  /** Reddit DMs a day at the top of the warmup ladder (the site caps at 5). */
  reachRedditMessagesPerDay: z.coerce.number().int().nonnegative().max(5).default(5),
  /** LinkedIn invites a day on day one, and the cap the weekly ramp grows to. */
  reachLinkedinConnectsStart: z.coerce.number().int().nonnegative().default(1),
  reachLinkedinConnectsCap: z.coerce.number().int().nonnegative().default(20),
  reachLinkedinMessagesPerDay: z.coerce.number().int().nonnegative().default(20),
  /** Niches the outreach channel never enrolls (William's holds). */
  reachHeldNiches: z
    .string()
    .default("sec_ria")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  /** Health: 7-day delivery-failure rate that pauses a number. */
  smsMaxFailRate: z.coerce.number().min(0).max(1).default(0.15),
  /** Health: 7-day fleet opt-out rate that pauses every number. */
  smsMaxOptOutRate: z.coerce.number().min(0).max(1).default(0.03),
  /** Health: balance under this is a Discord warning. */
  smsLowBalanceUsd: z.coerce.number().nonnegative().default(5),
  /** autobrowse's EC2 instance: a `sites` call starts it when stopped (it stops itself when idle). Unset = the Mac's desk serves `sites`. */
  autobrowseInstanceId: z
    .string()
    .regex(/^i-[0-9a-f]+$/)
    .optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** The ingress connection: `clients.connect(ingressOf(settings))`; the bearer rides along when set. */
export function ingressOf(s: Pick<Settings, "restateIngressUrl" | "restateAuthToken">): {
  url: string;
  headers?: Record<string, string>;
  serde: typeof INGRESS_JSON;
} {
  return {
    url: s.restateIngressUrl,
    ...(s.restateAuthToken ? { headers: { Authorization: `Bearer ${s.restateAuthToken}` } } : {}),
    serde: INGRESS_JSON,
  };
}

let sentNothing = false;
/**
 * JSON both ways, but a call with no input sends no body and no content type. Restate's ingress
 * refuses an empty body typed as JSON once a handler declares an input schema, and the stock
 * client sends exactly that for `.status()`. The clients lib reads `contentType` right after
 * `serialize`, in one synchronous step, so the flag never leaks between calls.
 */
export const INGRESS_JSON = {
  get contentType(): string {
    // Typed as the clients lib wants; undefined after no input makes it send no content type.
    return (sentNothing ? undefined : "application/json") as string;
  },
  serialize(value: unknown): Uint8Array {
    sentNothing = value === undefined;
    return sentNothing ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(value));
  },
  deserialize(bytes: Uint8Array): unknown {
    return bytes.length === 0 ? undefined : JSON.parse(new TextDecoder().decode(bytes));
  },
};

/** Env var name for each setting. One place, so `.env.example` and code can't drift. */
export const ENV_KEYS = {
  databaseUrl: "WREN_DATABASE_URL",
  databasePoolPort: "WREN_DATABASE_POOL_PORT",
  restateIngressUrl: "WREN_RESTATE_INGRESS_URL",
  restateAuthToken: "RESTATE_AUTH_TOKEN",
  restateAdminUrl: "WREN_RESTATE_ADMIN_URL",
  logLevel: "WREN_LOG_LEVEL",
  fetchContact: "WREN_FETCH_CONTACT",
  robotsMode: "WREN_ROBOTS_MODE",
  llm: "WREN_LLM",
  llmModel: "WREN_LLM_MODEL",
  llmEnvPath: "WREN_LLM_ENV_PATH",
  fillLlm: "WREN_FILL_LLM",
  tracing: "WREN_TRACING",
  verifier: "WREN_VERIFIER",
  smtpProbeUrl: "WREN_SMTP_PROBE_URL",
  smtpProbeToken: "WREN_SMTP_PROBE_TOKEN",
  smtpHelo: "WREN_SMTP_HELO",
  sendTimezone: "WREN_SEND_TIMEZONE",
  sendDays: "WREN_SEND_DAYS",
  sendHolidays: "WREN_SEND_HOLIDAYS",
  sendWindowStart: "WREN_SEND_WINDOW_START",
  sendWindowEnd: "WREN_SEND_WINDOW_END",
  sendLeadWindowStart: "WREN_SEND_LEAD_WINDOW_START",
  sendLeadWindowEnd: "WREN_SEND_LEAD_WINDOW_END",
  coldSendsPerInboxPerDay: "WREN_COLD_SENDS_PER_INBOX_PER_DAY",
  coldSendsRampStart: "WREN_COLD_SENDS_RAMP_START",
  coldSendsRampFrom: "WREN_COLD_SENDS_RAMP_FROM",
  coldSendsRampStep: "WREN_COLD_SENDS_RAMP_STEP",
  coldSendsRampEveryDays: "WREN_COLD_SENDS_RAMP_EVERY_DAYS",
  warmupPerCold: "WREN_WARMUP_PER_COLD",
  warmupStep: "WREN_WARMUP_STEP",
  warmupLimit: "WREN_WARMUP_LIMIT",
  sendGapMinMinutes: "WREN_SEND_GAP_MIN_MINUTES",
  sendGapMaxMinutes: "WREN_SEND_GAP_MAX_MINUTES",
  newOpenersPerDay: "WREN_NEW_OPENERS_PER_DAY",
  nicheOpenersPerDay: "WREN_NICHE_OPENERS_PER_DAY",
  killSwitchOffFor: "WREN_KILL_SWITCH_OFF_FOR",
  notify: "WREN_NOTIFY",
  discordWebhookUrl: "WREN_DISCORD_WEBHOOK_URL",
  discordEmailWebhookUrl: "WREN_DISCORD_EMAIL_WEBHOOK_URL",
  discordSmsWebhookUrl: "WREN_DISCORD_SMS_WEBHOOK_URL",
  discordReachWebhookUrl: "WREN_DISCORD_REACH_WEBHOOK_URL",
  discordAdsWebhookUrl: "WREN_DISCORD_ADS_WEBHOOK_URL",
  discordContentWebhookUrl: "WREN_DISCORD_CONTENT_WEBHOOK_URL",
  discordSearchWebhookUrl: "WREN_DISCORD_SEARCH_WEBHOOK_URL",
  discordClientsWebhookUrl: "WREN_DISCORD_CLIENTS_WEBHOOK_URL",
  discordPingUserId: "WREN_DISCORD_PING_USER_ID",
  operatorPhone: "WREN_OPERATOR_PHONE",
  composeDaysAhead: "WREN_COMPOSE_DAYS_AHEAD",
  poolModelStages: "WREN_POOL_MODEL_STAGES",
  poolProfiles: "WREN_POOL_PROFILES",
  poolLinkedin: "WREN_POOL_LINKEDIN",
  verificationHorizonDays: "WREN_VERIFICATION_HORIZON_DAYS",
  resendCooldownDays: "WREN_RESEND_COOLDOWN_DAYS",
  reconcileGraceMinutes: "WREN_RECONCILE_GRACE_MINUTES",
  bouncePauseRate: "WREN_BOUNCE_PAUSE_RATE",
  bouncePauseMinBounces: "WREN_BOUNCE_PAUSE_MIN_BOUNCES",
  healthWindowDays: "WREN_HEALTH_WINDOW_DAYS",
  placementSeeds: "WREN_PLACEMENT_SEEDS",
  pixelBaseUrl: "WREN_PIXEL_BASE_URL",
  openTracking: "WREN_OPEN_TRACKING",
  pixelExportToken: "WREN_PIXEL_EXPORT_TOKEN",
  siteBaseUrl: "WREN_SITE_BASE_URL",
  siteExportToken: "WREN_SITE_EXPORT_TOKEN",
  siteEdgeToken: "WREN_SITE_EDGE_TOKEN",
  postmasterUser: "WREN_POSTMASTER_USER",
  searchSite: "WREN_SEARCH_SITE",
  searchOrigin: "WREN_SEARCH_ORIGIN",
  reportTo: "WREN_REPORT_TO",
  reportFrom: "WREN_REPORT_FROM",
  googleServiceAccount: "WREN_GOOGLE_SERVICE_ACCOUNT",
  renderer: "WREN_RENDERER",
  cdpUrl: "WREN_CDP_URL",
  sendersFile: "WREN_SENDERS_FILE",
  mailboxesFile: "WREN_MAILBOXES_FILE",
  sendTransport: "WREN_SEND_TRANSPORT",
  daemonTickSeconds: "WREN_DAEMON_TICK_SECONDS",
  daemonSyncSeconds: "WREN_DAEMON_SYNC_SECONDS",
  contentChannels: "WREN_CONTENT_CHANNELS",
  contentVoicePath: "WREN_CONTENT_VOICE",
  mediaBucket: "WREN_MEDIA_BUCKET",
  filesBucket: "WREN_FILES_BUCKET",
  pagesBucket: "WREN_PAGES_BUCKET",
  portalOrigin: "WREN_PORTAL_ORIGIN",
  portalFrom: "WREN_PORTAL_FROM",
  portalMailbox: "WREN_PORTAL_MAILBOX",
  videosBucket: "WREN_VIDEOS_BUCKET",
  videosOrigin: "WREN_VIDEOS_ORIGIN",
  videosWatchBase: "WREN_VIDEOS_WATCH_BASE",
  ffmpeg: "WREN_FFMPEG",
  ytDlp: "WREN_YT_DLP",
  sopsDir: "WREN_SOPS_DIR",
  autobrowseDir: "WREN_AUTOBROWSE_DIR",
  booksBucket: "WREN_BOOKS_BUCKET",
  booksMailboxes: "WREN_BOOKS_MAILBOXES",
  watchMailboxes: "WREN_WATCH_MAILBOXES",
  watchSiteTopic: "WREN_WATCH_SITE_TOPIC",
  watchLlm: "WREN_WATCH_LLM",
  booksSince: "WREN_BOOKS_SINCE",
  booksAwsUsage: "WREN_BOOKS_AWS_USAGE",
  metaPageId: "WREN_META_PAGE_ID",
  metaAdAccountId: "WREN_META_AD_ACCOUNT_ID",
  adsPauseAfterUsd: "WREN_ADS_PAUSE_AFTER_USD",
  smsProvider: "WREN_SMS_PROVIDER",
  telnyxApiKey: "WREN_TELNYX_API_KEY",
  telnyxMessagingProfileId: "WREN_TELNYX_MESSAGING_PROFILE_ID",
  telnyxCampaignId: "WREN_TELNYX_CAMPAIGN_ID",
  telnyxPublicKey: "WREN_TELNYX_PUBLIC_KEY",
  smsLive: "WREN_SMS_LIVE",
  setupAgent: "WREN_SETUP_AGENT",
  mailGoogleClientId: "WREN_MAIL_GOOGLE_CLIENT_ID",
  mailGoogleClientSecret: "WREN_MAIL_GOOGLE_CLIENT_SECRET",
  mailMicrosoftClientId: "WREN_MAIL_MICROSOFT_CLIENT_ID",
  mailMicrosoftClientSecret: "WREN_MAIL_MICROSOFT_CLIENT_SECRET",
  socialLive: "WREN_SOCIAL_LIVE",
  smsDailyCap: "WREN_SMS_DAILY_CAP",
  smsMonthlyPerContact: "WREN_SMS_MONTHLY_PER_CONTACT",
  smsNumberCap: "WREN_SMS_NUMBER_CAP",
  smsRampStart: "WREN_SMS_RAMP_START",
  smsRampStep: "WREN_SMS_RAMP_STEP",
  smsRampEveryDays: "WREN_SMS_RAMP_EVERY_DAYS",
  smsMaxNumbers: "WREN_SMS_MAX_NUMBERS",
  smsWindow: "WREN_SMS_WINDOW",
  smsDays: "WREN_SMS_DAYS",
  smsGapSeconds: "WREN_SMS_GAP_SECONDS",
  smsFormWindow: "WREN_SMS_FORM_WINDOW",
  smsFormDays: "WREN_SMS_FORM_DAYS",
  smsBookingLink: "WREN_SMS_BOOKING_LINK",
  smsSenderName: "WREN_SMS_SENDER_NAME",
  calcomApiKey: "WREN_CALCOM_API_KEY",
  smsPushPublicKey: "WREN_SMS_PUSH_PUBLIC_KEY",
  smsPushPrivateKey: "WREN_SMS_PUSH_PRIVATE_KEY",
  smsPushSubject: "WREN_SMS_PUSH_SUBJECT",
  smsBases: "WREN_SMS_BASES",
  smsHeldNiches: "WREN_SMS_HELD_NICHES",
  reachLive: "WREN_REACH_LIVE",
  reachWindow: "WREN_REACH_WINDOW",
  reachDays: "WREN_REACH_DAYS",
  reachGapSeconds: "WREN_REACH_GAP_SECONDS",
  reachRedditMessagesPerDay: "WREN_REACH_REDDIT_MESSAGES_PER_DAY",
  reachLinkedinConnectsStart: "WREN_REACH_LINKEDIN_CONNECTS_START",
  reachLinkedinConnectsCap: "WREN_REACH_LINKEDIN_CONNECTS_CAP",
  reachLinkedinMessagesPerDay: "WREN_REACH_LINKEDIN_MESSAGES_PER_DAY",
  reachHeldNiches: "WREN_REACH_HELD_NICHES",
  smsMaxFailRate: "WREN_SMS_MAX_FAIL_RATE",
  smsMaxOptOutRate: "WREN_SMS_MAX_OPT_OUT_RATE",
  smsLowBalanceUsd: "WREN_SMS_LOW_BALANCE_USD",
  autobrowseInstanceId: "WREN_AUTOBROWSE_INSTANCE_ID",
  redditClientId: "WREN_REDDIT_CLIENT_ID",
  redditClientSecret: "WREN_REDDIT_CLIENT_SECRET",
  redditRefreshToken: "WREN_REDDIT_REFRESH_TOKEN",
  redditUsername: "WREN_REDDIT_USERNAME",
} as const satisfies Record<keyof Settings, string>;

export interface LoadOptions {
  /** Relative directory settings resolve against. Pass the value `loadEnvFile()` returned. */
  rootDir?: string;
}

/**
 * Parse settings from an env map. Missing optional keys take schema defaults.
 * Directory settings come back absolute so every process agrees on the path
 * regardless of which package it was started from.
 */
export function loadSettings(
  env: NodeJS.ProcessEnv = process.env,
  opts: LoadOptions = {},
): Settings {
  const raw: Record<string, string | undefined> = {};
  for (const [field, key] of Object.entries(ENV_KEYS)) {
    const value = env[key];
    if (value !== undefined && value !== "") raw[field] = value;
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `${ENV_KEYS[i.path[0] as keyof Settings]}: ${i.message}`,
    );
    throw new Error(`invalid settings:\n${lines.join("\n")}`);
  }
  const root = opts.rootDir ?? process.cwd();
  const s = parsed.data;
  return {
    ...s,
    ...(s.contentVoicePath ? { contentVoicePath: resolve(root, s.contentVoicePath) } : {}),
  };
}
