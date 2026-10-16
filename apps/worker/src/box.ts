/**
 * The pool chain served from the Postgres box. Same bundle and secrets as `lambda.ts`,
 * but only `BOX_SERVICES` (the waiting-heavy chain, the page archive) over loopback:
 * the wait on sites and mail servers bills nothing and no row crosses the network.
 * Self-hosted (no `RESTATE_TUNNEL_NAME`): the server runs on this box, so the worker
 * listens on loopback and registers itself at the loopback admin. With a tunnel name,
 * it dials Restate Cloud's tunnel instead (the way back until Cloud is deleted).
 */

import http2 from "node:http2";
import * as restate from "@restatedev/restate-sdk";
import { connectTunnel } from "@restatedev/restate-sdk-tunnel";
import { ingressOf, loadSettings } from "@wren/config";
import { loadSsmEnv, loadSsmFile } from "@wren/config/ssm";
import pino from "pino";
import { type AdminQuery, boxPort, boxUrl, watchSuperseded } from "./box-slot.js";
import { buildServices, servicesFor } from "./services.js";
import { startWakes } from "./wake.js";

const ROOT = process.env.WREN_BUNDLE_ROOT ?? process.cwd();

await loadSsmEnv(process.env.WREN_SSM_ENV_PARAM);
// The box's own: tunnel name, environment, signing key, a Full-role Restate Cloud key.
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
// A mailbox walk opens its own pool (PROBE_WIDTH + 1); this one serves everything else.
const built = await buildServices(settings, log, { rootDir: ROOT, dbPoolMax: 6 });
const services = servicesFor(built.services, "box");
// Rows that wake loops (designs/2026-10-11-push-not-poll.md): this box holds the LISTENs, on
// its own connections straight to Postgres, never through PgBouncer.
let wakes: { close(): Promise<void> } | null = null;
if (process.env.WREN_DATABASE_URL) {
  const { url, headers } = ingressOf(settings);
  wakes = await startWakes({
    databaseUrl: process.env.WREN_DATABASE_URL,
    ingress: { url, ...(headers ? { headers } : {}) },
    log,
  });
}

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`box worker needs ${name}`);
  return v;
};
// The server signs every call; the worker checks it against these (comma list).
const identityKeys = need("WREN_RESTATE_IDENTITY_KEY")
  .split(",")
  .map((k) => k.trim());

if (!process.env.RESTATE_TUNNEL_NAME) {
  // This slot's URL (`box-slot.ts`): a deploy's build is a new deployment beside the last one,
  // so calls pinned to the last one finish on its code. `force`: a restart of this build, or
  // the slot's build from two deploys ago, takes this build's handlers in place.
  const ADMIN = "http://127.0.0.1:9070";
  const port = boxPort();
  await new Promise<void>((ok) =>
    http2
      .createServer(restate.createEndpointHandler({ services, identityKeys }))
      .listen(port, "127.0.0.1", ok),
  );
  const res = await fetch(`${ADMIN}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: boxUrl(port), force: true }),
  });
  if (!res.ok)
    throw new Error(`restate register: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const reg = (await res.json()) as { id: string; services: { name: string }[] };
  log.info(
    { deployment: reg.id, port, services: reg.services.map((s) => s.name), ...built.summary },
    "box ready",
  );
  const query: AdminQuery = async (sql) => {
    const r = await fetch(`${ADMIN}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`restate query: HTTP ${r.status}`);
    return ((await r.json()) as { rows: Record<string, unknown>[] }).rows;
  };
  const first = reg.services[0]?.name;
  if (first)
    watchSuperseded({
      query,
      deployment: reg.id,
      service: first,
      everyMs: 30_000,
      // A later build took the services: it holds the wakes now. This one serves its pinned calls.
      async onSuperseded(pinned) {
        await wakes?.close();
        wakes = null;
        log.info({ deployment: reg.id, pinned }, "box superseded: serving pinned calls only");
      },
      onError: (err) => log.warn({ err: String(err) }, "box superseded check failed"),
    });
} else {
  const environmentId = need("RESTATE_ENVIRONMENT_ID");
  const region = need("RESTATE_CLOUD_REGION");
  const authToken = need("RESTATE_AUTH_TOKEN");

  const tunnel = connectTunnel({
    services,
    tunnelName: need("RESTATE_TUNNEL_NAME"),
    environmentId,
    region,
    signingPublicKey: identityKeys[0] as string,
    authToken,
  });
  await tunnel.ready;
  if (!tunnel.deploymentUrl) throw new Error("restate tunnel handshake gave no deployment URL");

  // `force`: a restart that lands at the same tunnel URL takes this build's handlers.
  const admin = `https://${environmentId.replace(/^env_/, "")}.env.${region}.restate.cloud:9070`;
  const headers = { authorization: `Bearer ${authToken}`, "content-type": "application/json" };
  const res = await fetch(`${admin}/deployments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ uri: tunnel.deploymentUrl, force: true }),
  });
  if (!res.ok)
    throw new Error(`restate register: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const reg = (await res.json()) as { id: string; services: { name: string }[] };

  // A restart often lands on another tunnel server, so a new URL and a new deployment. An
  // unfinished call stays pinned to the old one, whose endpoint died with the old
  // container, and waits forever (the pool loop stalled on every deploy). Move them here.
  const tunnelName = need("RESTATE_TUNNEL_NAME");
  const stranded = await fetch(`${admin}/query`, {
    method: "POST",
    headers: { ...headers, accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT i.id FROM sys_invocation i JOIN sys_deployment d ON d.id = i.pinned_deployment_id
        WHERE i.status <> 'completed' AND d.id <> '${reg.id}'
          AND d.endpoint LIKE '%/${tunnelName.replace(/[^\w-]/g, "")}/%'`,
    }),
  });
  const moved: string[] = [];
  if (stranded.ok) {
    for (const { id } of ((await stranded.json()) as { rows: { id: string }[] }).rows) {
      const r = await fetch(`${admin}/invocations/${id}/resume?deployment=${reg.id}`, {
        method: "PATCH",
        headers,
      });
      if (r.ok) moved.push(id);
      else
        log.warn(
          { id, status: r.status, body: (await r.text()).slice(0, 200) },
          "stranded call not moved",
        );
    }
  } else {
    log.warn({ status: stranded.status }, "stranded call query failed");
  }
  log.info(
    {
      deployment: reg.id,
      services: reg.services.map((s) => s.name),
      moved_calls: moved.length,
      ...built.summary,
    },
    "box ready",
  );

  // SIGTERM: the tunnel drains in-flight invocations before exit (its default shutdown).
}
