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
 * - `/webhooks/gmail`: Gmail's push through Pub/Sub, `?token=` checked against
 *   `GMAIL_PUSH_TOKEN`, then `InboxPush/<address>/notify/send` keyed by Pub/Sub's message
 *   id: the mailbox's inbox loop runs a pass now.
 * - `/api/<handler>`: Wren's operators only, by the token from Wren's sign-in
 *   (auth.wrenautomation.com, any method incl. passkeys); forwarded to the `SmsDesk`
 *   service. Only the handlers the app needs are open; enroll and lift stay on the CLI.
 * - `/links`, `/api/links/<id>[/take]`, `/c/<id>`: credential links
 *   (designs/2026-10-06-credential-links.md). The Mac posts AES-GCM ciphertext, HMAC signed
 *   with `CRED_LINK_SECRET`; it lives in KV until its TTL. The key is only in the link's
 *   fragment. An open link needs no sign-in, for someone outside Wren.
 *   `/c/<id>` is the reveal page and consumes nothing; an operator's `take` returns it once.
 * - `/marketing/<handler>`: the lander's signup form and preference center, forwarded to the
 *   `Marketing` service. No sign-in: a signup carries the lander's signature and a
 *   preference change its signed link, both checked by the service.
 * - `/calendar/<handler>`: our booking calendar (designs/2026-10-06-calendar.md), forwarded to
 *   the `Calendar` service. No sign-in: a booking carries the lander's signature, a move or a
 *   cancel its signed link, both checked by the service.
 * - everything else: the static app in public/.
 *
 * The Worker holds no data but a credential link's ciphertext: the inbox is Postgres, read through Restate.
 */
import { AUDIENCE, bearer, type Signed, verifyToken } from "@wren/auth/verify";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyTelnyx } from "@wren/channel-sms/webhook";
import { readBody } from "@wren/core/http";
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

export const MARKETING_HANDLERS: ReadonlySet<string> = new Set([
  "signUp",
  "confirm",
  "prefs",
  "set",
]);

