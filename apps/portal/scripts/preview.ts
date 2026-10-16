/**
 * The portal on your machine, against your local databases: the built app plus
 * the same API, called in-process instead of through Restate and sign-in.
 *
 *   pnpm --filter @wren/portal preview          # as an operator: every client
 *   pnpm --filter @wren/portal preview --demo   # as a demo visitor: masked
 *   pnpm --filter @wren/portal preview --as amy@acme.example   # as that person, guarded
 *
 * With `--as`, each call runs the access guard first, as the edge's services do, so a custom
 * role, extra grants and View as answer here as they would live.
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { calendarRecordsApi } from "@wren/calendar/console";
import { CALENDAR_CONSOLE_APPS, CALENDAR_CONSOLE_ROUTES } from "@wren/calendar/console-routes";
import { CALENDAR_RECORDS } from "@wren/calendar/records";
import {
  bookingPage,
  type ClientCalendarDeps,
  calendarFlows,
  calendarOwner,
  ownerDeps,
} from "@wren/calendar/restate";
import { mailAccess, mailAppsFrom } from "@wren/channel-email/access/access";
import { mailConsoleApi } from "@wren/channel-email/access/console";
import { MAIL_ACCESS_APPS, MAIL_ACCESS_ROUTES } from "@wren/channel-email/access/console-routes";
import { callRecord, firmRecord, replyRecord } from "@wren/channel-email/records";
import { EMAIL_CONSOLE_VIEWS } from "@wren/channel-email/views";
import { SMS_CONSOLE_APPS, SMS_CONSOLE_ROUTES } from "@wren/channel-sms/console-routes";
import { smsConsoleApi } from "@wren/channel-sms/restate";
import { CONTENT_CHANNELS, loadEnvFile, loadSettings } from "@wren/config";
import {
  CONNECTOR_APPS,
  connectorAccess,
  connectorAppsFrom,
  connectorsConsoleApi,
} from "@wren/connectors";
import { CONNECTORS_APPS, CONNECTORS_ROUTES } from "@wren/connectors/console-routes";
import { swapShortMedia, undoVideo, waitingIdeas } from "@wren/content";
import {
  liveFrom,
  type OwnSites,
  ownSwitchesOf,
  SOCIAL_ACCESS_APPS,
  SOCIAL_ACCESS_ROUTES,
  SOCIAL_APPS,
  socialAccess,
  socialAppsFrom,
  socialConsoleApi,
} from "@wren/content/connect";
import { pieceRows, piecesOf } from "@wren/content/pieces";
import { type Need, type RouteApps, routeAt } from "@wren/core/access";
import { accountsApi } from "@wren/core/accounts/console";
import { ACCOUNTS_CONSOLE_APPS, ACCOUNTS_CONSOLE_ROUTES } from "@wren/core/accounts/console-routes";
import { askRecord } from "@wren/core/ask";
import { BROADCAST_RECORDS } from "@wren/core/broadcast-records";
import { clientRecord, clientUrl } from "@wren/core/clients";
import { consoleApi } from "@wren/core/console";
import { CONSOLE_APPS, CONSOLE_ROUTES } from "@wren/core/console-routes";
import type { SiteClient } from "@wren/core/content";
import { KEY_STAGE_PATH, REF_ROUTES, rawKeyAt } from "@wren/core/key-refs";
import { intakeKey, pgKeyStore, throwawayRing } from "@wren/core/keys";
import {
  MARKETING_CONSOLE_APPS,
  MARKETING_CONSOLE_ROUTES,
} from "@wren/core/marketing/console-routes";
import { PEOPLE_RECORDS, peopleConsoleApi } from "@wren/core/people/console";
import { PEOPLE_CONSOLE_APPS, PEOPLE_CONSOLE_ROUTES } from "@wren/core/people/console-routes";
import { guard, PortalRefusal, teamSeat, type Unnamed, type Viewer } from "@wren/core/portal";
import { profileRecords } from "@wren/core/profile-records";
import { SEGMENT_RECORDS } from "@wren/core/segment-records";
import { SENT_RECORDS } from "@wren/core/sent/records";
import { templatesApi } from "@wren/core/templates/console";
import {
  TEMPLATES_CONSOLE_APPS,
  TEMPLATES_CONSOLE_ROUTES,
} from "@wren/core/templates/console-routes";
import { viewAsApi } from "@wren/core/view-as";
import { actingAs, cachedDb, clientDatabaseName, createDb } from "@wren/db";
import { dealsConsoleApi } from "@wren/deals/console";
import { DEALS_CONSOLE_APPS, DEALS_CONSOLE_ROUTES } from "@wren/deals/console-routes";
import { billingConsoleApi } from "@wren/delivery/billing/console";
import {
  BILLING_CONSOLE_APPS,
  BILLING_CONSOLE_ROUTES,
} from "@wren/delivery/billing/console-routes";
import { BILLING_RECORDS } from "@wren/delivery/billing/records";
import { type FileStore, fileNameOf } from "@wren/delivery/files";
import { HEALTH_RECORDS } from "@wren/delivery/health";
import { healthConsoleApi } from "@wren/delivery/health/console";
import { HEALTH_CONSOLE_APPS, HEALTH_CONSOLE_ROUTES } from "@wren/delivery/health/console-routes";
import { messagingApi } from "@wren/delivery/messaging";
import { DELIVERY_ROUTES, deliveryApi } from "@wren/delivery/restate";
import { DELIVERY_APPS } from "@wren/delivery/routes";
import { webhooksApi } from "@wren/delivery/webhooks";
import { documentsConsoleApi } from "@wren/documents/console";
import { DOCUMENTS_CONSOLE_APPS, DOCUMENTS_CONSOLE_ROUTES } from "@wren/documents/console-routes";
import { learnConsoleApi } from "@wren/learn/console";
import { LEARN_CONSOLE_APPS, LEARN_CONSOLE_ROUTES } from "@wren/learn/console-routes";
import { LEARN_RECORDS, sopRecordFor } from "@wren/learn/records";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { notesApi } from "@wren/notes/console";
import { NOTES_CONSOLE_APPS, NOTES_CONSOLE_ROUTES } from "@wren/notes/console-routes";
import { googleDrive } from "@wren/notes/drive";
import { NOTES_RECORDS } from "@wren/notes/records";
import { LIVE_PREFIX, Room, RoomRefusal, type SyncAnswer } from "@wren/notes/room";
import { pickAccount } from "@wren/outreach";
import { paymentsConsoleApi } from "@wren/payments/console";
import { PAYMENTS_CONSOLE_APPS, PAYMENTS_CONSOLE_ROUTES } from "@wren/payments/console-routes";
import { DEMO_NAME, PORTAL_ROUTES, portalApi } from "@wren/reactivation/restate";
import { sitesApi } from "@wren/sites/console";
import { SITES_CONSOLE_APPS, SITES_CONSOLE_ROUTES } from "@wren/sites/console-routes";
import { FORM_PATH, KIT_JS, KIT_PATH, TRACK_PATH } from "@wren/sites/kit";
import { SITES_RECORDS } from "@wren/sites/records";
import { FORM_CSP, PAGE_CSP } from "@wren/sites/render";
import { sitesPublicApi } from "@wren/sites/service";
import { proposeChange } from "@wren/studio/change";
import { setEdit, setLine, setWords } from "@wren/studio/edit";
import { withFallback } from "@wren/studio/stress";
import { dictationApi } from "@wren/voice/console";
import { VOICE_CONSOLE_APPS, VOICE_CONSOLE_ROUTES } from "@wren/voice/console-routes";
import { VOICE_RECORDS } from "@wren/voice/records";
import { WebSocketServer } from "ws";
import { mediaRecord, sopRecord } from "../../../packages/content/src/library.js";
import { marketingConsoleApi } from "../../../packages/content/src/restate/marketing-console.js";
import { videoRecord } from "../../../packages/content/src/video.js";
import { PORTAL_APPS } from "../../../packages/reactivation/src/portal/routes.js";
import { COMPONENTS } from "../../worker/src/components.js";
import { clientMarketing, marketingNumbers } from "../../worker/src/marketing.js";
import { copyRecords } from "../../worker/src/record-edits.js";
import { SETUPS } from "../../worker/src/setups.js";
import { WORKFLOWS } from "../../worker/src/workflows.js";
import { type DictateEnv, dictate } from "../src/dictate.js";
import { grantFor, MEDIA_GRANT_PATH, MEDIA_PATH, mediaKey, mediaProxy } from "../src/media.js";
import { PULSE_PATH, pulseCalls } from "../src/pulse.js";
import { isSend, isWrite, WRITE_STATUS_PATH } from "../src/services.js";

const demo = process.argv.includes("--demo");
const port = Number(process.env.PORT ?? 8788);
const rootDir = loadEnvFile(process.cwd(), process.env.WREN_ROOT);
const settings = loadSettings(process.env, { rootDir });
const standIns = process.env.WREN_PREVIEW_SOCIAL_APPS === "true";
/** autobrowse for Wren's own Check in the preview: every site signed in, one who-am-I route. */
const standInSites: OwnSites = {
  status: async () => ({
    authed: true,
    routes: [
      { method: "GET", path: "/me", via: "api" },
      { method: "POST", path: "/posts", via: "browser" },
    ],
    probe: { path: "/me" },
  }),
  read: async () => ({ data: { username: "wren_preview" } }),
  renewDry: async () => ({ due: [], next: null }),
  now: async () => Date.now(),
};
/** A client's TikTok as the stand-ins answer it: made-up numbers and two videos. */
const standInTikTok: SiteClient = {
  call: async <T>(_site: string, _method: string, path: string): Promise<T> =>
    (path === "/v2/user/info/"
      ? { data: { user: { follower_count: 1280, likes_count: 20450, video_count: 2 } } }
      : {
          data: {
            videos: [1, 2].map((i) => ({
              id: `preview-video-${i}`,
              title: `Preview video ${i}`,
              view_count: 900 * i,
              like_count: 40 * i,
              comment_count: 3 * i,
              create_time: Math.floor(Date.now() / 1000) - i * 86_400,
            })),
          },
        }) as T,
  via: async () => "api",
};
const main = createDb(settings.databaseUrl, { max: 2 }).db;
/** The key store with a key pair made at start: keys saved in an earlier run won't open. */
const ring = throwawayRing("dev");
const keys = pgKeyStore(main, ring);
/** Client files in memory, PUT and GET at /files/<key>: the bucket's part, minus the signing. */
const stored = new Map<string, { type: string; bytes: Buffer }>();
const files: FileStore = {
  putUrl: async (key) => `http://localhost:${port}/files/${key}`,
  getUrl: async (key) => `http://localhost:${port}/files/${key}`,
  put: async (key, bytes, type) => void stored.set(key, { type, bytes: Buffer.from(bytes) }),
};
/** A draft's stored files (thumbnail, cover) from the same store: `s3://<any bucket>/<key>`. */
const media = {
  bucket: "preview",
  host: {
    host: async (source: string) =>
      `http://localhost:${port}/files/${source.replace(/^s3:\/\/[^/]+\//, "")}`,
  },
};
/** The checks the Worker runs (services.ts `setupChecks`): the rest say "in development". */
const LIVE_CHECKS = new Set([
  "dns.answers",
  "dns.mail_records",
  "dns.postmaster_txt",
  "telnyx.campaign",
  "telnyx.number",
  "inbox.auth",
  "inbox.warmup",
  "inbox.placement",
  "search_console.access",
  "google_calendar.access",
  "meta.ad_account",
  "meta.page",
  "mail.google_app",
  "mail.microsoft_app",
  "google.mail_trust",
  "microsoft.admin_consent",
  "mailbox.token",
]);
/** The same services as the Worker's `/api/<service>/<route>`, called in-process. */
const SERVICES: Record<
  string,
  {
    routes: readonly string[];
    api: object;
    guard: { needs: object; apps: RouteApps<object>; unnamed: Unnamed };
  }
