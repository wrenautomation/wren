/**
 * Connectors on a real Postgres (designs/2026-10-09-connectors.md): a sign-in spent once, its
 * token kept in the key store and refreshed (a rotated refresh token kept), a sync's people handed
 * to the CRM, each change told once and nothing from before the link, a revoked grant breaking the
 * link, and disconnect. Fake apps, no network. Synthetic data only.
 */
import { addClient } from "@wren/core/clients";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectorAccess } from "../../src/connectors.js";
import type { Pulled, Puller } from "../../src/pull/types.js";
import { connectorFired, connectorLinks } from "../../src/schema.js";
import { type CrmLanding, syncLink } from "../../src/sync.js";

let pg: TestPostgres;
let keys: ReturnType<typeof pgKeyStore>;
let clock = new Date("2026-10-09T12:00:00Z");
const now = () => clock;

/** The apps' token and who-am-I endpoints. */
let tokenSays: () => Response;
const tokenCalls: string[] = [];
const fetch = async (url: string, init: RequestInit) => {
  if (url.includes("oauth/v1/token")) {
    tokenCalls.push(String(init.body));
    return tokenSays();
  }
  if (url.includes("/oauth/v1/access-tokens/"))
    return Response.json({ hub_id: 4242, hub_domain: "acme-test.hubspot.com" });
  return new Response("{}", { status: 404 });
};
const tokens = (access: string, refresh: string) => () =>
  Response.json({ access_token: access, refresh_token: refresh, expires_in: 1800 });

const access = () =>
  connectorAccess({
    main: pg.db,
    apps: async () => ({ hubspot: { id: "app", secret: "shh" } }),
    keys,
    origin: "https://app.wren.test",
    fetch,
    now,
  });

const landed: { ref: string; csv: string }[] = [];
const crm: CrmLanding = {
  async land(_db, o) {
    landed.push({ ref: o.ref, csv: new TextDecoder().decode(o.csv) });
  },
  async contacts(_db, _f, ids) {
    return ids.map((id) => ({ id, email: `kept${id}@example.test`, phone: "+14165550100" }));
  },
};
let pulled: Pulled;
const tokensSeen: string[] = [];
const puller: Puller = async (i) => {
  tokensSeen.push(i.token);
  return pulled;
};
const sync = (id: number) =>
  syncLink(
    {
      main: pg.db,
      clientDb: () => pg.db,
      crm,
      access: access(),
      fetch,
      pullers: { hubspot: puller },
      now,
    },
    id,
  );

const person = (id: string, created: string) => ({
  id,
  firstName: "Ada",
  lastName: `Test${id}`,
  fullName: null,
  email: null,
  phone: null,
  company: null,
  website: null,
  title: null,
  status: null,
  created,
  lastContacted: null,
});

beforeAll(async () => {
  pg = await startTestPostgres();
  keys = pgKeyStore(pg.db, throwawayRing());
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
});
afterAll(async () => {
  await pg?.stop();
});

let linkId = 0;

