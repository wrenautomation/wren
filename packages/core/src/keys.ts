/**
 * The key store (designs/2026-10-07-key-store.md): a client's own vendor keys, sealed in main's
 * `client_secrets`. Each value has its own data key (AES-256-GCM); the data key is sealed for the
 * store's X25519 public key. The sign-in Lambda holds the public key and can only seal; the worker
 * holds the private key and opens. Every read and write adds a `client_secret_events` row, never
 * with the value.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";
import { atomic, type Db, type Queryable, serializable, setAuditActor, type Tx } from "@wren/db";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { clientMembers, clients, operators } from "./clients/schema.js";
import { KEY_MAX, KEY_REF, keyProblem, last4 } from "./key-refs.js";
import {
  type ClientSecretRow,
  clientSecretEvents,
  clientSecrets,
  type SecretOp,
} from "./keys-schema.js";
import { PortalRefusal } from "./refusal.js";

// ---- keys and sealing ----

const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const INFO = Buffer.from("wren-keystore-v1");
const KID = /^[a-z0-9]{1,16}$/;

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function privateOf(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("key store: a private key is 32 bytes");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_X25519, raw]),
    format: "der",
    type: "pkcs8",
  });
}
function publicOf(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("key store: a public key is 32 bytes");
  return createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: "der", type: "spki" });
}
const rawPublic = (k: KeyObject) => k.export({ format: "der", type: "spki" }).subarray(-32);

function pairs(spec: string, what: string): { kid: string; raw: Buffer }[] {
  const out = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      const kid = s.slice(0, i);
      if (i < 1 || !KID.test(kid)) throw new Error(`key store: ${what} is kid:base64url[,…]`);
      return { kid, raw: unb64(s.slice(i + 1)) };
    });
  if (!out.length) throw new Error(`key store: ${what} is empty`);
  return out;
}

/** What seals: the current public key. The sign-in Lambda has only this. */
export interface Sealer {
  kid: string;
  seal(aad: string, value: string): { kid: string; wrapped: Uint8Array; sealed: Uint8Array };
}

/** What opens too: every private key by kid, the first the current one. Only the worker. */
export interface KeyRing extends Sealer {
  kids: readonly string[];
  open(aad: string, row: { kid: string; wrapped: Uint8Array; sealed: Uint8Array }): string;
  /** The data key sealed again for the current public key; the value stays as it is. */
  rewrap(aad: string, row: { kid: string; wrapped: Uint8Array }): Uint8Array;
}

function gcm(key: Buffer, plain: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}
function ungcm(key: Buffer, box: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(box);
  if (b.length < 28) throw new Error("key store: sealed value too short");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
}
function kekOf(shared: Buffer, eph: Buffer, to: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([eph, to]), INFO, 32));
}

function wrapFor(kid: string, to: KeyObject, dek: Buffer, aad: string): Uint8Array {
  const eph = generateKeyPairSync("x25519");
  const ephRaw = rawPublic(eph.publicKey);
  const kek = kekOf(
    diffieHellman({ privateKey: eph.privateKey, publicKey: to }),
    ephRaw,
    rawPublic(to),
  );
  return Buffer.concat([ephRaw, gcm(kek, dek, `${aad}|${kid}`)]);
}

function sealerOf(kid: string, pub: KeyObject): Sealer {
  return {
    kid,
    seal(aad, value) {
      const dek = randomBytes(32);
      const sealed = gcm(dek, Buffer.from(value, "utf8"), aad);
      return { kid, wrapped: wrapFor(kid, pub, dek, aad), sealed };
    },
  };
}

/** The sealer from `WREN_KEYSTORE_PUBLIC` (`k1:<base64url>`). */
export function keySealer(spec: string): Sealer {
  const [first] = pairs(spec, "WREN_KEYSTORE_PUBLIC");
  if (!first) throw new Error("key store: WREN_KEYSTORE_PUBLIC is empty");
  return sealerOf(first.kid, publicOf(first.raw));
}

