/**
 * Stripe, the calls pay links make, on the client's own key, through Stripe's official SDK
 * (designs/2026-10-07-forms-and-pay.md; the SDK choice: "Durable payments", 2026-10-14).
 *
 * `fetch` is passed in, so unit tests run on fixtures and the integration suite on stripe-mock,
 * with no network. The SDK pins Stripe's API version, signs and checks webhooks, and retries a
 * dropped connection or a 5xx with the same idempotency key. Nothing here charges anyone: a
 * Payment Link is a page on Stripe where the payer types their card; we never see it.
 */
import Stripe from "stripe";

export const STRIPE_API = "https://api.stripe.com";
/** The API version every call and every endpoint we register speaks: the SDK's own pin. */
export const STRIPE_VERSION = Stripe.API_VERSION;
/**
 * What a link's webhook hears: paid now, paid later (a bank debit) or not, refunds, disputes.
 * Each one is kept once by its id (`pay_events`) and applied in any order (`./states.ts`).
 */
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;
/** What a restricted key must be able to read for reconcile to hold links against Stripe. */
export const READ_ACCESS = "Checkout Sessions, Payment Intents, Charges and Disputes";
/** How old a signed event may be: Stripe's own default. */
export const TOLERANCE_S = 300;
/** Retries the SDK makes on a dropped connection, a 409 lock or a 5xx; Restate retries after. */
export const NETWORK_RETRIES = 2;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Stripe said no: its message, its HTTP status, and whether trying again may help. */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** A dropped connection, a rate limit or Stripe's own trouble: retry, never mark failed. */
    readonly transient = false,
  ) {
    super(message);
    this.name = "StripeError";
  }
  /** A restricted key without this permission, or a bad key. */
  get denied() {
    return this.status === 401 || this.status === 403;
  }
}

/** The SDK's error as ours; anything else as it was. */
export function stripeErrorOf(err: unknown): unknown {
  if (!(err instanceof Stripe.errors.StripeError)) return err;
  const status = err.statusCode ?? 0;
  const transient =
    err instanceof Stripe.errors.StripeConnectionError ||
    err instanceof Stripe.errors.StripeAPIError ||
    err instanceof Stripe.errors.StripeRateLimitError ||
    status === 409 ||
    status >= 500;
  return new StripeError(
    (err.message || `Stripe answered ${status}`).slice(0, 300),
    status,
    err.code ?? null,
    transient,
  );
}

const call = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (err) {
    throw stripeErrorOf(err);
  }
};

