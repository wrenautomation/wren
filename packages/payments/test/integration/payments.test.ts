/**
 * Text-to-pay on a real Postgres (designs/2026-10-07-forms-and-pay.md): connect Stripe with a
 * fake Stripe, make links (approved or waiting by the client's approver), approve, and take
 * Stripe's signed webhook: the link and the thread marked paid, once. Keys go through the key
 * store by ref, as the portal stages them. No network, no charge. Synthetic data only.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { addClient, addOperator, clients } from "@wren/core/clients";
import { clientAccounts } from "@wren/core/setup-schema";
import { vendorModes } from "@wren/core/vendor-schema";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { clientSecretEvents } from "@wren/core/keys-schema";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paymentsConsoleApi } from "../../src/console.js";
import { payLinks } from "../../src/schema.js";
import { stripeKeyOf, takeWebhook } from "../../src/service.js";
import { keepStripeLink, payAccountOf, payApprovalId, waitingPayLinks } from "../../src/store.js";
import { type Fetch, signFor } from "../../src/stripe.js";

let pg: TestPostgres;
let acme: Db;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
let keys: ReturnType<typeof pgKeyStore>;
// Synthetic Stripe: a made-up key and signing secret.
const KEY = "rk_test_fixture00000000";
const SECRET = "whsec_fixture000000000000";
const NOW = new Date("2026-10-07T15:00:00Z");
const ADA = { viewer: { email: "ada@example.test", operator: true } as never, client: "acme" };
let stripe: { url: string; body: string }[] = [];
let stripeSays: (url: string) => Response;
const fakeStripe: Fetch = async (url, init) => {
  stripe.push({ url, body: String(init.body) });
  return stripeSays(url);
};
const api = () =>
  paymentsConsoleApi({
    main: pg.db,
    open,
    keys,
    fetch: fakeStripe,
    portal: "https://app.wren.test",
  });
let contact = 0;
/** What the portal does first: the key to the store, a ref back. */
const staged = async (client: string, name: string, value: string) =>
  (await keys.stage({ client, name, value, by: ADA.viewer.email })).ref;

beforeAll(async () => {
  pg = await startTestPostgres();
  keys = pgKeyStore(pg.db, throwawayRing());
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
  await addOperator(pg.db, "ada@example.test");
  acme = open({ id: "acme" });
  const [c] = await acme
    .insert(smsContacts)
    .values({
      e164: "+12125550143",
      sourceKind: "form",
      basis: "opt_in",
      name: "Sam Rivera",
      email: "sam@example.test",
    })
    .returning({ id: smsContacts.id });
  contact = c?.id ?? 0;
});
afterAll(() => pg.stop());

