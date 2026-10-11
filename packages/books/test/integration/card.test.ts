/**
 * The card against the migrated schema: a statement's lines sorted by the
 * vendors' card words and William's rules, matched to mailed bills (a foreign
 * one takes the CAD charged), and a bill made for a charge no mail billed.
 * Every line and bill here is made up.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bills,
  cardLines,
  dirStore,
  documents,
  endSubscription,
  importStatement,
  listSubscriptions,
  matchCard,
  post,
  type RateFeed,
  readCardAlerts,
  ruleCard,
  seedBooks,
  shiftDay,
  sortCard,
  unsortedCard,
  vendors,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

let root: string;
beforeEach(async () => {
  await pg.db.execute(
    sql.raw(
      `TRUNCATE ${["card_rules", "card_lines", "subscription_ends", "lines", "entries", "bill_documents", "bills", "documents", "rates", "vendors", "accounts"].map((t) => `books.${t}`).join(", ")} RESTART IDENTITY CASCADE`,
    ),
  );
  await seedBooks(pg.db);
  root = await mkdtemp(join(tmpdir(), "card-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const feed: RateFeed = async (_currency, from, to) => {
  const out: Array<{ on: string; cadPerUnit: string }> = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push({ on: d, cadPerUnit: "1.37000000" });
  return out;
};

const STATEMENT = `Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description
1,'5555********1234,20260920,20260921,400.00,LEADGENJAY.COM
2,'5555********1234,20261007,20261008,15.52,X CORP. PAID FEATURES
3,'5555********1234,20261008,20261009,8.99,CORNER CAFE
4,'5555********1234,20261009,20261010,-500.00,PAYMENT RECEIVED - THANK YOU
`;

const vendorId = async (key: string) =>
  (await pg.db.select().from(vendors).where(eq(vendors.key, key)))[0]?.id as number;

/** A mailed bill, as `readDocuments` would save it. */
async function mailedBill(key: string, number: string, on: string, cents: number) {
  const [doc] = await pg.db
    .insert(documents)
    .values({
      sha256: `sha-${number}`,
      mediaType: "message/rfc822",
      size: 1,
      storeKey: `k-${number}`,
      source: "mailbox",
      kind: "bill",
      readAt: new Date(),
    })
    .returning();
  const v = (await pg.db.select().from(vendors).where(eq(vendors.key, key)))[0];
  const [b] = await pg.db
    .insert(bills)
    .values({
      vendorId: v?.id as number,
      number,
      kind: "receipt",
      issuedOn: on,
      currency: "USD",
      subtotalCents: cents,
      taxCents: 0,
      totalCents: cents,
      cycle: "monthly",
      accountId: v?.accountId as number,
      review: "ok",
      documentId: doc?.id as number,
    })
    .returning();
  await post(pg.db, { feed, runId: null });
  return b?.id as number;
}

const line = async (description: string) =>
  (await pg.db.select().from(cardLines).where(eq(cardLines.description, description)))[0];

describe("card", () => {
  it("imports once, sorts, matches, makes the missing bill, and gives it back to the mail", async () => {
    const store = dirStore(root);
    const xBill = await mailedBill("x", "X-1", "2026-10-07", 1100);
    const file = { bytes: new TextEncoder().encode(STATEMENT), filename: "october.csv" };
    expect(await importStatement(pg.db, store, file)).toMatchObject({ lines: 4, added: 4 });
    expect(await importStatement(pg.db, store, file)).toMatchObject({ added: 0, known: 4 });

    expect(await sortCard(pg.db)).toBe(2);
    expect((await unsortedCard(pg.db)).map((u) => u.descriptor)).toEqual(["CORNER CAFE"]);

    // On 10-11 the October charge is still in its grace; September's isn't.
    expect(await matchCard(pg.db, "2026-10-11")).toEqual({ matched: 1, charged: 1, made: 1 });
    const x = (await pg.db.select().from(bills).where(eq(bills.id, xBill)))[0];
    expect(x?.chargedCadCents).toBe(1552);
    const inbox = await line("LEADGENJAY.COM");
    const made = (
      await pg.db
        .select()
        .from(bills)
        .where(eq(bills.id, inbox?.billId as number))
    )[0];
    expect(made).toMatchObject({ number: `card:${inbox?.id}`, totalCents: 40000, currency: "CAD" });
    expect(made?.vendorId).toBe(await vendorId("inbox-insiders"));
    await post(pg.db, { feed, runId: null });

    // The vendor's own receipt turns up: the line moves to it, the made bill is void.
    const mailed = await mailedBill("inbox-insiders", "LGJ-1", "2026-09-20", 29200);
    expect(await matchCard(pg.db, "2026-10-11")).toMatchObject({ matched: 1, made: 0 });
    expect((await line("LEADGENJAY.COM"))?.billId).toBe(mailed);
    const voided = (
      await pg.db
        .select()
        .from(bills)
        .where(eq(bills.id, made?.id as number))
    )[0];
    expect(voided?.review).toBe("void");

    expect(await ruleCard(pg.db, "CORNER CAFE", "personal")).toBe(1);
    expect(await unsortedCard(pg.db)).toEqual([]);
    expect((await line("CORNER CAFE"))?.personal).toBe(true);
  });

  it("an alert becomes a line, and the statement takes it over", async () => {
    const [doc] = await pg.db
      .insert(documents)
      .values({
        sha256: "alert-1",
        mediaType: "message/rfc822",
        size: 1,
        storeKey: "a1",
        source: "mailbox",
        fromAddress: "bmoalerts@bmo.com",
        subject: "Purchase alert",
        text: "A purchase of $15.52 was made at X CORP on your card ending 1234.",
        sentAt: new Date("2026-10-07T15:00:00Z"),
      })
      .returning();
    const llm = new FakeLlm({
      respond: () =>
        JSON.stringify({
          purchase: true,
          merchant: "X CORP",
          amount: 15.52,
          currency: "CAD",
          on: "2026-10-07",
          card: "1234",
        }),
    });
    expect(await readCardAlerts(pg.db, llm)).toEqual({ read: 1, added: 1 });
    expect(await readCardAlerts(pg.db, llm)).toEqual({ read: 0, added: 0 });
    const [alert] = await pg.db.select().from(cardLines);
    expect(alert).toMatchObject({ source: "alert", documentId: doc?.id, amountCents: 1552 });

    const file = { bytes: new TextEncoder().encode(STATEMENT), filename: "october.csv" };
    const got = await importStatement(pg.db, dirStore(root), file);
    expect(got).toMatchObject({ added: 3, confirmed: 1 });
    const rows = await pg.db.select().from(cardLines);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.id === alert?.id)?.source).toBe("statement");
  });

  it("an ended subscription leaves the list until it bills again", async () => {
    await mailedBill("x", "X-1", "2026-08-07", 1100);
    expect((await listSubscriptions(pg.db, { on: "2026-08-20" })).map((s) => s.vendor)).toEqual([
      "x",
    ]);
    await endSubscription(pg.db, "x", "2026-08-10");
    expect(await listSubscriptions(pg.db, { on: "2026-08-20" })).toEqual([]);
    await mailedBill("x", "X-2", "2026-09-07", 1100);
    expect((await listSubscriptions(pg.db, { on: "2026-09-20" })).map((s) => s.vendor)).toEqual([
      "x",
    ]);
  });
});
