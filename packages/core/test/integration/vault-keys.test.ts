/**
 * The operator's keys, mirrored (designs/2026-10-19-api-keys-as-accounts.md): `syncVaultKeys` from
 * a fake `sites` client (upsert, delete what the vault no longer lists, drop a row that carries a
 * secret), and `keyAccounts`, both kinds as one list: the vault's and each client's own, with
 * spend by key id, purposes, last use, and a client that sees only its own. Synthetic keys only.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clients } from "../../src/clients/schema.js";
import { keyId } from "../../src/key-id.js";
import { type KeyStore, pgKeyStore, throwawayRing } from "../../src/keys.js";
import { clientSecrets, vaultKeys } from "../../src/keys-schema.js";
import { type KeyRow, keyAccounts, syncVaultKeys } from "../../src/vault-keys.js";
import { meter, setOwnKey, setPurposeKey } from "../../src/vendors.js";

let pg: TestPostgres;
let store: KeyStore;
const NOW = new Date("2026-10-19T12:00:00Z");
const ACME_EXA = "acme-exa-key-0000000000AAAA";
const ACME_EXA_BULK = "acme-exa-bulk-1111111111BBBB";
const BETA_EXA = "beta-exa-key-2222222222CCCC";
const WREN_ANTHROPIC = "wren-anthropic-key-33333333DDDD";
const WREN_EXA = "wren-exa-key-44444444EEEE";

const row = (o: Partial<KeyRow> & Pick<KeyRow, "site" | "account">): KeyRow => ({
  address: `${o.site}@${o.account}`,
  id: keyId(`${o.site}-${o.account}-synthetic`),
  owner: "wren",
  purposes: ["default"],
  status: "live",
  madeAt: "2026-10-01T00:00:00.000Z",
  uses: 0,
  lastUsedAt: null,
  ...o,
});
const source = (keys: unknown[]) => ({ keys: async () => ({ keys }) });

beforeAll(async () => {
  pg = await startTestPostgres();
  store = pgKeyStore(pg.db, throwawayRing());
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["vault_keys", "vendor_usage"]));

describe("syncVaultKeys", () => {
  it("upserts every row and stamps read_at", async () => {
    const warn: string[] = [];
    const a = row({ site: "anthropic", account: "autobrowse-prod", via: "anthropic@william" });
    const b = row({ site: "exa", account: "env-0", uses: 7, lastUsedAt: "2026-10-18T09:00:00Z" });
    const out = await syncVaultKeys(pg.db, source([a, b]), { now: NOW, warn: (l) => warn.push(l) });
    expect(out).toEqual({ keys: 2, removed: 0, refused: 0 });
    const rows = await pg.db.select().from(vaultKeys).orderBy(vaultKeys.address);
    expect(rows.map((r) => [r.address, r.site, r.account, r.owner, r.keyId])).toEqual([
      ["anthropic@autobrowse-prod", "anthropic", "autobrowse-prod", "wren", a.id],
      ["exa@env-0", "exa", "env-0", "wren", b.id],
    ]);
    expect(rows[0]).toMatchObject({ via: "anthropic@william", purposes: ["default"] });
    expect(rows[1]).toMatchObject({ uses: 7, lastUsedAt: new Date("2026-10-18T09:00:00Z") });
    expect(rows.every((r) => r.readAt.getTime() === NOW.getTime())).toBe(true);
    expect(warn).toEqual([]);

    // Again: the same rows update, none doubles; a status change and a spent date land.
    const later = new Date("2026-10-19T13:00:00Z");
    await syncVaultKeys(
      pg.db,
      source([a, { ...b, status: "spent", spentUntil: "2026-11-01T00:00:00.000Z" }]),
      { now: later },
    );
    const again = await pg.db.select().from(vaultKeys).orderBy(vaultKeys.address);
    expect(again).toHaveLength(2);
    expect(again[1]).toMatchObject({
      status: "spent",
      spentUntil: new Date("2026-11-01T00:00:00Z"),
    });
    expect(again[0]?.readAt).toEqual(later);
  });

  it("deletes the addresses the vault no longer lists", async () => {
    const a = row({ site: "exa", account: "env-0" });
    const b = row({ site: "exa", account: "env-1" });
    await syncVaultKeys(pg.db, source([a, b]), { now: NOW });
    const out = await syncVaultKeys(pg.db, source([a]), { now: NOW });
    expect(out).toMatchObject({ keys: 1, removed: 1 });
    expect((await pg.db.select().from(vaultKeys)).map((r) => r.address)).toEqual(["exa@env-0"]);
    expect(await syncVaultKeys(pg.db, source([]), { now: NOW })).toMatchObject({ removed: 1 });
    expect(await pg.db.select().from(vaultKeys)).toEqual([]);
  });

  it("drops a row that carries a secret, and logs its address, never the value", async () => {
    const warn: string[] = [];
    const good = row({ site: "exa", account: "env-0" });
    const leaky = {
      ...row({ site: "exa", account: "env-1" }),
      secret: "leaked-synthetic-value-9999",
    };
    const out = await syncVaultKeys(pg.db, source([good, leaky]), {
      now: NOW,
      warn: (l) => warn.push(l),
    });
    expect(out).toEqual({ keys: 1, removed: 0, refused: 1 });
    expect((await pg.db.select().from(vaultKeys)).map((r) => r.address)).toEqual(["exa@env-0"]);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain("exa@env-1");
    expect(warn.join()).not.toContain("leaked-synthetic-value-9999");
    // A row already mirrored that now carries a secret goes too: it is not shown.
    await syncVaultKeys(pg.db, source([good]), { now: NOW });
    await syncVaultKeys(pg.db, source([{ ...good, secret: "x" }]), { now: NOW, warn: () => {} });
    expect(await pg.db.select().from(vaultKeys)).toHaveLength(0);
  });

  it("drops a row that doesn't fit the shape", async () => {
    const warn: string[] = [];
    const out = await syncVaultKeys(
      pg.db,
      source([row({ site: "exa", account: "env-0" }), { address: "exa@bad", id: "not-hex" }, null]),
      { now: NOW, warn: (l) => warn.push(l) },
    );
    expect(out).toMatchObject({ keys: 1, refused: 2 });
    expect(warn).toHaveLength(2);
  });
});

describe("keyAccounts", () => {
  async function own(client: string, name: string, label: string, value: string) {
    const { ref } = await store.stage({ client, name, label, value, by: "op@example.test" });
    return (await store.bind({ ref, client, name, label, by: "op@example.test" })).ref;
  }

  it("lists the operator's keys and each client's own, with the shapes the page reads", async () => {
    await truncate(pg.db, ["vendor_modes", "client_secret_events", "client_secrets"]);
    const anth = row({ site: "anthropic", account: "autobrowse-prod", id: keyId(WREN_ANTHROPIC) });
    const exa = row({
      site: "exa",
      account: "env-0",
      id: keyId(WREN_EXA),
      status: "spent",
      spentUntil: "2026-11-01T00:00:00.000Z",
      purposes: ["default", "bulk"],
      lastUsedAt: "2026-10-18T09:00:00.000Z",
    });
    await syncVaultKeys(pg.db, source([anth, exa]), { now: NOW });
    const acmeDefault = await own("acme", "EXA_API_KEY", "default", ACME_EXA);
    const acmeBulk = await own("acme", "EXA_API_KEY", "bulk-2", ACME_EXA_BULK);
    await own("beta", "EXA_API_KEY", "default", BETA_EXA);
    // Not an API key: a mailbox token is no account of this kind.
    await own("acme", "STRIPE_WEBHOOK_SECRET", "default", "whsec_synthetic0000000000");
    await setOwnKey(pg.db, store, { client: "acme", vendor: "exa", keyRef: acmeDefault, by: "op" });
    await setPurposeKey(pg.db, store, {
      client: "acme",
      vendor: "exa",
      purpose: "bulk",
      keyRef: acmeBulk,
      by: "op",
    });
    // A read of the bulk key, then spend on three keys this month and one last month.
    await store.get({ ref: acmeBulk, client: "acme", by: "wren:vendors", why: "exa reads" });
    await meter(pg.db, {
      client: null,
      vendor: "exa",
      units: 100,
      micros: 700_000,
      keyId: keyId(WREN_EXA),
      at: new Date("2026-10-05T00:00:00Z"),
    });
    await meter(pg.db, {
      client: null,
      vendor: "exa",
      units: 10,
      micros: 300_000,
      keyId: keyId(WREN_EXA),
      at: new Date("2026-10-10T00:00:00Z"),
    });
    await meter(pg.db, {
      client: null,
      vendor: "exa",
      units: 10,
      micros: 900_000,
      keyId: keyId(WREN_EXA),
      at: new Date("2026-09-30T00:00:00Z"),
    });
    await meter(pg.db, {
      client: "acme",
      vendor: "exa",
      units: 5,
      micros: 250_000,
      keyId: keyId(ACME_EXA_BULK),
      at: new Date("2026-10-12T00:00:00Z"),
    });

    const all = await keyAccounts(pg.db, { now: NOW });
    const by = new Map(all.map((k) => [`${k.origin}:${k.owner}:${k.address}`, k]));
    expect([...by.keys()].sort()).toEqual([
      "client:acme:exa@bulk-2",
      "client:acme:exa@default",
      "client:beta:exa@default",
      "vault:wren:anthropic@autobrowse-prod",
      "vault:wren:exa@env-0",
    ]);

    // Operator key: spend sums by key id this month only; spent keeps its date; last used from the vault.
    expect(by.get("vault:wren:exa@env-0")).toMatchObject({
      id: "exa@env-0",
      vendor: "exa",
      state: "spent",
      purposes: ["default", "bulk"],
      spendMicros: 1_000_000,
      keyId: keyId(WREN_EXA),
      lastUsedAt: new Date("2026-10-18T09:00:00Z"),
    });
    expect(by.get("vault:wren:exa@env-0")?.until).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(by.get("vault:wren:anthropic@autobrowse-prod")).toMatchObject({
      state: "live",
      spendMicros: 0,
      until: null,
    });

    // Client keys: vendor from the name, label as the account, purposes from vendor_modes, the
    // last read as last used, spend by the key's id.
    expect(by.get("client:acme:exa@bulk-2")).toMatchObject({
      id: acmeBulk,
      vendor: "exa",
      state: "live",
      purposes: ["bulk"],
      spendMicros: 250_000,
      keyId: keyId(ACME_EXA_BULK),
    });
    expect(by.get("client:acme:exa@bulk-2")?.lastUsedAt).toBeInstanceOf(Date);
    expect(by.get("client:acme:exa@default")).toMatchObject({
      purposes: ["default"],
      spendMicros: 0,
      lastUsedAt: null,
    });
  });

  it("a client sees only its own keys, never the operator's", async () => {
    const acme = await keyAccounts(pg.db, { now: NOW, client: "acme" });
    expect(acme.map((k) => k.address).sort()).toEqual(["exa@bulk-2", "exa@default"]);
    expect(acme.every((k) => k.origin === "client" && k.owner === "acme")).toBe(true);
    expect((await keyAccounts(pg.db, { now: NOW, client: "beta" })).map((k) => k.owner)).toEqual([
      "beta",
    ]);
    expect(await keyAccounts(pg.db, { now: NOW, client: "nobody" })).toEqual([]);
  });

  it("filters by vendor, and a spent key past its date reads live", async () => {
    await syncVaultKeys(
      pg.db,
      source([
        row({
          site: "exa",
          account: "env-0",
          status: "spent",
          spentUntil: "2026-10-01T00:00:00.000Z",
        }),
        row({ site: "anthropic", account: "autobrowse-prod" }),
      ]),
      { now: NOW },
    );
    const exa = await keyAccounts(pg.db, { now: NOW, vendor: "exa" });
    expect(exa.filter((k) => k.origin === "vault")).toEqual([
      expect.objectContaining({ address: "exa@env-0", state: "live", until: null }),
    ]);
    expect(exa.some((k) => k.vendor !== "exa")).toBe(false);
  });

  it("a key saved before its id was kept shows the client's own-key spend only when it is the only one", async () => {
    await truncate(pg.db, ["vendor_modes", "client_secret_events", "client_secrets"]);
    const only = await own("beta", "EXA_API_KEY", "default", BETA_EXA);
    await setOwnKey(pg.db, store, { client: "beta", vendor: "exa", keyRef: only, by: "op" });
    await meter(pg.db, {
      client: "beta",
      vendor: "exa",
      units: 1,
      micros: 500_000,
      at: new Date("2026-10-03T00:00:00Z"),
    });
    await pg.db.update(clientSecrets).set({ keyId: null }).where(eq(clientSecrets.client, "beta"));
    const [k] = await keyAccounts(pg.db, { now: NOW, client: "beta" });
    expect(k).toMatchObject({ id: only, keyId: null, spendMicros: 500_000 });
    // A second key: the bucket can't say which one spent it.
    await own("beta", "EXA_API_KEY", "second", `${BETA_EXA}x`);
    await pg.db.update(clientSecrets).set({ keyId: null }).where(eq(clientSecrets.client, "beta"));
    const two = await keyAccounts(pg.db, { now: NOW, client: "beta" });
    expect(two.map((x) => x.spendMicros)).toEqual([null, null]);
  });
});
