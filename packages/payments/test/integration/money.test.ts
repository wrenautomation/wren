/**
 * A link's money on a real Postgres, the way Stripe really sends it: at least once, in any
 * order, and with our worker dying between steps (designs/2026-10-07-forms-and-pay.md, "Durable
 * payments"). Signed webhooks replayed, duplicated and reordered; a crash after the event is
 * kept; the thread's paid mark and the spine following refunds both ways; a failed bank payment
 * asked again; and reconcile healing what a dropped webhook missed and flagging what it can't.
 * A fake Stripe, synthetic data, no network, no charge.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { addClient, addOperator, clients } from "@wren/core/clients";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { paymentsConsoleApi } from "../../src/console.js";
import { reconcileAll } from "../../src/reconcile.js";
import { payEvents, payLinks } from "../../src/schema.js";
import { settleLink, takeWebhook } from "../../src/service.js";
import {
  claimChanges,
  createLink,
  keepStripeLink,
  linkById,
  linkIdFor,
  markSent,
} from "../../src/store.js";
import { type Fetch, signFor } from "../../src/stripe.js";

let pg: TestPostgres;
let acme: Db;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
let keys: ReturnType<typeof pgKeyStore>;
// Synthetic Stripe: a made-up key, signing secret and ids.
const KEY = "rk_test_fixture00000000";
const SECRET = "whsec_fixture000000000000";
const NOW = new Date("2026-10-14T15:00:00Z");
const ADA = { viewer: { email: "ada@example.test", operator: true } as never, client: "acme" };
let contact = 0;

/** A fake Stripe for reconcile: answers by path from `world`, records every call. */
interface World {
  sessions: Record<string, unknown[]>;
  intents: Record<string, unknown>;
  disputes: Record<string, unknown[]>;
  endpoint: { id: string; enabled_events: string[] };
}
let world: World;
let calls: { method: string; path: string }[] = [];
const fakeStripe: Fetch = async (url, init) => {
  const u = new URL(url);
  const method = init.method ?? "GET";
  calls.push({ method, path: u.pathname });
  const list = (data: unknown[]) =>
    Response.json({ object: "list", data, has_more: false, url: u.pathname });
  if (u.pathname === "/v1/webhook_endpoints" && method === "POST")
    return Response.json({ id: "we_test_1", secret: SECRET, livemode: false });
  if (u.pathname === `/v1/webhook_endpoints/${world.endpoint.id}`) {
    if (method === "POST") {
      const body = new URLSearchParams(String(init.body));
      world.endpoint.enabled_events = [...body.entries()]
        .filter(([k]) => k.startsWith("enabled_events"))
        .map(([, v]) => v);
    }
    return Response.json({ object: "webhook_endpoint", ...world.endpoint });
  }
  if (u.pathname === "/v1/checkout/sessions")
    return list(world.sessions[u.searchParams.get("payment_link") ?? ""] ?? []);
  if (u.pathname.startsWith("/v1/payment_intents/")) {
    const pi = world.intents[u.pathname.split("/").pop() ?? ""];
    return pi
      ? Response.json(pi)
      : Response.json(
          { error: { type: "invalid_request_error", message: "No such" } },
          {
            status: 404,
          },
        );
  }
  if (u.pathname === "/v1/disputes")
    return list(world.disputes[u.searchParams.get("payment_intent") ?? ""] ?? []);
  return Response.json({ error: { type: "invalid_request_error", message: "?" } }, { status: 404 });
};
const deps = () => ({ main: pg.db, open, keys, fetch: fakeStripe });
const api = () => paymentsConsoleApi({ ...deps(), portal: "https://app.wren.test" });

/** Stripe's events, as the webhook body carries them. */
let seq = 0;
const evt = (type: string, object: Record<string, unknown>, created?: number) =>
  JSON.stringify({
    id: `evt_test_${++seq}`,
    type,
    created: created ?? 1_790_000_000 + seq,
    livemode: false,
    data: { object },
  });
const checkout = (plink: string, o: Record<string, unknown> = {}) =>
  evt("checkout.session.completed", {
    id: `cs_test_${plink}`,
    payment_link: plink,
    payment_intent: `pi_test_${plink}`,
    payment_status: "paid",
    amount_total: 4900,
    currency: "usd",
    metadata: {},
    customer_details: { email: "sam@example.test" },
    ...o,
  });
const refunded = (plink: string, total: number) =>
  evt("charge.refunded", {
    id: `ch_test_${plink}`,
    payment_intent: `pi_test_${plink}`,
    amount: 4900,
    amount_refunded: total,
    status: "succeeded",
  });
const disputed = (plink: string, type: string, status: string, created: number) =>
  evt(
    type,
    { id: `dp_test_${plink}`, payment_intent: `pi_test_${plink}`, amount: 4900, status },
    created,
  );