/** The SDK on one key, over `fetchFn`, at `base` (Stripe, or stripe-mock in the tests). */
export function stripeClient(
  key: string,
  fetchFn: Fetch,
  base = STRIPE_API,
  retries = NETWORK_RETRIES,
): Stripe {
  const u = new URL(base);
  const protocol = u.protocol === "http:" ? "http" : "https";
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(fetchFn as typeof fetch),
    host: u.hostname,
    port: u.port || (protocol === "http" ? 80 : 443),
    protocol,
    maxNetworkRetries: retries,
    timeout: 20_000,
    telemetry: false,
  });
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
/** A Checkout Session of a link, trimmed: no card, no address. */
export interface StripeSession {
  id: string;
  status: string | null;
  paymentStatus: string;
  cents: number | null;
  currency: string | null;
  intent: string | null;
  email: string | null;
  created: number;
  live: boolean;
}
/** A payment as reconcile reads it: its state, what was refunded, any dispute. */
export interface StripePayment {
  status: string;
  received: number;
  refunded: number;
  disputed: boolean;
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String(v.id) : null;

/** The calls on one key. Each write carries an idempotency key, so a retry makes nothing twice. */
export function stripeApi(key: string, fetchFn: Fetch, base = STRIPE_API, retries?: number) {
  const s = stripeClient(key, fetchFn, base, retries);
  return {
    /** A one-off price, its product named by the description. */
    createPrice: (o: { id: string; cents: number; currency: string; description: string }) =>
      call(async (): Promise<StripePrice> => {
        const p = await s.prices.create(
          { currency: o.currency, unit_amount: o.cents, product_data: { name: o.description } },
          { idempotencyKey: `wren-price-${o.id}` },
        );
        return { id: p.id, livemode: p.livemode };
      }),
    /** The link: one paid checkout, then it stops taking payments; ours by metadata. */
    createPaymentLink: (o: { id: string; client: string; price: string; quantity: number }) =>
      call(async (): Promise<StripeLink> => {
        const l = await s.paymentLinks.create(
          {
            line_items: [{ price: o.price, quantity: o.quantity }],
            restrictions: { completed_sessions: { limit: 1 } },
            metadata: { wren_link: o.id, wren_client: o.client },
            payment_intent_data: { metadata: { wren_link: o.id } },
          },
          { idempotencyKey: `wren-link-${o.id}` },
        );
        return { id: l.id, url: l.url, livemode: l.livemode };
      }),
    /** Our endpoint on their account, on our API version; `idem` once per connect. */
    registerWebhook: (o: { client: string; url: string; idem: string }) =>
      call(async (): Promise<StripeEndpoint> => {
        const e = await s.webhookEndpoints.create(
          {
            url: o.url,
            enabled_events: [...STRIPE_EVENTS],
            api_version: STRIPE_VERSION,
            description: "Wren pay links",
            metadata: { wren_client: o.client },
          },
          { idempotencyKey: `wren-webhook-${o.idem}`.slice(0, 255) },
        );
        return { id: e.id, secret: e.secret ?? "", livemode: e.livemode };
      }),
    /** The events an endpoint hears now. */
    webhookEvents: (id: string) =>
      call(async () => (await s.webhookEndpoints.retrieve(id)).enabled_events),
    /** The account's webhook endpoints, where each posts and what it hears: a pasted secret has no id. */
    webhookEndpoints: () =>
      call(async () =>
        (await s.webhookEndpoints.list({ limit: 100 })).data.map((e) => ({
          id: e.id,
          url: e.url,
          events: [...e.enabled_events] as string[],
        })),
      ),
    /** An endpoint made before refunds and disputes: hear every event we read now. */
    setWebhookEvents: (id: string, events: readonly string[]) =>
      call(async () => {
        await s.webhookEndpoints.update(id, {
          enabled_events: [...events] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
        });
      }),
    /** The link's checkout sessions, newest first; a link takes one paid checkout. */
    sessionsOf: (link: string) =>
      call(async (): Promise<StripeSession[]> => {
        const page = await s.checkout.sessions.list({ payment_link: link, limit: 10 });
        return page.data.map((x) => ({
          id: x.id,
          status: x.status,
          paymentStatus: x.payment_status,
          cents: x.amount_total,
          currency: x.currency,
          intent: idOf(x.payment_intent),
          email: x.customer_details?.email ?? null,
          created: x.created,
          live: x.livemode,
        }));
      }),
    /** A payment's state, what's been refunded, and whether it's disputed. */
    paymentOf: (intent: string) =>
      call(async (): Promise<StripePayment> => {
        const pi = await s.paymentIntents.retrieve(intent, { expand: ["latest_charge"] });
        const ch =
          pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
        return {
          status: pi.status,
          received: pi.amount_received,
          refunded: ch?.amount_refunded ?? 0,
          disputed: ch?.disputed ?? false,
        };
      }),
    /** The payment's disputes, each with its state and when it was opened. */
    disputesOf: (intent: string) =>
      call(async () => {
        const page = await s.disputes.list({ payment_intent: intent, limit: 10 });
        return page.data.map((d) => ({ id: d.id, status: d.status, created: d.created }));
      }),
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
 * Is this body Stripe's, signed with `secret`? The SDK checks the `t=…,v1=…` header (any of
 * several `v1`, as when a secret is rolled) in constant time, no older than `TOLERANCE_S`; a
 * time past that far ahead of `now` is refused here too (the SDK lets it through).
 */
export function verifySignature(
  raw: string,
  header: string | null | undefined,
  secret: string,
  now: Date,
): { ok: true } | { ok: false; why: string } {
  if (!header) return { ok: false, why: "no signature" };
  const t = Number(/(?:^|,)t=(\d{1,12})(?:,|$)/.exec(header)?.[1]);
  if (Number.isFinite(t) && t * 1000 > now.getTime() + TOLERANCE_S * 1000)
    return { ok: false, why: "from the future" };
  try {
    Stripe.webhooks.constructEvent(raw, header, secret, TOLERANCE_S, undefined, now.getTime());
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    if (/tolerance/i.test(m)) return { ok: false, why: "too old" };
    if (/unable to extract/i.test(m)) return { ok: false, why: "bad signature" };
    return { ok: false, why: "signature doesn't match" };
  }
}

/** The header Stripe would send for `raw`: tests and the preview sign their own fixtures. */
export function signFor(raw: string, secret: string, at: Date): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret,
    timestamp: Math.floor(at.getTime() / 1000),
  });
}

