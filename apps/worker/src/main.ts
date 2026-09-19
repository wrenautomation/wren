/** Restate endpoint on Node: serves every channel's services on :9080. */

import { serve } from "@restatedev/restate-sdk/node";
import { loadEnvFile, loadSettings } from "@wren/config";
import pino from "pino";
import { buildServices } from "./services.js";

const PORT = Number(process.env.WREN_WORKER_PORT ?? 9080);

const rootDir = loadEnvFile();
const settings = loadSettings(process.env, { rootDir });
const log = pino({ level: settings.logLevel });
const built = await buildServices(settings, log, { rootDir });

await serve({ services: built.services, port: PORT });
log.info({ port: PORT, ...built.summary }, "worker listening");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "shutting down");
    await built.close();
    process.exit(0);
  });
}
