/**
 * Payments through Restate, every step replayed (`alwaysReplay`): Stripe's 5xx and dropped
 * connections retried with the same idempotency keys and never marked failed; Stripe's refusal
 * and a Stripe down past the retry window failing the link once, saying why; a webhook taken
 * twice telling the spine once; a refund telling it again. A fake Stripe and a recorder for
 * the spine, synthetic data, no network, no charge.
 */

import * as restate from "@restatedev/restate-sdk";
import * as restateClients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { smsContacts } from "@wren/channel-sms/schema";
import { addClient, addOperator, clients } from "@wren/core/clients";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import type { Fired } from "@wren/core/spine";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PAY_LINKS } from "../../src/components.js";
import { paymentsConsoleApi } from "../../src/console.js";
import { makePayments, type PaymentsDeps, type PaymentsService } from "../../src/service.js";
import { createLink, keepStripeLink, linkById, markSent } from "../../src/store.js";
import { type Fetch, signFor } from "../../src/stripe.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
let acme: Db;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
let keys: ReturnType<typeof pgKeyStore>;
const KEY = "rk_test_fixture00000000";
const SECRET = "whsec_fixture000000000000";
const NOW = new Date("2026-10-14T15:00:00Z");
let contact = 0;

/** Stripe's writes as they arrived: path and idempotency key. */
let writes: { path: string; key: string | null }[] = [];
/** How many more calls to a path fail, and how. */
let trouble: Record<string, { left: number; status: number }> = {};
const fakeStripe: Fetch = async (url, init) => {
  const path = new URL(url).pathname;
  writes.push({ path, key: new Headers(init.headers).get("idempotency-key") });
  const t = trouble[path];
  if (t && t.left > 0) {
    t.left -= 1;
    if (t.status === 0) throw new TypeError("fetch failed");
    return Response.json(
      { error: { type: t.status >= 500 ? "api_error" : "invalid_request_error", message: "No" } },
      { status: t.status },
    );
  }
  if (path === "/v1/webhook_endpoints")
    return Response.json({ id: "we_test_1", secret: SECRET, livemode: false });
  if (path === "/v1/prices") return Response.json({ id: "price_test_1", livemode: false });
  if (path === "/v1/payment_links")
    return Response.json({
      id: "plink_test_r",
      url: "https://buy.stripe.com/test_r",
      livemode: false,
    });
  return Response.json({ error: { message: "?" } }, { status: 404 });
};

/** The spine, as a recorder: what Payments told it, once per journaled send. */
const heard: Fired[] = [];
const ear = restate.service({
  name: "Ear",
  handlers: {
    hear: async (_ctx: restate.Context, f: Fired) => {
      heard.push(f);
    },
  },
});
const mail: { to: string; subject: string }[] = [];
const deps = (): PaymentsDeps => ({
  main: pg.db,
  open,
  keys,
  fetch: fakeStripe,
  portal: "https://app.wren.test",
  mailer: () => async (m) => {
    mail.push({ to: m.to, subject: m.subject });
  },
  fire: (ctx, f) => ctx.serviceSendClient<typeof ear>({ name: "Ear" }).hear(f),
  stripeRetry: { maxRetryDuration: 4_000, initialRetryInterval: 50, maxRetryInterval: 200 },
});
const payments = () =>
  restateClients
    .connect({ url: env.baseUrl() })
    .serviceClient<PaymentsService>({ name: "Payments" });
const until = async (ok: () => boolean, ms = 5_000) => {
  for (const end = Date.now() + ms; Date.now() < end; )
    if (ok()) return;
    else await new Promise((r) => setTimeout(r, 50));
};
const emailLink = (description: string) =>
  createLink(pg.db, {
    client: "acme",
    channel: "email",
    email: "sam@example.test",
    name: "Sam Rivera",
    description,
    cents: 4900,
    by: "ada@example.test",
    approved: true,
    now: NOW,
  });

