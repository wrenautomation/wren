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
  clientRecord,
  clients,
  findClient,
  isOperator,
  listMembers,
  mayHaveAccount,
  removeMember,
  updateClient,
} from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import { portalMe } from "../../src/portal.js";
import { serveRecords } from "../../src/records-serve.js";

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

describe("clients as a console record", () => {
  it("a client with its products and members, the demo apart", async () => {
    await pg.db
      .insert(clients)
      .values({ id: "show", name: "Show", database: "wren_client_show", demo: true });
    await addMember(pg.db, "acme", "b@acme.example");
    await addMember(pg.db, "acme", "c@acme.example");
    const api = serveRecords([clientRecord], pg.db);
    const page = await api.list({ record: "console.client", view: "clients" });
    expect(page.counts).toEqual({ clients: 1, all: 2 });
    expect(page.rows).toMatchObject([
      { id: "acme", name: "Acme", kind: "client", products: "other, reactivation", members: 2 },
    ]);
    const demo = await api.get({ record: "console.client", id: "show" });
    expect(demo.row).toMatchObject({ kind: "demo", members: 0, lastSeen: null });
  });
});

describe("setLook", () => {
  const look = { brand: { color: "#1d5a45" } };
  const api = () => consoleApi({ main: pg.db, views: [] });
  const lookOf = async (id: string) => (await findClient(pg.db, id))?.look;
  beforeEach(async () => {
    await pg.db.insert(clients).values([
      { id: "other", name: "Other", database: "wren_client_other" },
      { id: "show", name: "Show", database: "wren_client_show", demo: true },
    ]);
    await addMember(pg.db, "acme", "owner@acme.example", { role: "owner" });
    await addMember(pg.db, "acme", "b@acme.example");
    await addMember(pg.db, "other", "owner@other.example", { role: "owner" });
  });

  it("an owner sets their own client's look, and Me carries it", async () => {
    const viewer = { email: "Owner@Acme.example" };
    await api().setLook({ viewer, client: "acme", look });
    expect(await lookOf("acme")).toEqual(look);
    const me = await portalMe(pg.db, viewer, "Demo");
    expect(me.clients).toEqual([{ id: "acme", name: "Acme", look }]);
    await api().setLook({ viewer, client: "acme", look: null });
    expect(await lookOf("acme")).toBeNull();
  });

  it("an owner can't set another client's look; a member can't set their own", async () => {
    const owner = { email: "owner@acme.example" };
    await expect(api().setLook({ viewer: owner, client: "other", look })).rejects.toMatchObject({
      status: 403,
    });
    await expect(api().setLook({ viewer: owner, client: "show", look })).rejects.toMatchObject({
      status: 403,
    });
    const member = { email: "b@acme.example" };
    await expect(api().setLook({ viewer: member, client: "acme", look })).rejects.toMatchObject({
      status: 403,
    });
    expect(await lookOf("other")).toBeNull();
    expect(await lookOf("acme")).toBeNull();
  });

  it("an operator sets any client's, the demo's too; the demo viewer sets none", async () => {
    const operator = { email: "ops@wren.example", operator: true };
    await api().setLook({ viewer: operator, client: "other", look: "night" });
    await api().setLook({ viewer: operator, client: "show", look });
    expect(await lookOf("other")).toBe("night");
    expect(await lookOf("show")).toEqual(look);
    await expect(
      api().setLook({ viewer: { demo: true }, client: "show", look: null }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses what isn't a look", async () => {
    const operator = { email: "ops@wren.example", operator: true };
    for (const bad of [undefined, 3, [look], { big: "x".repeat(5000) }])
      await expect(
        api().setLook({ viewer: operator, client: "acme", look: bad }),
      ).rejects.toMatchObject({ status: 400 });
  });
});