/** Which of our events this is: a checkout, a refund, a dispute; other is kept, changes nothing. */
export type FactKind = "checkout" | "refund" | "dispute" | "other";

/**
 * What we keep of a Stripe event: ids, amounts, states, the payer's email. Never a card or an
 * address. It is all `./states.ts` needs to apply the event again, so a kept event replays.
 */
export interface StripeFact {
  event: string;
  type: string;
  kind: FactKind;
  /** When Stripe made the event (unix seconds): disputes apply in this order. */
  created: number | null;
  /** The Checkout Session (`cs_…`), the Payment Link (`plink_…`), the PaymentIntent (`pi_…`). */
  session: string | null;
  link: string | null;
  intent: string | null;
  /** Our id, when the object's metadata carries it. */
  wren: string | null;
  /** A session's `payment_status`, a charge's `status`, a dispute's `status`. */
  status: string | null;
  cents: number | null;
  currency: string | null;
  email: string | null;
  /** A charge's refunded total so far. */
  refunded: number | null;
  live: boolean;
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const kindOf = (type: string): FactKind =>
  type.startsWith("checkout.session.")
    ? "checkout"
    : type === "charge.refunded"
      ? "refund"
      : type.startsWith("charge.dispute.")
        ? "dispute"
        : "other";

/** A Stripe event body, trimmed to a `StripeFact`; null when it isn't one we can read. */
export function factsOf(raw: string): StripeFact | null {
  let e: unknown;
  try {
    e = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!e || typeof e !== "object") return null;
  const ev = e as {
    id?: unknown;
    type?: unknown;
    created?: unknown;
    livemode?: unknown;
    data?: { object?: unknown };
  };
  const id = str(ev.id, 80);
  const type = str(ev.type, 80);
  if (!id || !type) return null;
  const kind = kindOf(type);
  const o = (ev.data?.object ?? {}) as Record<string, unknown>;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const who = (o.customer_details ?? o.billing_details ?? {}) as Record<string, unknown>;
  return {
    event: id,
    type,
    kind,
    created: num(ev.created),
    session: kind === "checkout" ? str(o.id, 80) : null,
    link: str(o.payment_link, 80),
    intent: idOf(o.payment_intent)?.slice(0, 80) ?? null,
    wren: str(meta.wren_link, 40),
    status: kind === "checkout" ? str(o.payment_status, 40) : str(o.status, 40),
    cents: kind === "checkout" ? num(o.amount_total) : num(o.amount),
    currency: str(o.currency, 3),
    email: str(who.email, 200),
    refunded: kind === "refund" ? num(o.amount_refunded) : null,
    live: ev.livemode === true,
  };
}
