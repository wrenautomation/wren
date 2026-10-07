/**
 * Vendor modes on Postgres: no mode is "Needs setup", an own key has its quota to itself, a
 * managed client gets the smallest of its share, the clients' pool and the whole quota, and a
 * monthly cap stops it. Wren is never squeezed below its reserve.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients, wrenSettings } from "../../src/clients/schema.js";
import { pgKeyStore, throwawayRing } from "../../src/keys.js";
import {
  clearMode,
  gate,
  meter,
  modesOf,
  monthSpend,
  roomToday,
  setManaged,
  setOwnKey,
  setOwnLogin,
  usageSince,
} from "../../src/vendors.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
    { id: "gamma", name: "Gamma", database: "wren_client_gamma" },
  ]);
});
afterAll(() => pg.stop());

const NOW = new Date("2026-03-10T12:00:00Z");

describe("modes", () => {
  it("no mode: needs setup; an own key is stored in the key store, the row keeps its ref", async () => {
    expect(await gate(pg.db, "acme", "exa", 1, NOW)).toEqual({
      ok: false,
      why: "Needs setup",
      mode: null,
    });
    const store = pgKeyStore(pg.db, throwawayRing());
    const { ref } = await store.stage({
      client: "acme",
      name: "EXA_API_KEY",
      value: " test-key-123 ",
      by: "op",
    });
    await expect(
      setOwnKey(pg.db, null, { client: "acme", vendor: "exa", keyRef: ref, by: "op" }),
    ).rejects.toThrow("Key store not set up here");
    const { keyName, last4 } = await setOwnKey(pg.db, store, {
      client: "acme",
      vendor: "exa",
      keyRef: ref,
      by: "op",
    });
    expect([keyName, last4]).toEqual([ref, "-123"]);
    expect(await store.get({ ref, client: "acme", by: "op", why: "test" })).toBe("test-key-123");
    const [row] = await modesOf(pg.db, "acme");
    expect(row).toMatchObject({ vendor: "exa", mode: "own", keyName });
    expect(JSON.stringify(row)).not.toContain("test-key-123");
    expect(await gate(pg.db, "acme", "exa", 5, NOW)).toEqual({
      ok: true,
      mode: "own",
      bucket: "exa:own:acme",
      room: null,
    });
    // Metered on its own bucket, priced at Exa's public price.
    expect(
      await meter(pg.db, {
        client: "acme",
        vendor: "exa",
        units: 3,
        part: "signals.triggers",
        at: NOW,
      }),
    ).toEqual({
      mode: "own",
      bucket: "exa:own:acme",
      micros: 21_000,
    });
    await clearMode(pg.db, "acme", "exa");
    expect((await gate(pg.db, "acme", "exa", 1, NOW)).ok).toBe(false);
  });

  it("LinkedIn: own login only, never managed by default", async () => {
    await expect(
      setManaged(pg.db, { client: "acme", vendor: "linkedin", perDay: 5, capCents: 100, by: "op" }),
    ).rejects.toThrow("isn't offered managed");
    await setOwnLogin(pg.db, { client: "acme", vendor: "linkedin", by: "op" });
    expect(await gate(pg.db, "acme", "linkedin", 1, NOW)).toMatchObject({
      ok: true,
      bucket: "linkedin:own:acme",
    });
    // Twenty reads a day (burst 4) on the client's own login, counted on its bucket alone.
    for (let i = 0; i < 4; i++)
      await meter(pg.db, { client: "acme", vendor: "linkedin", units: 1, at: NOW });
    expect(await gate(pg.db, "acme", "linkedin", 1, NOW)).toMatchObject({
      ok: false,
      why: expect.stringMatching(/^No reads left today, next in \d+ minutes?$/),
    });
  });
});

describe("managed", () => {
  it("stops at the monthly cap", async () => {
    await setManaged(pg.db, { client: "beta", vendor: "exa", perDay: 0, capCents: 0, by: "op" });
    expect(await gate(pg.db, "beta", "exa", 1, NOW)).toMatchObject({
      ok: false,
      why: "No monthly cap set",
    });
    await setManaged(pg.db, { client: "beta", vendor: "exa", perDay: 0, capCents: 5, by: "op" });
    // 5 cents is 7 searches at $0.007.
    expect(await gate(pg.db, "beta", "exa", 7, NOW)).toMatchObject({
      ok: true,
      mode: "managed",
      bucket: "exa:managed",
    });
    await meter(pg.db, { client: "beta", vendor: "exa", units: 7, at: NOW });
    expect(await monthSpend(pg.db, "beta", "exa", NOW)).toBe(49_000);
    expect(await gate(pg.db, "beta", "exa", 1, NOW)).toMatchObject({
      ok: false,
      why: "Monthly cap of $0.05 reached",
    });
    // Next month starts over.
    expect(await gate(pg.db, "beta", "exa", 1, new Date("2026-04-01T00:00:00Z"))).toMatchObject({
      ok: true,
    });
  });

  it("a free vendor needs no $ cap: its daily share bounds it", async () => {
    await setManaged(pg.db, {
      client: "acme",
      vendor: "youtube",
      perDay: 0,
      capCents: 0,
      by: "op",
    });
    expect(await gate(pg.db, "acme", "youtube", 1, NOW)).toMatchObject({
      ok: false,
      why: "No daily share set",
    });
    await setManaged(pg.db, {
      client: "acme",
      vendor: "youtube",
      perDay: 50,
      capCents: 0,
      by: "op",
    });
    // YouTube: 10,000 a day, burst 2,000; a 50 share scales the burst to 10.
    expect(await gate(pg.db, "acme", "youtube", 10, NOW)).toMatchObject({ ok: true, room: 10 });
    await meter(pg.db, { client: "acme", vendor: "youtube", units: 10, at: NOW });
    expect((await gate(pg.db, "acme", "youtube", 1, NOW)).ok).toBe(false);
    expect(await roomToday(pg.db, "acme", "youtube", NOW)).toMatchObject({ ok: false });
  });

  it("today's room leaves the cap out; the gate keeps it for a paid vendor", async () => {
    await setManaged(pg.db, { client: "gamma", vendor: "exa", perDay: 0, capCents: 0, by: "op" });
    expect(await roomToday(pg.db, "gamma", "exa", NOW)).toMatchObject({ ok: true, room: null });
    expect(await gate(pg.db, "gamma", "exa", 1, NOW)).toMatchObject({
      ok: false,
      why: "No monthly cap set",
    });
  });

  it("splits a quota by shares under Wren's reserve, and Wren keeps its half", async () => {
    // Reddit: 400 a day, burst 40. Clients' pool is 200, burst 20.
    await setManaged(pg.db, {
      client: "beta",
      vendor: "reddit",
      perDay: 0,
      capCents: 100,
      by: "op",
    });
    expect(await gate(pg.db, "beta", "reddit", 1, NOW)).toMatchObject({
      ok: false,
      why: "No daily share set",
    });
    await setManaged(pg.db, {
      client: "beta",
      vendor: "reddit",
      perDay: 1000,
      capCents: 100,
      by: "op",
    });
    await setManaged(pg.db, {
      client: "gamma",
      vendor: "reddit",
      perDay: 1000,
      capCents: 100,
      by: "op",
    });
    // A share above the pool is held to the pool: 20 at once.
    expect(await gate(pg.db, "beta", "reddit", 20, NOW)).toMatchObject({ ok: true, room: 20 });
    await meter(pg.db, { client: "beta", vendor: "reddit", units: 20, at: NOW });
    // beta spent the pool's burst; gamma shares that pool.
    expect((await gate(pg.db, "gamma", "reddit", 1, NOW)).ok).toBe(false);
    // Wren still has the rest of the whole quota's burst.
    expect(await gate(pg.db, null, "reddit", 20, NOW)).toMatchObject({
      ok: true,
      mode: "managed",
      room: 20,
    });
    await meter(pg.db, { client: null, vendor: "reddit", units: 20, at: NOW });
    expect((await gate(pg.db, null, "reddit", 1, NOW)).ok).toBe(false);
    // An hour on, the pool refills about 8 (200 a day).
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await gate(pg.db, "gamma", "reddit", 1, later)).toMatchObject({ ok: true });

    expect(await usageSince(pg.db, null, new Date(0))).toEqual([
      { vendor: "reddit", mode: "managed", units: 20, micros: 0 },
    ]);
  });

  it("a vendor William takes off the managed list stops for clients", async () => {
    await pg.db
      .insert(wrenSettings)
      .values({ component: "vendors", settings: { managedForClients: ["reddit"] } });
    expect(await gate(pg.db, "beta", "exa", 1, NOW)).toMatchObject({
      ok: false,
      why: "Exa search isn't offered managed",
    });
  });
});