const hook = (raw: string) =>
  takeWebhook(deps(), { client: "acme", raw, signature: signFor(raw, SECRET, NOW) }, NOW);

/** A link out on Stripe as `plink`, to Sam's thread. */
const linkOut = async (plink: string) => {
  const l = await createLink(pg.db, {
    client: "acme",
    channel: "sms",
    contact,
    name: "Sam Rivera",
    description: "Filter swap",
    cents: 4900,
    by: "ada@example.test",
    approved: true,
    now: NOW,
  });
  await keepStripeLink(pg.db, l.id, {
    stripeLink: plink,
    url: `https://buy.stripe.com/${plink}`,
    live: false,
  });
  await markSent(pg.db, l.id, { message: null, now: NOW });
  return l.id;
};
const paidMark = async () =>
  (await acme.select().from(smsContacts).where(eq(smsContacts.id, contact)))[0]?.paidCents ?? null;

beforeAll(async () => {
  pg = await startTestPostgres();
  keys = pgKeyStore(pg.db, throwawayRing());
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
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
  world = {
    sessions: {},
    intents: {},
    disputes: {},
    endpoint: { id: "we_test_1", enabled_events: ["checkout.session.completed"] },
  };
  const keyRef = (
    await keys.stage({
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: KEY,
      by: "ada@example.test",
    })
  ).ref;
  await api().connect({ ...ADA, keyRef }, NOW);
});
afterAll(() => pg.stop());
beforeEach(async () => {
  calls = [];
  // Each test starts with Sam's thread unpaid and no links.
  await pg.db.execute(sql`delete from pay_events; delete from pay_links`);
  await acme.update(smsContacts).set({ paidCents: null, paidAt: null });
});

describe("duplicates and replays", () => {
  it("the same event many times at once: kept once, paid once", async () => {
    const id = await linkOut("plink_dup");
    const raw = checkout("plink_dup");
    const got = await Promise.all([hook(raw), hook(raw), hook(raw), hook(raw)]);
    expect(got.filter((g) => g.result === "paid")).toHaveLength(1);
    expect(got.filter((g) => g.result === "seen")).toHaveLength(3);
    expect(got.every((g) => g.link === id)).toBe(true);
    const events = await pg.db.select().from(payEvents).where(eq(payEvents.link, id));
    expect(events).toHaveLength(1);
    await Promise.all([settleLink(deps(), id), settleLink(deps(), id)]);
    expect(await paidMark()).toBe(4900);
  });
  it("a whole history replayed changes nothing", async () => {
    const id = await linkOut("plink_replay");
    const history = [checkout("plink_replay"), refunded("plink_replay", 1000)];
    for (const raw of history) await hook(raw);
    const before = await linkById(pg.db, id);
    for (const raw of [...history, ...history]) expect((await hook(raw)).result).toBe("seen");
    expect(await linkById(pg.db, id)).toEqual(before);
    expect(before).toMatchObject({ status: "paid", refundedCents: 1000 });
  });
});

describe("out of order", () => {
  it("a refund before its checkout is kept, then applied once the payment is known", async () => {
    const id = await linkOut("plink_early");
    const early = await hook(refunded("plink_early", 4900));
    expect(early).toMatchObject({ result: "unknown", link: null });
    const paid = await hook(checkout("plink_early"));
    expect(paid.link).toBe(id);
    expect(await linkById(pg.db, id)).toMatchObject({
      status: "refunded",
      paidCents: 4900,
      refundedCents: 4900,
      intent: "pi_test_plink_early",
    });
    const kept = await pg.db.select().from(payEvents).where(eq(payEvents.link, id));
    expect(kept.map((e) => e.result).sort()).toEqual(["paid", "refunded"]);
  });
  it("a dispute closed before it was opened ends lost", async () => {
    const id = await linkOut("plink_dispute");
    await hook(checkout("plink_dispute"));
    await hook(disputed("plink_dispute", "charge.dispute.closed", "lost", 1_800_000_300));
    await hook(
      disputed("plink_dispute", "charge.dispute.created", "needs_response", 1_800_000_100),
    );
    await hook(disputed("plink_dispute", "charge.dispute.updated", "under_review", 1_800_000_200));
    expect(await linkById(pg.db, id)).toMatchObject({ status: "refunded", dispute: "lost" });
  });
  it("a bank payment's success before its checkout: paid, never back to processing", async () => {
    const id = await linkOut("plink_bank");
    await hook(
      evt("checkout.session.async_payment_succeeded", {
        id: "cs_test_bank",
        payment_link: "plink_bank",
        payment_intent: "pi_test_bank",
        payment_status: "paid",
        amount_total: 4900,
      }),
    );
    await hook(checkout("plink_bank", { payment_status: "unpaid" }));
    expect((await linkById(pg.db, id))?.status).toBe("paid");
  });
});

