/**
 * updateClient against the migrated schema: products merge per block, a null
 * block removes that product, accounts as documented. Members and operators
 * decide who may sign in and what they see. Tests
 * that expose a bug assert the correct behavior and are marked "Was a bug".
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
  addOperator,
  clients,
  findClient,
  isOperator,
  listMembers,
  mayHaveAccount,
  removeMember,
  updateClient,
} from "../../src/clients/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["clients", "client_members", "operators"]);
  await pg.db.insert(clients).values({
    id: "acme",
    name: "Acme",
    database: "wren_client_acme",
    accounts: { linkedin: "linkedin@acme", web: "web@acme" },
    products: { reactivation: { on: true, compose: { perDay: 5 } }, other: { x: 1 } },
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

describe("updateClient: accounts", () => {
  it("accounts merge; an empty value turns a site off", async () => {
    const c = await updateClient(pg.db, "acme", { accounts: { web: "", x: "x@acme" } });
    expect(c.accounts).toEqual({ linkedin: "linkedin@acme", x: "x@acme" });
  });

  it("an unknown client throws", async () => {
    await expect(updateClient(pg.db, "nope", { name: "x" })).rejects.toThrow(/unknown client/);
  });
});

describe("who may sign in", () => {
  it("a member, by any spelling of their email; adding again changes the role", async () => {
    expect(await mayHaveAccount(pg.db, "b@acme.example")).toBe(false);
    await addMember(pg.db, "acme", " B@Acme.Example ");
    expect(await mayHaveAccount(pg.db, "B@ACME.example")).toBe(true);
    await addMember(pg.db, "acme", "b@acme.example", { role: "owner" });
    expect((await listMembers(pg.db, "acme")).map((m) => [m.email, m.role])).toEqual([
      ["b@acme.example", "owner"],
    ]);
    expect(await removeMember(pg.db, "acme", "B@acme.example")).toBe(true);
    expect(await mayHaveAccount(pg.db, "b@acme.example")).toBe(false);
  });

  it("an operator, who is no member of anything", async () => {
    await addOperator(pg.db, "Ops@Wren.Example");
    expect(await isOperator(pg.db, "ops@wren.example")).toBe(true);
    expect(await mayHaveAccount(pg.db, "ops@wren.example")).toBe(true);
    expect(await isOperator(pg.db, "b@acme.example")).toBe(false);
  });

  it("membership goes with the client", async () => {
    await addMember(pg.db, "acme", "b@acme.example");
    await pg.db.delete(clients);
    expect(await mayHaveAccount(pg.db, "b@acme.example")).toBe(false);
  });
});
