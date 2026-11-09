/**
 * A write's state, read from Restate's own record of it (designs/2026-10-15-one-write-path.md).
 * Each portal write carries a request id; the Worker turns it into the invocation's idempotency
 * key (`writeKey`). A tab that lost the answer (hidden, reloaded, offline) asks here how it went:
 * still going, done, failed and why, or never arrived. Nothing runs again.
 */
import { readBody } from "@wren/core/http";
import { json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { SERVICES } from "./services.js";

export { WRITE_STATUS_PATH } from "./services.js";

/** What a request id may be: the web's own (a UUID), or any short token. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Restate keeps the first answer a day. The key names who asked, so another login's id is theirs alone. */
export async function writeKey(email: string, site: Site, requestId: string): Promise<string> {
  const client = site.kind === "client" ? site.client : "";
  return `portal:${await sha256(`${email}\n${client}\n${requestId}`)}`;
}

/** Why Restate is trying a write again, while it does: its tries so far and the last error. */
interface WriteRetry {
  count: number;
  reason: string;
}

export type WriteState =
  | { state: "sending"; retry?: WriteRetry }
  | { state: "sent"; answer: unknown }
  | { state: "failed"; error: string }
  | { state: "unknown" };

/** A write's key as `writeKey` makes it: checked before it goes in a query. */
export const WRITE_KEY = /^portal:[0-9a-f]{64}$/;

/** The service and handler a write path runs as, or null when it isn't a write. */
export function writeTarget(path: string): { svc: string; route: string } | null {
  const [name = "", route = "", ...rest] = path.split("/");
  const svc = Object.hasOwn(SERVICES, name) ? SERVICES[name] : undefined;
  if (!svc || rest.length || !svc.writes.has(route)) return null;
  return { svc: svc.name, route };
}

const authOf = (env: Env): Record<string, string> =>
  env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {};

/** A failure as the person may read it: its first line, no tokens. */
export function reasonOf(failure: string): string {
  const line = (failure.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
  const clean = line
    .replace(/\b(bearer|token|key|secret|password)([=: ]+)\S+/gi, "$1$2[hidden]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[hidden]");
  return clean;
}

/**
 * How the write under `key` to `svc/route` went, from the runtime's record (the door); while it
 * is still going, why it is being tried again (the door's 470 says). Null: it can't say now.
 */
export async function readWrite(
  env: Env,
  svc: string,
  route: string,
  key: string,
): Promise<WriteState | null> {
  const url = `${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/restate/invocation/${svc}/${route}/${encodeURIComponent(key)}/output`;
  let res: Response;
  try {
    res = await fetch(url, { headers: authOf(env) });
  } catch {
    return null;
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  // 470: the runtime has it and it hasn't finished; the body says why it is trying again
  if (res.status === 470) {
    const r = (body as { retry?: { count?: unknown; reason?: unknown } } | null)?.retry;
    return r && typeof r.reason === "string" && Number(r.count) > 0
      ? { state: "sending", retry: { count: Number(r.count), reason: reasonOf(r.reason) } }
      : { state: "sending" };
  }
  if (res.ok) return { state: "sent", answer: body };
  if (res.status === 404) return { state: "unknown" };
  // The ingress itself is down: it can't say now.
  if (res.status === 502 || res.status === 503 || res.status === 504) return null;
  const b = body as { message?: unknown } | null;
  const error =
    b && typeof b === "object" && typeof b.message === "string"
      ? b.message
      : `It failed (${res.status}).`;
  return { state: "failed", error };
}

/**
 * POST {path, requestId}: how that write went. `unknown` = Restate never got it (or it is older
 * than a day): the tab sends it again under the same id.
 */
export async function writeStatus(
  req: Request,
  env: Env,
  site: Site,
  signedIn: (req: Request) => Promise<{ email: string } | Response>,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
    return json({ error: "json only" }, 415);
  const raw = await readBody(req, 1024);
  if (raw === null) return json({ error: "too large" }, 413);
  let asked: { path?: unknown; requestId?: unknown };
  try {
    asked = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "not json" }, 400);
  }
  const path = typeof asked?.path === "string" ? asked.path : "";
  const requestId = typeof asked?.requestId === "string" ? asked.requestId : "";
  const target = writeTarget(path);
  if (!target) return json({ error: "Not a write." }, 400);
  if (!REQUEST_ID.test(requestId))
    return json({ error: "A request id is 8 to 100 letters, digits, - or _." }, 400);
  const who = await signedIn(req);
  if (who instanceof Response) return who;
  const key = await writeKey(who.email, site, requestId);
  const state = await readWrite(env, target.svc, target.route, key);
  if (!state) return json({ error: "The portal's server can't say now." }, 502);
  return json(state satisfies WriteState);
}
