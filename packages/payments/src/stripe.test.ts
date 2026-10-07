import { describe, expect, it } from "vitest";
import type { PayLink } from "./schema.js";
import { payEmail, paymentFired, payText } from "./service.js";
import { centsOf, linkIdOf, money, PayRefusal, payApprovalId } from "./store.js";
import {
  type Fetch,
  factsOf,
  formBody,
  isSigningSecret,
  keyMode,
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
});

describe("factsOf", () => {
  it("keeps the ids, the amount and the email, never the address", () => {
    const f = factsOf(event());
    expect(f).toEqual({
      event: "evt_test_1",
      type: "checkout.session.completed",
      session: "cs_test_1",
      link: "plink_test_1",
      wren: "00000000-0000-4000-8000-000000000001",
      status: "paid",
      cents: 4900,
      currency: "usd",
      email: "payer@example.com",
      live: false,
    });
    expect(JSON.stringify(f)).not.toContain("never kept");
  });
  it("is null for what isn't an event", () => {
    expect(factsOf("not json")).toBeNull();
    expect(factsOf("{}")).toBeNull();
  });
});

describe("formBody", () => {
  it("writes Stripe's brackets", () => {
    expect(
      formBody({
        line_items: [{ price: "price_1", quantity: 2 }],
        metadata: { wren_link: "a b" },
        skip: null,
      }),
    ).toEqual([
      "line_items%5B0%5D%5Bprice%5D=price_1",
      "line_items%5B0%5D%5Bquantity%5D=2",
      "metadata%5Bwren_link%5D=a%20b",
    ]);
  });
});

describe("stripeApi", () => {
  it("posts with the key, an idempotency key and a form body; no network", async () => {
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
    const api = stripeApi("sk_test_fixture000", fake, "https://stripe.invalid/v1");
    const l = await api.createPaymentLink({
      id: "L1",
      client: "c1",
      price: "price_1",
      quantity: 1,
    });
    expect(l.url).toBe("https://buy.stripe.com/test_1");
    const [c] = calls;
    expect(c?.url).toBe("https://stripe.invalid/v1/payment_links");
    const h = c?.init.headers as Record<string, string>;
    expect(h["idempotency-key"]).toBe("wren-link-L1");
    expect(h.authorization).toBe("Bearer sk_test_fixture000");
    expect(String(c?.init.body)).toContain("restrictions%5Bcompleted_sessions%5D%5Blimit%5D=1");
  });
  it("turns Stripe's error into a StripeError, denied on 403", async () => {
    const fake: Fetch = async () =>
      new Response(JSON.stringify({ error: { message: "lacks permission", code: "x" } }), {
        status: 403,
      });
    const err = await stripeApi("rk_test_fixture000", fake)
      .registerWebhook({ client: "c1", url: "https://x.invalid", idem: "1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(err.denied).toBe(true);
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

describe("messages and the spine", () => {
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
  });
});
