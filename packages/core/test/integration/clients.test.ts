/**
 * updateClient against the migrated schema: products merge per block, a null
 * block removes that product, accounts as documented. Members and operators
 * decide who may sign in and what they see. Tests
 * that expose a bug assert the correct behavior and are marked "Was a bug".
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
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
import { defineComponent } from "../../src/components.js";
import { consoleApi } from "../../src/console.js";
import { clientsFor, portalMe, type Viewer, whoIs } from "../../src/portal.js";
import { serveRecords } from "../../src/records-serve.js";
import { runs } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["clients", "client_members", "operators", "runs"]);
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

describe("who is asking, read fresh", () => {
  it("a team row, a membership per client, the demo, or nobody", async () => {
    await pg.db.insert(clients).values({ id: "beta", name: "Beta", database: "wren_client_beta" });
    await addOperator(pg.db, "ops@wren.example");
    await addMember(pg.db, "acme", "b@acme.example", { role: "viewer" });
    await addMember(pg.db, "beta", "b@acme.example", { role: "owner" });
    const signed = (email: string): Viewer => ({ email });
    expect(await whoIs(pg.db, signed("Ops@Wren.Example"))).toEqual({
      team: "admin",
      clients: null,
    });
    expect(await whoIs(pg.db, signed("b@acme.example"))).toEqual({
      member: "viewer",
      client: "acme",
    });
    expect(await whoIs(pg.db, signed("b@acme.example"), "beta")).toEqual({
      member: "owner",
      client: "beta",
    });
    expect(await whoIs(pg.db, signed("b@acme.example"), "gamma")).toBeNull();
    expect(await whoIs(pg.db, signed("x@nowhere.example"))).toBeNull();
    expect(await whoIs(pg.db, { demo: true })).toEqual({ demo: true });
  });

  it("a scoped operator lists only their clients; an admin all of them", async () => {
    await pg.db.insert(clients).values({ id: "beta", name: "Beta", database: "wren_client_beta" });
    const ids = async (team: { role: "admin" | "operator"; clients: string[] | null }) =>
      (await clientsFor(pg.db, { email: "ops@wren.example", operator: true, team })).map(
        (c) => c.id,
      );
    expect(await ids({ role: "operator", clients: ["beta", "wren"] })).toEqual(["beta"]);
    expect(await ids({ role: "operator", clients: [] })).toEqual([]);
    expect(await ids({ role: "operator", clients: null })).toEqual(["acme", "beta"]);
    expect(await ids({ role: "admin", clients: ["beta"] })).toEqual(["acme", "beta"]);
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
    expect(me.clients).toEqual([
      {
        id: "acme",
        name: "Acme",
        look,
        installed: ["other", "reactivation"],
        role: "owner",
        can: ["read", "act", "money", "manage"],
      },
    ]);
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

describe("install, configure, uninstall", () => {
  const ops = { email: "ops@wren.example", operator: true };
  const base = defineComponent({
    id: "texts",
    name: "Texts",
    blurb: "Sends texts.",
    icon: "mail",
    for: "client",
    stage: "reach",
    ready: true,
    settings: z.object({ perDay: z.number().default(5), price: z.number().optional() }),
    priced: ["price"],
    effects: ["sends"],
    hypothesis: { from: "a test", guesses: [{ is: "fixed", says: "It sends texts." }] },
    // One loop per day of cap: configure changes which run.
    clientLoops: (client, s) =>
      s.perDay === 9
        ? [{ service: "Tick", key: `${client}/nine` }]
        : [{ service: "Tick", key: `${client}/x` }],
  });
  const all = [
    base,
    defineComponent({
      ...base,
      id: "reminders",
      name: "Reminders",
      effects: [],
      requires: { components: ["texts"] },
    }),
    defineComponent({
      ...base,
      id: "dms",
      name: "DMs",
      effects: [],
      requires: { accounts: ["telnyx"] },
    }),
    defineComponent({
      ...base,
      id: "soon",
      name: "Soon",
      ready: false,
      missing: ["per client db"],
    }),
    defineComponent({ ...base, id: "books", name: "Books", for: "wren" }),
  ];
  const asked: string[] = [];
  const api = () =>
    consoleApi({
      main: pg.db,
      views: [],
      components: all,
      asked: async (c, by, x) => void asked.push(`${c.id} ${by} ${x.id}`),
    });
  const productsOf = async () => (await findClient(pg.db, "acme"))?.products ?? {};
  const go = (component: string, more: object = {}) =>
    api().install({ viewer: ops, client: "acme", component, ...more });

  it("refuses not ready, Wren's own, missing requirements and an unconfirmed effect", async () => {
    await expect(go("soon")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("per client db"),
    });
    await expect(go("books")).rejects.toMatchObject({ status: 409 });
    await expect(go("reminders")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("texts"),
    });
    await expect(go("dms")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("telnyx"),
    });
    await expect(go("texts")).rejects.toMatchObject({ status: 400 });
    await expect(
      go("texts", { confirm: "texts", settings: { perDay: "x" } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(Object.keys(await productsOf()).sort()).toEqual(["other", "reactivation"]);
  });

  it("installs, configures and uninstalls, each on the run trail", async () => {
    expect(await go("texts", { confirm: "texts", settings: { perDay: 9 } })).toMatchObject({
      start: [{ service: "Tick", key: "acme/nine" }],
      stop: [],
    });
    await expect(go("texts", { confirm: "texts" })).rejects.toMatchObject({ status: 409 });
    await go("reminders");
    expect((await productsOf()).texts).toEqual({ perDay: 9 });
    await api().configure({
      viewer: ops,
      client: "acme",
      component: "texts",
      settings: { price: 1 },
    });
    expect((await productsOf()).texts).toEqual({ perDay: 9, price: 1 });
    // A loop the new block drops stops; one it keeps is not stopped.
    expect(
      await api().configure({
        viewer: ops,
        client: "acme",
        component: "texts",
        settings: { perDay: 3 },
      }),
    ).toMatchObject({ start: [{ key: "acme/x" }], stop: [{ key: "acme/nine" }] });
    // Required by reminders: it stays until reminders goes.
    await expect(
      api().uninstall({ viewer: ops, client: "acme", component: "texts" }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Reminders") });
    await api().uninstall({ viewer: ops, client: "acme", component: "reminders" });
    expect(
      await api().uninstall({ viewer: ops, client: "acme", component: "texts" }),
    ).toMatchObject({ start: [], stop: [{ key: "acme/x" }] });
    expect(await productsOf()).not.toHaveProperty("texts");
    const trail = (await pg.db.select().from(runs))
      .map((r) => `${r.command} ${JSON.stringify(r.stats)}`)
      .sort();
    expect(trail).toEqual([
      'console configure texts {"ok":true}',
      'console configure texts {"ok":true}',
      'console install reminders {"ok":true}',
      'console install texts {"ok":true}',
      'console uninstall reminders {"ok":true}',
      'console uninstall texts {"ok":true}',
    ]);
  });

  it("only the team installs; a client asks, the demo can't", async () => {
    await pg.db
      .insert(clients)
      .values({ id: "show", name: "Show", database: "wren_client_show", demo: true });
    await addMember(pg.db, "acme", "owner@acme.example", { role: "owner" });
    const owner = { email: "owner@acme.example" };
    await expect(
      api().install({ viewer: owner, client: "acme", component: "texts", confirm: "texts" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      api().ask({ viewer: owner, client: "acme", component: "books" }),
    ).rejects.toMatchObject({ status: 404 });
    await api().ask({ viewer: owner, client: "acme", component: "texts" });
    expect(asked).toEqual(["acme owner@acme.example texts"]);
    await expect(
      api().ask({ viewer: { demo: true }, client: "show", component: "texts" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("the catalog: a client sees its own kind only, and never a price", async () => {
    await go("texts", { confirm: "texts", settings: { perDay: 9, price: 1 } });
    const ids = async (viewer: Viewer) =>
      (await api().recordsList({ viewer, client: "acme", record: "console.component" })).rows.map(
        (r) => r.id,
      );
    expect(await ids(ops)).toContain("books");
    await addMember(pg.db, "acme", "owner@acme.example", { role: "owner" });
    expect(await ids({ email: "owner@acme.example" })).not.toContain("books");
    const got = await api().recordsGet({
      viewer: ops,
      client: "acme",
      record: "console.component",
      id: "texts",
    });
    expect(got.detail).toMatchObject({ installed: true, values: { perDay: 9 } });
    expect(JSON.stringify(got.detail)).not.toContain("price");
  });
});