describe("connectors", () => {
  it("connects once per sign-in and keeps the token in the key store", async () => {
    const a = access();
    expect((await a.view("acme")).apps.find((x) => x.app === "hubspot")?.state).toBe(
      "not_connected",
    );
    expect((await a.view("acme")).apps.find((x) => x.app === "jobber")?.state).toBe("needs_setup");
    const url = new URL(
      await a.connect({ client: "acme", app: "hubspot", by: "Ada@example.test" }),
    );
    const state = url.searchParams.get("state") ?? "";
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.wren.test/oauth/connector/hubspot",
    );
    tokenSays = tokens("acc-1", "ref-1");
    const r = await a.land({ app: "hubspot", state, code: "code-1" });
    expect(r).toMatchObject({ ok: true, said: expect.stringContaining("acme-test.hubspot.com") });
    linkId = r.link ?? 0;
    const again = await a.land({ app: "hubspot", state, code: "code-1" });
    expect(again.ok).toBe(false);
    const [l] = await pg.db.select().from(connectorLinks).where(eq(connectorLinks.id, linkId));
    expect(l).toMatchObject({ client: "acme", externalId: "4242", by: "ada@example.test" });
    expect(JSON.stringify(l)).not.toContain("acc-1");
    const v = await keys.get({ ref: l?.tokenRef ?? "", client: "acme", by: "t", why: "t" });
    expect(JSON.parse(v ?? "{}")).toMatchObject({ access: "acc-1", refresh: "ref-1" });
  });

  it("syncs: people to the CRM, news fired once, nothing from before the link", async () => {
    const [l] = await pg.db.select().from(connectorLinks).where(eq(connectorLinks.id, linkId));
    const made = l?.connectedAt.toISOString() ?? "";
    const after = new Date(Date.parse(made) + 60_000).toISOString();
    pulled = {
      people: [person("1", "2026-01-01T00:00:00Z"), person("2", after)],
      changes: [
        {
          key: "contact:1",
          change: "contact_added",
          at: "2026-01-01T00:00:00Z",
          person: "1",
          data: {},
        },
        { key: "contact:2", change: "contact_added", at: after, person: "2", data: {} },
      ],
      cursor: { contacts: after },
      more: false,
    };
    const out = await sync(linkId);
    expect(tokensSeen.at(-1)).toBe("acc-1");
    expect(out.people).toBe(2);
    expect(landed.at(-1)?.csv.split("\r\n")[0]).toContain("first name");
    expect(out.fired).toHaveLength(1);
    expect(out.fired[0]).toMatchObject({
      client: "acme",
      facts: { trigger: "trigger.app", app: "hubspot", change: "contact_added" },
      about: ["kept2@example.test"],
      event: { subject: "hubspot:contact:2", kind: "person", data: { name: "Ada Test2" } },
    });
    const twice = await sync(linkId);
    expect(twice.fired).toHaveLength(0);
    const [n] = await pg.db.select().from(connectorLinks).where(eq(connectorLinks.id, linkId));
    expect(n).toMatchObject({ people: 4, fired: 1, cursor: { contacts: after } });
    expect(await pg.db.select().from(connectorFired)).toHaveLength(1);
  });

  it("refreshes an expired token and keeps the rotated refresh token", async () => {
    clock = new Date(clock.getTime() + 2 * 3600_000);
    tokenSays = tokens("acc-2", "ref-2");
    pulled = { people: [], changes: [], cursor: {}, more: false };
    await sync(linkId);
    expect(tokensSeen.at(-1)).toBe("acc-2");
    expect(tokenCalls.at(-1)).toContain("refresh_token=ref-1");
    const [l] = await pg.db.select().from(connectorLinks).where(eq(connectorLinks.id, linkId));
    const v = await keys.get({ ref: l?.tokenRef ?? "", client: "acme", by: "t", why: "t" });
    expect(JSON.parse(v ?? "{}")).toMatchObject({ refresh: "ref-2" });
  });

  it("breaks on a revoked grant, then stops", async () => {
    clock = new Date(clock.getTime() + 2 * 3600_000);
    tokenSays = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    const out = await sync(linkId);
    expect(out.state).toBe("broken");
    expect((await access().view("acme")).apps.find((x) => x.app === "hubspot")?.state).toBe(
      "broken",
    );
    expect((await sync(linkId)).state).toBe("broken");
  });

  it("disconnects: the link and its token gone", async () => {
    const [l] = await pg.db.select().from(connectorLinks).where(eq(connectorLinks.id, linkId));
    expect(await access().disconnect({ client: "acme", id: linkId, by: "ada@example.test" })).toBe(
      true,
    );
    expect(await keys.info({ ref: l?.tokenRef ?? "", client: "acme" })).toBeNull();
    expect(await pg.db.select().from(connectorFired)).toHaveLength(0);
    expect((await sync(linkId)).state).toBe("gone");
  });
});
