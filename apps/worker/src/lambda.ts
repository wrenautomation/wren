/**
 * The Lambda lane of the runtime (`rt.ts`): the box invokes with `{rt}`, one handler turn each.
 * Cold start: pull the secret env from SSM, build the services. The pool is per instance and small.
 */

import { loadSettings } from "@wren/config";
import { loadSsmEnv, loadSsmFile } from "@wren/config/ssm";
import pino from "pino";
import { isRtEvent, lambdaTurns, rtSql } from "./rt.js";
import { pooled } from "./services/deps.js";
import { buildServices } from "./services.js";

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

// One connection pair per instance, made on first use; through PgBouncer.
let sql: ReturnType<typeof rtSql> | undefined;
let turns: ReturnType<typeof lambdaTurns> | undefined;

/** One pg turn; any other event is refused (only the box's role may invoke). */
export const handler = (event: unknown) => {
  if (!isRtEvent(event)) throw new Error("not an rt turn");
  sql ??= rtSql(pooled(settings), 2, "wren-rt-lambda");
  turns ??= lambdaTurns(built.services, sql);
  return turns(event);
};
