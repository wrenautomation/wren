/** Managed usage as draft lines: per owner and vendor a month, cost plus markup, never charged. */
import { clients, wrenSettings } from "@wren/core/clients";
import { memoryKeyStore, meter, setManaged, setOwnKey } from "@wren/core/vendors";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usageLines } from "../../src/schema.js";
import { monthBounds, usageLinesOf, writeUsageLines } from "../../src/usage-lines.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
  await setManaged(pg.db, { client: "acme", vendor: "exa", perDay: 0, capCents: 10_000, by: "op" });
  await setManaged(pg.db, { client: "acme", vendor: "x", perDay: 0, capCents: 10_000, by: "op" });
  await setOwnKey(pg.db, memoryKeyStore(), {
    client: "beta",
    vendor: "exa",
    value: "test-key-123",
    env: "test",
    by: "op",
  });
  const at = new Date("2026-03-10T00:00:00Z");
  await meter(pg.db, { client: "acme", vendor: "exa", units: 1000, at }); // $7.00
  await meter(pg.db, { client: "acme", vendor: "exa", units: 3, at }); // $0.021
  await meter(pg.db, { client: "acme", vendor: "x", units: 100, at }); // $0.50
  await meter(pg.db, { client: "beta", vendor: "exa", units: 500, at }); // own key: not billed
  await meter(pg.db, { client: null, vendor: "exa", units: 200, at }); // Wren's: $1.40, cost only
  await meter(pg.db, {
    client: "acme",
    vendor: "exa",
    units: 1000,
    at: new Date("2026-04-01T00:00:00Z"),
  });
});
afterAll(() => pg.stop());

describe("usage lines", () => {
  it("reads a month as YYYY-MM", () => {
    expect(monthBounds("2026-12")).toEqual({
      from: new Date("2026-12-01T00:00:00Z"),
      to: new Date("2027-01-01T00:00:00Z"),
      day: "2026-12-01",
    });
    expect(() => monthBounds("2026-13")).toThrow(/YYYY-MM/);
  });

  it("drafts one line per owner and managed vendor, at cost with no markup by default", async () => {
    expect(await writeUsageLines(pg.db, "2026-03")).toEqual({
      lines: 3,
      costCents: 700 + 2 + 50 + 140,
      amountCents: 700 + 2 + 50 + 140,
      kept: 0,
    });
    const lines = await usageLinesOf(pg.db, "2026-03");
    expect(
      lines.map((l) => [l.client, l.vendor, l.units, l.costCents, l.amountCents, l.state]),
    ).toEqual([
      ["acme", "exa", 1003, 702, 702, "draft"],
      ["acme", "x", 100, 50, 50, "draft"],
      [null, "exa", 200, 140, 140, "draft"],
    ]);
    expect((await usageLinesOf(pg.db, "2026-03", "beta")).length).toBe(0);
  });

  it("re-running rewrites drafts with the markup, and keeps lines already on an invoice", async () => {
    await pg.db.insert(wrenSettings).values({ component: "vendors", settings: { markupPct: 20 } });
    await pg.db.update(usageLines).set({ state: "on_invoice" }).where(eq(usageLines.vendor, "x"));
    expect(await writeUsageLines(pg.db, "2026-03")).toMatchObject({ lines: 2, kept: 1 });
    const lines = await usageLinesOf(pg.db, "2026-03");
    expect(lines.map((l) => [l.client, l.vendor, l.markupPct, l.amountCents, l.state])).toEqual([
      ["acme", "exa", 20, 842, "draft"],
      ["acme", "x", 0, 50, "on_invoice"],
      // Wren's own: cost only.
      [null, "exa", 0, 140, "draft"],
    ]);
  });
});
