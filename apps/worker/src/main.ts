/** Restate endpoint. Registers every channel's services on :9080. */

import { resolve } from "node:path";
import * as restate from "@restatedev/restate-sdk";
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
import { loadEnvFile, loadSettings } from "@wren/config";
import { createDb } from "@wren/db";
import { loadLlmEnv, makeLlm, makeTracer } from "@wren/llm";
import { LANDERS_BY_NICHE, NICHES } from "@wren/niches";
import { browserRenderer, PoliteFetcher, userAgent } from "@wren/research";
import { makeEnrichment } from "@wren/research/restate";
import pino from "pino";

const PORT = Number(process.env.WREN_WORKER_PORT ?? 9080);

const rootDir = loadEnvFile();
const settings = loadSettings(process.env, { rootDir });
const log = pino({ level: settings.logLevel });
const handle = createDb(settings.databaseUrl);

// Key fleets and provider keys live in llm.env; never in .env, never logged.
loadLlmEnv(settings.llmEnvPath, rootDir);
const llm = makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
const ua = settings.fetchContact ? userAgent(settings.fetchContact) : null;
if (!ua) log.warn("WREN_FETCH_CONTACT unset: crawl and render will refuse until it is");
const verifier = await makeVerifier(settings.verifier, {
  millionverifierApiKey: process.env.MILLIONVERIFIER_API_KEY ?? null,
});

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

const endpoint = restate
  .endpoint()
  .bind(makeLinkedinInbox({ db: handle.db, inboxDir: settings.inboxDir }))
  .bind(
    makeEnrichment({
      db: handle.db,
      fetcher: ua ? new PoliteFetcher(ua) : null,
      llm,
      renderer: ua ? () => browserRenderer(ua) : null,
      tracer,
      robotsMode: settings.robotsMode,
    }),
  )
  .bind(makeResolution({ db: handle.db, verifier }))
  .bind(
    makeSendScheduler({
      db: handle.db,
      transport,
      policy,
      fleet,
      pixelBaseUrl: settings.pixelBaseUrl ?? null,
      tickMs,
    }),
  )
  .bind(
    makeInboxScheduler({ db: handle.db, reader, senders: fleet.senders, syncMs, tickMs, classify }),
  )
  .bind(makeDisposition({ db: handle.db, llm, tracer, tracing: settings.tracing }));
// Bound only when configured: an object with nothing to pull is better absent than failing every pass.
if (postmaster) {
  endpoint.bind(
    makePostmasterScheduler({ db: handle.db, client: postmaster, domains: sendingDomains, policy }),
  );
}
if (opens) endpoint.bind(makeOpensScheduler({ db: handle.db, ...opens, syncMs, tickMs }));

endpoint.listen(PORT).then(() =>
  log.info(
    {
      port: PORT,
      llm: llm.name,
      classify,
      verifier: verifier.name,
      transport: transport.name,
      senders: fleet.senders.length,
      postmaster: postmaster !== null,
      opens: opens !== null,
    },
    "worker listening",
  ),
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "shutting down");
    await handle.close();
    process.exit(0);
  });
}
