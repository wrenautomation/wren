/**
 * phone.wrenautomation.com: the SMS inbox for the iPhone, the Seeker and the Mac,
 * and the door Telnyx webhooks come in by.
 *
 * - `/webhooks/telnyx`: signature checked here, then handed to Restate
 *   (`SmsWebhookIntake/ingest/send`) with the event id as the idempotency key, so a
 *   webhook Telnyx sends twice is applied once. Restate down = held (below).
 * - `/webhooks/calcom`: cal.com's booking webhook, HMAC checked against
 *   `CALCOM_WEBHOOK_SECRET`, then `CallBookingIntake/ingest/send` keyed by trigger + uid +
 *   start. Unsigned = 401, PING = 200 and goes no further, Restate down = held.
 * - `/webhooks/documenso`: Documenso's e-signature events (designs/2026-10-21-esign-and-newsletter.md).
 *   The `X-Documenso-Secret` header is checked against `DOCUMENSO_WEBHOOK_SECRET`, then
 *   `DocumentSign/signed/send` keyed by envelope + event + time, so a repeat is applied once.
 *   Unset secret = 503, wrong = 401, Restate down = held.
 * - `/webhooks/telnyx/<client>`, `/webhooks/calcom/<client>`: the same for a client's
 *   messaging profile and cal.com, into its database (`SmsWebhookIntake/ingestFor`,
 *   `CallBookingIntake/ingestFor`). A client's cal.com signs with its own secret, from
 *   `CALCOM_WEBHOOK_SECRETS`; a client with none there is 404.
 * - Telnyx, either path: the event's number picks whose account signed it
 *   (`SmsWebhookIntake/signer`). A client on its own Telnyx account is checked against its saved
 *   public key and lands only in its database; Wren's numbers and clients on Wren's account
 *   against `TELNYX_PUBLIC_KEY`. A path naming someone other than the number's owner is 401.
 * - `/webhooks/linq`: Linq's (iMessage), Standard Webhooks signature against
 *   `LINQ_WEBHOOK_SECRET`, then `SmsWebhookIntake/ingest/send` keyed by the event id.
 * - `/webhooks/gmail`: Gmail's push through Pub/Sub, `?token=` checked against
 *   `GMAIL_PUSH_TOKEN`, then `InboxPush/<address>/notify/send` keyed by Pub/Sub's message
 *   id: the mailbox's inbox loop runs a pass now.
 * - `/webhooks/meta`: Meta's webhooks (Page feed and messages, Instagram). GET answers the
 *   handshake against `META_WEBHOOK_TOKEN`; POST is checked against the app secret, then
 *   `SocialPushIntake/meta/send` keyed by the body's digest (designs/2026-10-12-push-everywhere.md).
 * - `/webhooks/site`: the lander's push of one site application (`{application, at}`), hex HMAC
 *   of the body in `x-wren-signature-256` against `SITE_EXPORT_TOKEN` (the lander's
 *   `EXPORT_TOKEN`), `at` within 5 minutes, then `SmsApplicationFollowUp/applied/send` keyed by the
 *   application: its first text runs now, not on the 30-minute pass. Restate down = held.
 * - Held (WA-1061): Telnyx, Linq, cal.com, Documenso and the lander retry for minutes only. With
 *   Restate down, the event goes to KV under its idempotency key and the sender gets 200; the
 *   cron (`replayHeld`, every 2 min) sends it on under the same key. Gmail, Business Profile
 *   and Meta retry for days: Restate down = 502.
 * - `/webhooks/gbp`: Business Profile's review notices through Pub/Sub, `?token=` checked against
 *   `GBP_PUSH_TOKEN`, then `SocialPushIntake/gbp/send` keyed by Pub/Sub's message id.
 * - `/api/<handler>`: Wren's operators only, by the token from Wren's sign-in
 *   (auth.wrenautomation.com, any method incl. passkeys); forwarded to the `SmsDesk`
 *   service. Only the handlers the app needs are open; enroll and lift stay on the CLI.
 * - `/links`, `/api/links/<id>[/take]`, `/c/<id>`: credential links
 *   (designs/2026-10-06-credential-links.md). The Mac posts AES-GCM ciphertext, HMAC signed
 *   with `CRED_LINK_SECRET`; it lives in KV until its TTL. The key is only in the link's
 *   fragment. An open link needs no sign-in, for someone outside Wren.
 *   `/c/<id>` is the reveal page and consumes nothing; an operator's `take` returns it once.
 * - `/drops`, `/api/drops/<id>[/fill]`, `/drops/<id>/take`, `/u/<id>`: drops, the other way
 *   (autobrowse designs/2026-10-12-papers.md). The Mac mints an empty one; the phone page seals a photo
 *   under the fragment's key and posts ciphertext; the Mac takes it once, signed.
 * - `/marketing/<handler>`: the lander's signup form and preference center, forwarded to the
 *   `SignupForm` service. No sign-in: a signup carries the lander's signature and a
 *   preference change its signed link, both checked by the service.
 * - `/calendar/<handler>`: our booking calendar (designs/2026-10-06-calendar.md), forwarded to
 *   the `BookingPage` service. No sign-in: a booking carries the lander's signature, a move or a
 *   cancel its signed link, both checked by the service.
 * - everything else: the static app in public/.
 *
 * The Worker holds no data but a link's or a drop's ciphertext: the inbox is Postgres, read through Restate.
 */
