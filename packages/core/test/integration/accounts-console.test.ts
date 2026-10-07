/**
 * AccountsConsole on Postgres: a client's people read their own accounts and mark their own
 * steps; Wren's team adds accounts, starts done for you and sets vendors; money needs an admin;
 * a key is saved by ref and never read back. Synthetic clients only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WREN } from "../../src/access.js";
import { accountsApi } from "../../src/accounts-console.js";
import { clientMembers, clients } from "../../src/clients/schema.js";
import { PortalRefusal, type Viewer } from "../../src/portal.js";
import { defineSetup } from "../../src/setup.js";
import { setupAlert } from "../../src/setup-alerts.js";
import { clientAccounts } from "../../src/setup-schema.js";
import { pgKeyStore, throwawayRing } from "../../src/keys.js";
import { meter } from "../../src/vendors.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  keys = pgKeyStore(pg.db, throwawayRing());
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

let keys: ReturnType<typeof pgKeyStore>;
const T = new Date("2026-03-10T12:00:00Z");
const api = (store = keys as typeof keys | null) =>
  accountsApi({
    db: pg.db,
    setups: [SETUP],
    checks: new Set(["dns.mail_records"]),
    keys: store,
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
    expect(exa).toMatchObject({ mode: "managed", capCents: 500, why: null, capped: null });
    expect(exa?.month).toEqual({
      managed: { units: 3, micros: 21_000 },
      own: { units: 0, micros: 0 },
    });
  });

  it("an own key saves by ref and never comes back; no store refuses", async () => {
    const VALUE = "synthetic-key-1234";
    const { ref } = await keys.stage({
      client: "acme",
      name: "X_BEARER_TOKEN",
      value: VALUE,
      by: OP.email,
    });
    await refused(
      api(null).setVendor({ viewer: OP, client: "acme", vendor: "x", mode: "own", keyRef: ref }),
      409,
      /Key store/,
    );
    await refused(
      api().setVendor({ viewer: ADMIN, client: "acme", vendor: "x", mode: "own", keyRef: ref }),
      403,
      /Someone else/,
    );
    await api().setVendor({ viewer: OP, client: "acme", vendor: "x", mode: "own", keyRef: ref });
    expect(await keys.get({ ref, client: "acme", by: "test", why: "check" })).toBe(VALUE);
    const v = await api().vendors({ viewer: ADMIN, client: "acme" });
    expect(JSON.stringify(v)).not.toContain("synthetic-key");
    expect(v.vendors.find((x) => x.id === "x")).toMatchObject({
      mode: "own",
      keySet: true,
      keyLast4: "1234",
    });
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

  it("a free vendor on Wren's key: today's room, no cap", async () => {
    await api().setVendor({
      viewer: ADMIN,
      client: "acme",
      vendor: "youtube",
      mode: "managed",
      perDay: 50,
      capCents: 0,
    });
    const yt = (await api().vendors({ viewer: ADMIN, client: "acme" })).vendors.find(
      (x) => x.id === "youtube",
    );
    expect(yt).toMatchObject({ free: true, why: null, capped: null, room: 10 });
    // A paid vendor with no cap: today still says its room; the cap says why nothing runs.
    await api().setVendor({
      viewer: ADMIN,
      client: "acme",
      vendor: "telnyx",
      mode: "managed",
      perDay: 0,
      capCents: 0,
    });
    const tx = (await api().vendors({ viewer: ADMIN, client: "acme" })).vendors.find(
      (x) => x.id === "telnyx",
    );
    expect(tx).toMatchObject({ free: false, why: null, room: null, capped: "No monthly cap set" });
  });

  it("usage across clients is the team's; totals count Wren's key only", async () => {
    await refused(api().usage({ viewer: AMY }), 403);
    await api().setVendor({
      viewer: OP,
      client: "acme",
      vendor: "x",
      mode: "own",
      key: "synthetic-key-1234",
    });
    await meter(pg.db, { client: "acme", vendor: "x", units: 100, at: T });
    const u = await api().usage({ viewer: ADMIN });
    expect(u.rows).toEqual([
      {
        client: "acme",
        clientName: "Acme Dental",
        vendor: "x",
        vendorName: "X API",
        mode: "own",
        units: 100,
        unit: "post reads",
        micros: 500_000,
      },
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
    expect(u.total).toBe(21_000);
    expect(u.owners).toEqual([{ client: "acme", name: "Acme Dental", micros: 21_000 }]);
    const x = (await api().vendors({ viewer: ADMIN, client: "acme" })).vendors.find(
      (r) => r.id === "x",
    );
    expect(x?.month).toEqual({
      managed: { units: 0, micros: 0 },
      own: { units: 100, micros: 500_000 },
    });
  });
});

describe("now", () => {
  it("the team sees what it acts on across clients; a client's people see theirs", async () => {
    const [acct] = await pg.db
      .select()
      .from(clientAccounts)
      .where(eq(clientAccounts.client, "acme"));
    if (!acct) throw new Error("no account");
    const base = { account: acct, siteLabel: "Sending domain", now: T };
    const step = { id: "dns", label: "Mail records", fact: "t.dns", who: "client" as const };
    await setupAlert(pg.db, {
      ...base,
      kind: "waiting",
      step,
      mode: "self",
      why: null,
      change: "a",
    });
    await setupAlert(pg.db, {
      ...base,
      kind: "stuck",
      step: { ...step, who: "wren", within: "2 days" },
      mode: "self",
      why: "Past its time",
      change: "b",
    });

    // At Wren: every client's items the team acts on (the stuck one), named by client.
    const team = await api().now({ viewer: ADMIN, client: WREN });
    expect(team.items.map((x) => [x.kind, x.clientName])).toEqual([["stuck", "Acme Dental"]]);
    expect(team.items[0]).not.toHaveProperty("key");
    // Amy's Now: her own step; the badge counts it.
    const amy = await api().now({ viewer: AMY, client: "acme" });
    expect(amy.items.map((x) => x.kind)).toEqual(["waiting"]);
    expect(amy.count).toBe(1);
    // Another client's person can't read it; nor can a client at Wren.
    await refused(api().now({ viewer: { email: "bo@beta.example" }, client: "acme" }), 403);
    await refused(api().now({ viewer: AMY, client: WREN }), 403);
    // The account's timeline carries both.
    const view = await api().accounts({ viewer: AMY, client: "acme" });
    expect(view.accounts[0]?.timeline.map((x) => x.kind)).toEqual(["stuck", "waiting"]);
  });
});
