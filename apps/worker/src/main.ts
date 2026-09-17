/** Restate endpoint. Registers every channel's services on :9080. */
import * as restate from "@restatedev/restate-sdk";
import { makeLinkedinInbox } from "@wren/channel-linkedin/restate";
import { loadEnvFile, loadSettings } from "@wren/config";
import { createDb } from "@wren/db";
import pino from "pino";

const PORT = Number(process.env.WREN_WORKER_PORT ?? 9080);

const settings = loadSettings(process.env, { rootDir: loadEnvFile() });
const log = pino({ level: settings.logLevel });
const handle = createDb(settings.databaseUrl);

restate
  .endpoint()
  .bind(makeLinkedinInbox({ db: handle.db, inboxDir: settings.inboxDir }))
  .listen(PORT)
  .then(() => log.info({ port: PORT }, "worker listening"));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "shutting down");
    await handle.close();
    process.exit(0);
  });
}
