/**
 * Whose key a vendor call runs on (designs/2026-10-07-vendor-keys.md). One resolver for every
 * metered vendor: a client on its own key reads it from the key store, with a read event that
 * says why; a client on Wren's key (managed) gets Wren's, gated and metered on its share; a
 * client on its own key with none saved is refused, never quietly run on Wren's.
 *
 * A key is cached per resolver, and a resolver lives for one invocation: never a module global,
 * so one client's key can't reach another's call. Read it inside the step that spends it and
 * never return it from that step: Restate journals what a step returns.
 */
import type { Db } from "@wren/db";
import { and, eq } from "drizzle-orm";
import type { KeyStore } from "./keys.js";
import { vendorModes } from "./vendor-schema.js";
import { VendorStop } from "./vendor-stop.js";
import { gate, meter, vendorOf } from "./vendors.js";

/** Who reads a client's key when a vendor call does: on each read event. */
export const VENDOR_READER = "wren:vendors";

/**
 * Where Wren's own key for each vendor lives. `env`: the worker holds it under that name.
 * Otherwise the path holds it (autobrowse's Exa ring, the model gateway, Wren's service
 * account), and the managed answer carries no key.
 */
export const WREN_KEYS: Readonly<Record<string, { env: string | null; source: string }>> = {
  exa: { env: null, source: "autobrowse: Exa key ring" },
  youtube: { env: null, source: "Wren's service account" },
  x: { env: null, source: "autobrowse: x" },
  models: { env: null, source: "gateway" },
  telnyx: { env: "WREN_TELNYX_API_KEY", source: "env: WREN_TELNYX_API_KEY" },
};

export type VendorKey =
  /** The client's own key, from the store. `source`: `store:<ref>`. */
  | { mode: "own"; key: string; source: string; last4: string }
  /**
   * Wren's key. `key` null: the path holds it (`source` says which). `unset`: the client has no
   * mode and the call site keeps running on Wren's as it did before modes (metered, not gated).
   */
  | { mode: "managed"; key: string | null; source: string; unset?: true };

const SHORT: Readonly<Record<string, string>> = {
  exa: "Exa",
  youtube: "YouTube",
  x: "X",
  models: "model",
  telnyx: "Telnyx",
  stripe: "Stripe",
};
/** The vendor's short name for a person: "X", "Exa", "YouTube". */
const shortName = (vendor: string) => SHORT[vendor] ?? vendorOf(vendor).name;

/** No key, or no mode: the call never ran. A stop, so a pass ends its reads on it. */
export class VendorKeyMissing extends VendorStop {
  readonly client: string;
  constructor(client: string, vendor: string, why: string) {
    super(vendor, "KEY", "", vendor, why, 409);
    this.message = why;
    this.client = client;
  }
}

export interface VendorKeyOptions {
  keys: KeyStore | null;
  /** Why the key is read: on its read event ("exa search for signals"). */
  why: string;
  /** Wren's env, for a managed key the worker holds. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Who reads: on the event. */
  by?: string;
  /**
   * No mode set: `refuse` (the default, "Pick how … runs"), or `managed` for a call site that ran
   * on Wren's key before modes existed and must keep running. Own is never this.
   */
  unset?: "refuse" | "managed";
}

/**
 * The key a call for `client` (null: Wren's own) runs on. Own with a key: the store, read with
 * an event. Managed (or Wren): Wren's. Own with no key saved, or no mode set: refused with what
 * to do. Never falls back to Wren's key for a client on its own.
 */
export async function vendorKey(
  db: Db,
  client: string | null,
  vendor: string,
  o: VendorKeyOptions,
): Promise<VendorKey> {
  const v = vendorOf(vendor);
  if (client === null) return managedKey(v.id, o.env);
  const [m] = await db
    .select({ mode: vendorModes.mode, keyName: vendorModes.keyName })
    .from(vendorModes)
    .where(and(eq(vendorModes.client, client), eq(vendorModes.vendor, v.id)));
  if (!m && o.unset === "managed") return { ...managedKey(v.id, o.env), unset: true };
  if (!m)
    throw new VendorKeyMissing(
      client,
      v.id,
      `Pick how ${shortName(v.id)} runs in Account → Vendors`,
    );
  if (m.mode === "managed") return managedKey(v.id, o.env);
  const connect = `Connect your ${shortName(v.id)} key in Account → Vendors`;
  if (v.own !== "key" || !m.keyName) throw new VendorKeyMissing(client, v.id, connect);
  if (!o.keys) throw new VendorKeyMissing(client, v.id, "Saved keys can't be read here");
  const key = await o.keys.get({
    ref: m.keyName,
    client,
    by: o.by ?? VENDOR_READER,
    why: o.why,
  });
  if (!key) throw new VendorKeyMissing(client, v.id, connect);
  return { mode: "own", key, source: `store:${m.keyName}`, last4: key.slice(-4) };
}

