/**
 * The vendor key resolver on Postgres: own reads the store with a reason, managed runs on Wren's
 * key and is gated and metered on the client's share, own with no key is refused (never Wren's
 * key), no client reads another's key, a cache lives for one resolver, and no key shows in an
 * error. Synthetic keys only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients } from "../../src/clients/schema.js";
import { type KeyStore, pgKeyStore, throwawayRing } from "../../src/keys.js";
import { clientSecretEvents } from "../../src/keys-schema.js";
import { keyedSites, meteredModel, meteredSites } from "../../src/metered.js";
import { scrubKey, VendorKeyMissing, vendorKey, vendorKeys } from "../../src/vendor-keys.js";
import { vendorModes, vendorUsage } from "../../src/vendor-schema.js";
import { isVendorStop, type VendorStop } from "../../src/vendor-stop.js";
import { setManaged, setOwnKey } from "../../src/vendors.js";

let pg: TestPostgres;
let store: KeyStore;
const ACME_KEY = "acme-x-key-0000000000AAAA";
const BETA_KEY = "beta-x-key-1111111111BBBB";
const WREN_TELNYX = "wren-telnyx-key-22222222CCCC";
const ENV = { WREN_TELNYX_API_KEY: WREN_TELNYX };

async function own(client: string, vendor: string, name: string, value: string) {
  const { ref } = await store.stage({ client, name, value, by: "op@example.test" });
  await setOwnKey(pg.db, store, { client, vendor, keyRef: ref, by: "op@example.test" });
  return ref;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  store = pgKeyStore(pg.db, throwawayRing());
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
    { id: "gamma", name: "Gamma", database: "wren_client_gamma" },
  ]);
  await own("acme", "x", "X_BEARER_TOKEN", ACME_KEY);
  await own("beta", "x", "X_BEARER_TOKEN", BETA_KEY);
  await own("acme", "telnyx", "TELNYX_API_KEY", "acme-telnyx-333333333DDDD");
  await setManaged(pg.db, { client: "beta", vendor: "telnyx", perDay: 0, capCents: 500, by: "op" });
  await setManaged(pg.db, { client: "beta", vendor: "exa", perDay: 0, capCents: 100, by: "op" });
});
afterAll(() => pg.stop());

const reads = async (client: string) =>
  (
    await pg.db
      .select()
      .from(clientSecretEvents)
      .where(and(eq(clientSecretEvents.client, client), eq(clientSecretEvents.op, "read")))
  ).map((e) => [e.by, e.why]);

describe("vendorKey", () => {
  it("own: the client's key from the store, with a read event and its reason", async () => {
    const k = await vendorKey(pg.db, "acme", "x", { keys: store, why: "x reads for signals" });
    expect(k).toMatchObject({ mode: "own", key: ACME_KEY, last4: "AAAA" });
    expect(k.source).toMatch(/^store:ks_[0-9a-f]{32}$/);
    expect(await reads("acme")).toContainEqual(["wren:vendors", "x reads for signals"]);
  });

  it("managed: Wren's key, from the worker's env or the path that holds it", async () => {
    expect(await vendorKey(pg.db, "beta", "telnyx", { keys: store, why: "t", env: ENV })).toEqual({
      mode: "managed",
      key: WREN_TELNYX,
      source: "env: WREN_TELNYX_API_KEY",
    });
    expect(await vendorKey(pg.db, "beta", "exa", { keys: store, why: "t" })).toEqual({
      mode: "managed",
      key: null,
      source: "autobrowse: Exa key ring",
    });
    // Wren itself: always managed.
    expect(await vendorKey(pg.db, null, "telnyx", { keys: store, why: "t", env: ENV })).toEqual({
      mode: "managed",
      key: WREN_TELNYX,
      source: "env: WREN_TELNYX_API_KEY",
    });
  });

  it("own with no key, or no mode: refused with what to do, never Wren's key", async () => {
    await pg.db.insert(vendorModes).values({
      client: "gamma",
      vendor: "telnyx",
      mode: "own",
      keyName: null,
      updatedBy: "op",
    });
    const err = await vendorKey(pg.db, "gamma", "telnyx", {
      keys: store,
      why: "t",
      env: ENV,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VendorKeyMissing);
    expect(err.message).toBe("Connect your Telnyx key in Account → Vendors");
    expect(isVendorStop(err)).toBe(true);
    expect(String(err.stack)).not.toContain(WREN_TELNYX);
    await expect(vendorKey(pg.db, "gamma", "x", { keys: store, why: "t" })).rejects.toThrow(
      "Pick how X runs in Account → Vendors",
    );
    // Own with a key but no store here: refused, not Wren's.
    await expect(
      vendorKey(pg.db, "acme", "telnyx", { keys: null, why: "t", env: ENV }),
    ).rejects.toThrow("Saved keys can't be read here");
    // A key deleted from the store: refused too.
    const ref = await own("gamma", "x", "X_BEARER_TOKEN", "gamma-x-key-44444444EEEE");
    await store.delete({ ref, client: "gamma", by: "op" });
    await expect(vendorKey(pg.db, "gamma", "x", { keys: store, why: "t" })).rejects.toThrow(
      "Connect your X key in Account → Vendors",
    );
  });

  it("never reads another client's key: each client gets its own, by its own ref", async () => {
    const r = vendorKeys({ main: pg.db, keys: store });
    const a = await r.key("acme", "x", "t");
    const b = await r.key("beta", "x", "t");
    expect([a.key, b.key]).toEqual([ACME_KEY, BETA_KEY]);
    // A ref of acme's on beta's row reads nothing: the store binds a ref to its client.
    await pg.db
      .update(vendorModes)
      .set({ keyName: a.source.slice("store:".length) })
      .where(and(eq(vendorModes.client, "beta"), eq(vendorModes.vendor, "x")));
    await expect(vendorKey(pg.db, "beta", "x", { keys: store, why: "t" })).rejects.toThrow(
      "Connect your X key",
    );
    await pg.db
      .update(vendorModes)
      .set({ keyName: b.source.slice("store:".length) })
      .where(and(eq(vendorModes.client, "beta"), eq(vendorModes.vendor, "x")));
  });

  it("caches per resolver only: one read per invocation, a new resolver reads again", async () => {
    const before = (await reads("acme")).length;
    const r1 = vendorKeys({ main: pg.db, keys: store });
    await r1.key("acme", "x", "t");
    await r1.key("acme", "x", "t");
    expect((await reads("acme")).length).toBe(before + 1);
    await vendorKeys({ main: pg.db, keys: store }).key("acme", "x", "t");
    expect((await reads("acme")).length).toBe(before + 2);
  });
});

describe("use", () => {
  const usage = async (client: string, vendor: string) =>
    pg.db
      .select({ mode: vendorUsage.mode, units: vendorUsage.units, micros: vendorUsage.micros })
      .from(vendorUsage)
      .where(and(eq(vendorUsage.client, client), eq(vendorUsage.vendor, vendor)));

  it("own: runs on the client's key and meters its own bucket", async () => {
    const r = vendorKeys({ main: pg.db, keys: store });
    const seen: string[] = [];
    await r.use(
      { client: "acme", vendor: "x", why: "t", spent: () => ({ units: 3 }) },
      async (k) => {
        seen.push(String(k.key));
        return null;
      },
    );
    expect(seen).toEqual([ACME_KEY]);
    expect(await usage("acme", "x")).toEqual([{ mode: "own", units: 3, micros: 15_000 }]);
  });

  it("managed: Wren's key, the gate first, metered after, the cap stops it", async () => {
    const r = vendorKeys({ main: pg.db, keys: store, env: ENV });
    const seen: (string | null)[] = [];
    await r.use({ client: "beta", vendor: "telnyx", why: "t" }, async (k) => {
      seen.push(k.key);
    });
    expect(seen).toEqual([WREN_TELNYX]);
    expect(await usage("beta", "telnyx")).toEqual([{ mode: "managed", units: 1, micros: 4_000 }]);
    // $5 cap at $0.004 a part: 2,000 parts at once is over it.
    const err = await r
      .use({ client: "beta", vendor: "telnyx", why: "t", units: 2_000 }, async () => "ran")
      .catch((e) => e);
    expect(isVendorStop(err)).toBe(true);
    expect(err.why).toBe("Monthly cap of $5.00 reached");
  });

  it("a key never shows in an error: the call's message, cause and stack are scrubbed", async () => {
    const r = vendorKeys({ main: pg.db, keys: store });
    const err = await r
      .use({ client: "acme", vendor: "x", why: "t" }, async (k) => {
        const e = new Error(`401 for Bearer ${k.key}`, { cause: new Error(`token ${k.key}`) });
        (e as Error & { status?: number }).status = 401;
        throw e;
      })
      .catch((e) => e);
    for (const text of [err.message, String(err.stack), String(err.cause ?? "")])
      expect(text).not.toContain(ACME_KEY);
    expect(err.message).toBe("401 for Bearer [key]");
    expect(err.status).toBe(401);
    // A failed call costs nothing.
    expect((await usage("acme", "x")).length).toBe(1);
  });

  it("scrubKey leaves an error without the key as it was", () => {
    const e = new Error("plain");
    expect(scrubKey(e, ACME_KEY)).toBe(e);
    expect(scrubKey(e, null)).toBe(e);
  });
});

describe("meteredSites and meteredModel route by mode", () => {
  const EXA_OWN = "acme-exa-key-55555555FFFF";
  const MODEL_OWN = "gsk_acmesynthetic666666GGGG";
  const now = () => new Date();

  beforeAll(async () => {
    await own("acme", "exa", "EXA_API_KEY", EXA_OWN);
    await own("acme", "models", "MODEL_API_KEY", MODEL_OWN);
    await setManaged(pg.db, {
      client: "beta",
      vendor: "models",
      perDay: 0,
      capCents: 100,
      by: "op",
    });
  });

  /** A fake autobrowse: what reached Wren's key ring. */
  const fakeSites = () => {
    const calls: string[] = [];
    return {
      calls,
      sites: {
        call: async <T>(site: string, _m: string, path: string) => {
          calls.push(`${site} ${path}`);
          return { query: "q", hits: [{ title: "t", url: "https://a.test" }], via: "exa" } as T;
        },
        via: async () => "api" as const,
      },
    };
  };
  /** A fake Exa: what reached it, and with which key. */
  const fakeExa = (status = 200, echo = false) => {
    const seen: { url: string; key: string | null }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("x-api-key");
      seen.push({ url, key });
      const body = echo
        ? { error: `bad key ${key}` }
        : { results: [{ title: "Own", url: "https://own.test" }] };
      return new Response(JSON.stringify(body), { status });
    };
    return { seen, fetch };
  };

  it("own Exa goes straight to Exa on the client's key; autobrowse never sees it", async () => {
    const f = fakeSites();
    const exa = fakeExa();
    const s = meteredSites(f.sites, {
      main: pg.db,
      client: "acme",
      part: "test.part",
      now,
      store,
      fetch: exa.fetch,
    });
    const out = await s.call<{ hits: { url: string }[]; via: string }>("web", "GET", "/search", {
      q: "plumbers",
      n: 3,
      via: "exa",
    });
    expect(out.hits.map((h) => h.url)).toEqual(["https://own.test"]);
    expect(out.via).toBe("exa");
    expect(exa.seen).toEqual([{ url: "https://api.exa.ai/search", key: EXA_OWN }]);
    expect(f.calls).toEqual([]);
    // Reads without a vendor pass through untouched.
    await s.call("web", "GET", "/read", { url: "https://a.test" });
    expect(f.calls).toEqual(["web /read"]);
  });

  it("managed Exa goes through autobrowse's ring; the client's key is never read", async () => {
    const f = fakeSites();
    const exa = fakeExa();
    const s = meteredSites(f.sites, {
      main: pg.db,
      client: "beta",
      part: "test.part",
      now,
      store,
      fetch: exa.fetch,
    });
    await s.call("web", "GET", "/search", { q: "x", via: "exa" });
    expect(f.calls).toEqual(["web /search"]);
    expect(exa.seen).toEqual([]);
    const rows = await pg.db
      .select({ mode: vendorUsage.mode, part: vendorUsage.part })
      .from(vendorUsage)
      .where(and(eq(vendorUsage.client, "beta"), eq(vendorUsage.vendor, "exa")));
    expect(rows).toEqual([{ mode: "managed", part: "test.part" }]);
  });

  it("no mode: refused before any read, on neither key", async () => {
    const f = fakeSites();
    const exa = fakeExa();
    const s = meteredSites(f.sites, {
      main: pg.db,
      client: "gamma",
      part: "test.part",
      now,
      store,
      fetch: exa.fetch,
    });
    const err = (await s
      .call("web", "GET", "/search", { q: "x", via: "exa" })
      .catch((e: unknown) => e)) as VendorStop;
    expect(isVendorStop(err)).toBe(true);
    expect(err.why).toBe("Pick how Exa runs in Account → Vendors");
    expect([f.calls, exa.seen]).toEqual([[], []]);
  });

  it("a vendor's error on the client's key never carries the key", async () => {
    const exa = fakeExa(401, true);
    const s = meteredSites(fakeSites().sites, {
      main: pg.db,
      client: "acme",
      part: "test.part",
      now,
      store,
      fetch: exa.fetch,
    });
    const err = (await s
      .call("web", "GET", "/search", { q: "x", via: "exa" })
      .catch((e: unknown) => e)) as VendorStop;
    expect(err.status).toBe(401);
    expect(`${err.message}${err.stack}`).not.toContain(EXA_OWN);
    expect(err.message).toContain("bad key [key]");
  });

  it("no journaled step returns the key", async () => {
    const journal: string[] = [];
    const step = async <T>(name: string, fn: () => Promise<T>) => {
      const out = await fn();
      journal.push(`${name} ${JSON.stringify(out ?? null)}`);
      return out;
    };
    const s = meteredSites(fakeSites().sites, {
      main: pg.db,
      client: "acme",
      part: "test.part",
      now,
      store,
      step,
      fetch: fakeExa().fetch,
    });
    await s.call("web", "GET", "/search", { q: "x", via: "exa" });
    expect(journal.map((j) => j.split(" ")[0])).toEqual(["key", "gate", "exa", "meter"]);
    expect(journal.join("\n")).not.toContain(EXA_OWN);
  });

  it("keyedSites only routes: own key direct, no mode stays on Wren's, nothing metered", async () => {
    const before = await pg.db.select({ id: vendorUsage.id }).from(vendorUsage);
    const f = fakeSites();
    const exa = fakeExa();
    const on = (client: string) =>
      keyedSites(f.sites, { main: pg.db, client, now, store, fetch: exa.fetch });
    await on("acme").call("web", "GET", "/search", { q: "a", via: "exa" });
    await on("gamma").call("web", "GET", "/search", { q: "g", via: "exa" });
    expect(exa.seen.map((x) => x.key)).toEqual([EXA_OWN]);
    expect(f.calls).toEqual(["web /search"]);
    const after = await pg.db.select({ id: vendorUsage.id }).from(vendorUsage);
    expect(after.length).toBe(before.length);
  });

  it("people and LinkedIn routes follow the client's Exa key; no mode stays on Wren's ring", async () => {
    const before = await pg.db.select({ id: vendorUsage.id }).from(vendorUsage);
    const f = fakeSites();
    const exa = fakeExa();
    const journal: string[] = [];
    const step = async <T>(name: string, fn: () => Promise<T>) => {
      const out = await fn();
      journal.push(`${name} ${JSON.stringify(out ?? null)}`);
      return out;
    };
    const on = (client: string) =>
      meteredSites(f.sites, { main: pg.db, client, part: "t", now, store, step, fetch: exa.fetch });
    const out = await on("acme").call<{ people: unknown[]; via: string }>("web", "GET", "/people", {
      q: "recruiters",
    });
    expect(out.via).toBe("exa");
    await on("acme").call("web", "GET", "/linkedin/posts", { q: "Avery" });
    // Managed and no mode: Wren's ring through autobrowse, as before.
    await on("beta").call("web", "GET", "/linkedin/profile", { url: "https://linkedin.com/in/a" });
    await on("gamma").call("web", "GET", "/people", { q: "g" });
    expect(exa.seen.map((x) => [x.url, x.key])).toEqual([
      ["https://api.exa.ai/search", EXA_OWN],
      ["https://api.exa.ai/search", EXA_OWN],
    ]);
    expect(f.calls).toEqual(["web /linkedin/profile", "web /people"]);
    // Only whose key: the caller meters these reads, and no step holds the key.
    const after = await pg.db.select({ id: vendorUsage.id }).from(vendorUsage);
    expect(after.length).toBe(before.length);
    expect(journal.join("\n")).not.toContain(EXA_OWN);
  });

  it("models: own key straight to its provider, managed on Wren's gateway, unset only by choice", async () => {
    const used: string[] = [];
    const gateway = {
      complete: async (p: string) => {
        used.push(`gateway ${p}`);
        return "ok";
      },
    };
    const own = (key: string) => ({
      complete: async (p: string) => {
        used.push(`own ${key.slice(-4)} ${p}`);
        return "ok";
      },
    });
    const base = { main: pg.db, part: "test.model", now, store, own };
    await meteredModel(gateway, { ...base, client: "acme" }).complete("a");
    await meteredModel(gateway, { ...base, client: "beta" }).complete("b");
    await expect(meteredModel(gateway, { ...base, client: "gamma" }).complete("c")).rejects.toThrow(
      "Pick how model runs in Account → Vendors",
    );
    await meteredModel(gateway, { ...base, client: "gamma", unset: "managed" }).complete("d");
    expect(used).toEqual(["own GGGG a", "gateway b", "gateway d"]);
    const rows = await pg.db
      .select({ client: vendorUsage.client, mode: vendorUsage.mode })
      .from(vendorUsage)
      .where(and(eq(vendorUsage.vendor, "models"), eq(vendorUsage.part, "test.model")));
    expect(rows).toEqual([
      { client: "acme", mode: "own" },
      { client: "beta", mode: "managed" },
      { client: "gamma", mode: "managed" },
    ]);
  });
});