import { AUDIENCE, bearer, type Signed, verifyToken } from "@wren/auth/verify";
import { readBody } from "@wren/core/http";
import {
  ourNumber,
  SIGNATURE_HEADER,
  STANDARD_ID_HEADER,
  STANDARD_SIGNATURE_HEADER,
  STANDARD_TIMESTAMP_HEADER,
  signedFresh,
  TIMESTAMP_HEADER,
  verifyStandardWebhook,
  verifyTelnyx,
} from "@wren/starling-sms/webhook";
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

/** Desk calls that text someone: the app's per-text key rides to Restate, so a resend sends once. */
const DESK_SENDS: ReadonlySet<string> = new Set(["reply", "start"]);
const KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

const MARKETING_HANDLERS: ReadonlySet<string> = new Set(["signUp", "confirm", "prefs", "set"]);

const CALENDAR_HANDLERS: ReadonlySet<string> = new Set([
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
    ...(env.WREN_API_TOKEN ? { authorization: `Bearer ${env.WREN_API_TOKEN}` } : {}),
    ...extra,
  };
}

const ingress = (env: Env, path: string) => `${env.WREN_API_URL.replace(/\/+$/, "")}/${path}`;

/** `<client>` from `/webhooks/<site>/<client>`; null when the path is not one. */
const clientIn = (pathname: string, site: string): string | null => {
  const prefix = `/webhooks/${site}/`;
  if (!pathname.startsWith(prefix)) return null;
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.exec(pathname.slice(prefix.length))?.[0] ?? null;
};

/** A body for Restate: Wren's as sent, a client's wrapped with its id. */
const forwarded = (raw: string, client: string | null) =>
  client ? `{"client":${JSON.stringify(client)},"body":${raw}}` : raw;

/** Whose account signed a webhook, as `SmsWebhookIntake/signer` answers (starling-sms signer.ts). */
type Signer =
  | { ok: true; client: string | null; publicKey: string | null }
  | { ok: false; why: string };

const SIGNER_TTL_MS = 5 * 60_000;
const SIGNERS_KEPT = 500;
/** Answers kept a few minutes, so a burst of one number's events asks Restate once. Public keys only. */
const signers = new Map<string, { at: number; answer: Signer }>();
/** Tests: start with no answers kept. */
export const forgetSigners = () => signers.clear();

/** Whose key checks a webhook about `number` on `client`'s path; null when Restate can't say. */
async function signerOf(
  env: Env,
  number: string | null,
  client: string | null,
): Promise<Signer | null> {
  const at = `${client ?? ""}|${number ?? ""}`;
  const kept = signers.get(at);
  if (kept && Date.now() - kept.at < SIGNER_TTL_MS) return kept.answer;
  let answer: Signer;
  try {
    const res = await fetch(ingress(env, "SmsWebhookIntake/signer"), {
      method: "POST",
      headers: restateHeaders(env),
      body: JSON.stringify({ number, client }),
    });
    if (!res.ok) return null;
    answer = (await res.json()) as Signer;
  } catch {
    return null;
  }
  if (signers.size >= SIGNERS_KEPT) signers.clear();
  signers.set(at, { at: Date.now(), answer });
  return answer;
}

