/**
 * Several keys per client per name (labels), the resolver by purpose, the key id on usage rows
 * and usage per key. Synthetic keys only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients } from "../../src/clients/schema.js";
import { keyId } from "../../src/key-id.js";
import { KeyRefusal, type KeyStore, pgKeyStore, throwawayRing } from "../../src/keys.js";
import { clientSecretEvents, clientSecrets } from "../../src/keys-schema.js";
import { VendorKeyMissing, vendorKey, vendorKeys } from "../../src/vendor-keys.js";
import { vendorUsage } from "../../src/vendor-schema.js";
import { meter, modesOf, setOwnKey, setPurposeKey, usageByKey } from "../../src/vendors.js";

let pg: TestPostgres;
let store: KeyStore;
const BY = "op@example.test";
const DEFAULT_KEY = "acme-exa-default-0000000000AAAA";
const BULK_KEY = "acme-exa-bulk-11111111111BBBB";
const BULK_KEY_2 = "acme-exa-bulk-22222222222CCCC";

beforeAll(async () => {
  pg = await startTestPostgres();
  store = pgKeyStore(pg.db, throwawayRing());
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
});
afterAll(() => pg.stop());

const live = () => pg.db.select().from(clientSecrets).where(eq(clientSecrets.state, "live"));

describe("labels", () => {
  it("keeps two live keys of one name under two labels, and a second version under one", async () => {
    const a = await store.put({ client: "acme", name: "EXA_API_KEY", value: DEFAULT_KEY, by: BY });
    const b = await store.put({
      client: "acme",
      name: "EXA_API_KEY",
      label: "bulk-2",
      value: BULK_KEY,
      by: BY,
    });
    expect(a).toMatchObject({ label: "default", version: 1 });
    expect(b).toMatchObject({ label: "bulk-2", version: 1 });
    expect(b.ref).not.toBe(a.ref);

    // A key put again under its label is its next version, same ref.
    const b2 = await store.put({
      client: "acme",
      name: "EXA_API_KEY",
      label: "bulk-2",
      value: BULK_KEY_2,
      by: BY,
    });
    expect(b2).toMatchObject({ ref: b.ref, label: "bulk-2", version: 2 });
    expect((await live()).length).toBe(2);

    expect(await store.named({ client: "acme", name: "EXA_API_KEY", by: BY, why: "t" })).toBe(
      DEFAULT_KEY,
    );
    expect(
      await store.named({ client: "acme", name: "EXA_API_KEY", label: "bulk-2", by: BY, why: "t" }),
    ).toBe(BULK_KEY_2);
    expect(
      await store.named({ client: "acme", name: "EXA_API_KEY", label: "nope", by: BY, why: "t" }),
    ).toBeNull();
  });

  it("binds a staged key under its label: a second version of that label's ref", async () => {
    const first = await store.stage({
      client: "beta",
      name: "EXA_API_KEY",
      label: "drafts",
      value: DEFAULT_KEY,
      by: BY,
    });
    const bound = await store.bind({
      ref: first.ref,
      client: "beta",
      name: "EXA_API_KEY",
      label: "drafts",
      by: BY,
    });
    expect(bound).toMatchObject({ ref: first.ref, label: "drafts", version: 1 });
    const next = await store.stage({
      client: "beta",
      name: "EXA_API_KEY",
      label: "drafts",
      value: BULK_KEY,
      by: BY,
    });
    // Bound under the wrong label: refused.
    await expect(
      store.bind({ ref: next.ref, client: "beta", name: "EXA_API_KEY", by: BY }),
    ).rejects.toThrow("saved for something else");
    expect(
      await store.bind({
        ref: next.ref,
        client: "beta",
        name: "EXA_API_KEY",
        label: "drafts",
        by: BY,
      }),
    ).toMatchObject({ ref: first.ref, version: 2 });
  });

  it("refuses a bad label with the rule, never the value", async () => {
    const err = await store
      .put({ client: "acme", name: "EXA_API_KEY", label: "Bad Label", value: BULK_KEY, by: BY })
      .catch((e) => e);
    expect(err).toBeInstanceOf(KeyRefusal);
    expect(err.message).toContain("A label is");
    expect(err.message).not.toContain(BULK_KEY);
  });
});

describe("the resolver by purpose", () => {
  const exa = async (client: string, purpose?: string) =>
    vendorKey(pg.db, client, "exa", { keys: store, why: "t", ...(purpose ? { purpose } : {}) });

  it("picks the purpose's row, falls back to default, and refuses own with no key", async () => {
    // The default row: the client's default-labelled key.
    const staged = await store.stage({
      client: "acme",
      name: "EXA_API_KEY",
      value: DEFAULT_KEY,
      by: BY,
    });
    await setOwnKey(pg.db, store, { client: "acme", vendor: "exa", keyRef: staged.ref, by: BY });
    const bulkRef = (
      await store.put({
        client: "acme",
        name: "EXA_API_KEY",
        label: "bulk-2",
        value: BULK_KEY_2,
        by: BY,
      })
    ).ref;
    await setPurposeKey(pg.db, store, {
      client: "acme",
      vendor: "exa",
      purpose: "bulk",
      keyRef: bulkRef,
      by: BY,
    });

    expect(await exa("acme")).toMatchObject({ mode: "own", key: DEFAULT_KEY });
    expect(await exa("acme", "bulk")).toMatchObject({
      mode: "own",
      key: BULK_KEY_2,
      id: keyId(BULK_KEY_2),
      source: `store:${bulkRef}`,
    });
    // A purpose with no row of its own uses default's key.
    expect(await exa("acme", "drafts")).toMatchObject({ mode: "own", key: DEFAULT_KEY });
    // The Vendors page's rows stay the default ones.
    expect((await modesOf(pg.db, "acme")).map((r) => [r.vendor, r.purpose])).toEqual([
      ["exa", "default"],
    ]);

    // A purpose row whose key was deleted: refused, never default's, never Wren's.
    await store.delete({ ref: bulkRef, client: "acme", by: BY });
    await expect(exa("acme", "bulk")).rejects.toBeInstanceOf(VendorKeyMissing);
    expect(await exa("acme")).toMatchObject({ key: DEFAULT_KEY });
  });

  it("refuses a key of another vendor name, another client's key, and a bad purpose", async () => {
    const stripe = await store.put({
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: "sk_test_synthetic000000000000",
      by: BY,
    });
    await expect(
      setPurposeKey(pg.db, store, {
        client: "acme",
        vendor: "exa",
        purpose: "bulk",
        keyRef: stripe.ref,
        by: BY,
      }),
    ).rejects.toThrow("takes a EXA_API_KEY");
    await expect(
      setPurposeKey(pg.db, store, {
        client: "beta",
        vendor: "exa",
        purpose: "bulk",
        keyRef: stripe.ref,
        by: BY,
      }),
    ).rejects.toThrow("No such key for that client");
    await expect(
      setPurposeKey(pg.db, store, {
        client: "acme",
        vendor: "exa",
        purpose: "Bulk Purpose",
        keyRef: stripe.ref,
        by: BY,
      }),
    ).rejects.toThrow("purpose:");
  });

  it("caches per purpose: one read each", async () => {
    const reads = async () =>
      (await pg.db.select().from(clientSecretEvents).where(eq(clientSecretEvents.op, "read")))
        .length;
    const r = vendorKeys({ main: pg.db, keys: store });
    const before = await reads();
    await r.key("acme", "exa", "t");
    await r.key("acme", "exa", "t");
    expect((await reads()) - before).toBe(1);
    await r.key("acme", "exa", "t", "drafts");
    await r.key("acme", "exa", "t", "drafts");
    expect((await reads()) - before).toBe(2);
  });
});

describe("key id on usage", () => {
  it("meter writes key_id, use passes the resolved key's id, null where a path holds the key", async () => {
    await meter(pg.db, { client: "acme", vendor: "exa", units: 2, keyId: "abc123abc123" });
    await vendorKeys({ main: pg.db, keys: store }).use(
      { client: "acme", vendor: "exa", why: "t", spent: () => ({ units: 3 }) },
      async () => null,
    );
    await meter(pg.db, { client: null, vendor: "exa", units: 5 });
    const rows = await pg.db.select().from(vendorUsage).orderBy(vendorUsage.id);
    expect(rows.map((r) => r.keyId)).toEqual(["abc123abc123", keyId(DEFAULT_KEY), null]);
  });

  it("usageByKey sums one month per key and leaves keyless rows out", async () => {
    const may = new Date("2026-05-10T00:00:00Z");
    const june = new Date("2026-06-10T00:00:00Z");
    await meter(pg.db, {
      client: "acme",
      vendor: "exa",
      units: 10,
      keyId: "kkkkkkkkkkkk",
      at: may,
    });
    await meter(pg.db, {
      client: "acme",
      vendor: "exa",
      units: 4,
      keyId: "kkkkkkkkkkkk",
      at: june,
    });
    await meter(pg.db, {
      client: "acme",
      vendor: "exa",
      units: 6,
      keyId: "kkkkkkkkkkkk",
      at: june,
    });
    await meter(pg.db, {
      client: "acme",
      vendor: "exa",
      units: 1,
      keyId: "jjjjjjjjjjjj",
      at: june,
    });
    const m = await usageByKey(pg.db, { since: new Date("2026-06-01T00:00:00Z") });
    expect(m.get("kkkkkkkkkkkk")).toEqual({ units: 10, micros: expect.any(Number), calls: 2 });
    expect(m.get("jjjjjjjjjjjj")).toMatchObject({ units: 1, calls: 1 });
    expect([...m.keys()]).not.toContain("null");
    const all = await usageByKey(pg.db, { since: may });
    expect(all.get("kkkkkkkkkkkk")).toMatchObject({ units: 20, calls: 3 });
  });
});
