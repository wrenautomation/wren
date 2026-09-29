/**
 * updateClient against the migrated schema: products merge per block, a null
 * block removes that product, accounts and portal emails as documented. Tests
 * that expose a bug assert the correct behavior and are marked "Was a bug".
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clients, findClient, updateClient } from "../../src/clients/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["clients"]);
  await pg.db.insert(clients).values({
    id: "acme",
    name: "Acme",
    database: "wren_client_acme",
    accounts: { linkedin: "linkedin@acme", web: "web@acme" },
    products: { reactivation: { on: true, compose: { perDay: 5 } }, other: { x: 1 } },
    portalEmails: ["a@acme.example"],
  });
});

describe("updateClient: products", () => {
  it("a block replaces that product whole; the others stay", async () => {
    const c = await updateClient(pg.db, "acme", { products: { reactivation: { on: false } } });
    expect(c.products).toEqual({ reactivation: { on: false }, other: { x: 1 } });
    expect((await findClient(pg.db, "acme"))?.products).toEqual(c.products);
  });

  it("null removes that product; null for one never set is a no-op", async () => {
    const c = await updateClient(pg.db, "acme", {
      products: { reactivation: null, missing: null },
    });
    expect(c.products).toEqual({ other: { x: 1 } });
  });

  it("a new product is added", async () => {
    const c = await updateClient(pg.db, "acme", { products: { phone: { on: true } } });
    expect(Object.keys(c.products).sort()).toEqual(["other", "phone", "reactivation"]);
  });

  it("a change without products leaves them alone", async () => {
    const c = await updateClient(pg.db, "acme", { name: "Acme Inc" });
    expect(c.name).toBe("Acme Inc");
    expect(c.products).toEqual({
      reactivation: { on: true, compose: { perDay: 5 } },
      other: { x: 1 },
    });
  });

  it("removing every product leaves an empty object, not null", async () => {
    const c = await updateClient(pg.db, "acme", { products: { reactivation: null, other: null } });
    expect(c.products).toEqual({});
  });

  // Was a bug (minor): an undefined block is dropped by JSON on write, so it silently removes the
  // product; only null is documented to remove.
  it("an undefined block keeps the product", async () => {
    const c = await updateClient(pg.db, "acme", { products: { reactivation: undefined } });
    expect(c.products).toHaveProperty("reactivation");
  });
});

describe("updateClient: accounts and portal emails", () => {
  it("accounts merge; an empty value turns a site off", async () => {
    const c = await updateClient(pg.db, "acme", { accounts: { web: "", x: "x@acme" } });
    expect(c.accounts).toEqual({ linkedin: "linkedin@acme", x: "x@acme" });
  });

  it("portal emails are replaced and normalized", async () => {
    const c = await updateClient(pg.db, "acme", { portalEmails: [" B@Acme.Example "] });
    expect(c.portalEmails).toEqual(["b@acme.example"]);
  });

  it("an unknown client throws", async () => {
    await expect(updateClient(pg.db, "nope", { name: "x" })).rejects.toThrow(/unknown client/);
  });
});
