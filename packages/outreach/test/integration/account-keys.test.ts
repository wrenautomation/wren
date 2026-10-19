/**
 * API keys sit beside logins on Marketing → Accounts (designs/2026-10-19-api-keys-as-accounts.md):
 * the operator's mirrored keys and each client's own, as `platform: "api"` rows with owner,
 * purposes, spend in dollars and last use. Postgres, synthetic keys, a fake `sites` source.
 */
import { clients } from "@wren/core/clients";
import { keyId } from "@wren/core/key-id";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { syncVaultKeys } from "@wren/core/vault-keys";
import { meter, setOwnKey } from "@wren/core/vendors";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount } from "../../src/accounts.js";
import { accountRecord } from "../../src/records.js";

let pg: TestPostgres;
const NOW = new Date();
const WREN_EXA = "wren-exa-key-44444444EEEE";
const ACME_EXA = "acme-exa-key-0000000000AAAA";
const BETA_EXA = "beta-exa-key-2222222222CCCC";
const sites = (keys: unknown[]) => ({ keys: async () => ({ keys }) });

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
});
afterAll(() => pg?.stop());
beforeEach(() =>
  truncate(pg.db, [
    "vault_keys",
    "vendor_usage",
    "vendor_modes",
    "client_secret_events",
    "client_secrets",
    "reach_accounts",
  ]),
);

async function ownKey(client: string, value: string) {
  const store = pgKeyStore(pg.db, throwawayRing());
  const { ref } = await store.stage({ client, name: "EXA_API_KEY", value, by: "op@example.test" });
  await setOwnKey(pg.db, store, { client, vendor: "exa", keyRef: ref, by: "op@example.test" });
  return { store, ref };
}

const rowsOf = async () =>
  ((await accountRecord.rows?.(pg.db)) ?? []) as Array<Record<string, unknown>>;

describe("marketing.account rows", () => {
  it("lists a login, an operator key and a client key, each with its own columns", async () => {
    await addAccount(pg.db, { platform: "reddit", account: "reddit@wren", now: NOW });
    await syncVaultKeys(
      pg.db,
      sites([
        {
          address: "exa@env-0",
          id: keyId(WREN_EXA),
          site: "exa",
          account: "env-0",
          owner: "wren",
          purposes: ["default", "bulk"],
          status: "spent",
          spentUntil: new Date(NOW.getTime() + 5 * 86_400_000).toISOString(),
          madeAt: "2026-10-01T00:00:00.000Z",
          uses: 3,
          lastUsedAt: "2026-10-18T09:00:00.000Z",
        },
      ]),
      { now: NOW },
    );
    const { store, ref } = await ownKey("acme", ACME_EXA);
    await store.get({ ref, client: "acme", by: "wren:vendors", why: "exa reads" });
    await meter(pg.db, {
      client: null,
      vendor: "exa",
      units: 10,
      micros: 1_500_000,
      keyId: keyId(WREN_EXA),
      at: NOW,
    });
    await meter(pg.db, {
      client: "acme",
      vendor: "exa",
      units: 10,
      micros: 250_000,
      keyId: keyId(ACME_EXA),
      at: NOW,
    });

    const rows = await rowsOf();
    const keys = rows.filter((r) => r.platform === "api");
    expect(rows.some((r) => r.platform === "reddit" && r.id === "reddit@wren")).toBe(true);
    expect(keys.map((r) => r.account)).toEqual(["exa@default", "exa@env-0"]);

    const op = keys.find((r) => r.account === "exa@env-0");
    expect(op).toMatchObject({
      origin: "vault",
      owner: "wren",
      purposes: "default, bulk",
      state: "spent",
      spend: 1.5,
      currency: "USD",
      lastUsed: "2026-10-18T09:00:00.000Z",
    });
    expect(op?.until).toEqual(expect.any(String));

    const cl = keys.find((r) => r.account === "exa@default");
    expect(cl).toMatchObject({
      origin: "client",
      owner: "acme",
      purposes: "default",
      state: "live",
      spend: 0.25,
      currency: "USD",
    });
    expect(cl?.lastUsed).toEqual(expect.any(String));
    // No row carries a key value.
    expect(JSON.stringify(rows)).not.toMatch(/exa-key-/);
  });

  it("spend sums by key id: two keys of a client keep their own", async () => {
    const a = await ownKey("beta", BETA_EXA);
    const second = await a.store.stage({
      client: "beta",
      name: "EXA_API_KEY",
      label: "bulk",
      value: `${BETA_EXA}x`,
      by: "op@example.test",
    });
    await a.store.bind({
      ref: second.ref,
      client: "beta",
      name: "EXA_API_KEY",
      label: "bulk",
      by: "op@example.test",
    });
    await meter(pg.db, {
      client: "beta",
      vendor: "exa",
      units: 1,
      micros: 400_000,
      keyId: keyId(BETA_EXA),
      at: NOW,
    });
    await meter(pg.db, {
      client: "beta",
      vendor: "exa",
      units: 1,
      micros: 100_000,
      keyId: keyId(BETA_EXA),
      at: NOW,
    });
    await meter(pg.db, {
      client: "beta",
      vendor: "exa",
      units: 1,
      micros: 300_000,
      keyId: keyId(`${BETA_EXA}x`),
      at: NOW,
    });
    const rows = await rowsOf();
    expect(rows.filter((r) => r.platform === "api").map((r) => [r.account, r.spend])).toEqual([
      ["exa@bulk", 0.3],
      ["exa@default", 0.5],
    ]);
  });
});
