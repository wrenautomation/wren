/** Restate endpoint. Registers every channel's services on :9080. */
import * as restate from "@restatedev/restate-sdk";
import { makeVerifier } from "@wren/channel-email";
import { makeResolution } from "@wren/channel-email/restate";
import { makeLinkedinInbox } from "@wren/channel-linkedin/restate";
import { loadEnvFile, loadSettings } from "@wren/config";
import { createDb } from "@wren/db";
import { loadLlmEnv, makeLlm, makeTracer } from "@wren/llm";
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

restate
  .endpoint()
  .bind(makeLinkedinInbox({ db: handle.db, inboxDir: settings.inboxDir }))
  .bind(
    makeEnrichment({
      db: handle.db,
      fetcher: ua ? new PoliteFetcher(ua) : null,
      llm,
      renderer: ua ? () => browserRenderer(ua) : null,
      tracer: makeTracer(settings.tracing),
      robotsMode: settings.robotsMode,
    }),
  )
  .bind(makeResolution({ db: handle.db, verifier }))
  .listen(PORT)
  .then(() => log.info({ port: PORT, llm: llm.name, verifier: verifier.name }, "worker listening"));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "shutting down");
    await handle.close();
    process.exit(0);
  });
}