/** The ring from `WREN_KEYSTORE_KEY` (`k2:<base64url>,k1:<base64url>`, newest first). */
export function keyRing(spec: string): KeyRing {
  const keys = pairs(spec, "WREN_KEYSTORE_KEY").map((p) => {
    const priv = privateOf(p.raw);
    return { kid: p.kid, priv, pub: createPublicKey(priv) };
  });
  const byKid = new Map(keys.map((k) => [k.kid, k]));
  const current = keys[0] as (typeof keys)[number];
  const sealer = sealerOf(current.kid, current.pub);
  const dekOf = (aad: string, row: { kid: string; wrapped: Uint8Array }) => {
    const k = byKid.get(row.kid);
    if (!k) throw new Error(`key store: no private key ${row.kid} here`);
    const w = Buffer.from(row.wrapped);
    const eph = w.subarray(0, 32);
    const kek = kekOf(
      diffieHellman({ privateKey: k.priv, publicKey: publicOf(eph) }),
      eph,
      rawPublic(k.pub),
    );
    return ungcm(kek, w.subarray(32), `${aad}|${row.kid}`);
  };
  return {
    ...sealer,
    kids: keys.map((k) => k.kid),
    open: (aad, row) => ungcm(dekOf(aad, row), row.sealed, aad).toString("utf8"),
    rewrap: (aad, row) => wrapFor(current.kid, current.pub, dekOf(aad, row), aad),
  };
}

/** A new key pair as the two variables take them. Prints nothing. */
export function newKeyPair(kid: string): { privateSpec: string; publicSpec: string } {
  if (!KID.test(kid)) throw new Error("kid: lowercase letters and digits, 16 at most");
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const raw = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  return { privateSpec: `${kid}:${b64(raw)}`, publicSpec: `${kid}:${b64(rawPublic(publicKey))}` };
}

/** The public half of a private spec's current key, as `WREN_KEYSTORE_PUBLIC` takes it. */
export function publicSpecOf(privateSpec: string): string {
  const [first] = pairs(privateSpec, "WREN_KEYSTORE_KEY");
  if (!first) throw new Error("key store: WREN_KEYSTORE_KEY is empty");
  return `${first.kid}:${b64(rawPublic(createPublicKey(privateOf(first.raw))))}`;
}

// ---- the store ----

/** How long a staged key waits for a handler to bind it. */
export const STAGED_FOR_MS = 60 * 60_000;

const aadOf = (client: string, name: string) => `wren-key|${client}|${name}`;
const newRef = () => `ks_${randomBytes(16).toString("hex")}`;

export class KeyRefusal extends PortalRefusal {}

/** A kept key as a page may see it: never the value. */
export interface KeyInfo {
  ref: string;
  name: string;
  last4: string;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}
const infoOf = (r: ClientSecretRow): KeyInfo => ({
  ref: r.id,
  name: r.name,
  last4: r.last4,
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
});

async function logged(
  tx: Tx,
  by: string,
  e: { secret: string; client: string; name: string; op: SecretOp; why?: string | null },
) {
  await setAuditActor(tx, by);
  await tx.insert(clientSecretEvents).values({ ...e, by, why: e.why ?? null });
}

/** Staged rows past their hour, gone, each with an `expire` event. */
async function expireStaged(tx: Tx, now: Date) {
  const gone = await tx
    .delete(clientSecrets)
    .where(
      and(
        eq(clientSecrets.state, "staged"),
        lt(clientSecrets.createdAt, new Date(now.getTime() - STAGED_FOR_MS)),
      ),
    )
    .returning({ id: clientSecrets.id, client: clientSecrets.client, name: clientSecrets.name });
  for (const g of gone)
    await logged(tx, "wren:keystore", {
      secret: g.id,
      client: g.client,
      name: g.name,
      op: "expire",
    });
}

/**
 * Seal a key and keep it aside for a handler to bind, for an hour. The sign-in Lambda calls this
 * with the public key alone. Refuses a name Wren doesn't keep or a value of the wrong shape.
 */
export async function stageKey(
  main: Db,
  sealer: Sealer,
  o: { client: string; name: string; value: string; by: string; now?: Date },
): Promise<{ ref: string; last4: string }> {
  const value = o.value.trim();
  const problem = keyProblem(o.name, value);
  if (problem) throw new KeyRefusal(problem);
  const ref = newRef();
  const s = sealer.seal(aadOf(o.client, o.name), value);
  await atomic(main, async (tx) => {
    await expireStaged(tx, o.now ?? new Date());
    await tx.insert(clientSecrets).values({
      id: ref,
      client: o.client,
      name: o.name,
      state: "staged",
      ...s,
      last4: last4(value),
      createdBy: o.by,
      updatedBy: o.by,
      ...(o.now ? { createdAt: o.now, updatedAt: o.now } : {}),
    });
    await logged(tx, o.by, { secret: ref, client: o.client, name: o.name, op: "stage" });
  });
  return { ref, last4: last4(value) };
}

