/**
 * The pool chain served from the Postgres box. Same bundle and secrets as `lambda.ts`,
 * but only the waiting-heavy services (`POOL_CHAIN`) and the database over loopback:
 * the wait on sites and mail servers bills nothing and no row crosses the network.
 * No inbound port: the worker dials Restate Cloud's tunnel, then registers the URL it
 * is handed, which moves those services here from Lambda.
 */

import { connectTunnel } from "@restatedev/restate-sdk-tunnel";
import { loadSettings } from "@wren/config";
import { loadSsmEnv, loadSsmFile } from "@wren/config/ssm";
import pino from "pino";
import { buildServices, servicesFor } from "./services.js";

const ROOT = process.env.WREN_BUNDLE_ROOT ?? process.cwd();

await loadSsmEnv(process.env.WREN_SSM_ENV_PARAM);
// The box's own: tunnel name, environment, signing key, a Full-role Restate Cloud key.
await loadSsmEnv(process.env.WREN_SSM_BOX_PARAM);
const roster = await loadSsmFile(process.env.WREN_SSM_ROSTER_PARAM, "/tmp/senders_config.toml");
if (roster && !process.env.WREN_SENDERS_FILE) process.env.WREN_SENDERS_FILE = roster;
// Same database, this machine's door: TLS and credentials stay as the URL says.
if (process.env.WREN_DATABASE_URL) {
  const url = new URL(process.env.WREN_DATABASE_URL);
  url.hostname = "127.0.0.1";
  process.env.WREN_DATABASE_URL = url.toString();
}
const settings = loadSettings(process.env, { rootDir: ROOT });
const log = pino({ level: settings.logLevel });
// A mailbox walk opens its own pool (PROBE_WIDTH + 1); this one serves everything else.
const built = await buildServices(settings, log, { rootDir: ROOT, dbPoolMax: 6 });
const services = servicesFor(built.services, "box");

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`box worker needs ${name}`);
  return v;
};
const environmentId = need("RESTATE_ENVIRONMENT_ID");
const region = need("RESTATE_CLOUD_REGION");
const authToken = need("RESTATE_AUTH_TOKEN");

const tunnel = connectTunnel({
  services,
  tunnelName: need("RESTATE_TUNNEL_NAME"),
  environmentId,
  region,
  signingPublicKey: need("WREN_RESTATE_IDENTITY_KEY"),
  authToken,
});
await tunnel.ready;
if (!tunnel.deploymentUrl) throw new Error("restate tunnel handshake gave no deployment URL");

// `force`: a restart lands at the same tunnel URL with this build's handlers.
const admin = `https://${environmentId.replace(/^env_/, "")}.env.${region}.restate.cloud:9070`;
const res = await fetch(`${admin}/deployments`, {
  method: "POST",
  headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" },
  body: JSON.stringify({ uri: tunnel.deploymentUrl, force: true }),
});
if (!res.ok) throw new Error(`restate register: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
const reg = (await res.json()) as { id: string; services: { name: string }[] };
log.info(
  { deployment: reg.id, services: reg.services.map((s) => s.name), ...built.summary },
  "box ready",
);

// SIGTERM: the tunnel drains in-flight invocations before exit (its default shutdown).
