/**
 * The same services as `main.ts`, served to Restate Cloud from AWS Lambda.
 * Cold start: pull the secret env from SSM, build the services, hand the
 * handler to Restate. Every invocation is one journaled step or handler turn;
 * the pool is per Lambda instance and stays small.
 */

import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { loadSettings } from "@wren/config";
import pino from "pino";
import { buildServices } from "./services.js";
import { loadSsmEnv, loadSsmFile } from "./ssm-env.js";

const ROOT = process.env.LAMBDA_TASK_ROOT ?? process.cwd();

await loadSsmEnv(process.env.WREN_SSM_ENV_PARAM);
// The roster lives in SSM, not the bundle; /tmp is the one writable path on Lambda.
const roster = await loadSsmFile(process.env.WREN_SSM_ROSTER_PARAM, "/tmp/senders_config.toml");
if (roster && !process.env.WREN_SENDERS_FILE) process.env.WREN_SENDERS_FILE = roster;
const settings = loadSettings(process.env, { rootDir: ROOT });
const log = pino({ level: settings.logLevel });
const built = await buildServices(settings, log, { rootDir: ROOT, dbPoolMax: 2 });
log.info(built.summary, "lambda ready");

// Restate Cloud signs every request; the public key comes from the environment's
// Developers > Security page. Unset means any caller Lambda's IAM lets in.
const identityKey = process.env.WREN_RESTATE_IDENTITY_KEY;

export const handler = createEndpointHandler({
  services: built.services,
  ...(identityKey ? { identityKeys: [identityKey] } : {}),
});
