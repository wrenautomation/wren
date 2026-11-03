/**
 * Whose Telnyx account signed a webhook (designs/2026-10-07-vendor-keys.md). The number the
 * event is about picks the owner: Wren's numbers sit in main, a client's in its own database.
 * A client on its own Telnyx account (`telnyx` mode `own`) signs with its account's public key,
 * saved beside its API key as `TELNYX_PUBLIC_KEY`; everyone else is on Wren's account and its
 * key. A client's key only ever admits events into that client's database.
 */
import { clients } from "@wren/core/clients";
import type { KeyStore } from "@wren/core/keys";
import { VENDOR_READER } from "@wren/core/vendor-keys";
import { modeOf, vendorOf } from "@wren/core/vendors";
import type { Db } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { TEXTS } from "./clients.js";
import { smsNumbers } from "./schema.js";

/**
 * Who a webhook is for and the key to check it with. `client` null: Wren's. `publicKey` null:
 * Wren's account key (the phone Worker's `TELNYX_PUBLIC_KEY`).
 */
export type Signer =
  | { ok: true; client: string | null; publicKey: string | null }
  | { ok: false; why: string };

export interface SignerDeps {
  main: Db;
  clientDb: (id: string) => Db;
  keys: KeyStore | null;
}

const has = async (db: Db, e164: string) =>
  (await db.select({ id: smsNumbers.id }).from(smsNumbers).where(eq(smsNumbers.e164, e164)))
    .length > 0;

/** The client whose database holds `e164`, among those `only` names (every texting client). */
async function clientWith(d: SignerDeps, e164: string, only: string | null) {
  const rows = await d.main
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.demo, false),
        only
          ? eq(clients.id, only)
          : sql`(${clients.products} ? ${TEXTS} or ${clients.accounts} ? 'telnyx')`,
      ),
    );
  for (const r of rows) if (await has(d.clientDb(r.id), e164)) return r.id;
  return null;
}

/** The key `client` signs with: its own account's when it texts on its own, else Wren's. */
async function keyOf(d: SignerDeps, client: string): Promise<Signer> {
  const v = vendorOf("telnyx");
  const m = await modeOf(d.main, client, v.id);
  if (m?.mode !== "own") return { ok: true, client, publicKey: null };
  const name = v.publicKeyName ?? "TELNYX_PUBLIC_KEY";
  if (!d.keys) return { ok: false, why: "saved keys can't be read here" };
  const publicKey = await d.keys.named({
    client,
    name,
    by: VENDOR_READER,
    why: "telnyx webhook signature",
  });
  if (!publicKey) return { ok: false, why: `${client} has no Telnyx public key saved` };
  return { ok: true, client, publicKey };
}

/**
 * The owner of a webhook about `number` (null: the event names none, as 10DLC's don't), sent to
 * `client`'s path (null: Wren's). The number's owner wins; a path naming someone else is refused.
 */
export async function telnyxSigner(
  d: SignerDeps,
  o: { number: string | null; client: string | null },
): Promise<Signer> {
  const number = o.number?.trim() || null;
  if (number) {
    if (await has(d.main, number))
      return o.client
        ? { ok: false, why: "that number is Wren's" }
        : { ok: true, client: null, publicKey: null };
    const owner = await clientWith(d, number, o.client);
    if (owner) return keyOf(d, owner);
    if (o.client && (await clientWith(d, number, null)))
      return { ok: false, why: `that number isn't ${o.client}'s` };
  }
  // A number nobody holds yet (or none named): the path's owner, on its own terms.
  return o.client ? keyOf(d, o.client) : { ok: true, client: null, publicKey: null };
}
