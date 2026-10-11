/**
 * The same services as `main.ts`, served to Restate Cloud from AWS Lambda.
 * Cold start: pull the secret env from SSM, build the services, hand the
 * handler to Restate. Every invocation is one journaled step or handler turn;
 * the pool is per Lambda instance and stays small.
 */

import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { loadSettings } from "@wren/config";
import { loadSsmEnv, loadSsmFile } from "@wren/config/ssm";
import pino from "pino";
import { buildServices, servicesFor } from "./services.js";

const ROOT = process.env.LAMBDA_TASK_ROOT ?? process.cwd();

// Each cold-start phase in ms on the "lambda ready" line; module load is the rest of Init.
const t0 = performance.now();
const [, roster, mailboxes] = await Promise.all([
  loadSsmEnv(process.env.WREN_SSM_ENV_PARAM),
  // The roster lives in SSM, not the bundle; /tmp is the one writable path on Lambda.
  loadSsmFile(process.env.WREN_SSM_ROSTER_PARAM, "/tmp/senders_config.toml"),
  // The SMTP/IMAP logins autobrowse writes, for the roster's smtp inboxes.
  loadSsmFile(process.env.WREN_SSM_MAILBOXES_PARAM, "/tmp/mailboxes.json"),
]);
if (roster && !process.env.WREN_SENDERS_FILE) process.env.WREN_SENDERS_FILE = roster;
if (mailboxes && !process.env.WREN_MAILBOXES_FILE) process.env.WREN_MAILBOXES_FILE = mailboxes;
const t1 = performance.now();
const settings = loadSettings(process.env, { rootDir: ROOT });
const log = pino({ level: settings.logLevel });
const built = await buildServices(settings, log, { rootDir: ROOT, dbPoolMax: 2 });
const ms = (a: number, b: number) => Math.round(b - a);
log.info(
  { ...built.summary, initMs: { ssm: ms(t0, t1), build: ms(t1, performance.now()) } },
  "lambda ready",
);

// Restate Cloud signs every request; the public key comes from the environment's
// Developers > Security page. Unset means any caller Lambda's IAM lets in.
const identityKey = process.env.WREN_RESTATE_IDENTITY_KEY;

export const handler = createEndpointHandler({
  services: servicesFor(built.services, "lambda"),
  ...(identityKey ? { identityKeys: [identityKey] } : {}),
});