export const CALENDAR_HANDLERS: ReadonlySet<string> = new Set([
  "slots",
  "book",
  "booking",
  "reschedule",
  "cancel",
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
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
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
async function hmacSigned(secret: string, raw: string, signature: string | null): Promise<boolean> {
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
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  if (!(await hmacSigned(secret, raw, req.headers.get("x-cal-signature-256")))) {
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

/** Constant time: both sides hashed first, so length leaks nothing either. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all(
    [a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v)))),
  );
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= (x?.[i] ?? 0) ^ (y?.[i] ?? 1);
  return diff === 0;
}

/** Gmail's push: `{message: {data: base64 {emailAddress, historyId}, messageId}}`. */
async function gmailWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.GMAIL_PUSH_TOKEN) return json({ error: "webhooks off: no GMAIL_PUSH_TOKEN" }, 503);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!(await sameSecret(token, env.GMAIL_PUSH_TOKEN))) return json({ error: "bad token" }, 401);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let id: unknown;
  let address: unknown;
  try {
    const { message } = JSON.parse(raw) as { message?: { data?: string; messageId?: unknown } };
    id = message?.messageId;
    address = (JSON.parse(atob(message?.data ?? "")) as { emailAddress?: unknown }).emailAddress;
  } catch {
    return json({ error: "not a Gmail push" }, 400);
  }
  if (typeof id !== "string" || id === "" || typeof address !== "string" || !address.includes("@"))
    return json({ error: "not a Gmail push" }, 400);
  let res: Response;
  try {
    res = await fetch(
      ingress(env, `InboxPush/${encodeURIComponent(address.toLowerCase())}/notify/send`),
      {
        method: "POST",
        headers: restateHeaders(env, { "idempotency-key": `gmail-${id}` }),
        body: "{}",
      },
    );
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
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let body = raw;
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

/** The lander's marketing and calendar calls, passed through as they are; the service checks each one. */
async function lander(
  req: Request,
  env: Env,
  service: string,
  open: ReadonlySet<string>,
  handler: string,
): Promise<Response> {
  if (!open.has(handler)) return json({ error: "not found" }, 404);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ error: "json only" }, 415);
  }
  const body = await readBody(req, MAX_BODY);
  if (body === null) return json({ error: "too large" }, 413);
  let res: Response;
  try {
    res = await fetch(ingress(env, `${service}/${handler}`), {
      method: "POST",
      headers: restateHeaders(env),
      body: body || "{}",
    });
  } catch {
    return json({ error: "restate unreachable" }, 502);
  }
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

/** A credential link's id: 128 random bits, base64url. */
const LINK_ID = /^[A-Za-z0-9_-]{22}$/;
/** A link's life: 10 minutes unless the mint asks, at most 7 days. */
const LINK_TTL_S = 600;
const LINK_TTL_MAX_S = 7 * 24 * 3600;
/** Standard base64, as Node's `toString("base64")` writes it. */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const LINK_SIGNATURE = "x-wren-signature-256";

/**
 * A credential link from the Mac (`autobrowse creds link`): `{label, iv, data, at, open?, ttl?}`,
 * hex HMAC-SHA256 of the body in `x-wren-signature-256`, as cal.com signs. Only ciphertext
 * arrives; a body older than 5 minutes is refused, so a captured one can't be replayed.
 */
async function mintLink(req: Request, env: Env): Promise<Response> {
  if (!env.CRED_LINK_SECRET) return json({ error: "links off: no CRED_LINK_SECRET" }, 503);
  const raw = await readBody(req, 16 * 1024);
  if (raw === null) return json({ error: "too large" }, 413);
  if (!(await hmacSigned(env.CRED_LINK_SECRET, raw, req.headers.get(LINK_SIGNATURE)))) {
    return json({ error: "bad signature" }, 401);
  }
  let body: {
    label?: unknown;
    iv?: unknown;
    data?: unknown;
    at?: unknown;
    open?: unknown;
    ttl?: unknown;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const { label, iv, data, at, open = false, ttl = LINK_TTL_S } = body;
  if (typeof at !== "number" || Math.abs(Date.now() - at) > 5 * 60_000) {
    return json({ error: "stale" }, 401);
  }
  if (
    typeof label !== "string" ||
    !/^[\w .,@+:-]{1,100}$/.test(label) ||
    typeof iv !== "string" ||
    !B64.test(iv) ||
    typeof data !== "string" ||
    !B64.test(data) ||
    typeof open !== "boolean" ||
    !Number.isInteger(ttl) ||
    (ttl as number) < 60 ||
    (ttl as number) > LINK_TTL_MAX_S
  ) {
    return json({ error: "want {label, iv, data, at, open?, ttl? (60s to 7d)}" }, 400);
  }
  const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await env.CRED_LINKS.put(id, JSON.stringify({ label, iv, data, open }), {
    expirationTtl: ttl as number,
  });
  return json({ id });
}

/**
 * A look at a link: `/api/links/<id>` names it, `/api/links/<id>/take` returns
 * `{label, iv, data}` and deletes it. An open link answers anyone holding its 128-bit id; any
 * other needs an operator, and a caller without one gets 401 whether or not the id exists.
 */
async function link(req: Request, env: Env, rest: string): Promise<Response> {
  const [id, take, ...more] = rest.split("/");
  if (!id || !LINK_ID.test(id) || more.length || (take !== undefined && take !== "take")) {
    return json({ error: "not found" }, 404);
  }
  const raw = await env.CRED_LINKS.get(id);
  const held = raw
    ? (JSON.parse(raw) as { label: string; iv: string; data: string; open: boolean })
    : null;
  if (!held?.open) {
    const who = await operator(req, env);
    if (who instanceof Response) return who;
  }
  if (!held) return json({ error: "This link is used or expired." }, 404);
  if (!take) return json({ label: held.label, open: held.open });
  // ponytail: get-then-delete is not atomic; two callers racing one link could both read it. A Durable Object if that matters.
  await env.CRED_LINKS.delete(id);
  return new Response(JSON.stringify({ label: held.label, iv: held.iv, data: held.data }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * The door (designs/2026-10-05-workflows.md): any webhook into a workflow's input, by a token
 * `wren hooks add` made. JSON or a form; the Spine checks the token and answers the status.
 */
async function door(req: Request, env: Env, token: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "no such hook" }, 404);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let payload: unknown;
  try {
    payload = (req.headers.get("content-type") ?? "").startsWith(
      "application/x-www-form-urlencoded",
    )
      ? Object.fromEntries(new URLSearchParams(raw))
      : JSON.parse(raw || "{}");
  } catch {
    return json({ error: "send JSON or a form" }, 415);
  }
  let res: Response;
  try {
    res = await fetch(ingress(env, "Spine/hook"), {
      method: "POST",
      headers: restateHeaders(env),
      body: JSON.stringify({ token, payload }),
    });
  } catch {
    return json({ error: "restate unreachable" }, 502);
  }
  if (!res.ok) return json({ error: `restate ${res.status}` }, 502);
  const { status, ...rest } = (await res.json()) as { status?: number };
  return json(rest, status ?? 200);
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
    if (pathname === "/webhooks/gmail") {
      return req.method === "POST" ? gmailWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname.startsWith("/hooks/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return door(req, env, pathname.slice("/hooks/".length));
    }
    if (pathname === "/links") {
      return req.method === "POST" ? mintLink(req, env) : json({ error: "POST only" }, 405);
    }
    // The reveal page: static, for any id. A GET never touches KV, so a link preview burns nothing.
    if (pathname.startsWith("/c/") && LINK_ID.test(pathname.slice(3))) {
      return env.ASSETS.fetch(new Request(new URL("/c", req.url), req));
    }
    if (pathname.startsWith("/marketing/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return lander(req, env, "Marketing", MARKETING_HANDLERS, pathname.slice(11));
    }
    if (pathname.startsWith("/calendar/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return lander(req, env, "Calendar", CALENDAR_HANDLERS, pathname.slice(10));
    }
    if (pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      if (pathname.startsWith("/api/links/")) return link(req, env, pathname.slice(11));
      return desk(req, env, pathname.slice("/api/".length));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
