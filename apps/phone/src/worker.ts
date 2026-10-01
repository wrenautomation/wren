/**
 * phone.wrenautomation.com: the SMS inbox for the iPhone, the Seeker and the Mac,
 * and the door Telnyx webhooks come in by.
 *
 * - `/webhooks/telnyx`: signature checked here, then handed to Restate
 *   (`SmsEvents/ingest/send`) with the event id as the idempotency key, so a
 *   webhook Telnyx sends twice is applied once. Restate down = 502, and Telnyx
 *   retries.
 * - `/api/<handler>`: Wren's operators only, by the token from Wren's sign-in
 *   (auth.wrenautomation.com, any method incl. passkeys); forwarded to the `SmsDesk`
 *   service. Only the handlers the app needs are open; enroll and lift stay on the CLI.
 * - everything else: the static app in public/.
 *
 * The Worker holds no data: the inbox is Postgres, read through Restate.
 */
import { AUDIENCE, bearer, type Signed, verifyToken } from "@wren/auth/verify";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyTelnyx } from "@wren/channel-sms/webhook";
import type { Env } from "./env.js";

export const DESK_HANDLERS: ReadonlySet<string> = new Set([
  "threads",
  "thread",
  "markRead",
  "reply",
  "start",
  "label",
  "numbers",
  "stats",
  "pause",
  "resume",
  "templates",
  "setTemplate",
  "pushKey",
  "subscribe",
  "unsubscribe",
]);

const MAX_BODY = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function restateHeaders(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
    ...extra,
  };
}

const ingress = (env: Env, path: string) =>
  `${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/${path}`;

async function telnyxWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.TELNYX_PUBLIC_KEY) return json({ error: "webhooks off: no TELNYX_PUBLIC_KEY" }, 503);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, 413);
  const verdict = await verifyTelnyx({
    publicKey: env.TELNYX_PUBLIC_KEY,
    signature: req.headers.get(SIGNATURE_HEADER),
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    rawBody: raw,
  });
  if (!verdict.ok) return json({ error: verdict.reason }, 401);
  let body: { data?: { id?: unknown } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const id = body.data?.id;
  if (typeof id !== "string" || id === "") return json({ error: "no event id" }, 400);
  let res: Response;
  try {
    res = await fetch(ingress(env, "SmsEvents/ingest/send"), {
      method: "POST",
      headers: restateHeaders(env, { "idempotency-key": `telnyx-${id}` }),
      body: raw,
    });
  } catch {
    return json({ error: "restate unreachable" }, 502);
  }
  if (!res.ok) return json({ error: `restate ${res.status}` }, 502);
  return json({ ok: true });
}

/** The signed-in operator, or the refusal. */
async function operator(req: Request, env: Env): Promise<Signed | Response> {
  if (!env.AUTH_ORIGIN) return json({ error: "sign-in is not set up" }, 503);
  let who: Awaited<ReturnType<typeof verifyToken>>;
  try {
    who = await verifyToken(bearer(req), { issuer: env.AUTH_ORIGIN, audience: AUDIENCE });
  } catch {
    return json({ error: "couldn't check your sign-in" }, 502);
  }
  if (!who) return json({ error: "sign in" }, 401);
  return who.operator ? who : json({ error: "This is for Wren's team." }, 403);
}

async function desk(req: Request, env: Env, handler: string): Promise<Response> {
  if (!DESK_HANDLERS.has(handler)) return json({ error: "not found" }, 404);
  const who = await operator(req, env);
  if (who instanceof Response) return who;
  // A JSON content type forces a CORS preflight, so another site cannot post here.
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ error: "json only" }, 415);
  }
  let body = await req.text();
  if (body.length > MAX_BODY) return json({ error: "too large" }, 413);
  // Who saved a template or turned on alerts is the signed-in operator, never what the page says.
  if (handler === "setTemplate" || handler === "subscribe") {
    try {
      body = JSON.stringify({ ...JSON.parse(body), by: who.email });
    } catch {
      return json({ error: "bad json" }, 400);
    }
  }
  let res: Response;
  try {
    res = await fetch(ingress(env, `SmsDesk/${handler}`), {
      method: "POST",
      headers: restateHeaders(env),
      body: body || "{}",
    });
  } catch {
    return json({ error: "restate unreachable" }, 502);
  }
  // Restate's own status and body: a refusal (opted out, empty text) reads as its message.
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/webhooks/telnyx") {
      return req.method === "POST" ? telnyxWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return desk(req, env, pathname.slice("/api/".length));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
