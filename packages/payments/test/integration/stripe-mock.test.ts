/**
 * Every Stripe call Wren makes, against stripe-mock (Stripe's own server built from its OpenAPI
 * spec): a request shape Stripe would refuse fails here, before a client's key ever sees it.
 * Its answers are canned, so this checks requests and parsing, not money. Skipped when Docker
 * isn't here. No network past the local container, no charge.
 */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STRIPE_EVENTS, StripeError, stripeApi } from "../../src/stripe.js";

const IMAGE = "stripe/stripe-mock:v0.205.0";
const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const hasDocker = (() => {
  try {
    docker("info", "--format", "{{.ServerVersion}}");
    return true;
  } catch {
    return false;
  }
})();

let container = "";
let base = "";
const api = () => stripeApi("sk_test_fixture00000000", (u, i) => fetch(u, i), base, 0);

beforeAll(async () => {
  if (!hasDocker) return;
  container = docker("run", "-d", "--rm", "-p", "127.0.0.1::12111", IMAGE);
  const port = docker("port", container, "12111/tcp").split("\n")[0]?.split(":").pop();
  base = `http://127.0.0.1:${port}`;
  for (const end = Date.now() + 30_000; Date.now() < end; ) {
    try {
      if ((await fetch(`${base}/v1/prices`, { headers: { authorization: "Bearer sk_test_x" } })).ok)
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("stripe-mock didn't start");
}, 120_000);
afterAll(() => {
  if (container) docker("stop", container);
});

describe.skipIf(!hasDocker)("Stripe's spec takes every call", () => {
  it("a price and its link", async () => {
    const price = await api().createPrice({
      id: "00000000-0000-4000-8000-000000000001",
      cents: 4900,
      currency: "usd",
      description: "Filter swap",
    });
    expect(price.id).toMatch(/^price_/);
    const link = await api().createPaymentLink({
      id: "00000000-0000-4000-8000-000000000001",
      client: "acme",
      price: price.id,
      quantity: 2,
    });
    expect(link.id).toMatch(/^plink_/);
    expect(link.url).toMatch(/^https:\/\//);
  });

  it("the webhook: made on our version with every event, read, and widened", async () => {
    const e = await api().registerWebhook({
      client: "acme",
      url: "https://app.wren.test/__pay/stripe/acme",
      idem: "test-1",
    });
    expect(e.id).toMatch(/^we_/);
    expect(Array.isArray(await api().webhookEvents(e.id))).toBe(true);
    await api().setWebhookEvents(e.id, STRIPE_EVENTS);
  });

  it("reconcile's reads: a link's sessions, a payment with its charge, its disputes", async () => {
    const sessions = await api().sessionsOf("plink_test_1");
    expect(sessions[0]).toMatchObject({ id: expect.stringMatching(/^cs_/) });
    const pay = await api().paymentOf("pi_test_1");
    expect(pay).toMatchObject({
      status: expect.any(String),
      received: expect.any(Number),
      refunded: expect.any(Number),
      disputed: expect.any(Boolean),
    });
    const disputes = await api().disputesOf("pi_test_1");
    expect(disputes[0]).toMatchObject({ id: expect.stringMatching(/^dp_/) });
  });

  it("a request Stripe's spec refuses is Stripe's refusal, not a retry", async () => {
    const err = await api()
      .setWebhookEvents("we_test_1", ["charge.not_an_event"])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(err).toMatchObject({ status: 400, transient: false });
  });
});
