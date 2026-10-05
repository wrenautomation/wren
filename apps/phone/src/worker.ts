/**
 * phone.wrenautomation.com: the SMS inbox for the iPhone, the Seeker and the Mac,
 * and the door Telnyx webhooks come in by.
 *
 * - `/webhooks/telnyx`: signature checked here, then handed to Restate
 *   (`SmsEvents/ingest/send`) with the event id as the idempotency key, so a
 *   webhook Telnyx sends twice is applied once. Restate down = 502, and Telnyx
 *   retries.
 * - `/webhooks/calcom`: cal.com's booking webhook, HMAC checked against
 *   `CALCOM_WEBHOOK_SECRET`, then `CallBookings/ingest/send` keyed by trigger + uid +
 *   start. Unsigned = 401, PING = 200 and goes no further, Restate down = 502.
 * - `/webhooks/telnyx/<client>`, `/webhooks/calcom/<client>`: the same for a client's
 *   messaging profile and cal.com, into its database (`SmsEvents/ingestFor`,
 *   `CallBookings/ingestFor`). A client's cal.com signs with its own secret, from
 *   `CALCOM_WEBHOOK_SECRETS`; a client with none there is 404.
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

/** `<client>` from `/webhooks/<site>/<client>`; null when the path is not one. */
const clientIn = (pathname: string, site: string): string | null => {
  const prefix = `/webhooks/${site}/`;
  if (!pathname.startsWith(prefix)) return null;
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.exec(pathname.slice(prefix.length))?.[0] ?? null;
};

/** A body for Restate: Wren's as sent, a client's wrapped with its id. */
const forwarded = (raw: string, client: string | null) =>
  client ? `{"client":${JSON.stringify(client)},"body":${raw}}` : raw;

async function telnyxWebhook(req: Request, env: Env, client: string | null): Promise<Response> {
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
    res = await fetch(ingress(env, `SmsEvents/${client ? "ingestFor" : "ingest"}/send`), {
      method: "POST",
      headers: restateHeaders(env, { "idempotency-key": `telnyx-${id}` }),
      body: forwarded(raw, client),
    });
  } catch {
    return json({ error: "restate unreachable" }, 502);
  }
  if (!res.ok) return json({ error: `restate ${res.status}` }, 502);
  return json({ ok: true });
}

/** Hex HMAC-SHA256 of the raw body, as cal.com signs it; `crypto.subtle.verify` compares in constant time. */
async function calcomSigned(
  secret: string,
  raw: string,
  signature: string | null,
): Promise<boolean> {
  const hex = (signature ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const sig = new Uint8Array(hex.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(raw));
}

/**
 * cal.com's booking webhook: signature checked here, then `CallBookings/ingest/send` keyed
 * by trigger + uid + start, so a delivery cal.com repeats is applied once. PING stops here.
 */
async function calcomWebhook(req: Request, env: Env, client: string | null): Promise<Response> {
  let secret = env.CALCOM_WEBHOOK_SECRET;
  if (client) {
    let secrets: Record<string, unknown>;
    try {
      secrets = JSON.parse(env.CALCOM_WEBHOOK_SECRETS ?? "{}") as Record<string, unknown>;
    } catch {
      return json({ error: "webhooks off: CALCOM_WEBHOOK_SECRETS is not json" }, 503);
    }
    const own = Object.hasOwn(secrets, client) ? secrets[client] : undefined;
    if (typeof own !== "string" || own === "") return json({ error: "not found" }, 404);
    secret = own;
  }
  if (!secret) return json({ error: "webhooks off: no CALCOM_WEBHOOK_SECRET" }, 503);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, 413);
  if (!(await calcomSigned(secret, raw, req.headers.get("x-cal-signature-256")))) {
    return json({ error: "bad signature" }, 401);
  }
  let body: { triggerEvent?: unknown; payload?: { uid?: unknown; startTime?: unknown } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const trigger = String(body.triggerEvent ?? "");
  if (trigger === "PING") return json({ ok: true });
  const uid = body.payload?.uid;
  if (typeof uid !== "string" || uid === "") return json({ error: "no booking uid" }, 400);
  let res: Response;
  try {
    res = await fetch(ingress(env, `CallBookings/${client ? "ingestFor" : "ingest"}/send`), {
      method: "POST",
      headers: restateHeaders(env, {
        "idempotency-key": `calcom-${client ? `${client}-` : ""}${trigger}-${uid}-${String(body.payload?.startTime ?? "")}`,
      }),
      body: forwarded(raw, client),
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
    for (const [site, hook] of [
      ["telnyx", telnyxWebhook],
      ["calcom", calcomWebhook],
    ] as const) {
      const wren = pathname === `/webhooks/${site}`;
      const client = wren ? null : clientIn(pathname, site);
      if (!wren && !client) continue;
      return req.method === "POST" ? hook(req, env, client) : json({ error: "POST only" }, 405);
    }
    if (pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return desk(req, env, pathname.slice("/api/".length));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