/**
 * A Telnyx webhook. The number it's about picks whose account signed it: a client on its own
 * Telnyx account signs with that account's key, and its events land only in its database;
 * Wren's numbers and clients on Wren's account check against `TELNYX_PUBLIC_KEY`.
 */
async function telnyxWebhook(req: Request, env: Env, path: string | null): Promise<Response> {
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  return telnyxEvent(env, {
    kind: "telnyx",
    raw,
    signature: req.headers.get(SIGNATURE_HEADER),
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    path,
    at: Date.now(),
  });
}

/**
 * One Telnyx event, live or held. Restate down at the signer: held whole, checked on replay
 * against its own receive time (`at`). A replay answers 503 while Restate is still down.
 */
async function telnyxEvent(
  env: Env,
  e: Extract<Held, { kind: "telnyx" }>,
  replay = false,
): Promise<Response> {
  const { raw, signature, timestamp, path } = e;
  const nowSeconds = Math.floor(e.at / 1000);
  const fresh = signedFresh({ signature, timestamp, nowSeconds });
  if (!fresh.ok) return json({ error: fresh.reason }, 401);
  let body: { data?: { id?: unknown } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const id = body.data?.id;
  const number = ourNumber(body);
  const who: Signer | null =
    number === null && path === null
      ? { ok: true, client: null, publicKey: null }
      : await signerOf(env, number, path);
  if (!who) {
    if (replay) return json({ error: "signer unreachable" }, 503);
    if (typeof id !== "string" || id === "") return json({ error: "signer unreachable" }, 502);
    return hold(env, `telnyx-${id}`, e);
  }
  if (!who.ok) return json({ error: who.why }, 401);
  const publicKey = who.publicKey ?? env.TELNYX_PUBLIC_KEY;
  if (!publicKey) return json({ error: "webhooks off: no TELNYX_PUBLIC_KEY" }, 503);
  const verdict = await verifyTelnyx({ publicKey, signature, timestamp, rawBody: raw, nowSeconds });
  if (!verdict.ok) return json({ error: verdict.reason }, 401);
  if (typeof id !== "string" || id === "") return json({ error: "no event id" }, 400);
  const client = who.client;
  return forward(
    env,
    `SmsWebhookIntake/${client ? "ingestFor" : "ingest"}/send`,
    `telnyx-${id}`,
    forwarded(raw, client),
    replay,
  );
}

/**
 * A Linq webhook (iMessage, RCS, SMS on Wren's Linq line): Standard Webhooks signature against
 * `LINQ_WEBHOOK_SECRET`, then `SmsWebhookIntake/ingest/send` keyed by Linq's event id. Wren's only:
 * no client is on Linq yet.
 */
async function linqWebhook(req: Request, env: Env): Promise<Response> {
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  if (!env.LINQ_WEBHOOK_SECRET) return json({ error: "webhooks off: no LINQ_WEBHOOK_SECRET" }, 503);
  const id = req.headers.get(STANDARD_ID_HEADER);
  const verdict = await verifyStandardWebhook({
    secret: env.LINQ_WEBHOOK_SECRET,
    id,
    signature: req.headers.get(STANDARD_SIGNATURE_HEADER),
    timestamp: req.headers.get(STANDARD_TIMESTAMP_HEADER),
    rawBody: raw,
  });
  if (!verdict.ok) return json({ error: verdict.reason }, 401);
  return forward(env, "SmsWebhookIntake/ingest/send", `linq-${id}`, raw);
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
 * cal.com's booking webhook: signature checked here, then `CallBookingIntake/ingest/send` keyed
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
  return forward(
    env,
    `CallBookingIntake/${client ? "ingestFor" : "ingest"}/send`,
    `calcom-${client ? `${client}-` : ""}${trigger}-${uid}-${String(body.payload?.startTime ?? "")}`,
    forwarded(raw, client),
  );
}

/**
 * Documenso's webhook: the shared secret in `X-Documenso-Secret` checked here, then
 * `DocumentSign/signed/send` keyed by envelope, event and time. Documents ignores an event it has no
 * use for and an envelope it did not make.
 */
async function documensoWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.DOCUMENSO_WEBHOOK_SECRET) {
    return json({ error: "webhooks off: no DOCUMENSO_WEBHOOK_SECRET" }, 503);
  }
  const given = req.headers.get("x-documenso-secret") ?? "";
  if (!(await sameSecret(given, env.DOCUMENSO_WEBHOOK_SECRET))) {
    return json({ error: "bad secret" }, 401);
  }
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let body: { event?: unknown; createdAt?: unknown; payload?: { envelopeId?: unknown } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const envelope = body.payload?.envelopeId;
  if (typeof body.event !== "string" || typeof envelope !== "string" || envelope === "") {
    return json({ error: "no event or envelope" }, 400);
  }
  return forward(
    env,
    "DocumentSign/signed/send",
    `documenso-${envelope}-${body.event}-${String(body.createdAt ?? "")}`,
    raw,
  );
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

/** Hex SHA-256: a body's idempotency key when the vendor sends no event id. */
async function digest(raw: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Meta's webhooks (designs/2026-10-12-push-everywhere.md). GET is the subscription's handshake:
 * `hub.challenge` back when `hub.verify_token` matches. POST is signed with the app secret, or the
 * Instagram app's for Instagram Login; the body goes whole to `SocialPushIntake/meta`, keyed by its
 * digest (Meta sends no event id and batches entries).
 */
async function metaWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.META_WEBHOOK_TOKEN) return json({ error: "webhooks off: no META_WEBHOOK_TOKEN" }, 503);
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const ok =
      q.get("hub.mode") === "subscribe" &&
      (await sameSecret(q.get("hub.verify_token") ?? "", env.META_WEBHOOK_TOKEN));
    if (!ok) return json({ error: "bad token" }, 401);
    return new Response(q.get("hub.challenge") ?? "", {
      headers: { "content-type": "text/plain" },
    });
  }
  if (req.method !== "POST") return json({ error: "GET or POST" }, 405);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  const sig = req.headers.get("x-hub-signature-256")?.replace(/^sha256=/, "") ?? null;
  const secrets = [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET].filter((s): s is string => !!s);
  if (!secrets.length) return json({ error: "webhooks off: no META_APP_SECRET" }, 503);
  let signed = false;
  for (const s of secrets) if (await hmacSigned(s, raw, sig)) signed = true;
  if (!signed) return json({ error: "bad signature" }, 401);
  return toRestate(env, "SocialPushIntake/meta/send", `meta-${await digest(raw)}`, raw);
}

