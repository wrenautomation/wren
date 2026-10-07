/**
 * The key store on Postgres: stage then bind, rotate, put, read, delete, the hour a staged key
 * waits, and a new private key. Every read and write is an event in the audit log, never with
 * the value; the sealed rows stay out of it. Synthetic keys only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientMembers, clients, operators } from "../../src/clients/schema.js";
import {
  intakeKey,
  keyRing,
  keySealer,
  maySaveKeys,
  newKeyPair,
  pgKeyStore,
  rewrapAll,
  STAGED_FOR_MS,
  stageKey,
} from "../../src/keys.js";
import { clientSecretEvents, clientSecrets } from "../../src/keys-schema.js";

let pg: TestPostgres;
const PAIR = newKeyPair("k1");
const KEY = "sk_test_synthetic000000000000";
const NEXT = "sk_test_synthetic111111111111";
let at = new Date("2026-10-07T12:00:00Z");
const clock = () => at;
const store = () => pgKeyStore(pg.db, keyRing(PAIR.privateSpec), clock);

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
    { id: "demo", name: "Demo", database: "wren_client_demo", demo: true },
  ]);
});
afterAll(() => pg.stop());

const events = async (secret: string) =>
  (
    await pg.db
      .select()
      .from(clientSecretEvents)
      .where(eq(clientSecretEvents.secret, secret))
      .orderBy(clientSecretEvents.id)
  ).map((e) => [e.op, e.by]);

describe("key store", () => {
  it("stages with the public key alone, binds by ref, reads it back audited", async () => {
    const { ref, last4 } = await stageKey(pg.db, keySealer(PAIR.publicSpec), {
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: KEY,
      by: "ada@example.test",
      now: at,
    });
    expect(ref).toMatch(/^ks_[0-9a-f]{32}$/);
    expect(last4).toBe("0000");
    const s = store();
    expect(await s.get({ ref, client: "acme", by: "x", why: "too soon" })).toBeNull();
    const info = await s.bind({
      ref,
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      by: "Ada@example.test",
    });
    expect(info).toMatchObject({ ref, name: "STRIPE_SECRET_KEY", last4: "0000", version: 1 });
    // Binding again (a retried step) answers the same.
    expect(
      await s.bind({ ref, client: "acme", name: "STRIPE_SECRET_KEY", by: "ada@example.test" }),
    ).toMatchObject({ ref, version: 1 });
    expect(await s.get({ ref, client: "beta", by: "x", why: "wrong client" })).toBeNull();
    expect(await s.get({ ref, client: "acme", by: "wren:payments", why: "make a link" })).toBe(KEY);
    expect(await events(ref)).toEqual([
      ["stage", "ada@example.test"],
      ["bind", "Ada@example.test"],
      ["read", "wren:payments"],
    ]);
  });

  it("a second key for the same name becomes the next version under the first ref", async () => {
    const s = store();
    const [live] = await pg.db.select().from(clientSecrets).where(eq(clientSecrets.client, "acme"));
    if (!live) throw new Error("no live key");
    const { ref } = await s.stage({
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: NEXT,
      by: "ada@example.test",
    });
    const info = await s.bind({
      ref,
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      by: "ada@example.test",
    });
    expect(info).toMatchObject({ ref: live.id, version: 2, last4: "1111" });
    expect(await s.get({ ref: live.id, client: "acme", by: "t", why: "t" })).toBe(NEXT);
    expect(
      await s.bind({ ref, client: "acme", name: "STRIPE_SECRET_KEY", by: "ada@example.test" }),
    ).toMatchObject({ ref: live.id, version: 2 });
    const rotated = await s.rotate({ ref: live.id, client: "acme", value: KEY, by: "op" });
    expect(rotated.version).toBe(3);
    expect(await s.info({ ref: live.id, client: "acme" })).toMatchObject({ last4: "0000" });
  });

  it("refuses another's key, another client's, and one past its hour", async () => {
    const s = store();
    const { ref } = await s.stage({
      client: "beta",
      name: "EXA_API_KEY",
      value: "exa-synthetic-1234",
      by: "ada@example.test",
    });
    await expect(
      s.bind({ ref, client: "beta", name: "EXA_API_KEY", by: "bob@example.test" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.bind({ ref, client: "acme", name: "EXA_API_KEY", by: "ada@example.test" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      s.bind({ ref, client: "beta", name: "X_BEARER_TOKEN", by: "ada@example.test" }),
    ).rejects.toMatchObject({ status: 409 });
    at = new Date(at.getTime() + STAGED_FOR_MS + 1);
    await expect(
      s.bind({ ref, client: "beta", name: "EXA_API_KEY", by: "ada@example.test" }),
    ).rejects.toMatchObject({ status: 404 });
    // The next stage clears it, with an event.
    await s.stage({ client: "beta", name: "YOUTUBE_API_KEY", value: "yt-synthetic-1", by: "a" });
    expect(await pg.db.select().from(clientSecrets).where(eq(clientSecrets.id, ref))).toEqual([]);
    expect((await events(ref)).at(-1)).toEqual(["expire", "wren:keystore"]);
  });

  it("put makes a key live at once; delete removes it", async () => {
    const s = store();
    const secret = "whsec_synthetic00000000";
    const put = await s.put({
      client: "beta",
      name: "STRIPE_WEBHOOK_SECRET",
      value: secret,
      by: "op",
    });
    expect(await s.get({ ref: put.ref, client: "beta", by: "t", why: "t" })).toBe(secret);
    const again = await s.put({
      client: "beta",
      name: "STRIPE_WEBHOOK_SECRET",
      value: secret,
      by: "op",
    });
    expect(again).toMatchObject({ ref: put.ref, version: 2 });
    await expect(
      s.put({ client: "beta", name: "STRIPE_WEBHOOK_SECRET", value: "nope", by: "op" }),
    ).rejects.toThrow("whsec_");
    expect(await s.delete({ ref: put.ref, client: "beta", by: "op" })).toBe(true);
    expect(await s.get({ ref: put.ref, client: "beta", by: "t", why: "t" })).toBeNull();
    expect((await events(put.ref)).map(([op]) => op)).toEqual(["put", "read", "rotate", "delete"]);
  });

  it("a new private key: old values open, rewrap moves them, then the old key can go", async () => {
    const next = newKeyPair("k2");
    const both = keyRing(`${next.privateSpec},${PAIR.privateSpec}`);
    expect(await rewrapAll(pg.db, both)).toBeGreaterThan(0);
    const rows = await pg.db.select().from(clientSecrets);
    expect(new Set(rows.map((r) => r.kid))).toEqual(new Set(["k2"]));
    const only = pgKeyStore(pg.db, keyRing(next.privateSpec), clock);
    const live = rows.find((r) => r.client === "acme" && r.state === "live");
    if (!live) throw new Error("no live key");
    expect(await only.get({ ref: live.id, client: "acme", by: "t", why: "t" })).toBe(KEY);
  });

  it("logs every write in the audit log under its actor; no sealed row, no value", async () => {
    const tables = await pg.db.execute<{ table_name: string; actor: string | null }>(
      sql`select table_name, actor from audit_events
          where table_name in ('client_secrets', 'client_secret_events')`,
    );
    expect(tables.some((r) => r.table_name === "client_secrets")).toBe(false);
    expect(
      tables.filter((r) => r.table_name === "client_secret_events").map((r) => r.actor),
    ).toEqual(expect.arrayContaining(["ada@example.test", "wren:payments", "wren:keystore"]));
    const dump = await pg.db.execute(sql`select * from audit_events`);
    expect(JSON.stringify(dump)).not.toContain("synthetic");
  });

  it("only someone on the client may stage for it", async () => {
    await pg.db.insert(operators).values([
      { email: "all@example.test", role: "operator", clients: null },
      { email: "some@example.test", role: "operator", clients: ["beta"] },
    ]);
    await pg.db.insert(clientMembers).values([
      { clientId: "acme", email: "owner@example.test", role: "owner" },
      { clientId: "demo", email: "demo@example.test", role: "owner" },
    ]);
    expect(await maySaveKeys(pg.db, "ALL@example.test", "acme")).toBe(true);
    expect(await maySaveKeys(pg.db, "some@example.test", "acme")).toBe(false);
    expect(await maySaveKeys(pg.db, "some@example.test", "beta")).toBe(true);
    expect(await maySaveKeys(pg.db, "owner@example.test", "acme")).toBe(true);
    expect(await maySaveKeys(pg.db, "owner@example.test", "beta")).toBe(false);
    expect(await maySaveKeys(pg.db, "demo@example.test", "demo")).toBe(false);
  });

  it("intake: a member's key comes back as a ref; others and wrong shapes are refused", async () => {
    const sealer = keySealer(PAIR.publicSpec);
    const body = { client: "acme", name: "STRIPE_SECRET_KEY", value: NEXT };
    const ok = await intakeKey(pg.db, sealer, "owner@example.test", body);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ref: expect.stringMatching(/^ks_/), last4: "1111" });
    expect(
      (await intakeKey(pg.db, sealer, "owner@example.test", { ...body, client: "beta" })).status,
    ).toBe(403);
    const wrong = await intakeKey(pg.db, sealer, "owner@example.test", {
      ...body,
      value: "pk_test_synthetic0000000000",
    });
    expect(wrong).toEqual({
      status: 400,
      body: { error: "That isn't a Stripe secret key (sk_ or rk_)" },
    });
    // A mailbox token is Wren's to keep, never pasted.
    const token = await intakeKey(pg.db, sealer, "owner@example.test", {
      client: "acme",
      name: "MAIL_GOOGLE_0123456789ABCDEF",
      value: '{"refresh":"synthetic-refresh"}',
    });
    expect(token.status).toBe(400);
  });

  it("named reads Wren's own keys by name; a sealer-only store can't read", async () => {
    await pg.db.insert(clients).values({ id: "wren", name: "Wren", database: "wren_client_wren" });
    const s = store();
    await s.put({
      client: "wren",
      name: "MAIL_GOOGLE_CLIENT_SECRET",
      value: "synthetic-app-secret",
      by: "cli",
    });
    expect(
      await s.named({
        client: "wren",
        name: "MAIL_GOOGLE_CLIENT_SECRET",
        by: "wren:mail",
        why: "t",
      }),
    ).toBe("synthetic-app-secret");
    expect(
      await s.named({ client: "wren", name: "MAIL_GOOGLE_CLIENT_ID", by: "t", why: "t" }),
    ).toBeNull();
    const sealOnly = pgKeyStore(pg.db, keySealer(PAIR.publicSpec), clock);
    const put = await sealOnly.put({
      client: "wren",
      name: "MAIL_GOOGLE_CLIENT_ID",
      value: "synthetic-app-id",
      by: "cli",
    });
    expect(put.last4).toBe("p-id");
    await expect(
      sealOnly.named({ client: "wren", name: "MAIL_GOOGLE_CLIENT_ID", by: "t", why: "t" }),
    ).rejects.toThrow("only seals");
  });
});
