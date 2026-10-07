/**
 * AccountsConsole on Postgres: a client's people read their own accounts and mark their own
 * steps; Wren's team adds accounts, starts done for you and sets vendors; money needs an admin;
 * a key is saved by name and never read back. Synthetic clients only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountsApi } from "../../src/accounts-console.js";
import { clientMembers, clients } from "../../src/clients/schema.js";
import { PortalRefusal, type Viewer } from "../../src/portal.js";
import { defineSetup } from "../../src/setup.js";
import { memoryKeyStore, meter } from "../../src/vendors.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Dental", database: "wren_client_acme" },
    { id: "beta", name: "Beta Roofing", database: "wren_client_beta" },
  ]);
  await pg.db.insert(clientMembers).values([
    { clientId: "acme", email: "amy@acme.example", role: "member" },
    { clientId: "acme", email: "val@acme.example", role: "viewer" },
    { clientId: "beta", email: "bo@beta.example", role: "owner" },
  ]);
  await pg.db.execute(sql`
    INSERT INTO operators (email, role) VALUES ('admin@example.test', 'admin'),
      ('op@example.test', 'operator')`);
}, 240_000);
afterAll(() => pg?.stop());

const SETUP = defineSetup({
  id: "setup.test",
  name: "Sending domain",
  blurb: "A domain that sends.",
  site: "domain",
  steps: [
    {
      id: "dns",
      fact: "t.dns",
      label: "Mail records",
      who: "client",
      how: "Add the records.",
      forYou: "Wren adds the records.",
      check: "dns.mail_records",
      every: "15 minutes",
    },
    {
      id: "verify",
      fact: "t.verified",
      label: "Verified",
      who: "wren",
      how: "Wren verifies it.",
      forYou: "Wren verifies it.",
      check: "t.unbuilt",
    },
  ],
});

const keys = memoryKeyStore();
const T = new Date("2026-03-10T12:00:00Z");
const api = (store = keys as typeof keys | null) =>
  accountsApi({
    db: pg.db,
    setups: [SETUP],
    checks: new Set(["dns.mail_records"]),
    keys: store,
    env: "test",
    now: () => T,
  });
const ADMIN: Viewer = { email: "admin@example.test", operator: true };
const OP: Viewer = {
  email: "op@example.test",
  operator: true,
  team: { role: "operator", clients: null },
};
const AMY: Viewer = { email: "amy@acme.example" };
const VAL: Viewer = { email: "val@acme.example" };
const refused = async (p: Promise<unknown>, status: number, says?: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
  if (says) expect((err as Error).message).toMatch(says);
};

describe("accounts", () => {
  let id = 0;
  it("the team adds an account; a client's people can't", async () => {
    await refused(
      api().addAccount({ viewer: AMY, client: "acme", site: "domain", ref: "acme.example" }),
      403,
      /Wren's team/,
    );
    ({ id } = await api().addAccount({
      viewer: ADMIN,
      client: "acme",
      site: "domain",
      ref: "send.acme.example",
    }));
    expect(id).toBeGreaterThan(0);
  });

  it("reads the owner's own: its accounts, sites and setups to start", async () => {
    const team = await api().accounts({ viewer: ADMIN, client: "acme" });
    expect(team.team).toBe(true);
    expect(team.sites.find((s) => s.site === "domain")?.setups).toEqual(["Sending domain"]);
    const amy = await api().accounts({ viewer: AMY, client: "acme" });
    expect(amy.team).toBe(false);
    expect(amy.mayAct).toBe(true);
    expect(amy.sites).toEqual([]);
    const [a] = amy.accounts;
    expect(a).toMatchObject({ siteLabel: "Sending domain", ref: "send.acme.example", runs: [] });
    expect(a).not.toHaveProperty("login");
    expect(a?.setups.map((s) => s.id)).toEqual(["setup.test"]);
    // Another client's person can't name this one.
    await refused(api().accounts({ viewer: { email: "bo@beta.example" }, client: "acme" }), 403);
  });

  it("a client starts self-serve; done for you is the team's", async () => {
    await refused(
      api().start({ viewer: AMY, client: "acme", account: id, setup: SETUP.id, mode: "for_you" }),
      403,
    );
    await refused(api().start({ viewer: VAL, client: "acme", account: id, setup: SETUP.id }), 403);
    const { emits } = await api().start({
      viewer: AMY,
      client: "acme",
      account: id,
      setup: SETUP.id,
    });
    expect(emits[0]).toMatchObject({ client: "acme", workflow: SETUP.id, from: "in.accounts" });
    // A switch of mode is a restart: the team's.
    await refused(api().start({ viewer: AMY, client: "acme", account: id, setup: SETUP.id }), 403);
    const run = (await api().accounts({ viewer: AMY, client: "acme" })).accounts[0]?.runs[0];
    expect(run).toMatchObject({ setup: SETUP.id, gen: 1, mode: "self", step: "dns" });
    expect(run?.steps.map((s) => [s.id, s.state, s.check, s.mayMark])).toEqual([
      ["dns", "checking", "live", true],
      ["verify", "later", "development", false],
    ]);
  });

  it("checks the waiting step now, as a fresh round", async () => {
    const { emits } = await api().checkNow({
      viewer: AMY,
      client: "acme",
      account: id,
      setup: SETUP.id,
    });
    expect(emits[0]?.events[0]?.subject).toBe(`account:${id}:g1#c${T.getTime()}`);
  });

  it("a client marks its own steps, never Wren's", async () => {
    await refused(
      api().mark({ viewer: AMY, client: "acme", account: id, setup: SETUP.id, step: "verify" }),
      403,
      /Wren's team/,
    );
    const { emits } = await api().mark({
      viewer: AMY,
      client: "acme",
      account: id,
      setup: SETUP.id,
      step: "dns",
    });
    expect(emits).toHaveLength(1);
    const a = (await api().accounts({ viewer: ADMIN, client: "acme" })).accounts[0];
    expect(a?.facts).toMatchObject([{ fact: "t.dns", label: "Mail records", state: "ok" }]);
    expect(a?.runs[0]?.steps[0]?.state).toBe("done");
    // Wren's step: the team marks it.
    await api().mark({ viewer: OP, client: "acme", account: id, setup: SETUP.id, step: "verify" });
    await refused(
      api().mark({ viewer: AMY, client: "beta", account: id, setup: SETUP.id, step: "dns" }),
      403,
    );
  });

  it("the team switches to done for you: the next generation", async () => {
    const { emits } = await api().start({
      viewer: OP,
      client: "acme",
      account: id,
      setup: SETUP.id,
      mode: "for_you",
    });
    expect(emits[0]?.events[0]?.subject).toBe(`account:${id}:g2`);
  });

  it("refuses the demo, and Wren's own accounts to a client", async () => {
    await refused(
      api().start({ viewer: { demo: true }, account: id, setup: SETUP.id }),
      403,
      /read-only/,
    );
    await refused(api().accounts({ viewer: AMY, client: "wren" }), 403);
    expect((await api().accounts({ viewer: ADMIN, client: "wren" })).owner).toEqual({
      id: null,
      name: "Wren",
    });
  });
});

describe("vendors", () => {
  it("no mode: every vendor needs setup for a client", async () => {
    const v = await api().vendors({ viewer: AMY, client: "acme" });
    expect(v.team).toBe(false);
    expect(v.mayMoney).toBe(false);
    expect(v.vendors.find((x) => x.id === "exa")).toMatchObject({
      mode: null,
      why: "Needs setup",
      keySet: false,
    });
    expect(v.vendors.find((x) => x.id === "linkedin")?.offered).toBe(false);
  });

  it("managed is money: an admin sets share and cap, an operator can't", async () => {
    await refused(
      api().setVendor({
        viewer: OP,
        client: "acme",
        vendor: "exa",
        mode: "managed",
        perDay: 10,
        capCents: 500,
      }),
      403,
      /admin/,
    );
    await refused(
      api().setVendor({ viewer: AMY, client: "acme", vendor: "exa", mode: "none" }),
      403,
    );
    await api().setVendor({
      viewer: ADMIN,
      client: "acme",
      vendor: "exa",
      mode: "managed",
      perDay: 10,
      capCents: 500,
    });
    await meter(pg.db, { client: "acme", vendor: "exa", units: 3, at: T });
    const exa = (await api().vendors({ viewer: AMY, client: "acme" })).vendors.find(
      (x) => x.id === "exa",
    );
    expect(exa).toMatchObject({ mode: "managed", capCents: 500, why: null });
    expect(exa?.month).toEqual({ units: 3, micros: 21_000 });
  });

  it("an own key saves by name and never comes back; no store refuses", async () => {
    await refused(
      api(null).setVendor({
        viewer: OP,
        client: "acme",
        vendor: "x",
        mode: "own",
        key: "synthetic-key-1234",
      }),
      409,
      /Key store/,
    );
    await api().setVendor({
      viewer: OP,
      client: "acme",
      vendor: "x",
      mode: "own",
      key: "synthetic-key-1234",
    });
    expect(keys.keys.get("/wren/test/owners/acme/keys/X_BEARER_TOKEN")).toBe("synthetic-key-1234");
    const v = await api().vendors({ viewer: ADMIN, client: "acme" });
    expect(JSON.stringify(v)).not.toContain("synthetic-key");
    expect(v.vendors.find((x) => x.id === "x")).toMatchObject({ mode: "own", keySet: true });
    await refused(
      api().setVendor({ viewer: OP, client: "acme", vendor: "reddit", mode: "own" }),
      409,
    );
    await api().setVendor({ viewer: OP, client: "acme", vendor: "x", mode: "none" });
    const x = (await api().vendors({ viewer: ADMIN, client: "acme" })).vendors.find(
      (r) => r.id === "x",
    );
    expect(x?.mode).toBe(null);
  });

  it("usage across clients is the team's", async () => {
    await refused(api().usage({ viewer: AMY }), 403);
    const u = await api().usage({ viewer: ADMIN });
    expect(u.rows).toEqual([
      {
        client: "acme",
        clientName: "Acme Dental",
        vendor: "exa",
        vendorName: "Exa search",
        mode: "managed",
        units: 3,
        unit: "searches",
        micros: 21_000,
      },
    ]);
  });
});
