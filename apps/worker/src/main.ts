/**
 * Local dev: the whole runtime (`rt.ts`) in one process, every service on the box lane, the door
 * on `WREN_WORKER_PORT` (8080). Needs `WREN_DATABASE_URL`.
 */

import { loadEnvFile, loadSettings } from "@wren/config";
import pino from "pino";
import { startRt } from "./rt.js";
import { buildServices } from "./services.js";

const PORT = Number(process.env.WREN_WORKER_PORT ?? 8080);

// `none`: the env as given, no file read.
const rootDir = process.env.WREN_ENV_FILE === "none" ? process.cwd() : loadEnvFile();
const settings = loadSettings(process.env, { rootDir });
const log = pino({ level: settings.logLevel });
const built = await buildServices(settings, log, { rootDir });
const rt = await startRt({
  all: built.services,
  box: built.services.map((s) => s.name),
  databaseUrl: settings.databaseUrl,
  build: "dev",
  doorPort: PORT,
  // the CLI sends this bearer when set (`ingressOf`)
  ...(settings.restateAuthToken ? { doorBearer: settings.restateAuthToken } : {}),
  log,
});
log.info({ door: rt.doorUrl, ...built.summary }, "worker listening");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "shutting down");
    await rt.stop();
    await built.close();
    process.exit(0);
  });
}
