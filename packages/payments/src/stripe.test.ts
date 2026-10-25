import { describe, expect, it } from "vitest";
import type { PayLink } from "./schema.js";
import { payEmail, paymentFired, payText } from "./service.js";
import { centsOf, linkIdOf, money, PayRefusal, payApprovalId } from "./store.js";
import {
  type Fetch,
  factsOf,
  isSigningSecret,
  keyMode,
  STRIPE_EVENTS,
  STRIPE_VERSION,
  StripeError,
  signFor,
  stripeApi,
  verifySignature,
} from "./stripe.js";

// Synthetic: a made-up signing secret and Stripe ids, never a real account's.
const SECRET = "whsec_testfixture0000000000";
const NOW = new Date("2026-10-07T15:00:00Z");

const event = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_test_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_1",
        payment_link: "plink_test_1",
        payment_status: "paid",
        amount_total: 4900,
        currency: "usd",
        metadata: { wren_link: "00000000-0000-4000-8000-000000000001" },
        customer_details: { email: "payer@example.com", address: { line1: "never kept" } },
        ...o,
      },
    },
  });

describe("verifySignature", () => {
  it("takes Stripe's own signature", () => {
    const raw = event();
    expect(verifySignature(raw, signFor(raw, SECRET, NOW), SECRET, NOW)).toEqual({ ok: true });
  });
  it("takes any of several v1 signatures (a secret being rolled)", () => {
    const raw = event();
    const h = signFor(raw, SECRET, NOW).replace("v1=", `v1=${"0".repeat(64)},v1=`);
    expect(verifySignature(raw, h, SECRET, NOW).ok).toBe(true);
  });
  it("refuses a changed body, another secret, an old one, none", () => {
    const raw = event();
    const h = signFor(raw, SECRET, NOW);
    expect(verifySignature(event({ amount_total: 1 }), h, SECRET, NOW)).toEqual({
      ok: false,
      why: "signature doesn't match",
    });
    expect(verifySignature(raw, h, "whsec_other00000000", NOW).ok).toBe(false);
    const late = new Date(NOW.getTime() + 301_000);
    expect(verifySignature(raw, h, SECRET, late)).toEqual({ ok: false, why: "too old" });
    expect(verifySignature(raw, null, SECRET, NOW)).toEqual({ ok: false, why: "no signature" });
    expect(verifySignature(raw, "t=abc,v1=zz", SECRET, NOW).ok).toBe(false);
  });
  it("refuses a signature dated ahead of now", () => {
    const raw = event();
    const ahead = signFor(raw, SECRET, new Date(NOW.getTime() + 600_000));
    expect(verifySignature(raw, ahead, SECRET, NOW)).toEqual({ ok: false, why: "from the future" });
  });
});

describe("factsOf", () => {
  it("keeps the ids, the amount and the email, never the address", () => {
    const f = factsOf(event());
    expect(f).toEqual({
      event: "evt_test_1",
      type: "checkout.session.completed",
      kind: "checkout",
      created: null,
      session: "cs_test_1",
      link: "plink_test_1",
      intent: null,
      wren: "00000000-0000-4000-8000-000000000001",
      status: "paid",
      cents: 4900,
      currency: "usd",
      email: "payer@example.com",
      refunded: null,
      live: false,
    });
    expect(JSON.stringify(f)).not.toContain("never kept");
  });
  it("reads a refund's running total and a dispute's state, by their payment", () => {
    const refund = factsOf(
      JSON.stringify({
        id: "evt_test_2",
        type: "charge.refunded",
        created: 1_790_000_000,
        livemode: false,
        data: {
          object: {
            id: "ch_test_1",
            payment_intent: "pi_test_1",
            amount: 4900,
            amount_refunded: 1000,
            status: "succeeded",
            billing_details: { email: "payer@example.com", address: { line1: "never kept" } },
          },
        },
      }),
    );
    expect(refund).toMatchObject({
      kind: "refund",
      intent: "pi_test_1",
      refunded: 1000,
      cents: 4900,
      session: null,
      created: 1_790_000_000,
    });
    expect(JSON.stringify(refund)).not.toContain("never kept");
    const dispute = factsOf(
      JSON.stringify({
        id: "evt_test_3",
        type: "charge.dispute.closed",
        data: { object: { id: "dp_test_1", payment_intent: { id: "pi_test_1" }, status: "lost" } },
      }),
    );
    expect(dispute).toMatchObject({ kind: "dispute", intent: "pi_test_1", status: "lost" });
  });
  it("is null for what isn't an event", () => {
    expect(factsOf("not json")).toBeNull();
    expect(factsOf("{}")).toBeNull();
  });
});

