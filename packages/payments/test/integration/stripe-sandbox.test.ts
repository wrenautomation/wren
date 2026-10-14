/**
 * Every Stripe call Wren makes, against a real Stripe sandbox: money moves (test cards only), so
 * reconcile's reads see a real payment, a refund and a dispute. Runs only with
 * STRIPE_TEST_SECRET_KEY (a sandbox key; a live key is refused):
 *   node scripts/secrets.mjs run ../autobrowse/.env -- 'pnpm --filter @wren/payments exec vitest run test/integration/stripe-sandbox.test.ts'
 */
import { describe, expect, it } from "vitest";
import { STRIPE_API, STRIPE_EVENTS, StripeError, stripeApi } from "../../src/stripe.js";

const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";
if (key && !key.startsWith("sk_test_"))
  throw new Error("STRIPE_TEST_SECRET_KEY must be a test key");
const api = () => stripeApi(key, (u, i) => fetch(u, i), STRIPE_API, 0);
const run = Date.now().toString(36);

/** What only a payer does: Stripe's own test cards, straight at the API. */
async function stripe(path: string, form: Record<string, string>) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  const body = (await res.json()) as { id: string; status: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}
const pay = (card: string) =>
  stripe("/v1/payment_intents", {
    amount: "4900",
    currency: "usd",
    payment_method: card,
    confirm: "true",
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
  });

describe.skipIf(!key)("a Stripe sandbox takes every call", () => {
  it("a price and its link", async () => {
    const price = await api().createPrice({
      id: crypto.randomUUID(),
      cents: 4900,
      currency: "usd",
      description: `Filter swap ${run}`,
    });
    expect(price.id).toMatch(/^price_/);
    const link = await api().createPaymentLink({
      id: crypto.randomUUID(),
      client: "acme",
      price: price.id,
      quantity: 2,
    });
    expect(link.url).toMatch(/^https:\/\/buy\.stripe\.com\//);
    expect(await api().sessionsOf(link.id)).toEqual([]);
  });

  it("the webhook: made on our version with every event, read, and widened", async () => {
    const e = await api().registerWebhook({
      client: "acme",
      url: `https://app.wren.test/__pay/stripe/acme-${run}`,
      idem: `sandbox-${run}`,
    });
    expect(e.id).toMatch(/^we_/);
    await api().setWebhookEvents(e.id, STRIPE_EVENTS);
    expect([...(await api().webhookEvents(e.id))].sort()).toEqual([...STRIPE_EVENTS].sort());
  });

  it("reconcile reads a paid, then part-refunded, payment", async () => {
    const pi = await pay("pm_card_visa");
    expect(pi.status).toBe("succeeded");
    expect(await api().paymentOf(pi.id)).toMatchObject({
      status: "succeeded",
      received: 4900,
      refunded: 0,
      disputed: false,
    });
    await stripe("/v1/refunds", { payment_intent: pi.id, amount: "1000" });
    expect(await api().paymentOf(pi.id)).toMatchObject({ received: 4900, refunded: 1000 });
  });

  it("reconcile reads a disputed payment and its dispute", async () => {
    const pi = await pay("pm_card_createDispute");
    let disputes: Awaited<ReturnType<ReturnType<typeof api>["disputesOf"]>> = [];
    for (const end = Date.now() + 60_000; Date.now() < end && !disputes.length; ) {
      await new Promise((r) => setTimeout(r, 2000));
      disputes = await api().disputesOf(pi.id);
    }
    // Newer accounts' disputes are du_, older ones dp_.
    expect(disputes[0]).toMatchObject({ id: expect.stringMatching(/^d[pu]_/) });
    expect(await api().paymentOf(pi.id)).toMatchObject({ disputed: true });
  }, 90_000);

  it("a request Stripe refuses is Stripe's refusal, not a retry", async () => {
    const err = await api()
      .setWebhookEvents("we_does_not_exist", STRIPE_EVENTS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(err).toMatchObject({ transient: false });
  });
});