/**
 * Business Profile's Pub/Sub push: `?token=` checked against `GBP_PUSH_TOKEN`, then the decoded
 * notification (`{type, review?, location}`) to `SocialPushIntake/gbp`, keyed by Pub/Sub's message id.
 */
async function gbpWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.GBP_PUSH_TOKEN) return json({ error: "webhooks off: no GBP_PUSH_TOKEN" }, 503);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!(await sameSecret(token, env.GBP_PUSH_TOKEN))) return json({ error: "bad token" }, 401);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let id: unknown;
  let note: unknown;
  try {
    const { message } = JSON.parse(raw) as { message?: { data?: string; messageId?: unknown } };
    id = message?.messageId;
    note = JSON.parse(atob(message?.data ?? ""));
  } catch {
    return json({ error: "not a Pub/Sub push" }, 400);
  }
  if (typeof id !== "string" || id === "" || !note || typeof note !== "object")
    return json({ error: "not a Pub/Sub push" }, 400);
  return toRestate(env, "SocialPushIntake/gbp/send", `gbp-${id}`, JSON.stringify(note));
}

/** A site push older (or newer) than this is refused: a replayed body goes nowhere. */
const SITE_FRESH_MS = 5 * 60 * 1000;

/**
 * The lander's push: one application, signed with the export token it shares with wren. Only
 * the id crosses: the service reads the application from the site's export itself.
 */
