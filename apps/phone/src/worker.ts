/**
 * phone.wrenautomation.com: the SMS inbox for the iPhone, the Seeker and the Mac,
 * and the door Telnyx webhooks come in by.
 *
 * - `/webhooks/telnyx`: signature checked here, then handed to Restate
 *   (`SmsEvents/ingest/send`) with the event id as the idempotency key, so a
 *   webhook Telnyx sends twice is applied once. Restate down = 502, and Telnyx
 *   retries.
 * - `/auth/*`: passkeys (passkeys.ts).
 * - `/api/<handler>`: signed-in only; forwarded to the `SmsDesk` service. Only the
 *   handlers the app needs are open; enroll and lift stay on the CLI.
 * - everything else: the static app in public/.
 *
 * The Worker holds no data: the inbox is Postgres, read through Restate.
 */
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyTelnyx } from "@wren/channel-sms/webhook";
import type { Env } from "./env.js";
import {
  loginOptions,
  loginVerify,
  logout,
  registerOptions,
  registerVerify,
  signedIn,
} from "./passkeys.js";

export const DESK_HANDLERS: ReadonlySet<string> = new Set([
  "threads",
  "thread",
  "markRead",
  "reply",
  "label",
  "numbers",
  "stats",
  "pause",
  "resume",
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

async function desk(req: Request, env: Env, handler: string): Promise<Response> {
  if (!DESK_HANDLERS.has(handler)) return json({ error: "not found" }, 404);
  if (!(await signedIn(req, env))) return json({ error: "sign in" }, 401);
  // A JSON content type forces a CORS preflight, so another site cannot post here
  // even if a browser ever sent the SameSite=Strict cookie along.
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ error: "json only" }, 415);
  }
  const body = await req.text();
  if (body.length > MAX_BODY) return json({ error: "too large" }, 413);
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
    if (pathname.startsWith("/auth/") || pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      switch (pathname) {
        case "/auth/register/options":
          return registerOptions(req, env);
        case "/auth/register/verify":
          return registerVerify(req, env);
        case "/auth/login/options":
          return loginOptions(req, env);
        case "/auth/login/verify":
          return loginVerify(req, env);
        case "/auth/logout":
          return logout();
        case "/auth/me":
          return json({ signedIn: await signedIn(req, env) });
      }
      if (pathname.startsWith("/api/")) return desk(req, env, pathname.slice("/api/".length));
      return json({ error: "not found" }, 404);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
