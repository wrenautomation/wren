/**
 * Wren's own billing by bank transfer (designs/2026-10-15-wise-billing.md): invoices mailed with
 * their PDF, credits read from a fake Wise, matched once, the rest waiting on a person. All
 * synthetic: no real bank details, no real mail.
 */
import { addMember, clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { PortalRefusal } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billingConsoleApi } from "../../src/billing/console.js";
import {
  billingPass,
  type CreditIn,
  creditsList,
  dismissCredit,
  matchByHand,
  parseReceive,
  type WiseReader,
} from "../../src/billing/index.js";
import {
  addInvoice,
  engagementOf,
  invoicesOf,
  onboard,
  signAgreement,
  startEngagement,
} from "../../src/index.js";
import { invoices } from "../../src/schema.js";
import type { PortalMail } from "../../src/watch.js";

let pg: TestPostgres;
const BY = "ops@wren.example";
const RECEIVE = parseReceive(
  JSON.stringify({ USD: { name: "Example Co", account: "000111", routing: "000000000" } }),
);

const mail: PortalMail[] = [];
const pinged: { title: string; body: string }[] = [];
const notifier: Notifier = {
  name: "test",
  notify: async (title, body = "") => {
    pinged.push({ title, body });
    return true;
  },
};
/** The fake Wise: whatever the test put in `inbox`, every pass. */
let inbox: CreditIn[] = [];
const wise: WiseReader = { credits: async () => inbox };
const pass = (at: string, over: { wise?: WiseReader | null } = {}) =>
  billingPass(
    {
      main: pg.db,
      wise: over.wise === undefined ? wise : over.wise,
      send: async (m) => {
        mail.push(m);
      },
      receive: RECEIVE,
      app: "https://app.example",
      zone: "UTC",
      notifier,
    },
    new Date(at),
  );
const take = <T>(a: T[]) => a.splice(0, a.length);

let seq = 0;
const credit = (over: Partial<CreditIn> = {}): CreditIn => ({
  wiseId: `DEPOSIT-${++seq}`,
  balanceId: "1",
  currency: "USD",
  cents: 100_000,
  feeCents: 0,
  at: new Date("2026-10-16T12:00:00Z"),
  kind: "DEPOSIT",
  payer: "Someone",
  memo: null,
  description: null,
  raw: {},
  ...over,
});

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PortalRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}

let first = "";
let second = "";

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Demo Co", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  await addMember(pg.db, "acme", "mo@acme.example");
  for (const id of ["acme", "demo"])
    await startEngagement(pg.db, {
      clientId: id,
      offerId: "reactivation",
      startsOn: "2026-10-05",
      by: BY,
      status: "active",
    });
});

afterAll(async () => {
  await pg?.stop();
});

describe("invoices out", () => {
  it("numbers each invoice and mails its PDF to the owners once; the demo's never", async () => {
    const e = await engagementOf(pg.db, "acme");
    first = (
      await addInvoice(pg.db, e, {
        description: "Setup",
        cents: 100_000,
        dueOn: "2026-10-30",
        by: BY,
      })
    ).number;
    second = (
      await addInvoice(pg.db, e, {
        description: "October",
        cents: 50_000,
        dueOn: "2026-10-30",
        by: BY,
      })
    ).number;
    await addInvoice(pg.db, await engagementOf(pg.db, "demo"), {
      description: "Setup",
      cents: 100_000,
      dueOn: "2026-10-30",
      by: BY,
    });
    expect(first).toMatch(/^WREN-\d+$/);

    await pass("2026-10-15T12:00:00Z", { wise: null });
    const sent = take(mail);
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ["amy@acme.example", `Acme Staffing: invoice ${first} from Wren`],
      ["amy@acme.example", `Acme Staffing: invoice ${second} from Wren`],
    ]);
    const [m] = sent;
    expect(m?.text).toContain(`Reference (put it in the memo): ${first}`);
    expect(m?.text).toContain("Account number: 000111");
    expect(m?.text).toContain("https://app.example/account/billing?client=acme");
    const pdf = m?.attachments?.[0];
    expect(pdf).toMatchObject({ filename: `${first}.pdf`, contentType: "application/pdf" });
    expect(new TextDecoder().decode(pdf?.content.slice(0, 5))).toBe("%PDF-");
    expect(take(pinged).map((p) => p.title)).toEqual(["Invoices mailed: 2"]);

    await pass("2026-10-15T12:15:00Z", { wise: null });
    expect(take(mail)).toEqual([]);
  });
});