describe("connecting Stripe", () => {
  it("saves the key and adds the webhook with it", async () => {
    stripe = [];
    stripeSays = () =>
      Response.json({ id: "we_test_1", secret: SECRET, livemode: false }, { status: 200 });
    const keyRef = await staged("acme", "STRIPE_SECRET_KEY", KEY);
    const r = await api().connect({ ...ADA, keyRef }, NOW);
    expect(r).toMatchObject({ connected: true, webhook: "api", last4: KEY.slice(-4) });
    expect(stripe[0]?.url).toBe("https://api.stripe.com/v1/webhook_endpoints");
    expect(decodeURIComponent(stripe[0]?.body ?? "")).toContain(
      "url=https://app.wren.test/__pay/stripe/acme",
    );
    const acct = await payAccountOf(pg.db, "acme");
    if (!acct?.secretName) throw new Error("no secret kept");
    expect(
      await keys.get({ ref: acct.secretName, client: "acme", by: "test", why: "check" }),
    ).toBe(SECRET);
    expect(acct).toMatchObject({ endpoint: "we_test_1", how: "api", live: false });
    const [m] = await pg.db.select().from(vendorModes).where(eq(vendorModes.client, "acme"));
    expect(m).toMatchObject({ vendor: "stripe", mode: "own", keyName: keyRef });
    const accts = await pg.db
      .select()
      .from(clientAccounts)
      .where(eq(clientAccounts.site, "stripe"));
    expect(accts.map((a) => a.ref)).toEqual(["Stripe (test mode)"]);
    const s = await api().status(ADA);
    expect(s).toMatchObject({
      connected: true,
      webhook: "api",
      live: false,
      approves: true,
      last4: KEY.slice(-4),
    });
    // Payments/send reads it by the row's ref.
    expect(await stripeKeyOf({ main: pg.db, keys }, "acme", "make a link")).toBe(KEY);
    // Each read and write logged, never with the value.
    const log = await pg.db.select().from(clientSecretEvents);
    expect(log.map((e) => e.op)).toEqual(expect.arrayContaining(["stage", "bind", "read", "put"]));
    expect(JSON.stringify(log)).not.toContain(KEY);
    expect(JSON.stringify(log)).not.toContain(SECRET);
  });

  it("asks for the signing secret when the key can't add webhooks", async () => {
    stripeSays = () =>
      Response.json({ error: { message: "The provided key lacks permission" } }, { status: 403 });
    const keyRef = await staged("beta", "STRIPE_SECRET_KEY", KEY);
    const r = await api().connect({ ...ADA, client: "beta", keyRef }, NOW);
    expect(r).toMatchObject({ connected: true, webhook: null });
    expect(r.why).toContain("paste its signing secret");
    await expect(staged("beta", "STRIPE_WEBHOOK_SECRET", "nope")).rejects.toThrow("whsec_");
    const secretRef = await staged("beta", "STRIPE_WEBHOOK_SECRET", SECRET);
    const ok = await api().connect({ ...ADA, client: "beta", secretRef }, NOW);
    expect(ok).toMatchObject({ webhook: "pasted" });
    await expect(staged("acme", "STRIPE_SECRET_KEY", "pk_test_00000000000")).rejects.toThrow(
      "sk_ or rk_",
    );
  });

  it("refuses a ref that isn't this client's, or one already gone", async () => {
    const keyRef = await staged("acme", "STRIPE_SECRET_KEY", KEY);
    await expect(api().connect({ ...ADA, client: "beta", keyRef }, NOW)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      api().connect({ ...ADA, keyRef: `ks_${"0".repeat(32)}` }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("making and approving links", () => {
  it("sends at once for an approver, waits for anyone else", async () => {
    const made = await api().create(
      { ...ADA, phone: "(212) 555-0143", amount: "49", description: "Filter swap" },
      NOW,
    );
    expect(made.links[0]).toMatchObject({
      status: "sending",
      channel: "sms",
      contact,
      name: "Sam Rivera",
      amountCents: 4900,
    });
    await expect(
      api().create({ ...ADA, phone: "+12125550199", amount: "49", description: "x" }, NOW),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      api().create({ ...ADA, email: "a@example.test", amount: "0.10", description: "x" }, NOW),
    ).rejects.toMatchObject({ status: 400 });

    // The client approves its own sends: Wren's team's link waits, and can't say yes.
    await pg.db.update(clients).set({ approver: "client" }).where(eq(clients.id, "acme"));
    const waiting = await api().fromThread(
      { ...ADA, ids: [contact], amount: "120.00", description: "Service call", quantity: 2 },
      NOW,
    );
    const id = waiting.links[0]?.id ?? "";
    expect(waiting.links[0]).toMatchObject({ status: "waiting", quantity: 2 });
    expect((await waitingPayLinks(pg.db)).map((w) => w.id)).toEqual([id]);
    await expect(api().approve({ ...ADA, ids: [payApprovalId(id)] }, NOW)).rejects.toMatchObject({
      status: 403,
    });
    await pg.db.update(clients).set({ approver: "wren" }).where(eq(clients.id, "acme"));
    const yes = await api().approve({ ...ADA, ids: [payApprovalId(id)] }, NOW);
    expect(yes.links.map((l) => l.status)).toEqual(["sending"]);
    // A second yes changes nothing.
    expect((await api().approve({ ...ADA, ids: [id] }, NOW)).links).toEqual([]);
  });

  it("lists one client's links only", async () => {
    const page = await api().recordsList({ ...ADA, record: "payments.link" } as never);
    expect(page.rows.length).toBe(2);
    expect(page.rows.map((r) => r.amount)).toContainEqual({ amount: 49, currency: "USD" });
    const beta = await api().recordsList({
      ...ADA,
      client: "beta",
      record: "payments.link",
    } as never);
    expect(beta.rows).toEqual([]);
  });
});

describe("Stripe's webhook", () => {
  const event = (id: string, link: string, amount = 4900) =>
    JSON.stringify({
      id,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: `cs_${id}`,
          payment_link: link,
          payment_status: "paid",
          amount_total: amount,
          currency: "usd",
          metadata: {},
          customer_details: { email: "sam@example.test" },
        },
      },
    });
  const deps = () => ({ main: pg.db, open, keys });

  it("marks the link and the thread paid, once", async () => {
    const [l] = await pg.db.select().from(payLinks).where(eq(payLinks.amountCents, 4900));
    if (!l) throw new Error("no link");
    await keepStripeLink(pg.db, l.id, {
      stripeLink: "plink_test_1",
      url: "https://buy.stripe.com/test_1",
      live: false,
    });
    const raw = event("evt_test_1", "plink_test_1");
    const got = await takeWebhook(
      deps(),
      { client: "acme", raw, signature: signFor(raw, SECRET, NOW) },
      NOW,
    );
    expect(got).toMatchObject({ status: 200, result: "paid" });
    expect(got.paid).toMatchObject({
      id: l.id,
      status: "paid",
      paidCents: 4900,
      session: "cs_evt_test_1",
    });
    const [c] = await acme.select().from(smsContacts).where(eq(smsContacts.id, contact));
    expect(c?.paidCents).toBe(4900);
    // Stripe retries: kept once, nothing marked twice.
    const again = await takeWebhook(
      deps(),
      { client: "acme", raw, signature: signFor(raw, SECRET, NOW) },
      NOW,
    );
    expect(again).toMatchObject({ status: 200, result: "seen", paid: null });
    const [c2] = await acme.select().from(smsContacts).where(eq(smsContacts.id, contact));
    expect(c2?.paidCents).toBe(4900);
  });

  it("refuses a bad signature, an unknown client; keeps an unknown link's event", async () => {
    const raw = event("evt_test_2", "plink_nobody");
    expect(
      (
        await takeWebhook(
          deps(),
          { client: "acme", raw, signature: signFor(raw, "whsec_wrong0000", NOW) },
          NOW,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await takeWebhook(
          deps(),
          { client: "nobody", raw, signature: signFor(raw, SECRET, NOW) },
          NOW,
        )
      ).status,
    ).toBe(404);
    const unknown = await takeWebhook(
      deps(),
      { client: "acme", raw, signature: signFor(raw, SECRET, NOW) },
      NOW,
    );
    expect(unknown).toMatchObject({ status: 200, result: "unknown", paid: null });
    // Another client's link is never matched from this client's endpoint.
    const theirs = event("evt_test_3", "plink_test_1");
    const cross = await takeWebhook(
      deps(),
      { client: "beta", raw: theirs, signature: signFor(theirs, SECRET, NOW) },
      NOW,
    );
    expect(cross).toMatchObject({ status: 200, result: "unknown" });
  });
});
