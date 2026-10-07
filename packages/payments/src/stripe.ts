/**
 * Stripe, the few calls text-to-pay makes, on the client's own key (designs/2026-10-07-forms-and-pay.md).
 * `fetch` is passed in, so tests run on fixtures with no network. Nothing here charges anyone:
 * a Payment Link is a page on Stripe where the payer types their card; we never see it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API = "https://api.stripe.com/v1";
/** The events a link's webhook hears: paid now, or paid later (a bank debit). */
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
] as const;
/** How old a signed event may be: Stripe's own default. */
export const TOLERANCE_S = 300;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Stripe said no: its message, its HTTP status, and whether the key lacks the right. */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "StripeError";
  }
  /** A restricted key without this permission, or a bad key. */
  get denied() {
    return this.status === 401 || this.status === 403;
  }
}

/** A form body as Stripe reads it: `a[b][0][c]=1`. */
export function formBody(o: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v))
      v.forEach((x, i) => {
        if (x !== null && typeof x === "object")
          out.push(...formBody(x as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`);
      });
    else if (typeof v === "object") out.push(...formBody(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export interface StripePrice {
  id: string;
  livemode: boolean;
}
export interface StripeLink {
  id: string;
  url: string;
  livemode: boolean;
}
export interface StripeEndpoint {
  id: string;
  /** The signing secret: only on create, never read again. */
  secret: string;
  livemode: boolean;
}

/** The calls on one key. Each write carries an idempotency key, so a retry makes nothing twice. */
export function stripeApi(key: string, fetchFn: Fetch, base = STRIPE_API) {
  const post = async <T>(path: string, body: Record<string, unknown>, idem: string): Promise<T> => {
    const res = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idem,
      },
      body: formBody(body).join("&"),
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: { message?: string; code?: string } })
      | null;
    if (!res.ok || !json || json.error) {
      const e = json?.error;
      throw new StripeError(
        e?.message?.slice(0, 300) ?? `Stripe answered ${res.status}`,
        res.status,
        e?.code ?? null,
      );
    }
    return json;
  };
  return {
    /** A one-off price, its product named by the description. */
    createPrice: (o: { id: string; cents: number; currency: string; description: string }) =>
      post<StripePrice>(
        "/prices",
        {
          currency: o.currency,
          unit_amount: o.cents,
          product_data: { name: o.description },
        },
        `wren-price-${o.id}`,
      ),
    /** The link: one paid checkout, then it stops taking payments; ours by metadata. */
    createPaymentLink: (o: { id: string; client: string; price: string; quantity: number }) =>
      post<StripeLink>(
        "/payment_links",
        {
          line_items: [{ price: o.price, quantity: o.quantity }],
          restrictions: { completed_sessions: { limit: 1 } },
          metadata: { wren_link: o.id, wren_client: o.client },
          payment_intent_data: { metadata: { wren_link: o.id } },
        },
        `wren-link-${o.id}`,
      ),
    /** Our endpoint on their account, hearing paid checkouts; `idem` once per connect. */
    registerWebhook: (o: { client: string; url: string; idem: string }) =>
      post<StripeEndpoint>(
        "/webhook_endpoints",
        {
          url: o.url,
          enabled_events: [...STRIPE_EVENTS],
          description: "Wren pay links",
          metadata: { wren_client: o.client },
        },
        `wren-webhook-${o.idem}`.slice(0, 255),
      ),
  };
}
export type StripeApi = ReturnType<typeof stripeApi>;

/** A key's mode by its prefix: `sk_live_`/`rk_live_`, `sk_test_`/`rk_test_`; null if neither. */
export function keyMode(key: string): "live" | "test" | null {
  const m = /^(?:sk|rk)_(live|test)_[A-Za-z0-9]{8,}$/.exec(key.trim());
  return m ? (m[1] as "live" | "test") : null;
}

/** A signing secret looks like `whsec_…`. */
export const isSigningSecret = (s: string) => /^whsec_[A-Za-z0-9+/=]{8,}$/.test(s.trim());

/**
 * Is this body Stripe's, signed with `secret`? The header is `t=<unix>,v1=<hex>[,v1=…]`: HMAC-
 * SHA256 of `${t}.${raw}`, the time within `TOLERANCE_S` of now. Checked in constant time.
 */
export function verifySignature(
  raw: string,
  header: string | null | undefined,
  secret: string,
  now: Date,
): { ok: true } | { ok: false; why: string } {
  if (!header) return { ok: false, why: "no signature" };
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d{1,12}$/.test(t) || !sigs.length) return { ok: false, why: "bad signature" };
  if (Math.abs(now.getTime() / 1000 - Number(t)) > TOLERANCE_S)
    return { ok: false, why: "too old" };
  const want = createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest();
  const match = sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/.test(s)) return false;
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  return match ? { ok: true } : { ok: false, why: "signature doesn't match" };
}

/** The header Stripe would send for `raw`: tests and the preview sign their own fixtures. */
export function signFor(raw: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

/** What we keep of a checkout event: no card, no address, only what marks the link. */
export interface PaidFacts {
  event: string;
  type: string;
  session: string | null;
  link: string | null;
  /** Our id, when the payment intent or session metadata carries it. */
  wren: string | null;
  status: string | null;
  cents: number | null;
  currency: string | null;
  email: string | null;
  live: boolean;
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v ? v.slice(0, max) : null);

/** A Stripe event body, trimmed to `PaidFacts`; null when it isn't one we can read. */
export function factsOf(raw: string): PaidFacts | null {
  let e: unknown;
  try {
    e = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!e || typeof e !== "object") return null;
  const ev = e as { id?: unknown; type?: unknown; livemode?: unknown; data?: { object?: unknown } };
  const id = str(ev.id, 80);
  const type = str(ev.type, 80);
  if (!id || !type) return null;
  const o = (ev.data?.object ?? {}) as Record<string, unknown>;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const who = (o.customer_details ?? {}) as Record<string, unknown>;
  return {
    event: id,
    type,
    session: str(o.id, 80),
    link: str(o.payment_link, 80),
    wren: str(meta.wren_link, 40),
    status: str(o.payment_status, 40),
    cents: typeof o.amount_total === "number" ? o.amount_total : null,
    currency: str(o.currency, 3),
    email: str(who.email, 200),
    live: ev.livemode === true,
  };
}