/**
 * May this email stage a key for `client`? A team seat that reaches it, or a member of it (not a
 * demo client). The handler that binds it checks the real permission.
 */
export async function maySaveKeys(
  main: Queryable,
  email: string,
  client: string,
): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const [row] = await main.execute<{ ok: boolean }>(sql`
    select exists (
      select 1 from ${operators} where ${operators.email} = ${e}
        and (${operators.clients} is null or ${client} = any(${operators.clients}))
    ) or exists (
      select 1 from ${clientMembers} join ${clients} on ${clients.id} = ${clientMembers.clientId}
      where ${clientMembers.email} = ${e} and ${clientMembers.clientId} = ${client}
        and not ${clients.demo}
    ) as ok`);
  return row?.ok === true;
}

/**
 * One key from the browser, staged: the sign-in Lambda's `/api/keys/stage` and the preview's.
 * `email` is who the edge says is signed in. Answers the ref and last 4, or why not; never the
 * value. `may` is who may save for a client (the preview's stand-in seat passes its own).
 */
export async function intakeKey(
  main: Db,
  sealer: Sealer | null,
  email: string | null,
  body: unknown,
  may: (main: Queryable, email: string, client: string) => Promise<boolean> = maySaveKeys,
): Promise<{ status: number; body: { ref: string; last4: string } | { error: string } }> {
  const no = (status: number, error: string) => ({ status, body: { error } });
  if (!sealer) return no(503, "Saving keys isn't set up here yet");
  if (!email) return no(401, "Sign in first");
  const b = (body ?? {}) as Record<string, unknown>;
  const client = typeof b.client === "string" ? b.client : "";
  const name = typeof b.name === "string" ? b.name : "";
  const value = typeof b.value === "string" ? b.value : "";
  if (!/^[a-z0-9_-]{1,40}$/.test(client)) return no(400, "Which client?");
  if (!value.trim() || value.length > KEY_MAX) return no(400, "Paste the key");
  if (!(await may(main, email, client))) return no(403, "Not one of your clients");
  try {
    return { status: 200, body: await stageKey(main, sealer, { client, name, value, by: email }) };
  } catch (err) {
    if (err instanceof KeyRefusal) return no(err.status, err.message);
    throw err;
  }
}

export interface KeyStore {
  /** Seal and set aside (tests and the local preview; prod stages at the sign-in Lambda). */
  stage(o: { client: string; name: string; value: string; by: string }): Promise<{
    ref: string;
    last4: string;
  }>;
  /**
   * A staged key becomes the client's live key of its name: new, or the next version of the one
   * there under that one's ref. Only the person who staged it, within the hour. Again: the same.
   */
  bind(o: { ref: string; client: string; name: string; by: string }): Promise<KeyInfo>;
  /** Seal and make live at once: a secret the worker got itself (Stripe's webhook secret). */
  put(o: { client: string; name: string; value: string; by: string }): Promise<KeyInfo>;
  /** A new value under the same ref. */
  rotate(o: { ref: string; client: string; value: string; by: string }): Promise<KeyInfo>;
  /** The value, with a `read` event saying who and why. Null: no such live key. */
  get(o: { ref: string; client: string; by: string; why: string }): Promise<string | null>;
  /** The same by name, for keys Wren keeps by a known name (its own mail apps). */
  named(o: { client: string; name: string; by: string; why: string }): Promise<string | null>;
  delete(o: { ref: string; client: string; by: string }): Promise<boolean>;
  /** What a page shows: name, last 4, version. No value, no event. */
  info(o: { ref: string; client: string }): Promise<KeyInfo | null>;
}

async function liveRow(db: Queryable, ref: string, client: string) {
  if (!KEY_REF.test(ref)) return null;
  const [r] = await db
    .select()
    .from(clientSecrets)
    .where(
      and(
        eq(clientSecrets.id, ref),
        eq(clientSecrets.client, client),
        eq(clientSecrets.state, "live"),
      ),
    );
  return r ?? null;
}

