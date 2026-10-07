/**
 * Whose key checks a Telnyx webhook (signer.ts): Wren's numbers on Wren's key, a client on its
 * own account on its saved public key, a client on Wren's account on Wren's key, and a path
 * naming someone other than the number's owner refused. Synthetic keys only.
 */
import { addClient } from "@wren/core/clients";
import { type KeyStore, pgKeyStore, throwawayRing } from "@wren/core/keys";
import { setManaged, setOwnKey } from "@wren/core/vendors";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeProvider } from "../../src/provider.js";
import { type SignerDeps, telnyxSigner } from "../../src/signer.js";
import { numbers } from "./fixtures.js";

let pg: TestPostgres;
let store: KeyStore;
let d: SignerDeps;
const ACME_PUB = `${"A".repeat(42)}c=`;
const WREN = "+15550009999";
const ACME = "+15550001111";
const BETA = "+15550002222";

beforeAll(async () => {
  pg = await startTestPostgres();
  store = pgKeyStore(pg.db, throwawayRing());
  const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
  for (const id of ["acme", "beta"])
    await addClient(pg.db, pg.url, { id, name: id, products: { "sms.texts": {} } });
  await numbers(pg.db, new FakeProvider(), [WREN]);
  await numbers(open("acme"), new FakeProvider(), [ACME]);
  await numbers(open("beta"), new FakeProvider(), [BETA]);
  const stage = async (name: string, value: string) =>
    (await store.stage({ client: "acme", name, value, by: "op@example.test" })).ref;
  await setOwnKey(pg.db, store, {
    client: "acme",
    vendor: "telnyx",
    keyRef: await stage("TELNYX_API_KEY", "acme-telnyx-333333333DDDD"),
    publicKeyRef: await stage("TELNYX_PUBLIC_KEY", ACME_PUB),
    by: "op@example.test",
  });
  await setManaged(pg.db, { client: "beta", vendor: "telnyx", perDay: 0, capCents: 0, by: "op" });
  d = { main: pg.db, clientDb: open, keys: store };
});
afterAll(() => pg.stop());

describe("telnyxSigner", () => {
  it("Wren's number: Wren's key, and never on a client's path", async () => {
    expect(await telnyxSigner(d, { number: WREN, client: null })).toEqual({
      ok: true,
      client: null,
      publicKey: null,
    });
    expect(await telnyxSigner(d, { number: WREN, client: "acme" })).toMatchObject({ ok: false });
  });

  it("a client on its own account: its saved public key, on either path", async () => {
    const own = { ok: true, client: "acme", publicKey: ACME_PUB };
    expect(await telnyxSigner(d, { number: ACME, client: null })).toEqual(own);
    expect(await telnyxSigner(d, { number: ACME, client: "acme" })).toEqual(own);
    // No number on the event: the path's owner.
    expect(await telnyxSigner(d, { number: null, client: "acme" })).toEqual(own);
  });

  it("a client on Wren's account: Wren's key, its database", async () => {
    expect(await telnyxSigner(d, { number: BETA, client: null })).toEqual({
      ok: true,
      client: "beta",
      publicKey: null,
    });
  });

  it("a path naming someone other than the number's owner is refused", async () => {
    expect(await telnyxSigner(d, { number: BETA, client: "acme" })).toMatchObject({ ok: false });
    expect(await telnyxSigner(d, { number: ACME, client: "beta" })).toMatchObject({ ok: false });
  });

  it("own with no public key saved is refused, never Wren's key", async () => {
    const noStore = { ...d, keys: null };
    expect(await telnyxSigner(noStore, { number: ACME, client: null })).toMatchObject({
      ok: false,
    });
  });
});