async function siteWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.SITE_EXPORT_TOKEN) return json({ error: "webhooks off: no SITE_EXPORT_TOKEN" }, 503);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  if (!(await hmacSigned(env.SITE_EXPORT_TOKEN, raw, req.headers.get(LINK_SIGNATURE)))) {
    return json({ error: "bad signature" }, 401);
  }
  let body: { application?: unknown; at?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const id = body.application;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return json({ error: "no application id" }, 400);
  }
  if (typeof body.at !== "number" || Math.abs(Date.now() - body.at) > SITE_FRESH_MS) {
    return json({ error: "stale" }, 401);
  }
  return forward(
    env,
    "SmsApplicationFollowUp/applied/send",
    `site-application-${id}`,
    JSON.stringify({ application: id }),
  );
}

/**
 * A webhook held in KV while Restate is down (WA-1061, designs/2026-11-04-at-least-once.md), for
 * senders that retry for minutes only (Telnyx, Linq, cal.com, Documenso, the lander). Pub/Sub and
 * Meta retry for days: they keep the 502. `forward`: checked, sent on as is. `telnyx`: Restate
 * was down at the signer, so the whole request waits and is checked on replay.
 */
type Held =
  | { kind: "forward"; path: string; key: string; body: string; at: number }
  | {
      kind: "telnyx";
      raw: string;
      signature: string | null;
      timestamp: string | null;
      path: string | null;
      at: number;
    };

const HELD = "held:";
/** Restate keeps an idempotency key 7 days (WA-1060): a replay inside it is applied once. */
const HELD_TTL_S = 7 * 24 * 60 * 60;

/** Kept under its idempotency key: a vendor's retry while down writes nothing new. KV fails: 502. */
async function hold(env: Env, key: string, held: Held): Promise<Response> {
  try {
    if ((await env.CRED_LINKS.get(HELD + key)) === null)
      await env.CRED_LINKS.put(HELD + key, JSON.stringify(held), { expirationTtl: HELD_TTL_S });
  } catch {
    return json({ error: "restate unreachable" }, 502);
  }
  return json({ ok: true, held: true });
}

/**
 * One send into Restate under `key`. Down (no answer, or 5xx): held, 200. Restate's 4xx: 502, the
 * vendor retries. On replay nothing is held: 503 down, 422 refused.
 */
async function forward(
  env: Env,
  path: string,
  key: string,
  body: string,
  replay = false,
): Promise<Response> {
  let status: number;
  try {
    const res = await fetch(ingress(env, path), {
      method: "POST",
      headers: restateHeaders(env, { "idempotency-key": key }),
      body,
    });
    status = res.status;
  } catch {
    status = 0;
  }
  if (status >= 200 && status < 300) return json({ ok: true });
  const down = status === 0 || status >= 500;
  if (replay) return json({ error: `restate ${status || "unreachable"}` }, down ? 503 : 422);
  if (down) return hold(env, key, { kind: "forward", path, key, body, at: Date.now() });
  return json({ error: `restate ${status}` }, 502);
}

/**
 * The cron (every 2 minutes; KV's free tier lists 1,000 times a day): each held webhook, oldest
 * first, under its own key, so a repeat at Restate is applied once. Sent or refused for good:
 * deleted. Restate still down: kept until its TTL.
 */