describe("money in", () => {
  let partial = 0;
  let stray = 0;

  it("a credit naming its invoice exactly pays it; our own moves and partials don't", async () => {
    inbox = [
      credit({ memo: `Invoice ${first}`, cents: 99_500, feeCents: 500 }),
      credit({ kind: "CONVERSION", cents: 5_000, memo: second }),
      credit({ memo: second, cents: 20_000 }),
      credit({ payer: "Stranger", cents: 1_234 }),
    ];
    const s = await pass("2026-10-16T13:00:00Z");
    expect(s).toMatchObject({ credits: 4, matched: 1, waiting: 2 });
    const bills = await invoicesOf(pg.db, "acme");
    expect(bills.find((i) => i.number === first)).toMatchObject({
      status: "paid",
      paidOn: "2026-10-16",
      receivedCents: 100_000,
    });
    expect(bills.find((i) => i.number === second)).toMatchObject({
      status: "open",
      receivedCents: 0,
    });
    const titles = take(pinged).map((p) => p.title);
    expect(titles).toEqual(["Paid by transfer: 1", "Payments to look at: 2"]);

    const shown = await creditsList(pg.db);
    expect(shown.map((c) => c.status).sort()).toEqual(["matched", "review", "review"]);
    const waits = shown.filter((c) => c.status === "review");
    const p = waits.find((c) => c.cents === 20_000);
    expect(p).toMatchObject({
      invoice: second,
      client: "acme",
      why: expect.stringMatching(/^partial/),
    });
    partial = p?.id ?? 0;
    stray = waits.find((c) => c.cents === 1_234)?.id ?? 0;
    expect((await creditsList(pg.db, { status: ["ignored"] }))[0]?.kind).toBe("CONVERSION");
  });

  it("reading the same window again adds nothing", async () => {
    expect(await pass("2026-10-16T13:15:00Z")).toMatchObject({
      credits: 0,
      matched: 0,
      waiting: 0,
    });
    expect(take(pinged)).toEqual([]);
    expect(await creditsList(pg.db, { status: ["review", "matched", "ignored"] })).toHaveLength(4);
  });

  it("by hand: the right currency on an open invoice, once", async () => {
    const [cad] = await pg.db
      .insert(invoices)
      .values({
        engagementId: (await engagementOf(pg.db, "acme")).id,
        description: "CAD one",
        cents: 20_000,
        currency: "CAD",
        issuedOn: "2026-10-15",
        dueOn: "2026-10-30",
        createdBy: BY,
      })
      .returning();
    expect(await refused(matchByHand(pg.db, partial, cad?.number ?? "", BY))).toBe(400);
    expect(await refused(matchByHand(pg.db, partial, first, BY))).toBe(409);
    expect(await refused(matchByHand(pg.db, partial, "WREN-1", BY))).toBe(404);
    const t = await matchByHand(pg.db, partial, second.toLowerCase(), BY);
    expect(t.credit).toMatchObject({ status: "matched", decidedBy: BY, why: "by hand: partial" });
    expect(t.invoice).toMatchObject({ status: "open", receivedCents: 20_000 });
    expect(await refused(matchByHand(pg.db, partial, second, BY))).toBe(409);
  });

  it("the rest, exactly, pays it; a stray is set aside", async () => {
    inbox = [credit({ memo: second, cents: 30_000 })];
    expect(await pass("2026-10-17T13:00:00Z")).toMatchObject({ matched: 1 });
    take(pinged);
    expect((await invoicesOf(pg.db, "acme")).find((i) => i.number === second)).toMatchObject({
      status: "paid",
      receivedCents: 50_000,
    });
    expect((await dismissCredit(pg.db, stray, BY)).status).toBe("dismissed");
    expect(await refused(dismissCredit(pg.db, stray, BY))).toBe(409);
  });

  it("the console: the demo changes nothing; a blank invoice means the likely one", async () => {
    const api = billingConsoleApi(pg.db);
    expect(await refused(api.dismiss({ viewer: { demo: true }, ids: ["credit:1"] }))).toBe(403);
    const e = await engagementOf(pg.db, "acme");
    const third = await addInvoice(pg.db, e, {
      description: "November",
      cents: 40_000,
      dueOn: "2026-11-30",
      by: BY,
    });
    inbox = [credit({ memo: third.number, cents: 10_000 })];
    await pass("2026-10-18T13:00:00Z");
    take(pinged);
    const [w] = await creditsList(pg.db, { status: ["review"] });
    expect(w?.invoice).toBe(third.number);
    const viewer = { email: BY, operator: true };
    expect(await api.match({ viewer, ids: [`credit:${w?.id}`] })).toEqual({
      done: [String(w?.id)],
    });
    expect(await refused(api.match({ viewer, ids: [] }))).toBe(400);
    expect(await refused(api.match({ viewer, ids: ["credit:x"] }))).toBe(404);
  });

  it("a setup invoice paid by transfer starts the plan once the contract is signed", async () => {
    await pg.db
      .insert(clients)
      .values({ id: "bolt", name: "Bolt Ltd", database: "wren_client_bolt" });
    const { engagement, agreement } = await onboard(pg.db, {
      clientId: "bolt",
      offerId: "reactivation",
      startsOn: "2026-10-05",
      terms: { setupCents: 150_000 },
      by: BY,
    });
    await signAgreement(pg.db, engagement, {
      sha256: agreement.sha256,
      name: "Bo Brown",
      email: "bo@bolt.example",
      agreed: true,
    });
    const setup = await addInvoice(pg.db, engagement, {
      description: "Setup",
      cents: 150_000,
      dueOn: "2026-10-30",
      setup: true,
      by: BY,
    });
    // No reference, but the exact amount from a payer named like the client.
    inbox = [credit({ payer: "BOLT LIMITED", cents: 150_000 })];
    expect(await pass("2026-10-19T13:00:00Z")).toMatchObject({ matched: 1 });
    const [i] = await pg.db.select().from(invoices).where(eq(invoices.number, setup.number));
    expect(i?.status).toBe("paid");
    expect((await engagementOf(pg.db, "bolt")).status).toBe("active");
  });
});
