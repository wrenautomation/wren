import { resolve } from "node:path";
import { z } from "zod";

export { loadEnvFile } from "./env-file.js";

/** All process settings. Read once at startup, passed down explicitly. */
export const settingsSchema = z.object({
  databaseUrl: z.string().url(),
  restateIngressUrl: z.string().url().default("http://127.0.0.1:8080"),
  inboxDir: z.string().min(1).default("inbox"),
  draftsDir: z.string().min(1).default("drafts"),
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
  tracing: z.enum(["none"]).default("none"),
  /** Mailbox verifier for resolution: the fake never spends. */
  verifier: z.enum(["fake", "millionverifier"]).default("fake"),

  // ---- send policy (parsed and range-checked by SendPolicy in channel-email) ----
  /** IANA zone the fleet window is read in. */
  sendTimezone: z.string().min(1).default("America/Chicago"),
  /** Comma-separated send days, mon..sun or full names. */
  sendDays: z.string().min(1).default("mon,tue,wed,thu,fri"),
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
  sendGapMinMinutes: z.coerce.number().default(8),
  sendGapMaxMinutes: z.coerce.number().default(20),
  /** Fleet-wide brake on new conversations per day; unset = unlimited. */
  newOpenersPerDay: z.coerce.number().int().optional(),
  /** Operator nudges: none | console | discord (needs the webhook URL, a secret). */
  notify: z.enum(["none", "console", "discord"]).default("none"),
  discordWebhookUrl: z.string().min(1).optional(),
  /** Send days of approved openers the queue-keeper holds ahead of the fleet (0 = off). */
  composeDaysAhead: z.coerce.number().int().min(0).default(3),
  /** Which pool-feeder stages may call the model: none (free groundwork), pick, all (+extraction). */
  poolModelStages: z.enum(["none", "pick", "all"]).default("none"),
  /** A lead whose only VALID check is older than this counts as unverified at compose. */
  verificationHorizonDays: z.coerce.number().int().default(45),
  resendCooldownDays: z.coerce.number().int().default(30),
  reconcileGraceMinutes: z.coerce.number().default(10),
  bouncePauseRate: z.coerce.number().default(0.02),
  bouncePauseMinBounces: z.coerce.number().int().default(2),
  healthWindowDays: z.coerce.number().int().default(7),
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
  /**
   * The Workspace user Postmaster answers for — the account that registered
   * the domains at postmaster.google.com. Unset = no daily pull.
   */
  postmasterUser: z.string().min(1).optional(),
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
  /** "console" prints; "gmail" sends for real. Console until cutover. */
  sendTransport: z.enum(["console", "gmail"]).default("console"),
  daemonTickSeconds: z.coerce.number().int().default(60),
  daemonSyncSeconds: z.coerce.number().int().default(300),
  /**
   * Domain provisioning (`Domain/{domain}`): bound only when the account id
   * and the Workspace super admin are both set and CLOUDFLARE_API_TOKEN is in
   * the env. Secrets never go through settings.
   */
  cloudflareAccountId: z.string().min(1).optional(),
  /** The Workspace super admin the service account acts as for domains and users. */
  googleAdminUser: z.string().email().optional(),
  /** DMARC aggregate reports go here (unset = none). */
  dmarcRua: z.string().email().optional(),
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
    .pipe(z.array(z.enum(["linkedin", "youtube"]))),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Env var name for each setting. One place, so `.env.example` and code can't drift. */
export const ENV_KEYS = {
  databaseUrl: "WREN_DATABASE_URL",
  restateIngressUrl: "WREN_RESTATE_INGRESS_URL",
  inboxDir: "WREN_INBOX_DIR",
  draftsDir: "WREN_DRAFTS_DIR",
  logLevel: "WREN_LOG_LEVEL",
  fetchContact: "WREN_FETCH_CONTACT",
  robotsMode: "WREN_ROBOTS_MODE",
  llm: "WREN_LLM",
  llmModel: "WREN_LLM_MODEL",
  llmEnvPath: "WREN_LLM_ENV_PATH",
  tracing: "WREN_TRACING",
  verifier: "WREN_VERIFIER",
  sendTimezone: "WREN_SEND_TIMEZONE",
  sendDays: "WREN_SEND_DAYS",
  sendWindowStart: "WREN_SEND_WINDOW_START",
  sendWindowEnd: "WREN_SEND_WINDOW_END",
  sendLeadWindowStart: "WREN_SEND_LEAD_WINDOW_START",
  sendLeadWindowEnd: "WREN_SEND_LEAD_WINDOW_END",
  coldSendsPerInboxPerDay: "WREN_COLD_SENDS_PER_INBOX_PER_DAY",
  coldSendsRampStart: "WREN_COLD_SENDS_RAMP_START",
  coldSendsRampFrom: "WREN_COLD_SENDS_RAMP_FROM",
  coldSendsRampStep: "WREN_COLD_SENDS_RAMP_STEP",
  coldSendsRampEveryDays: "WREN_COLD_SENDS_RAMP_EVERY_DAYS",
  sendGapMinMinutes: "WREN_SEND_GAP_MIN_MINUTES",
  sendGapMaxMinutes: "WREN_SEND_GAP_MAX_MINUTES",
  newOpenersPerDay: "WREN_NEW_OPENERS_PER_DAY",
  notify: "WREN_NOTIFY",
  discordWebhookUrl: "WREN_DISCORD_WEBHOOK_URL",
  composeDaysAhead: "WREN_COMPOSE_DAYS_AHEAD",
  poolModelStages: "WREN_POOL_MODEL_STAGES",
  verificationHorizonDays: "WREN_VERIFICATION_HORIZON_DAYS",
  resendCooldownDays: "WREN_RESEND_COOLDOWN_DAYS",
  reconcileGraceMinutes: "WREN_RECONCILE_GRACE_MINUTES",
  bouncePauseRate: "WREN_BOUNCE_PAUSE_RATE",
  bouncePauseMinBounces: "WREN_BOUNCE_PAUSE_MIN_BOUNCES",
  healthWindowDays: "WREN_HEALTH_WINDOW_DAYS",
  pixelBaseUrl: "WREN_PIXEL_BASE_URL",
  openTracking: "WREN_OPEN_TRACKING",
  pixelExportToken: "WREN_PIXEL_EXPORT_TOKEN",
  postmasterUser: "WREN_POSTMASTER_USER",
  reportTo: "WREN_REPORT_TO",
  reportFrom: "WREN_REPORT_FROM",
  googleServiceAccount: "WREN_GOOGLE_SERVICE_ACCOUNT",
  renderer: "WREN_RENDERER",
  cdpUrl: "WREN_CDP_URL",
  sendersFile: "WREN_SENDERS_FILE",
  sendTransport: "WREN_SEND_TRANSPORT",
  daemonTickSeconds: "WREN_DAEMON_TICK_SECONDS",
  daemonSyncSeconds: "WREN_DAEMON_SYNC_SECONDS",
  cloudflareAccountId: "WREN_CLOUDFLARE_ACCOUNT_ID",
  googleAdminUser: "WREN_GOOGLE_ADMIN_USER",
  dmarcRua: "WREN_DMARC_RUA",
  contentChannels: "WREN_CONTENT_CHANNELS",
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
  return { ...s, inboxDir: resolve(root, s.inboxDir), draftsDir: resolve(root, s.draftsDir) };
}