/**
 * The store on main, opening with `ring`. Given only a sealer (the CLI, with the public key), it
 * writes and binds but every read says it can't.
 */
export function pgKeyStore(
  main: Db,
  ring: KeyRing | Sealer,
  clock: () => Date = () => new Date(),
): KeyStore {
  const opener = (): KeyRing => {
    if (!("open" in ring)) throw new KeyRefusal("Saved keys can't be read here", 503);
    return ring;
  };
  const read = async (tx: Tx, row: ClientSecretRow | null, by: string, why: string) => {
    if (!row) return null;
    const value = opener().open(aadOf(row.client, row.name), row);
    await logged(tx, by, { secret: row.id, client: row.client, name: row.name, op: "read", why });
    return value;
  };
  const reseal = async (
    tx: Tx,
    row: ClientSecretRow,
    value: string,
    by: string,
    op: SecretOp,
  ): Promise<KeyInfo> => {
    const s = ring.seal(aadOf(row.client, row.name), value);
    const [r] = await tx
      .update(clientSecrets)
      .set({
        ...s,
        last4: last4(value),
        version: sql`${clientSecrets.version} + 1`,
        updatedBy: by,
        updatedAt: clock(),
      })
      .where(eq(clientSecrets.id, row.id))
      .returning();
    await logged(tx, by, { secret: row.id, client: row.client, name: row.name, op });
    return infoOf(r as ClientSecretRow);
  };
  const liveByName = async (tx: Queryable, client: string, name: string) => {
    const [r] = await tx
      .select()
      .from(clientSecrets)
      .where(
        and(
          eq(clientSecrets.client, client),
          eq(clientSecrets.name, name),
          eq(clientSecrets.state, "live"),
        ),
      )
      .for("update");
    return r ?? null;
  };

  return {
    stage: (o) => stageKey(main, ring, { ...o, now: clock() }),

    bind: (o) =>
      serializable(main, async (tx) => {
        if (!KEY_REF.test(o.ref)) throw new KeyRefusal("That isn't a saved key's reference");
        const [staged] = await tx
          .select()
          .from(clientSecrets)
          .where(and(eq(clientSecrets.id, o.ref), eq(clientSecrets.state, "staged")));
        if (!staged) {
          // Bound already (a retried call): the live row it went into.
          const [done] = await tx
            .select()
            .from(clientSecrets)
            .where(
              and(
                eq(clientSecrets.client, o.client),
                eq(clientSecrets.name, o.name),
                eq(clientSecrets.state, "live"),
                eq(clientSecrets.boundFrom, o.ref),
              ),
            );
          if (done) return infoOf(done);
          throw new KeyRefusal(
            "That key wasn't saved, or waited over an hour. Paste it again.",
            404,
          );
        }
        if (staged.client !== o.client || staged.name !== o.name)
          throw new KeyRefusal("That key was saved for something else", 409);
        if (staged.createdBy.toLowerCase() !== o.by.toLowerCase())
          throw new KeyRefusal("Someone else saved that key", 403);
        if (clock().getTime() - staged.createdAt.getTime() > STAGED_FOR_MS)
          throw new KeyRefusal("That key waited over an hour. Paste it again.", 404);
        const live = await liveByName(tx, o.client, o.name);
        if (live) {
          // The value moves under the live ref; its data key is bound to client and name, not ref.
          const [r] = await tx
            .update(clientSecrets)
            .set({
              kid: staged.kid,
              wrapped: staged.wrapped,
              sealed: staged.sealed,
              last4: staged.last4,
              version: sql`${clientSecrets.version} + 1`,
              boundFrom: o.ref,
              updatedBy: o.by,
              updatedAt: clock(),
            })
            .where(eq(clientSecrets.id, live.id))
            .returning();
          await tx.delete(clientSecrets).where(eq(clientSecrets.id, o.ref));
          await logged(tx, o.by, {
            secret: live.id,
            client: o.client,
            name: o.name,
            op: "rotate",
            why: `from ${o.ref}`,
          });
          return infoOf(r as ClientSecretRow);
        }
        const [r] = await tx
          .update(clientSecrets)
          .set({ state: "live", boundFrom: o.ref, updatedBy: o.by, updatedAt: clock() })
          .where(eq(clientSecrets.id, o.ref))
          .returning();
        await logged(tx, o.by, { secret: o.ref, client: o.client, name: o.name, op: "bind" });
        return infoOf(r as ClientSecretRow);
      }),

    put: (o) =>
      serializable(main, async (tx) => {
        const value = o.value.trim();
        const problem = keyProblem(o.name, value, "wren");
        if (problem) throw new KeyRefusal(problem);
        const live = await liveByName(tx, o.client, o.name);
        if (live) return reseal(tx, live, value, o.by, "rotate");
        const ref = newRef();
        const [r] = await tx
          .insert(clientSecrets)
          .values({
            id: ref,
            client: o.client,
            name: o.name,
            state: "live",
            ...ring.seal(aadOf(o.client, o.name), value),
            last4: last4(value),
            createdBy: o.by,
            updatedBy: o.by,
            createdAt: clock(),
            updatedAt: clock(),
          })
          .returning();
        await logged(tx, o.by, { secret: ref, client: o.client, name: o.name, op: "put" });
        return infoOf(r as ClientSecretRow);
      }),

    rotate: (o) =>
      atomic(main, async (tx) => {
        const row = await liveRow(tx, o.ref, o.client);
        if (!row) throw new KeyRefusal("No such key", 404);
        const value = o.value.trim();
        const problem = keyProblem(row.name, value, "wren");
        if (problem) throw new KeyRefusal(problem);
        return reseal(tx, row, value, o.by, "rotate");
      }),

    get: (o) =>
      atomic(main, async (tx) => read(tx, await liveRow(tx, o.ref, o.client), o.by, o.why)),

    named: (o) =>
      atomic(main, async (tx) => read(tx, await liveByName(tx, o.client, o.name), o.by, o.why)),

    delete: (o) =>
      atomic(main, async (tx) => {
        const row = await liveRow(tx, o.ref, o.client);
        if (!row) return false;
        await tx.delete(clientSecrets).where(eq(clientSecrets.id, row.id));
        await logged(tx, o.by, {
          secret: row.id,
          client: row.client,
          name: row.name,
          op: "delete",
        });
        return true;
      }),

    info: async (o) => {
      const row = await liveRow(main, o.ref, o.client);
      return row ? infoOf(row) : null;
    },
  };
}