function managedKey(
  vendor: string,
  env: Readonly<Record<string, string | undefined>> = {},
): Extract<VendorKey, { mode: "managed" }> {
  const w = WREN_KEYS[vendor];
  if (!w) return { mode: "managed", key: null, source: "wren" };
  const key = w.env ? (env[w.env]?.trim() ?? null) : null;
  if (w.env && !key) throw new Error(`Wren's ${shortName(vendor)} key isn't set here (${w.env})`);
  return { mode: "managed", key, source: w.source };
}

/** A key's text gone from an error: its message, and its cause's. Status and name kept. */
export function scrubKey(err: unknown, key: string | null): unknown {
  if (!key || key.length < 4 || !(err instanceof Error)) return err;
  const clean = (s: string) => s.split(key).join("[key]");
  const leaks = (e: unknown, depth = 0): boolean =>
    e instanceof Error &&
    depth < 4 &&
    (e.message.includes(key) || (e.stack ?? "").includes(key) || leaks(e.cause, depth + 1));
  if (!leaks(err)) return err;
  const out = new Error(clean(err.message)) as Error & Record<string, unknown>;
  out.name = err.name;
  for (const f of ["status", "site", "reason", "vendor", "why"])
    if (f in err) out[f] = clean(String((err as unknown as Record<string, unknown>)[f]));
  if ("status" in err) out.status = (err as { status: unknown }).status;
  out.stack = clean(err.stack ?? "");
  return out;
}

/** One call's use, as `meter` takes it: units, and dollars when the caller knows them. */
export interface Spent {
  units: number;
  micros?: number;
}

/** What spends: the call's client and what it is for. */
export interface VendorUse<T> {
  client: string | null;
  vendor: string;
  /** On the key's read event: "exa search for signals". */
  why: string;
  /** Units the gate asks for first; default 1. */
  units?: number;
  /** What the call spent, from its answer; default `units`. Null: nothing went out, no row. */
  spent?: (out: T) => Spent | null;
  part?: string | null;
  runId?: string | null;
}

/**
 * The resolver for one invocation: its keys cached per (client, vendor) for its life. `use`
 * resolves, gates, runs and meters, in both modes; a key never leaves in an error.
 */
export interface VendorKeys {
  key(client: string | null, vendor: string, why: string): Promise<VendorKey>;
  use<T>(o: VendorUse<T>, run: (k: VendorKey) => Promise<T>): Promise<T>;
}

export function vendorKeys(deps: {
  main: Db;
  keys: KeyStore | null;
  env?: Readonly<Record<string, string | undefined>>;
  by?: string;
  now?: () => Date;
  unset?: "refuse" | "managed";
}): VendorKeys {
  const cache = new Map<string, Promise<VendorKey>>();
  const now = deps.now ?? (() => new Date());
  const key = (client: string | null, vendor: string, why: string) => {
    const at = `${client ?? ""}\u0000${vendor}`;
    let k = cache.get(at);
    if (!k) {
      k = vendorKey(deps.main, client, vendor, {
        keys: deps.keys,
        why,
        ...(deps.env ? { env: deps.env } : {}),
        ...(deps.by ? { by: deps.by } : {}),
        ...(deps.unset ? { unset: deps.unset } : {}),
      });
      // A refusal isn't kept: a key saved a moment later works on the next call.
      k.catch(() => cache.delete(at));
      cache.set(at, k);
    }
    return k;
  };
  return {
    key,
    async use(o, run) {
      const k = await key(o.client, o.vendor, o.why);
      const units = o.units ?? 1;
      if (!(k.mode === "managed" && k.unset)) {
        const g = await gate(deps.main, o.client, o.vendor, units, now());
        if (!g.ok) {
          const stop = new VendorStop(o.vendor, "GATE", "", o.vendor, g.why);
          stop.message = `${shortName(o.vendor)}: ${g.why}`;
          throw stop;
        }
      }
      let out: Awaited<ReturnType<typeof run>>;
      try {
        out = await run(k);
      } catch (err) {
        throw scrubKey(err, k.key);
      }
      const s = o.spent ? o.spent(out) : { units };
      if (!s) return out;
      await meter(deps.main, {
        client: o.client,
        vendor: o.vendor,
        units: s.units,
        ...(s.micros !== undefined ? { micros: s.micros } : {}),
        part: o.part ?? null,
        runId: o.runId ?? null,
      });
      return out;
    },
  };
}