describe("after a crash", () => {
  it("the event kept but the step cut short: Stripe's resend finishes the thread mark", async () => {
    const id = await linkOut("plink_crash");
    const raw = checkout("plink_crash");
    await hook(raw); // "apply" journaled; the worker dies before "settle".
    expect(await paidMark()).toBeNull();
    const resend = await hook(raw);
    expect(resend).toMatchObject({ result: "seen", link: id });
    await settleLink(deps(), id);
    expect(await paidMark()).toBe(4900);
  });
  it("a retried insert finds its row: one link per id", async () => {
    const id = linkIdFor("seed-1", 7);
    expect(linkIdFor("seed-1", 7)).toBe(id);
    expect(linkIdFor("seed-1", 8)).not.toBe(id);
    const ask = {
      id,
      client: "acme",
      channel: "email" as const,
      email: "sam@example.test",
      description: "Filter swap",
      cents: 4900,
      by: "ada@example.test",
      now: NOW,
    };
    const [a, b] = await Promise.all([createLink(pg.db, ask), createLink(pg.db, ask)]);
    expect(a.id).toBe(id);
    expect(b.id).toBe(id);
    expect(await pg.db.select().from(payLinks).where(eq(payLinks.id, id))).toHaveLength(1);
  });
  it("the spine hears each change once: a retried claim gets its own back, a new one none", async () => {
    const id = await linkOut("plink_tell");
    await hook(checkout("plink_tell"));
    expect((await claimChanges(pg.db, id, "token-a")).changes).toEqual(["paid"]);
    expect((await claimChanges(pg.db, id, "token-a")).changes).toEqual(["paid"]);
    expect((await claimChanges(pg.db, id, "token-b")).changes).toEqual([]);
    await hook(refunded("plink_tell", 4900));
    expect((await claimChanges(pg.db, id, "token-c")).changes).toEqual(["refunded"]);
    expect((await claimChanges(pg.db, id, "token-d")).changes).toEqual([]);
  });
});

describe("access follows the money, both ways", () => {
  it("paid marks the thread; a part refund lowers it; a full refund clears it", async () => {
    const id = await linkOut("plink_access");
    await hook(checkout("plink_access"));
    await settleLink(deps(), id);
    expect(await paidMark()).toBe(4900);
    await hook(refunded("plink_access", 900));
    await settleLink(deps(), id);
    expect(await paidMark()).toBe(4000);
    await hook(refunded("plink_access", 4900));
    await settleLink(deps(), id);
    expect(await paidMark()).toBeNull();
    const [line] = await acme.execute<{ summary: string }>(
      sql`select summary from profile_timeline where link = ${`/payments/links/${id}`}`,
    );
    expect(line?.summary).toMatch(/^Refunded \$49\.00 for /);
  });
  it("a dispute open keeps it; lost takes it", async () => {
    const id = await linkOut("plink_lost");
    await hook(checkout("plink_lost"));
    await hook(disputed("plink_lost", "charge.dispute.created", "needs_response", 1_800_000_100));
    await settleLink(deps(), id);
    expect(await paidMark()).toBe(4900);
    await hook(disputed("plink_lost", "charge.dispute.closed", "lost", 1_800_000_200));
    await settleLink(deps(), id);
    expect(await paidMark()).toBeNull();
  });
});