/**
 * After a new private key goes first in the ring: every data key sealed for the current public
 * key. The values themselves don't change. Then the old key can leave the ring.
 */
export async function rewrapAll(main: Db, ring: KeyRing): Promise<number> {
  const rows = await main
    .select({ id: clientSecrets.id })
    .from(clientSecrets)
    .where(ne(clientSecrets.kid, ring.kid));
  let n = 0;
  for (const { id } of rows)
    await atomic(main, async (tx) => {
      const [row] = await tx
        .select()
        .from(clientSecrets)
        .where(eq(clientSecrets.id, id))
        .for("update");
      if (!row || row.kid === ring.kid) return;
      const wrapped = ring.rewrap(aadOf(row.client, row.name), row);
      await tx
        .update(clientSecrets)
        .set({ kid: ring.kid, wrapped })
        .where(eq(clientSecrets.id, id));
      await logged(tx, "wren:keystore", {
        secret: id,
        client: row.client,
        name: row.name,
        op: "rewrap",
      });
      n++;
    });
  return n;
}

/** The sign-in Lambda's sealer: null when `WREN_KEYSTORE_PUBLIC` isn't set. */
export function sealerFromEnv(env: NodeJS.ProcessEnv = process.env): Sealer | null {
  const spec = env.WREN_KEYSTORE_PUBLIC;
  return spec ? keySealer(spec) : null;
}

/** The store from the worker's env: null when `WREN_KEYSTORE_KEY` isn't set. */
export function keyStoreFromEnv(main: Db, env: NodeJS.ProcessEnv = process.env): KeyStore | null {
  const spec = env.WREN_KEYSTORE_KEY;
  return spec ? pgKeyStore(main, keyRing(spec)) : null;
}

/** A fresh ring for tests and the local preview: nothing leaves the process. */
export const throwawayRing = (kid = "t1") => keyRing(newKeyPair(kid).privateSpec);
