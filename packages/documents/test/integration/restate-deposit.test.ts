/**
 * A signed estimate's deposit through Restate, every step replayed (`alwaysReplay`): Stripe's
 * 5xx retried on the same idempotency keys, one link however often it's clicked, two clicks at
 * once sharing it, and the page following the link's money both ways (paid, clearing,
 * refunded; a failed bank payment gets a new link). A fake Stripe, synthetic data, no network,
 * no charge. Calls go to Restate's ingress by plain HTTP.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { addClient, addOperator } from "@wren/core/clients";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { paymentsConsoleApi } from "@wren/payments/console";
import { payLinks } from "@wren/payments/schema";
import type { Fetch } from "@wren/payments/stripe";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documentsConsoleApi } from "../../src/console.js";
import { type Answer, type DocumentsDeps, makeDocuments } from "../../src/service.js";
import { docById, issueLink, markSent, signDoc } from "../../src/store.js";

let pg: TestPostgres;
let env: Awaited<ReturnType<typeof startTestRestate>>;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
let keys: ReturnType<typeof pgKeyStore>;
const KEY = "rk_test_fixture00000000";
const ADA = { viewer: { email: "ada@example.test", operator: true } as never, client: "acme" };
let doc = "";
let token = "";

let writes: { path: string; key: string | null }[] = [];
let failLinks = 0;
let made = 0;
const byKey = new Map<string, number>();
const fakeStripe: Fetch = async (url, init) => {
  const path = new URL(url).pathname;
  writes.push({ path, key: new Headers(init.headers).get("idempotency-key") });
  if (path === "/v1/webhook_endpoints")
    return Response.json({ id: "we_test_1", secret: "whsec_fixture000000000000", livemode: false });
  if (path === "/v1/prices") return Response.json({ id: "price_test_1", livemode: false });
  if (path === "/v1/payment_links") {
    if (failLinks > 0) {
      failLinks -= 1;
      return Response.json({ error: { type: "api_error", message: "down" } }, { status: 500 });
    }
    // Stripe answers a repeated idempotency key with the first answer, as here.
    const key = new Headers(init.headers).get("idempotency-key") ?? "";
    if (!byKey.has(key)) {
      made += 1;
      byKey.set(key, made);
    }
    const n = byKey.get(key);
    return Response.json({
      id: `plink_test_${n}`,
      url: `https://buy.stripe.com/test_${n}`,
      livemode: false,
    });
  }
  return Response.json({ error: { message: "?" } }, { status: 404 });
};
const deps = (): DocumentsDeps => ({
  main: pg.db,
  open,
  keys,
  fetch: fakeStripe,
  portal: "https://app.wren.test",
  mailer: null,
  stripeRetry: { maxRetryDuration: 4_000, initialRetryInterval: 50, maxRetryInterval: 200 },
});
const call = async (handler: string): Promise<Answer> => {
  const r = await fetch(`${env.baseUrl()}/Documents/${handler}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "acme", token, bot: true }),
  });
  if (!r.ok) throw new Error(`${handler}: ${r.status} ${await r.text()}`);
  return (await r.json()) as Answer;
};
const linkOf = async () => (await docById(pg.db, doc))?.payLink ?? null;
const setStatus = async (status: string) => {
  const id = await linkOf();
  if (!id) throw new Error("no deposit link");
  await pg.db.update(payLinks).set({ status }).where(eq(payLinks.id, id));
};

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  keys = pgKeyStore(pg.db, throwawayRing());
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Air", products: {} });
  await addOperator(pg.db, "ada@example.test");
  const [c] = await open({ id: "acme" })
    .insert(smsContacts)
    .values({
      e164: "+12125550143",
      sourceKind: "form",
      basis: "opt_in",
      name: "Sam Rivera",
      email: "sam@example.test",
    })
    .returning({ id: smsContacts.id });
  const now = new Date();
  const docs = documentsConsoleApi({ main: pg.db, open });
  const d = await docs.create(
    {
      ...ADA,
      kind: "estimate",
      contact: c?.id ?? 0,
      lines: [{ name: "Tune-up", price: 149 }],
      depositPct: 25,
    } as never,
    now,
  );
  doc = d.doc.id;
  await docs.send({ ...ADA, id: doc }, now);
  token = await issueLink(pg.db, doc, now);
  await markSent(pg.db, doc, { message: 7, by: "ada@example.test", now });
  const sent = (await docById(pg.db, doc)) as never as Parameters<typeof signDoc>[1];
  await signDoc(pg.db, sent, {
    name: "Sam Rivera",
    email: "sam@example.test",
    consent: "yes",
    sha: sent.sha256,
    now,
  });
  const keyRef = (
    await keys.stage({
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: KEY,
      by: "ada@example.test",
    })
  ).ref;
  await paymentsConsoleApi(deps()).connect({ ...ADA, keyRef }, now);
  env = await startTestRestate({ services: [makeDocuments(deps())], alwaysReplay: true });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(() => {
  writes = [];
  failLinks = 0;
});

describe("the deposit", () => {
  it("Stripe's 5xx: retried on the same key; one link, however often it's clicked", async () => {
    failLinks = 4;
    const first = await call("deposit");
    expect(first).toMatchObject({ status: 303, location: "https://buy.stripe.com/test_1" });
    const keys = new Set(writes.filter((w) => w.path === "/v1/payment_links").map((w) => w.key));
    const id = await linkOf();
    expect(keys).toEqual(new Set([`wren-link-${id}`]));
    expect((await call("deposit")).location).toBe(first.location);
    const rows = await pg.db.select().from(payLinks).where(eq(payLinks.document, doc));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", amountCents: expect.any(Number) });
  });

  it("the page follows the link's money, both ways", async () => {
    await setStatus("processing");
    expect((await call("serve")).html).toContain("still clearing");
    expect((await call("deposit")).status).toBe(200);
    await setStatus("paid");
    expect((await call("serve")).html).toContain("Deposit paid.");
    await setStatus("refunded");
    const page = (await call("serve")).html ?? "";
    expect(page).toContain("Deposit refunded.");
    expect(page).not.toContain("Deposit paid.");
    expect(writes.filter((w) => w.path === "/v1/payment_links")).toEqual([]);
  });

  it("a failed bank payment: a new link takes its place, once, even clicked twice at once", async () => {
    await setStatus("unpaid");
    const old = await linkOf();
    const [a, b] = await Promise.all([call("deposit"), call("deposit")]);
    expect(a.status).toBe(303);
    expect(b.status).toBe(303);
    const now = await linkOf();
    expect(now).not.toBe(old);
    const rows = await pg.db.select().from(payLinks).where(eq(payLinks.document, doc));
    const live = rows.filter((r) => r.status === "sent");
    expect(live.map((r) => r.id)).toEqual([now]);
    // Whichever click lost let its own row go, never sent.
    for (const r of rows.filter((x) => x.id !== now && x.id !== old))
      expect(r).toMatchObject({ status: "failed", stripeLink: null });
    expect(a.location).toBe(live[0]?.url);
    expect(b.location).toBe(live[0]?.url);
  });
});