> = {
  delivery: {
    routes: Object.keys(DELIVERY_ROUTES),
    guard: { needs: DELIVERY_ROUTES, apps: DELIVERY_APPS, unnamed: "first" },
    api: {
      ...deliveryApi({
        main,
        demoName: DEMO_NAME,
        files,
        app: `http://localhost:${port}`,
        // A client's own database, for the rules Account > Messaging shows.
        open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      }),
      ...messagingApi({ main, open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)) }),
      // Redeliver answers the id here; the worker's handler is what sends it.
      ...webhooksApi({ main }),
    },
  },
  reactivation: {
    routes: Object.keys(PORTAL_ROUTES),
    guard: { needs: PORTAL_ROUTES, apps: PORTAL_APPS, unnamed: "first" },
    api: portalApi({ main, open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)) }),
  },
  console: {
    routes: Object.keys(CONSOLE_ROUTES),
    guard: { needs: CONSOLE_ROUTES, apps: CONSOLE_APPS, unnamed: "wren" },
    api: {
      // View as's picker and the sandbox (designs/2026-10-14-view-as.md).
      ...viewAsApi({ main, mainUrl: settings.databaseUrl, components: COMPONENTS }),
      ...consoleApi({
        main,
        views: EMAIL_CONSOLE_VIEWS,
        components: COMPONENTS,
        workflows: WORKFLOWS,
        setups: SETUPS,
        records: [
          askRecord,
          // The Clients app's list, with each client's Templates, Components and Accounts.
          clientRecord,
          // The copy pages edit in place: History, Undo, Ask Claude (whose answer nothing writes here).
          ...copyRecords(settings.smsSenderName),
          // The Library's Media (no bucket here: listed, not played) and SOPs.
          mediaRecord(),
          sopRecord,
          // Inbox > Calls and Email replies, and a client's page (/clients/all/<id>), as the worker
          // registers them; Wren's own bookings for the Calendar's counts and Today.
          callRecord,
          replyRecord,
          ...CALENDAR_RECORDS,
          clientRecord,
          // Marketing's own pages (drafts, posts, comments, DMs, videos, Inbox) and Pipeline's
          // companies. Videos play from the in-memory file store.
          ...marketingNumbers(media),
          videoRecord(media),
          firmRecord,
          // Voice's calls and Latency, as the worker registers them.
          ...VOICE_RECORDS,
          // Clients' health and flags.
          ...HEALTH_RECORDS,
          // Money in by bank transfer.
          ...BILLING_RECORDS,
          // The Inbox's Mentions: the signed-in person's own.
          ...NOTES_RECORDS,
          // Learn, with the SOP library read from the local folders.
          ...LEARN_RECORDS,
          sopRecordFor(resolve(rootDir, settings.sopsDir)),
          ...SITES_RECORDS,
          // Every message we sent (People → Sent), and Wren's segments.
          ...SENT_RECORDS,
          ...SEGMENT_RECORDS,
          ...BROADCAST_RECORDS,
          // People: everyone once, their addresses, traits and timeline. Site visits: a stand-in
          // for the lander's log (the worker reads it live), two lines for any visitor.
          ...profileRecords(WORKFLOWS, {
            visits: async (v) =>
              v.length
                ? [
                    { at: new Date().toISOString(), text: "Saw /pricing, 2 min", href: null },
                    {
                      at: new Date(Date.now() - 864e5).toISOString(),
                      text: "Saw /, 40 sec, from google",
                      href: null,
                    },
                  ]
                : [],
          }),
        ],
      }),
    },
  },
  // Accounts and vendors. Steps move on the spine, which isn't here: a write saves, nothing runs.
  accounts: {
    routes: Object.keys(ACCOUNTS_CONSOLE_ROUTES),
    guard: { needs: ACCOUNTS_CONSOLE_ROUTES, apps: ACCOUNTS_CONSOLE_APPS, unnamed: "first" },
    api: accountsApi({
      db: main,
      setups: SETUPS,
      checks: LIVE_CHECKS,
      keys,
      agent: process.env.WREN_SETUP_AGENT === "true",
      parts: COMPONENTS.filter((c) => c.requires.facts.length > 0),
    }),
  },
  // Account → Mail. No network: Connect can't reach Google or Microsoft here. Wren's apps from
  // WREN_MAIL_* when set.
  mail: {
    routes: Object.keys(MAIL_ACCESS_ROUTES),
    guard: { needs: MAIL_ACCESS_ROUTES, apps: MAIL_ACCESS_APPS, unnamed: "first" },
    api: mailConsoleApi({
      main,
      access: mailAccess({
        main,
        apps: mailAppsFrom(
          {
            googleId: settings.mailGoogleClientId,
            googleSecret: settings.mailGoogleClientSecret,
            microsoftId: settings.mailMicrosoftClientId,
            microsoftSecret: settings.mailMicrosoftClientSecret,
          },
          keys,
        ),
        keys,
        origin: `http://localhost:${port}`,
        fetch: async () => {
          throw new Error("no network in the preview");
        },
      }),
      clientDb: (c) =>
        cachedDb(clientUrl(settings.databaseUrl, { database: clientDatabaseName(c) })),
      setups: SETUPS,
    }),
  },
  // Account → Social. No network: Connect can't reach a platform here. Wren's apps from the key
  // store, or stand-ins with WREN_PREVIEW_SOCIAL_APPS=true to see every state (and, on Wren's own
  // page, every channel with a Check that answers from a stand-in autobrowse).
  social: {
    routes: Object.keys(SOCIAL_ACCESS_ROUTES),
    guard: { needs: SOCIAL_ACCESS_ROUTES, apps: SOCIAL_ACCESS_APPS, unnamed: "first" },
    api: socialConsoleApi({
      main,
      own: {
        switches: ownSwitchesOf({
          ...settings,
          contentChannels:
            settings.contentChannels.length || !standIns
              ? settings.contentChannels
              : CONTENT_CHANNELS,
        }),
        known: CONTENT_CHANNELS,
        ...(standIns ? { sites: standInSites } : {}),
      },
      ...(standIns ? { sites: standInTikTok } : {}),
      access: socialAccess({
        main,
        apps:
          process.env.WREN_PREVIEW_SOCIAL_APPS === "true"
            ? async () =>
                Object.fromEntries(SOCIAL_APPS.map((a) => [a, { id: `${a}-app`, secret: "x" }]))
            : socialAppsFrom(keys, process.env),
        keys,
        origin: `http://localhost:${port}`,
        fetch: async () => {
          throw new Error("no network in the preview");
        },
        live: liveFrom(settings.socialLive),
      }),
    }),
  },
  // Account → Connectors. No network: Connect can't reach an app here; Wren's apps from the key
  // store, or stand-ins with WREN_PREVIEW_SOCIAL_APPS=true to see every state.
  connectors: {
    routes: Object.keys(CONNECTORS_ROUTES),
    guard: { needs: CONNECTORS_ROUTES, apps: CONNECTORS_APPS, unnamed: "first" },
    api: connectorsConsoleApi({
      main,
      access: connectorAccess({
        main,
        apps:
          process.env.WREN_PREVIEW_SOCIAL_APPS === "true"
            ? async () =>
                Object.fromEntries(CONNECTOR_APPS.map((a) => [a, { id: `${a}-app`, secret: "x" }]))
            : connectorAppsFrom(keys, process.env),
        keys,
        origin: `http://localhost:${port}`,
        fetch: async () => {
          throw new Error("no network in the preview");
        },
      }),
    }),
  },
  // A client's Marketing, from its own database. A verdict goes to its desk on Restate: not here.
  marketing: {
    routes: Object.keys(MARKETING_CONSOLE_ROUTES),
    guard: { needs: MARKETING_CONSOLE_ROUTES, apps: MARKETING_CONSOLE_APPS, unnamed: "first" },
    api: marketingConsoleApi({
      db: main,
      open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      records: clientMarketing(media),
    }),
  },
  // A client's Calendar app (its week and its calls), from its own database. Outcomes and cancel
  // run on Restate: not here.
  calendar: {
    routes: Object.keys(CALENDAR_CONSOLE_ROUTES),
    guard: { needs: CALENDAR_CONSOLE_ROUTES, apps: CALENDAR_CONSOLE_APPS, unnamed: "wren" },
    api: calendarRecordsApi({
      main,
      open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      portal: `http://localhost:${port}`,
    }),
  },
  // The Library's templates, in Wren's own database.
  templates: {
    routes: Object.keys(TEMPLATES_CONSOLE_ROUTES),
    guard: { needs: TEMPLATES_CONSOLE_ROUTES, apps: TEMPLATES_CONSOLE_APPS, unnamed: "wren" },
    api: templatesApi({ db: main }),
  },
  // Notes, in each workspace's own database; images in memory like client files.
  // Health and flags: rate, override, raise, take, address, clear.
  health: {
    routes: Object.keys(HEALTH_CONSOLE_ROUTES),
    guard: { needs: HEALTH_CONSOLE_ROUTES, apps: HEALTH_CONSOLE_APPS, unnamed: "wren" },
    api: healthConsoleApi(main),
  },
  // Money in by bank transfer: match, set aside.
  billing: {
    routes: Object.keys(BILLING_CONSOLE_ROUTES),
    guard: { needs: BILLING_CONSOLE_ROUTES, apps: BILLING_CONSOLE_APPS, unnamed: "wren" },
    api: billingConsoleApi(main),
  },
  notes: {
    routes: Object.keys(NOTES_CONSOLE_ROUTES),
    guard: { needs: NOTES_CONSOLE_ROUTES, apps: NOTES_CONSOLE_APPS, unnamed: "wren" },
    api: notesApi({
      main,
      open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      files,
      zone: settings.sendTimezone,
      // Public links only: the service account's key stays on the Worker.
      drive: googleDrive({}),
    }),
  },
  // Learn: a save is kept here; its read and score run on the spine, which isn't here.
  learn: {
    routes: Object.keys(LEARN_CONSOLE_ROUTES),
    guard: { needs: LEARN_CONSOLE_ROUTES, apps: LEARN_CONSOLE_APPS, unnamed: "wren" },
    api: learnConsoleApi(main, fetch, (c) =>
      cachedDb(clientUrl(settings.databaseUrl, { database: clientDatabaseName(c) })),
    ),
  },
  // Sites, in Wren's own database. No model here: a new page takes the offer's own words.
  sites: {
    routes: Object.keys(SITES_CONSOLE_ROUTES),
    guard: { needs: SITES_CONSOLE_ROUTES, apps: SITES_CONSOLE_APPS, unnamed: "wren" },
    api: sitesApi({ db: main, write: null }),
  },
  // A client's Texts, from its own database. A reply, Done and a review ask by hand run on
  // Restate: not here.
  people: {
    routes: Object.keys(PEOPLE_CONSOLE_ROUTES),
    guard: { needs: PEOPLE_CONSOLE_ROUTES, apps: PEOPLE_CONSOLE_APPS, unnamed: "wren" },
    api: peopleConsoleApi({
      db: main,
      open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      records: [...PEOPLE_RECORDS, ...profileRecords(WORKFLOWS)],
    }),
  },
  sms: {
    routes: Object.keys(SMS_CONSOLE_ROUTES),
    guard: { needs: SMS_CONSOLE_ROUTES, apps: SMS_CONSOLE_APPS, unnamed: "first" },
    api: smsConsoleApi({ db: main, open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)) }),
  },
  // Opportunities: a move fires nothing here, as there's no spine.
  deals: {
    routes: Object.keys(DEALS_CONSOLE_ROUTES),
    guard: { needs: DEALS_CONSOLE_ROUTES, apps: DEALS_CONSOLE_APPS, unnamed: "wren" },
    api: dealsConsoleApi({ main }),
  },
  // Payments: links and Stripe's status. No Stripe here: a key saves, and connecting stops at
  // Stripe's check.
  payments: {
    routes: Object.keys(PAYMENTS_CONSOLE_ROUTES),
    guard: { needs: PAYMENTS_CONSOLE_ROUTES, apps: PAYMENTS_CONSOLE_APPS, unnamed: "first" },
    api: (() => {
      const api = paymentsConsoleApi({
        main,
        open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
        keys,
        fetch: async () => new Response("{}", { status: 503 }),
        portal: `http://localhost:${port}`,
      });
      const now = () => new Date();
      return {
        ...api,
        create: (r: never) => api.create(r, now()),
        fromThread: (r: never) => api.fromThread(r, now()),
        approve: (r: never) => api.approve(r, now()),
        decline: (r: never) => api.decline(r, now()),
        connect: (r: never) => api.connect(r, now()),
      };
    })(),
  },
  // Documents: drafts, templates and To approve. Nothing is sent: a send stops at "sending".
  documents: {
    routes: Object.keys(DOCUMENTS_CONSOLE_ROUTES),
    guard: { needs: DOCUMENTS_CONSOLE_ROUTES, apps: DOCUMENTS_CONSOLE_APPS, unnamed: "first" },
    api: (() => {
      const api = documentsConsoleApi({
        main,
        open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      });
      const now = () => new Date();
      return {
        ...api,
        create: (r: never) => api.create(r, now()),
        update: (r: never) => api.update(r, now()),
        send: (r: never) => api.send(r, now()),
        approve: (r: never) => api.approve(r, now()),
        decline: (r: never) => api.decline(r, now()),
        void: (r: never) => api.void(r, now()),
        remind: (r: never) => api.remind(r, now()),
        duplicate: (r: never) => api.duplicate(r, now()),
        templateSave: (r: never) => api.templateSave(r, now()),
        templateArchive: (r: never) => api.templateArchive(r, now()),
      };
    })(),
  },
  // Dictation's timings only; a test call's save is Restate's.
  voice: {
    routes: ["dictated", "dictation"],
    guard: { needs: VOICE_CONSOLE_ROUTES, apps: VOICE_CONSOLE_APPS, unnamed: "wren" },
    api: dictationApi({ db: main }),
  },
};
/** Ask Claude's handler is Restate's (it opens a run, then the desk answers): here, only the run. */
const local = SERVICES.console?.api as Record<string, (i: unknown) => Promise<unknown>>;
local.recordsAsk = async (i) => ({ id: await local.recordsAskOpen?.(i) });
local.workflowAsk = async (i) => ({ id: await local.workflowAskOpen?.(i) });
/** A handler by name is Restate's; here only the video editor's saves, straight on the row. */
local.call = async (i) => {
  const { service, handler, input } = i as { service: string; handler: string; input: VideoIn };
  const by = "preview@localhost";
  try {
    if (service === "VideoDesk" && handler === "set")
      return pickRun(
        await setEdit(main, input.id, input.patch, {
          by,
          ...(input.expect ? { expect: input.expect } : {}),
          ...(input.proposal ? { stats: { proposal: input.proposal } } : {}),
        }),
      );
    if (service === "VideoDesk" && handler === "undo")
      return pickRun(await undoVideo(main, input.id, by));
    // A storyboard change: the preview's model is the CLI's (--llm gateway, no paid fallback).
    if (service === "VideoDesk" && handler === "propose")
      return await proposeChange(main, input.id, input.sentence ?? "", previewModel(), {
        by,
        beat: input.beat ?? null,
      });
    if (service === "VideoDesk" && handler === "line")
      return pickRun(await setLine(main, input.id, input as Required<VideoIn>, by));
    if (service === "VideoDesk" && handler === "words" && input.wrong && input.right)
      return pickRun(
        await setWords(main, input.id, { wrong: input.wrong, right: input.right }, { by }),
      );
    if (service === "VideoDesk" && handler === "swap") {
      const r = await swapShortMedia(main, input.id, {
        by,
        ...(input.short ? { short: input.short } : {}),
      });
      return { run: r.run, swapped: r.swapped.length, missing: r.missing.length };
    }
    // A draft's account pick (no words): kept as the desk keeps it, so the picker works here.
    const pick = input as unknown as {
      record?: string;
      id?: string;
      text?: string;
      account?: string | null;
    };
    if (service === "DraftAsk" && handler === "set" && pick.text === undefined && "account" in pick)
      return {
        accounts: await pickAccount(main, {
          item: `${pick.record}:${pick.id}`,
          account: pick.account ?? null,
          by,
        }),
      };
    // Studio's reads: what waits on him, and every piece with where it went.
    if (service === "ContentDesk" && handler === "waiting")
      return { ideas: await waitingIdeas(main) };
    if (service === "Pieces" && handler === "list")
      return { pieces: piecesOf(await pieceRows(main, "localhost")) };
  } catch (err) {
    if (err instanceof PortalRefusal) throw err;
    throw new PortalRefusal(err instanceof Error ? err.message : String(err), 409);
  }
  throw new PortalRefusal(`${service}/${handler} runs on Restate, not in preview.`, 404);
};
/** The model a storyboard change asks: `WREN_PREVIEW_LLM` (default the gateway), keys as the CLI loads them. */
const previewModel = () => {
  loadLlmEnv(settings.llmEnvPath, rootDir);
  return withFallback(makeLlm(process.env.WREN_PREVIEW_LLM ?? "gateway", process.env), null);
};
type VideoIn = {
  id: number;
  patch?: unknown;
  expect?: Record<string, unknown>;
  proposal?: string;
  sentence?: string;
  beat?: string | null;
} & {
  at?: number[];
  text?: string;
  was?: string;
  wrong?: string;
  right?: string;
  short?: number | null;
};
const pickRun = ({ run }: { run: string }) => ({ run });
const as = process.argv[process.argv.indexOf("--as") + 1];
const guarded = !demo && process.argv.includes("--as") && !!as;
const viewer: Viewer = demo
  ? { demo: true }
  : guarded
    ? { email: as, ...((await teamSeat(main, as)) ? { operator: true } : {}) }
    : { email: "preview@localhost", operator: true };