export async function replayHeld(
  env: Env,
): Promise<{ sent: number; kept: number; dropped: number }> {
  const held: { name: string; h: Held }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.CRED_LINKS.list({ prefix: HELD, ...(cursor ? { cursor } : {}) });
    for (const k of page.keys) {
      const raw = await env.CRED_LINKS.get(k.name);
      if (raw !== null) held.push({ name: k.name, h: JSON.parse(raw) as Held });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  held.sort((a, b) => a.h.at - b.h.at);
  const out = { sent: 0, kept: 0, dropped: 0 };
  for (const { name, h } of held) {
    const res =
      h.kind === "telnyx"
        ? await telnyxEvent(env, h, true)
        : await forward(env, h.path, h.key, h.body, true);
    if (res.status === 503) {
      out.kept += 1;
      continue;
    }
    if (res.ok) out.sent += 1;
    else {
      out.dropped += 1;
      console.error(`held ${name} dropped: ${res.status} ${await res.text()}`);
    }
    await env.CRED_LINKS.delete(name);
  }
  return out;
}

/** One send into Restate; 502 when it fails, so the vendor retries. */
async function toRestate(env: Env, path: string, key: string, body: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(ingress(env, path), {
      method: "POST",
      headers: restateHeaders(env, { "idempotency-key": key }),
      body,
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
  const key = req.headers.get("idempotency-key");
  const keyed =
    DESK_SENDS.has(handler) && key && KEY_RE.test(key)
      ? { "idempotency-key": `phone-${handler}-${key}` }
      : {};
  let res: Response;
  try {
    res = await fetch(ingress(env, `SmsDesk/${handler}`), {
      method: "POST",
      headers: restateHeaders(env, keyed),
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
 * A drop: a credential link the other way (autobrowse designs/2026-10-12-papers.md). The Mac mints one
 * (`autobrowse papers ask`); the page at `/u/<id>` seals a photo in the phone's browser under
 * the key in the link's fragment and posts only ciphertext; the Mac takes it once and opens it.
 * KV `drop:<id>` holds `{label, open, until}`, then `{iv, data}` once filled.
 */
const DROP_MAX = 18 * 1024 * 1024; // a 12 MB document, base64, in JSON
type Drop = { label: string; open: boolean; until: number; iv?: string; data?: string };

/** Fresh and HMAC signed by the Mac with `CRED_LINK_SECRET`, like a link's mint; else a refusal. */
async function fromMac(req: Request, env: Env): Promise<Record<string, unknown> | Response> {
  if (!env.CRED_LINK_SECRET) return json({ error: "links off: no CRED_LINK_SECRET" }, 503);
  const raw = await readBody(req, 16 * 1024);
  if (raw === null) return json({ error: "too large" }, 413);
  if (!(await hmacSigned(env.CRED_LINK_SECRET, raw, req.headers.get(LINK_SIGNATURE)))) {
    return json({ error: "bad signature" }, 401);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "not json" }, 400);
  }
  if (typeof body.at !== "number" || Math.abs(Date.now() - body.at) > 5 * 60_000) {
    return json({ error: "stale" }, 401);
  }
  return body;
}

/** `POST /drops {label, at, open?, ttl?}` from the Mac: an empty drop, `{id}`. */
async function mintDrop(req: Request, env: Env): Promise<Response> {
  const body = await fromMac(req, env);
  if (body instanceof Response) return body;
  const { label, open = false, ttl = LINK_TTL_S } = body;
  if (
    typeof label !== "string" ||
    !/^[\w .,@+:-]{1,100}$/.test(label) ||
    typeof open !== "boolean" ||
    !Number.isInteger(ttl) ||
    (ttl as number) < 60 ||
    (ttl as number) > LINK_TTL_MAX_S
  ) {
    return json({ error: "want {label, at, open?, ttl? (60s to 7d)}" }, 400);
  }
  const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const drop: Drop = { label, open, until: Math.floor(Date.now() / 1000) + (ttl as number) };
  await env.CRED_LINKS.put(`drop:${id}`, JSON.stringify(drop), { expirationTtl: ttl as number });
  return json({ id });
}

/**
 * The page's calls: `/api/drops/<id>` names it (`{label, open, filled}`), `/api/drops/<id>/fill`
 * with `{iv, data}` fills it once. An open drop answers anyone holding its id; any other needs
 * an operator, and a caller without one gets 401 whether or not it exists.
 */
async function drop(req: Request, env: Env, rest: string): Promise<Response> {
  const [id, fill, ...more] = rest.split("/");
  if (!id || !LINK_ID.test(id) || more.length || (fill !== undefined && fill !== "fill")) {
    return json({ error: "not found" }, 404);
  }
  const raw = await env.CRED_LINKS.get(`drop:${id}`);
  const held = raw ? (JSON.parse(raw) as Drop) : null;
  if (!held?.open) {
    const who = await operator(req, env);
    if (who instanceof Response) return who;
  }
  if (!held) return json({ error: "This link is used or expired." }, 404);
  const filled = held.data !== undefined;
  if (!fill) return json({ label: held.label, open: held.open, filled });
  if (filled) return json({ error: "Already sent. Ask for a new link to send another." }, 409);
  const body = await readBody(req, DROP_MAX);
  if (body === null) return json({ error: "too large: 12 MB at most" }, 413);
  let sealed: { iv?: unknown; data?: unknown };
  try {
    sealed = JSON.parse(body) as typeof sealed;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const { iv, data } = sealed;
  if (typeof iv !== "string" || !B64.test(iv) || typeof data !== "string" || !B64.test(data)) {
    return json({ error: "want {iv, data}" }, 400);
  }
  const left = Math.max(60, held.until - Math.floor(Date.now() / 1000));
  await env.CRED_LINKS.put(`drop:${id}`, JSON.stringify({ ...held, iv, data }), {
    expirationTtl: left,
  });
  return json({ ok: true });
}

/** `POST /drops/<id>/take {at}` from the Mac: `{iv, data}` once, `{waiting: true}` before. */
async function takeDrop(req: Request, env: Env, id: string): Promise<Response> {
  const body = await fromMac(req, env);
  if (body instanceof Response) return body;
  const raw = await env.CRED_LINKS.get(`drop:${id}`);
  if (!raw) return json({ error: "used or expired" }, 404);
  const held = JSON.parse(raw) as Drop;
  if (held.data === undefined) return json({ waiting: true });
  // ponytail: get-then-delete is not atomic, as with links; only the Mac takes, one at a time.
  await env.CRED_LINKS.delete(`drop:${id}`);
  return new Response(JSON.stringify({ iv: held.iv, data: held.data }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * The door (designs/2026-10-05-workflows.md): any webhook into a workflow's input, by a token
 * `wren hooks add` made. JSON or a form; the Executor checks the token and answers the status.
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
    res = await fetch(ingress(env, "Executor/hook"), {
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
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(replayHeld(env));
  },
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
    if (pathname === "/webhooks/documenso") {
      return req.method === "POST" ? documensoWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname === "/webhooks/linq") {
      return req.method === "POST" ? linqWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname === "/webhooks/gmail") {
      return req.method === "POST" ? gmailWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname === "/webhooks/site") {
      return req.method === "POST" ? siteWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname === "/webhooks/meta") return metaWebhook(req, env);
    if (pathname === "/webhooks/gbp") {
      return req.method === "POST" ? gbpWebhook(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname.startsWith("/hooks/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return door(req, env, pathname.slice("/hooks/".length));
    }
    if (pathname === "/links") {
      return req.method === "POST" ? mintLink(req, env) : json({ error: "POST only" }, 405);
    }
    if (pathname === "/drops") {
      return req.method === "POST" ? mintDrop(req, env) : json({ error: "POST only" }, 405);
    }
    const take = /^\/drops\/([A-Za-z0-9_-]{22})\/take$/.exec(pathname);
    if (take?.[1]) {
      return req.method === "POST"
        ? takeDrop(req, env, take[1])
        : json({ error: "POST only" }, 405);
    }
    // The drop page: static, for any id, like the reveal page.
    if (pathname.startsWith("/u/") && LINK_ID.test(pathname.slice(3))) {
      return env.ASSETS.fetch(new Request(new URL("/u", req.url), req));
    }
    // The reveal page: static, for any id. A GET never touches KV, so a link preview burns nothing.
    if (pathname.startsWith("/c/") && LINK_ID.test(pathname.slice(3))) {
      return env.ASSETS.fetch(new Request(new URL("/c", req.url), req));
    }
    if (pathname.startsWith("/marketing/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return lander(req, env, "SignupForm", MARKETING_HANDLERS, pathname.slice(11));
    }
    if (pathname.startsWith("/calendar/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      return lander(req, env, "BookingPage", CALENDAR_HANDLERS, pathname.slice(10));
    }
    if (pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      if (pathname.startsWith("/api/links/")) return link(req, env, pathname.slice(11));
      if (pathname.startsWith("/api/drops/")) return drop(req, env, pathname.slice(11));
      return desk(req, env, pathname.slice("/api/".length));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