beforeAll(async () => {
  pg = await startTestPostgres();
  keys = pgKeyStore(pg.db, throwawayRing());
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
  await addOperator(pg.db, "ada@example.test");
  await pg.db
    .update(clients)
    .set({ sends: [PAY_LINKS] })
    .where(eq(clients.id, "acme"));
  acme = open({ id: "acme" });
  const [c] = await acme
    .insert(smsContacts)
    .values({ e164: "+12125550143", sourceKind: "form", basis: "opt_in", name: "Sam Rivera" })
    .returning({ id: smsContacts.id });
  contact = c?.id ?? 0;
  const keyRef = (
    await keys.stage({
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: KEY,
      by: "ada@example.test",
    })
  ).ref;
  await paymentsConsoleApi({ ...deps(), portal: "https://app.wren.test" }).connect(
    { viewer: { email: "ada@example.test", operator: true } as never, client: "acme", keyRef },
    NOW,
  );
  env = await startTestRestate({ services: [makePayments(deps()), ear], alwaysReplay: true });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(() => {
  writes = [];
  trouble = {};
  mail.length = 0;
  heard.length = 0;
});

describe("Payments/send", () => {
  it("Stripe's 5xx and a dropped connection: retried with the same key, sent once", async () => {
    const l = await emailLink("Filter swap");
    // Past the SDK's own two retries, so Restate's step retries too.
    trouble["/v1/payment_links"] = { left: 4, status: 500 };
    trouble["/v1/prices"] = { left: 1, status: 0 };
    expect(await payments().send({ id: l.id })).toEqual({ sent: true });
    const links = writes.filter((w) => w.path === "/v1/payment_links");
    expect(links.length).toBe(5);
    expect(new Set(links.map((w) => w.key))).toEqual(new Set([`wren-link-${l.id}`]));
    expect(new Set(writes.filter((w) => w.path === "/v1/prices").map((w) => w.key))).toEqual(
      new Set([`wren-price-${l.id}`]),
    );
    expect(await linkById(pg.db, l.id)).toMatchObject({
      status: "sent",
      stripeLink: "plink_test_r",
      why: null,
    });
    expect(mail).toEqual([{ to: "sam@example.test", subject: "Filter swap: $49.00" }]);
    // Sent again by mistake: not `sending`, so nothing happens.
    expect(await payments().send({ id: l.id })).toEqual({ sent: false });
    expect(mail).toHaveLength(1);
  });

  it("Stripe's refusal fails the link at once, saying why", async () => {
    const l = await emailLink("Service call");
    trouble["/v1/prices"] = { left: 99, status: 400 };
    const r = await payments().send({ id: l.id });
    expect(r).toMatchObject({ sent: false, why: "Stripe: No" });
    expect(writes.filter((w) => w.path === "/v1/prices")).toHaveLength(1);
    expect(await linkById(pg.db, l.id)).toMatchObject({ status: "failed", why: "Stripe: No" });
    expect(mail).toEqual([]);
  });

  it("Stripe down past the retry window: failed, never charged or sent", async () => {
    const l = await emailLink("Water heater");
    trouble["/v1/prices"] = { left: 10_000, status: 503 };
    const r = await payments().send({ id: l.id });
    expect(r.sent).toBe(false);
    expect((await linkById(pg.db, l.id))?.status).toBe("failed");
    expect(writes.filter((w) => w.path === "/v1/payment_links")).toEqual([]);
    expect(mail).toEqual([]);
  }, 30_000);
});

describe("Payments/stripe", () => {
  const evt = (id: string, type: string, object: Record<string, unknown>) =>
    JSON.stringify({ id, type, created: 1_790_000_000, livemode: false, data: { object } });
  const hook = (raw: string) =>
    payments().stripe({ client: "acme", raw, signature: signFor(raw, SECRET, new Date()) });

  it("taken twice, the spine hears paid once; a refund, once more", async () => {
    const l = await createLink(pg.db, {
      client: "acme",
      channel: "sms",
      contact,
      name: "Sam Rivera",
      description: "Drain clear",
      cents: 4900,
      by: "ada@example.test",
      approved: true,
      now: NOW,
    });
    await keepStripeLink(pg.db, l.id, {
      stripeLink: "plink_test_hook",
      url: "https://buy.stripe.com/test_hook",
      live: false,
    });
    await markSent(pg.db, l.id, { message: null, now: NOW });
    const paid = evt("evt_test_r1", "checkout.session.completed", {
      id: "cs_test_hook",
      payment_link: "plink_test_hook",
      payment_intent: "pi_test_hook",
      payment_status: "paid",
      amount_total: 4900,
      currency: "usd",
    });
    expect(await hook(paid)).toEqual({ status: 200, result: "paid" });
    expect(await hook(paid)).toEqual({ status: 200, result: "seen" });
    await until(() => heard.length >= 1);
    const paidMark = async () =>
      (await acme.select().from(smsContacts).where(eq(smsContacts.id, contact)))[0]?.paidCents;
    expect(await paidMark()).toBe(4900);
    const refund = evt("evt_test_r2", "charge.refunded", {
      id: "ch_test_hook",
      payment_intent: "pi_test_hook",
      amount_refunded: 4900,
    });
    expect(await hook(refund)).toEqual({ status: 200, result: "refunded" });
    await until(() => heard.length >= 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(heard.map((f) => [(f.facts as { change?: string }).change, f.event.subject])).toEqual([
      ["paid", `payment:${l.id}`],
      ["refunded", `payment:${l.id}:refunded`],
    ]);
    expect(await paidMark()).toBeNull();
    expect((await linkById(pg.db, l.id))?.status).toBe("refunded");
  });

  it("a forged body is refused before anything is kept", async () => {
    const raw = evt("evt_test_r3", "checkout.session.completed", { id: "cs_x" });
    const r = await payments().stripe({
      client: "acme",
      raw,
      signature: signFor(raw, "whsec_wrong0000", new Date()),
    });
    expect(r.status).toBe(400);
  });
});
