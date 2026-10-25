/**
 * Our invoices as the executor hears them (`claimInvoiceChanges`): each change once ever, about the
 * client's billing person. Synthetic data only.
 */
import { addMember, clients } from "@wren/core/clients";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimInvoiceChanges } from "../../src/billing/index.js";
import { addInvoice, engagementOf, markInvoice, startEngagement } from "../../src/index.js";
import { invoices } from "../../src/schema.js";

let pg: TestPostgres;
const BY = "ops@wren.example";

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Demo Co", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  for (const id of ["acme", "demo"])
    await startEngagement(pg.db, {
      clientId: id,
      offerId: "reactivation",
      startsOn: "2026-10-05",
      by: BY,
      status: "active",
    });
});
afterAll(() => pg?.stop());

const made = async (client: string, description: string, dueOn: string, cents = 50_000) =>
  (
    await addInvoice(pg.db, await engagementOf(pg.db, client), {
      description,
      cents,
      issuedOn: "2026-10-10",
      dueOn,
      by: BY,
    })
  ).number;
const summary = (f: Awaited<ReturnType<typeof claimInvoiceChanges>>) =>
  f.map((x) => [x.event.subject, x.facts.trigger === "trigger.payment" && x.facts.change]);

describe("invoice changes", () => {
  it("tells issued, paid, late and refunded once each, about the owner; the demo's never", async () => {
    const a = await made("acme", "Setup", "2026-10-30");
    const b = await made("acme", "October", "2026-10-20");
    await made("demo", "Setup", "2026-10-30");

    const first = await claimInvoiceChanges(pg.db, "t1", "2026-10-15");
    expect(summary(first)).toEqual([
      [`payment:invoice:${a}:invoiced`, "invoiced"],
      [`payment:invoice:${b}:invoiced`, "invoiced"],
    ]);
    expect(first[0]).toMatchObject({
      client: null,
      about: ["amy@acme.example"],
      event: {
        kind: "invoice",
        data: {
          source: "invoice",
          id: a,
          change: "invoiced",
          amount_cents: 50_000,
          email: "amy@acme.example",
          client_id: "acme",
        },
      },
    });
    // Told: a second pass says nothing. A retry under the same token says it again.
    expect(await claimInvoiceChanges(pg.db, "t2", "2026-10-15")).toEqual([]);
    expect(summary(await claimInvoiceChanges(pg.db, "t1", "2026-10-15"))).toHaveLength(2);

    // b is past due on the 21st; a is not.
    expect(summary(await claimInvoiceChanges(pg.db, "t3", "2026-10-21"))).toEqual([
      [`payment:invoice:${b}:late`, "late"],
    ]);
    expect(await claimInvoiceChanges(pg.db, "t4", "2026-10-22")).toEqual([]);

    // Paid: told once, even though the invoice is no longer open.
    await markInvoice(pg.db, "acme", a, "paid", "2026-10-23");
    const paid = await claimInvoiceChanges(pg.db, "t5", "2026-10-24");
    expect(summary(paid)).toEqual([[`payment:invoice:${a}:paid`, "paid"]]);
    expect(paid[0]?.event.data).toMatchObject({ amount_cents: 50_000, refunded_cents: 0 });
    expect(await claimInvoiceChanges(pg.db, "t6", "2026-10-25")).toEqual([]);

    // A refund by transfer.
    await pg.db.update(invoices).set({ refundedCents: 20_000 }).where(eq(invoices.number, a));
    const refunded = await claimInvoiceChanges(pg.db, "t7", "2026-10-26");
    expect(summary(refunded)).toEqual([[`payment:invoice:${a}:refunded`, "refunded"]]);
    expect(refunded[0]?.event.data).toMatchObject({ refunded_cents: 20_000 });
    expect(await claimInvoiceChanges(pg.db, "t8", "2026-10-27")).toEqual([]);
  });

  it("tells nothing for a void invoice", async () => {
    const n = await made("acme", "Void me", "2026-11-30");
    await markInvoice(pg.db, "acme", n, "void");
    expect(await claimInvoiceChanges(pg.db, "t9", "2026-12-15")).toEqual([]);
  });
});