const dist = join(import.meta.dirname, "..", "dist");

/**
 * A client's booking page at /c/<client>/book, its API at /c/<client>/__book/<handler>: the same
 * flows as ClientCalendar, in-process on a stand-in for Restate's context. No Google and no mail
 * here: a booking holds its slot and sends nothing; reminders and the spine are dropped.
 */
const BOOK_PAGE =
  /^\/c\/[a-z][a-z0-9_]{0,39}\/(?:book(?:\/[A-Za-z0-9_-]{1,64})?|booking\/[A-Za-z0-9._-]{1,80})\/?$/;
const BOOK_API = /^\/c\/([a-z][a-z0-9_]{0,39})\/__book\/(slots|book|booking|reschedule|cancel)$/;
const bookDeps: ClientCalendarDeps = {
  main,
  open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
  host: null,
  shared: "preview-only-secret",
  portal: `http://localhost:${port}`,
  mailer: null,
};
type Ctx = Parameters<ReturnType<typeof calendarFlows>["slots"]>[0];
const drop: object = new Proxy({}, { get: () => () => undefined });
const standIn = {
  run: async (_name: string, fn: () => unknown) => fn(),
  date: { now: async () => Date.now() },
  serviceSendClient: () => drop,
  objectSendClient: () => drop,
  console,
} as unknown as Ctx;
async function book(client: string, handler: string, req: Record<string, unknown>) {
  const owner = await calendarOwner(main, bookDeps.portal, client);
  const d = ownerDeps(bookDeps, owner);
  const f = calendarFlows(d);
  const page = bookingPage(owner, d);
  const token = req.token;
  if (handler === "slots") return { ...page, ...(await f.slots(standIn)) };
  if (handler === "booking") return { ...page, ...(await f.view(standIn, f.bookingOf(token))) };
  if (handler === "book")
    return f.book(standIn, {
      ...(req as unknown as Parameters<typeof f.book>[1]),
      offer: typeof req.tag === "string" && req.tag ? req.tag : null,
    });
  if (handler === "reschedule") return f.reschedule(standIn, f.bookingOf(token), String(req.start));
  return f.cancel(standIn, f.bookingOf(token), {
    by: "booker",
    reason: typeof req.reason === "string" ? req.reason : null,
  });
}
/** One API call, in-process, guarded as the edge's services are with `--as`. */
async function callApi(
  name: string,
  call: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const svc = SERVICES[name];
  const handler = (svc?.api as Record<string, (i: unknown) => Promise<unknown>> | undefined)?.[
    call
  ];
  if (!svc?.routes.includes(call) || !handler) return { status: 404, body: { error: "not found" } };
  try {
    // A call under View as is guarded too: the guard decides who it's as.
    const viewing = input.viewAs !== undefined && input.viewAs !== null;
    if (!guarded && !viewing) return { status: 200, body: await handler(input) };
    const g = svc.guard;
    const need = (g.needs as Record<string, Need>)[call] as Need;
    const fresh = await guard(
      main,
      need,
      input as unknown as Parameters<typeof guard>[2],
      g.unnamed,
      routeAt(g.apps, call),
    );
    const as = "as" in fresh.viewer ? fresh.viewer.as : undefined;
    return {
      status: 200,
      body: await (as
        ? actingAs({ actor: as.by, as: as.label }, () => handler(fresh))
        : handler(fresh)),
    };
  } catch (err) {
    if (err instanceof PortalRefusal) return { status: err.status, body: { message: err.message } };
    console.error(err);
    return { status: 500, body: { message: err instanceof Error ? err.message : String(err) } };
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const previewMediaKey = mediaKey(crypto.randomUUID());

/** Writes by request id, and how each went: preview's Restate idempotency. */
type Ran = {
  out: { status: number; body: unknown } | null;
  done: Promise<{ status: number; body: unknown }>;
};
const once = new Map<string, Ran>();

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path.startsWith("/files/")) {
    const key = path.slice(7);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      stored.set(key, { type: req.headers["content-type"] ?? "", bytes: Buffer.concat(chunks) });
      return res.writeHead(200).end();
    }
    const f = stored.get(key);
    if (!f) return res.writeHead(404).end();
    // A video seeks by range, as from the bucket.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const end = range[2] ? Math.min(Number(range[2]), f.bytes.length - 1) : f.bytes.length - 1;
      const start = range[1] ? Number(range[1]) : 0;
      res.writeHead(206, {
        "content-type": f.type,
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${f.bytes.length}`,
        "content-length": end - start + 1,
      });
      return res.end(f.bytes.subarray(start, end + 1));
    }
    res.writeHead(200, {
      "accept-ranges": "bytes",
      "content-type": f.type,
      "content-disposition": `attachment; filename="${fileNameOf(key)}"`,
    });
    return res.end(f.bytes);
  }
  const booking = BOOK_API.exec(path);
  if (booking) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const out = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    try {
      const { client: _c, ...input } = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      return out(200, await book(booking[1] as string, booking[2] as string, input));
    } catch (err) {
      // A refusal (Restate's TerminalError) carries its status.
      const e = err as { name?: string; code?: number; message?: string };
      if (e.name === "TerminalError") return out(e.code ?? 400, { error: e.message });
      console.error(err);
      return out(502, { error: "Booking is down for a moment. Try again soon." });
    }
  }
  // Sites' public paths, as the Worker serves them (src/sites.ts): Wren's pages at /o/<slug>, a
  // draft behind its token, the kit, the tracker, the form. A form enters no door here.
  if (path.startsWith("/o/")) {
    const pub = sitesPublicApi(main);
    if (path === KIT_PATH)
      return res.writeHead(200, { "content-type": "text/javascript" }).end(KIT_JS);
    if ((path === TRACK_PATH || path === FORM_PATH) && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = (() => {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      if (path === TRACK_PATH) {
        await pub.track(body);
        return res.writeHead(204).end();
      }
      const { "cf-turnstile-response": _t, ...fields } = (body.fields ?? {}) as Record<
        string,
        unknown
      >;
      const out = await pub.form(
        { ...body, fields, host: "localhost", human: "off", visitor: null },
        async () => ({ status: 503, error: "the preview runs no spine" }),
      );
      return res
        .writeHead(out.status, { "content-type": "application/json" })
        .end(
          JSON.stringify(
            out.status < 300 ? { ok: true } : { error: out.error, errors: out.errors },
          ),
        );
    }
    const u = new URL(req.url ?? "/", "http://x");
    const hosted = /^\/o\/f\/([a-z0-9-]{1,80}|[0-9a-f-]{36})\/?$/.exec(path);
    if (hosted) {
      const got = await pub.serveForm({
        client: null,
        slug: hosted[1] ?? "",
        embed: u.searchParams.get("embed") === "1",
      });
      return res
        .writeHead(got.status, { "content-type": "text/html", "content-security-policy": FORM_CSP })
        .end(got.html);
    }
    const pv = /^\/o\/__preview\/([0-9a-f-]{36})$/.exec(path);
    const slug = /^\/o\/([a-z0-9-]{1,80})\/?$/.exec(path);
    const got = pv
      ? await pub.serve({ preview: { id: pv[1] ?? "", token: u.searchParams.get("t") ?? "" } })
      : await pub.serve({ client: null, slug: slug?.[1] ?? "" });
    return res
      .writeHead(got.status, { "content-type": "text/html", "content-security-policy": PAGE_CSP })
      .end(got.html);
  }
  if (BOOK_PAGE.test(path)) {
    res.writeHead(200, { "content-type": "text/html" });
    return createReadStream(join(dist, "book.html")).pipe(res);
  }
  // Dictation's speech server (src/dictate.ts), the same code: DICTATE_URL in the shell turns it on.
  if (path === "/api/dictate") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const r = new Request(`http://localhost${path}`, {
      method: req.method ?? "GET",
      headers: { "content-type": req.headers["content-type"] ?? "" },
      ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    });
    const out = await dictate(r, process.env as DictateEnv, {
      demo,
      signedIn: async () => null,
    });
    res.writeHead(out.status, { "content-type": "application/json" });
    return res.end(await out.text());
  }
  // Learn's pictures and audio, as the Worker serves them (src/media.ts), on a key of this run's.
  if (path === MEDIA_GRANT_PATH || path === MEDIA_PATH) {
    const key = await previewMediaKey;
    if (path === MEDIA_GRANT_PATH)
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(await grantFor(key)));
    const range = req.headers.range;
    const out = await mediaProxy(
      new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers: range ? { range } : {},
      }),
      key,
    );
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  const route = path.startsWith("/api/") ? path.slice(5) : null;
  if (route !== null) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    // A pasted key: sealed here, as the sign-in Lambda does in prod. The stand-in seat may save.
    if (path === KEY_STAGE_PATH) {
      if (req.method !== "POST" || "demo" in viewer) return send(403, { error: "Sign in first" });
      const out = await intakeKey(
        main,
        ring,
        viewer.email,
        body,
        guarded ? undefined : async () => true,
      );
      return send(out.status, out.body);
    }
    // A batch of reads (src/pulse.ts): each as its own call.
    if (path === PULSE_PATH) {
      const calls = pulseCalls(body);
      if (!calls) return send(400, { error: "a list of calls" });
      const answers = await Promise.all(
        calls.map(async (c) => {
          const [n = "", r = ""] = c.path.split("/");
          if (!SERVICES[n]?.routes.includes(r))
            return { status: 404, body: { error: "not found" } };
          return callApi(n, r, { ...c.body, viewer });
        }),
      );
      return send(200, { answers });
    }
    // How a write went, by its request id: as the Worker reads Restate's record of it.
    if (path === WRITE_STATUS_PATH) {
      const ran = once.get(`${body.path}\n${body.requestId}`);
      if (!ran) return send(200, { state: "unknown" });
      if (!ran.out) return send(200, { state: "sending" });
      const b = ran.out.body as { message?: string } | null;
      return send(
        200,
        ran.out.status === 200
          ? { state: "sent", answer: ran.out.body }
          : { state: "failed", error: b?.message ?? `It failed (${ran.out.status}).` },
      );
    }
    const [name = "", call = ""] = route.split("/");
    const svc = SERVICES[name];
    if (!svc?.routes.includes(call)) return send(404, { error: "not found" });
    if (REF_ROUTES.includes(`${name}/${call}`) && rawKeyAt(body))
      return send(400, { error: "Send a saved key's reference, never the key" });
    // A write runs once per request id, as Restate's idempotency key makes it in prod.
    const { requestId, ...input } = body as { requestId?: unknown } & Record<string, unknown>;
    const id = typeof requestId === "string" && isWrite(route) ? `${route}\n${requestId}` : null;
    let ran = id ? once.get(id) : undefined;
    if (!ran) {
      const fresh: Ran = { out: null, done: callApi(name, call, { ...input, viewer }) };
      void fresh.done.then((o) => {
        fresh.out = o;
      });
      ran = fresh;
      if (id) once.set(id, fresh);
    }
    // A send answers that it has it at once; the tab reads its outcome from writes/status.
    if (id && isSend(route, input))
      return send(202, { accepted: true, state: "queued", requestId: String(requestId) });
    const out = await ran.done;
    return send(out.status, out.body);
  }
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  const found =
    file.startsWith(dist) && existsSync(file) && extname(file) ? file : join(dist, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(found)] ?? "application/octet-stream" });
  createReadStream(found).pipe(res);
});