describe("stripeApi", () => {
  it("posts with the key, our API version, an idempotency key and a form body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake: Fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          id: "plink_test_1",
          url: "https://buy.stripe.com/test_1",
          livemode: false,
        }),
        { status: 200 },
      );
    };
    const api = stripeApi("sk_test_fixture000", fake, "https://stripe.invalid");
    const l = await api.createPaymentLink({
      id: "L1",
      client: "c1",
      price: "price_1",
      quantity: 1,
    });
    expect(l.url).toBe("https://buy.stripe.com/test_1");
    const [c] = calls;
    expect(c?.url).toBe("https://stripe.invalid/v1/payment_links");
    const h = new Headers(c?.init.headers);
    expect(h.get("idempotency-key")).toBe("wren-link-L1");
    expect(h.get("authorization")).toBe("Bearer sk_test_fixture000");
    expect(h.get("stripe-version")).toBe(STRIPE_VERSION);
    expect(decodeURIComponent(String(c?.init.body))).toContain(
      "restrictions[completed_sessions][limit]=1",
    );
  });
  it("registers the endpoint for every event we read, on our API version", async () => {
    let body = "";
    const fake: Fetch = async (_url, init) => {
      body = decodeURIComponent(String(init.body));
      return Response.json({ id: "we_test_1", secret: "whsec_fixture000", livemode: false });
    };
    const e = await stripeApi("sk_test_fixture000", fake, "https://stripe.invalid").registerWebhook(
      { client: "c1", url: "https://x.invalid/__pay/stripe/c1", idem: "c1-1" },
    );
    expect(e).toEqual({ id: "we_test_1", secret: "whsec_fixture000", livemode: false });
    for (const ev of STRIPE_EVENTS) expect(body).toContain(ev);
    expect(body).toContain(`api_version=${STRIPE_VERSION}`);
  });
  it("turns Stripe's error into a StripeError, denied on 403", async () => {
    const fake: Fetch = async () =>
      new Response(JSON.stringify({ error: { message: "lacks permission", code: "x" } }), {
        status: 403,
      });
    const err = await stripeApi("rk_test_fixture000", fake, "https://stripe.invalid", 0)
      .registerWebhook({ client: "c1", url: "https://x.invalid", idem: "1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(err.denied).toBe(true);
    expect(err.transient).toBe(false);
  });
  it("calls a dropped connection, a 5xx or a 429 transient: retried, never failed", async () => {
    const api = (f: Fetch) => stripeApi("sk_test_fixture000", f, "https://stripe.invalid", 0);
    const price = { id: "x", cents: 100, currency: "usd", description: "d" };
    const down = await api(async () => {
      throw new TypeError("fetch failed");
    })
      .createPrice(price)
      .catch((e) => e);
    expect(down).toBeInstanceOf(StripeError);
    expect(down.transient).toBe(true);
    const five = await api(async () =>
      Response.json({ error: { message: "x", type: "api_error" } }, { status: 500 }),
    )
      .createPrice(price)
      .catch((e) => e);
    expect(five.transient).toBe(true);
    const busy = await api(async () =>
      Response.json({ error: { message: "x", type: "rate_limit_error" } }, { status: 429 }),
    )
      .createPrice(price)
      .catch((e) => e);
    expect(busy.transient).toBe(true);
  });
  it("retries a 5xx itself with the same idempotency key", async () => {
    const keys: (string | null)[] = [];
    let n = 0;
    const flaky: Fetch = async (_url, init) => {
      keys.push(new Headers(init.headers).get("idempotency-key"));
      n += 1;
      return n === 1
        ? Response.json({ error: { message: "x", type: "api_error" } }, { status: 500 })
        : Response.json({ id: "price_1", livemode: false });
    };
    const p = await stripeApi("sk_test_fixture000", flaky, "https://stripe.invalid", 2).createPrice(
      { id: "L9", cents: 100, currency: "usd", description: "d" },
    );
    expect(p.id).toBe("price_1");
    expect(keys).toEqual(["wren-price-L9", "wren-price-L9"]);
  });
});

