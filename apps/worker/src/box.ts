/**
 * The worker on the Postgres box: the whole runtime (`rt.ts`). Same bundle and secrets as
 * `lambda.ts`. The box lane runs `BOX_SERVICES` here (the waiting-heavy chain, the page archive):
 * the wait on sites and mail servers bills nothing and no row crosses the network. The read lane
 * runs the portal's reads here, always warm. Every other turn goes to the Lambda. The door (slot port + 10) takes calls behind Caddy.
 */

import { loadSettings } from "@wren/config";
import { loadSsmEnv, loadSsmFile } from "@wren/config/ssm";
import { PORTAL_READS } from "@wren/portal-routes";
import pino from "pino";
import { boxPort } from "./box-slot.js";
import { startRt } from "./rt.js";
import { BOX_SERVICES, buildServices } from "./services.js";
import { startWakes } from "./wake.js";

const ROOT = process.env.WREN_BUNDLE_ROOT ?? process.cwd();

await loadSsmEnv(process.env.WREN_SSM_ENV_PARAM);
// The box's own settings.
await loadSsmEnv(process.env.WREN_SSM_BOX_PARAM);
const roster = await loadSsmFile(process.env.WREN_SSM_ROSTER_PARAM, "/tmp/senders_config.toml");
if (roster && !process.env.WREN_SENDERS_FILE) process.env.WREN_SENDERS_FILE = roster;
// The SMTP/IMAP logins autobrowse writes, for the roster's smtp inboxes.
const mailboxes = await loadSsmFile(process.env.WREN_SSM_MAILBOXES_PARAM, "/tmp/mailboxes.json");
if (mailboxes && !process.env.WREN_MAILBOXES_FILE) process.env.WREN_MAILBOXES_FILE = mailboxes;
// Same database, this machine's door: TLS and credentials stay as the URL says.
if (process.env.WREN_DATABASE_URL) {
  const url = new URL(process.env.WREN_DATABASE_URL);
  url.hostname = "127.0.0.1";
  process.env.WREN_DATABASE_URL = url.toString();
}
const settings = loadSettings(process.env, { rootDir: ROOT });
const log = pino({ level: settings.logLevel });
const databaseUrl = process.env.WREN_DATABASE_URL;
if (!databaseUrl) throw new Error("box worker needs WREN_DATABASE_URL");
// A mailbox walk opens its own pool (PROBE_WIDTH + 1); this one serves everything else.
const built = await buildServices(settings, log, { rootDir: ROOT, dbPoolMax: 6 });
const port = boxPort();
// Rows that wake loops (designs/2026-10-11-push-not-poll.md): this box holds the LISTENs, on its
// own connections straight to Postgres, never through PgBouncer. Started once rt is up.
let wakes: { close(): Promise<void> } | null = null;
const rt = await startRt({
  all: built.services,
  box: BOX_SERVICES,
  domainOf: built.domainOf,
  // the portal's reads: a page never waits on a Lambda cold start
  reads: PORTAL_READS,
  databaseUrl,
  build: process.env.WREN_BUILD ?? "dev",
  ...(process.env.WREN_BUILD_LIVE ? { buildLive: process.env.WREN_BUILD_LIVE } : {}),
  doorPort: port + 10,
  // a newer build holds the wakes now; this one finishes its pinned rows
  async onSuperseded() {
    await wakes?.close();
    wakes = null;
    log.info({ build: process.env.WREN_BUILD }, "box superseded: serving pinned rows only");
  },
  log,
});
// to this slot's own door on loopback: Caddy's bearer guards only the public side
wakes = await startWakes({ databaseUrl, ingress: { url: rt.doorUrl as string }, log });
// box-worker.sh waits for this line
log.info({ port, door: rt.doorUrl, ...built.summary }, "box ready");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "box stopping");
    await wakes?.close();
    await rt.stop();
    await built.close();
    process.exit(0);
  });
}
