/**
 * Every Restate service the worker serves, built once from settings. Shared by
 * the two hosts: the Node listener (`main.ts`, local/compose) and the Lambda
 * handler (`lambda.ts`, Restate Cloud). Nothing here assumes a process lifetime
 * beyond one invocation: state lives in Restate and Postgres.
 */
import { resolve } from "node:path";
import type { ServiceDefinition, VirtualObjectDefinition } from "@restatedev/restate-sdk";
import {
  activeSenders,
  ConsoleTransport,
  expandHome,
  GmailClient,
  GmailTransport,
  type InboxReader,
  loadRoster,
  loadServiceAccountKey,
  makeVerifier,
  type PostmasterClient,
  postmasterToken,
  rosterFleet,
  SendPolicy,
  senderDomain,
  type Transport,
} from "@wren/channel-email";
import {
  makeDisposition,
  makeInboxScheduler,
  makeOpensScheduler,
  makePostmasterScheduler,
  makeResolution,
  makeSendScheduler,
} from "@wren/channel-email/restate";
import { makeLinkedinInbox } from "@wren/channel-linkedin/restate";
import type { Settings } from "@wren/config";
import { createDb } from "@wren/db";
import { loadLlmEnv, makeLlm, makeTracer } from "@wren/llm";
import { LANDERS_BY_NICHE, NICHES } from "@wren/niches";
import {
  type BrowserRenderer,
  browserbaseRenderer,
  browserRenderer,
  cdpRenderer,
  PoliteFetcher,
  userAgent,
} from "@wren/research";
import { makeEnrichment } from "@wren/research/restate";
import type { Logger } from "pino";

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
  const handle = createDb(settings.databaseUrl, opts.dbPoolMax ? { max: opts.dbPoolMax } : {});
  const db = handle.db;

  // Key fleets and provider keys live in llm.env (or the host's env); never logged.
  loadLlmEnv(settings.llmEnvPath, rootDir);
  const llm = makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
  const ua = settings.fetchContact ? userAgent(settings.fetchContact) : null;
  if (!ua) log.warn("WREN_FETCH_CONTACT unset: crawl and render will refuse until it is");
  const verifier = await makeVerifier(settings.verifier, {
    millionverifierApiKey: process.env.MILLIONVERIFIER_API_KEY ?? null,
  });
  const renderer = ua ? rendererFor(settings, ua, log) : null;

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
    makeLinkedinInbox({ db, inboxDir: settings.inboxDir }),
    makeEnrichment({
      db,
      fetcher: ua ? new PoliteFetcher(ua) : null,
      llm,
      renderer,
      tracer,
      robotsMode: settings.robotsMode,
    }),
    makeResolution({ db, verifier }),
    makeSendScheduler({
      db,
      transport,
      policy,
      fleet,
      // The pixel goes into mail only when asked; the host alone just enables the opens pull.
      pixelBaseUrl: settings.openTracking ? (settings.pixelBaseUrl ?? null) : null,
      tickMs,
    }),
    makeInboxScheduler({ db, reader, senders: fleet.senders, syncMs, tickMs, classify }),
    makeDisposition({ db, llm, tracer, tracing: settings.tracing }),
  ];
  // Bound only when configured: an object with nothing to pull is better absent than failing every pass.
  if (postmaster) {
    services.push(
      makePostmasterScheduler({ db, client: postmaster, domains: sendingDomains, policy }),
    );
  }
  if (opens) services.push(makeOpensScheduler({ db, ...opens, syncMs, tickMs }));

  return {
    services,
    summary: {
      llm: llm.name,
      classify,
      verifier: verifier.name,
      renderer: renderer ? settings.renderer : "none",
      transport: transport.name,
      senders: fleet.senders.length,
      postmaster: postmaster !== null,
      opens: opens !== null,
    },
    close: () => handle.close(),
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