describe("keys and secrets", () => {
  it("reads a key's mode by its prefix", () => {
    expect(keyMode("sk_test_abcdefgh123")).toBe("test");
    expect(keyMode("rk_live_abcdefgh123")).toBe("live");
    expect(keyMode("pk_test_abcdefgh123")).toBeNull();
    expect(isSigningSecret(SECRET)).toBe(true);
    expect(isSigningSecret("sk_test_abcdefgh")).toBe(false);
  });
});

describe("centsOf", () => {
  it("reads dollars as people type them", () => {
    expect(centsOf("49")).toBe(4900);
    expect(centsOf("49.5")).toBe(4950);
    expect(centsOf("$1,200.00")).toBe(120000);
    expect(centsOf(12.34)).toBe(1234);
  });
  it("refuses what Stripe won't take", () => {
    for (const bad of ["0.49", "1.234", "abc", "", "-5"])
      expect(() => centsOf(bad)).toThrow(PayRefusal);
  });
  it("prints money and To approve ids", () => {
    expect(money(120000)).toBe("$1,200.00");
    expect(linkIdOf(payApprovalId("abc"))).toBe("abc");
    expect(linkIdOf("abc")).toBe("abc");
  });
});

describe("messages and the executor", () => {
  const link = {
    id: "00000000-0000-4000-8000-000000000001",
    client: "c1",
    contact: 7,
    email: "payer@example.com",
    name: "Sam Rivera",
    channel: "sms",
    description: "Filter swap",
    amountCents: 4900,
    quantity: 2,
    currency: "usd",
    paidCents: 9800,
    live: false,
  } as PayLink;
  it("writes the text and the email plainly", () => {
    expect(payText("Acme HVAC", link, "https://buy.stripe.com/test_1")).toBe(
      "Acme HVAC: 2 x Filter swap, $98.00. Pay here: https://buy.stripe.com/test_1",
    );
    const m = payEmail("Acme HVAC", link, "https://buy.stripe.com/test_1");
    expect(m.subject).toBe("2 x Filter swap: $98.00");
    expect(m.text).toContain("Hi Sam,");
  });
  it("fires payment.received about the email and the thread", () => {
    const f = paymentFired(link);
    expect(f.facts).toEqual({ trigger: "trigger.payment", change: "paid" });
    expect(f.about).toEqual(["payer@example.com", "sms:7"]);
    expect(f.event.subject).toBe(`payment:${link.id}`);
    expect(f.event.data).toMatchObject({ source: "pay_link", id: link.id });
  });
  it("fires a refund or a failure under its own subject, with the document", () => {
    const f = paymentFired({ ...link, refundedCents: 9800, document: null }, "refunded");
    expect(f.facts).toEqual({ trigger: "trigger.payment", change: "refunded" });
    expect(f.event.subject).toBe(`payment:${link.id}:refunded`);
    expect(f.event.data).toMatchObject({
      change: "refunded",
      refunded_cents: 9800,
      document: null,
    });
  });
});