describe("a bank payment that fails", () => {
  it("goes processing, then unpaid; asked again once, as a new link", async () => {
    const id = await linkOut("plink_fail");
    await hook(checkout("plink_fail", { payment_status: "unpaid" }));
    expect((await linkById(pg.db, id))?.status).toBe("processing");
    await hook(
      evt("checkout.session.async_payment_failed", {
        id: "cs_test_plink_fail",
        payment_link: "plink_fail",
        payment_intent: "pi_test_plink_fail",
        payment_status: "unpaid",
      }),
    );
    expect((await linkById(pg.db, id))?.status).toBe("unpaid");
    expect((await claimChanges(pg.db, id, "t1")).changes).toEqual(["failed"]);
    const again = await api().again({ ...ADA, ids: [id] }, NOW);
    const twice = await api().again({ ...ADA, ids: [id] }, NOW);
    expect(again.links[0]?.id).not.toBe(id);
    expect(twice.links[0]?.id).toBe(again.links[0]?.id);
    expect(again.links[0]).toMatchObject({ status: "sending", amountCents: 4900, contact });
    await expect(
      api().again({ ...ADA, ids: [again.links[0]?.id ?? ""] }, NOW),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("reconcile", () => {
  const sessionOf = (plink: string, o: Record<string, unknown> = {}) => ({
    id: `cs_test_${plink}`,
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    amount_total: 4900,
    currency: "usd",
    payment_intent: `pi_test_${plink}`,
    customer_details: { email: "sam@example.test" },
    created: 1_790_000_000,
    livemode: false,
    ...o,
  });
  const intentOf = (plink: string, o: Record<string, unknown> = {}, charge = {}) => ({
    id: `pi_test_${plink}`,
    object: "payment_intent",
    status: "succeeded",
    amount_received: 4900,
    latest_charge: { id: `ch_test_${plink}`, amount_refunded: 0, disputed: false, ...charge },
    ...o,
  });

  it("heals what dropped webhooks missed: paid, refunded, a dispute lost; once", async () => {
    const id = await linkOut("plink_missed");
    world.sessions.plink_missed = [sessionOf("plink_missed")];
    world.intents.pi_test_plink_missed = intentOf(
      "plink_missed",
      {},
      {
        amount_refunded: 1000,
        disputed: true,
      },
    );
    world.disputes.pi_test_plink_missed = [
      { id: "dp_test_1", object: "dispute", status: "lost", created: 1_790_000_100 },
    ];
    const s = await reconcileAll(deps(), NOW);
    expect(s).toMatchObject({ clients: 1, checked: 1, healed: 3, drift: 0, touched: [id] });
    expect(await linkById(pg.db, id)).toMatchObject({
      status: "refunded",
      paidCents: 4900,
      refundedCents: 1000,
      dispute: "lost",
      checkedAt: NOW,
    });
    const recon = await pg.db.select().from(payEvents).where(eq(payEvents.link, id));
    expect(recon.every((e) => e.id.startsWith(`recon:${id}:`))).toBe(true);
    // Checked again later: nothing new to apply, nothing new kept.
    await pg.db.update(payLinks).set({ checkedAt: null }).where(eq(payLinks.id, id));
    const again = await reconcileAll(deps(), NOW);
    expect(again).toMatchObject({ checked: 1, healed: 0, touched: [] });
    expect(await pg.db.select().from(payEvents).where(eq(payEvents.link, id))).toHaveLength(
      recon.length,
    );
  });

  it("leaves what agrees alone, and skips links checked lately", async () => {
    const id = await linkOut("plink_fine");
    await hook(checkout("plink_fine"));
    world.sessions.plink_fine = [sessionOf("plink_fine")];
    world.intents.pi_test_plink_fine = intentOf("plink_fine");
    const s = await reconcileAll(deps(), NOW);
    expect(s).toMatchObject({ checked: 1, healed: 0, drift: 0 });
    expect(await pg.db.select().from(payEvents).where(eq(payEvents.link, id))).toHaveLength(1);
    expect((await reconcileAll(deps(), NOW)).checked).toBe(0);
  });

  it("flags paid here but not on Stripe, once, for a person", async () => {
    const id = await linkOut("plink_drift");
    await hook(checkout("plink_drift"));
    world.sessions.plink_drift = [];
    world.intents.pi_test_plink_drift = intentOf("plink_drift", {
      status: "requires_payment_method",
    });
    const s = await reconcileAll(deps(), NOW);
    expect(s.drift).toBe(1);
    expect((await linkById(pg.db, id))?.why).toContain("Stripe has no payment");
    await pg.db.update(payLinks).set({ checkedAt: null }).where(eq(payLinks.id, id));
    await reconcileAll(deps(), NOW);
    const drift = await pg.db
      .select()
      .from(payEvents)
      .where(and(eq(payEvents.link, id), eq(payEvents.result, "drift")));
    expect(drift).toHaveLength(1);
    expect((await api().status(ADA)).drift).toBe(1);
  });

  it("adds refund and dispute events to an endpoint Wren made before them", async () => {
    world.endpoint.enabled_events = ["checkout.session.completed"];
    const s = await reconcileAll(deps(), NOW);
    expect(s.endpoints).toBe(1);
    expect(world.endpoint.enabled_events).toEqual(
      expect.arrayContaining(["charge.refunded", "charge.dispute.closed"]),
    );
    expect((await reconcileAll(deps(), NOW)).endpoints).toBe(0);
  });

  it("a client whose key Stripe refuses is a line, not a failed pass", async () => {
    await pg.db.update(clients).set({ name: "Acme Plumbing" }).where(eq(clients.id, "acme"));
    const saved = world.endpoint.id;
    world.endpoint.id = "we_gone";
    await linkOut("plink_refused");
    const s = await reconcileAll(deps(), NOW);
    world.endpoint.id = saved;
    expect(s.skipped).toEqual([{ client: "acme", why: expect.any(String) }]);
  });
});