/**
 * Live notes: the same room as the Worker's Durable Object (src/live.ts), here in-process, one per
 * note. `?as=<email>` joins as someone else, for a second cursor in a script; preview only.
 */
const rooms = new Map<string, Room>();
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const id = url.pathname.startsWith(LIVE_PREFIX) ? url.pathname.slice(LIVE_PREFIX.length) : "";
  if (!id || demo) return socket.destroy();
  const client = url.searchParams.get("client");
  // A second person in the room: `?as=` on the socket, or a `preview_as` cookie for a browser.
  const who =
    url.searchParams.get("as") ??
    /(?:^|;\s*)preview_as=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ??
    null;
  sockets.handleUpgrade(req, socket, head, async (ws) => {
    // Frames that come before the room lets them in wait, as the Durable Object's do.
    const early: string[] = [];
    let take = (f: string) => void early.push(f);
    ws.on("message", (data: unknown) => take(String(data)));
    const me: Viewer = who
      ? {
          email: decodeURIComponent(who),
          ...((await teamSeat(main, decodeURIComponent(who))) ? { operator: true } : {}),
        }
      : viewer;
    const email = "email" in me ? me.email : "";
    let room = rooms.get(id);
    if (!room || room.closed) {
      const fresh: Room = new Room(id, {
        sync: async (as, body) => {
          const out = await callApi("notes", "sync", { ...body, ...as });
          const b = out.body as Record<string, unknown>;
          return out.status === 200
            ? ({ ok: true, ...b } as SyncAnswer)
            : { ok: false, status: out.status, message: String(b.message ?? b.error) };
        },
        onEmpty: () => {
          if (rooms.get(id) === fresh) rooms.delete(id);
        },
      });
      room = fresh;
      rooms.set(id, room);
    }
    const r = room;
    const s = {
      send: (f: string) => ws.send(f),
      close: (code: number, reason: string) => ws.close(code, reason),
    };
    try {
      const peer = await r.join(s, { email, as: { ...(client ? { client } : {}), viewer: me } });
      take = (f) => void r.message(peer, f);
      for (const f of early.splice(0)) take(f);
      ws.on("close", () => r.leave(peer));
    } catch (err) {
      ws.close(4000 + (err instanceof RoomRefusal ? err.status : 503), "refused");
    }
  });
});
server.listen(port, () =>
  console.log(`portal preview${demo ? " (demo)" : ""}: http://localhost:${port}`),
);
