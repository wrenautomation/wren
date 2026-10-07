/**
 * A client's reads through the vendor gate (designs/2026-10-07-setup-and-vendors.md): each read
 * a site call or a model call makes asks `gate` first and is `meter`ed after, on the client's
 * own limits. A stop throws `VendorStop` (a 429, so a pass that ends its reads on a cap ends
 * them on a stop too). Writes are never metered: a client's sends wait on its live flag.
 *
 * Whose key (designs/2026-10-07-vendor-keys.md): a client on its own Exa, X or YouTube key reads
 * straight from the vendor with it (`vendor-direct.ts`); on Wren's, through autobrowse as before.
 * autobrowse's people and LinkedIn routes that read Exa's index follow the client's Exa key too.
 * A model call on its own key goes straight to its provider; on Wren's, the gateway.
 */
import type { Db } from "@wren/db";
import { SiteCallError, type SiteClient, type SiteMethod } from "./content/autobrowse.js";
import type { FetchLike } from "./doh.js";
import type { KeyStore } from "./keys.js";
import { directCall, directRefusal, isExaRoute, unitsOfRead } from "./vendor-direct.js";
import { scrubKey, type VendorKeys, vendorKeys } from "./vendor-keys.js";
import { isVendorStop, VendorStop } from "./vendor-stop.js";
import { gate, meter, vendorOf } from "./vendors.js";

export { isVendorStop, VendorStop };

export interface MeterScope {
  main: Db;
  /** Null: Wren's own, client zero. */
  client: string | null;
  /** The part reading, on its usage rows. */
  part: string;
  now: () => Date;
  /** A journaled step (`ctx.run`) around the gate and the meter; a plain call without one. */
  step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  runId?: string | null;
}

/** The vendor a site call reads from, or null: writes and upkeep (inboxes, health) aren't. */
export function vendorOfCall(
  site: string,
  method: SiteMethod,
  path: string,
  input?: Record<string, unknown>,
): string | null {
  if (method !== "GET") return null;
  if (site === "reddit" || site === "reddit-public") return "reddit";
  if (site === "web" && input?.via === "exa") return "exa";
  if (site === "linkedin" && /^\/(in|search|company)\//.test(path)) return "linkedin";
  if (site === "x" && path.startsWith("/2/")) return "x";
  if (site === "youtube" && path.startsWith("/youtube/v3/")) return "youtube";
  return null;
}

const plain = <T>(_name: string, fn: () => Promise<T>) => fn();
/** Vendors a call can also reach on a signed-in account, where no API key is spent. */
const LOGINS = new Set(["x", "youtube"]);

/** A vendor's error body as one line, for the error a caller sees. */
function errorText(body: unknown): string {
  const b = body as {
    error?: unknown;
    title?: string;
    detail?: string;
    message?: string;
  } | null;
  const e = b?.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  return b?.detail ?? b?.title ?? b?.message ?? JSON.stringify(body ?? null).slice(0, 300);
}

type Answer = { ok: true; body: unknown } | { ok: false; status: number; error: string };

/**
 * The same sites, every read gated and metered for the scope's client, on the client's key when
 * it brings its own. Reads go one at a time, in the order asked: a caller's `Promise.all` would
 * otherwise await journaled steps at once, which a Restate handler can't, and a replay must meet
 * them in the same order. A key is read inside the step that spends it and never returned.
 */
export function meteredSites(
  sites: SiteClient,
  s: MeterScope & { store: KeyStore | null; fetch?: FetchLike },
): SiteClient {
  return routed(sites, s, true);
}

/**
 * Only whose key: a client's Exa, X and YouTube reads on its own key when it brought one, else
 * Wren's path as before; no gate, no meter (the caller has its own), and a client with no mode
 * stays on Wren's. Own with no key saved is a `VendorStop`, never Wren's key.
 */
export function keyedSites(
  sites: SiteClient,
  s: Omit<MeterScope, "part"> & { part?: string; store: KeyStore | null; fetch?: FetchLike },
): SiteClient {
  return routed(sites, { ...s, part: s.part ?? "reads" }, false);
}

function routed(
  sites: SiteClient,
  s: MeterScope & { store: KeyStore | null; fetch?: FetchLike },
  metered: boolean,
): SiteClient {
  const keys = vendorKeys({
    main: s.main,
    keys: s.store,
    now: s.now,
    ...(metered ? {} : { unset: "managed" as const }),
  });
  // Exa under people and LinkedIn routes: a client with no Exa mode stays on Wren's ring.
  const exaKeys = metered
    ? vendorKeys({ main: s.main, keys: s.store, now: s.now, unset: "managed" })
    : keys;
  const step = s.step ?? plain;
  let chain: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };
  const why = (vendor: string) => `${vendor} read for ${s.part}`;

  async function read<T>(
    vendor: string,
    site: string,
    method: SiteMethod,
    path: string,
    input: Record<string, unknown> | undefined,
    go: () => Promise<T>,
  ): Promise<T> {
    const stop = (w: string) => new VendorStop(site, method, path, vendor, w);
    const client = s.client;
    // Whose key: the step answers the mode, never the key.
    const mode =
      client !== null && vendorOf(vendor).own === "key"
        ? await step(`key ${vendor}`, () =>
            keys.key(client, vendor, why(vendor)).then(
              (k) => ({ mode: k.mode }),
              (err) => (isVendorStop(err) ? { stop: err.why } : Promise.reject(err)),
            ),
          )
        : { mode: "managed" as const };
    if ("stop" in mode) throw stop(mode.stop);
    if (mode.mode === "own") {
      const no = directRefusal(vendor, site, method, path);
      if (no) throw stop(no);
    }
    if (metered) {
      const g = await step(`gate ${vendor}`, () => gate(s.main, client, vendor, 1, s.now()));
      if (!g.ok) throw stop(g.why);
    }
    const out =
      mode.mode === "own" && client !== null
        ? await own<T>(keys, client, vendor, site, method, path, input)
        : await go();
    if (!metered) return out;
    const units = unitsOfRead(vendor, path, out);
    await step(`meter ${vendor}`, () =>
      meter(s.main, { client, vendor, units, part: s.part, runId: s.runId ?? null }),
    );
    return out;
  }

  /** One read on the client's own key, in a step that reads the key and never returns it. */
  async function own<T>(
    on: VendorKeys,
    client: string,
    vendor: string,
    site: string,
    method: SiteMethod,
    path: string,
    input: Record<string, unknown> | undefined,
  ): Promise<T> {
    const a = await step(`${vendor} on own key`, async (): Promise<Answer> => {
      const k = await on.key(client, vendor, why(vendor));
      if (k.mode !== "own" || !k.key) return { ok: false, status: 409, error: "key changed" };
      try {
        const r = await directCall(vendor, k.key, site, path, input, s.fetch);
        if (r.ok) return { ok: true, body: r.body };
        const e = scrubKey(new Error(errorText(r.body)), k.key) as Error;
        return { ok: false, status: r.status, error: e.message };
      } catch (err) {
        const e = scrubKey(err, k.key);
        return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
      }
    });
    if (!a.ok) throw new SiteCallError(site, method, path, a.status, a.error);
    return a.body as T;
  }

  /**
   * autobrowse's Exa-backed people, company and LinkedIn routes: the client's own Exa key when it
   * brought one, else Wren's ring as before. Only whose key: the caller gates and meters these
   * reads already (as LinkedIn search), and a client with no Exa mode stays on Wren's.
   */
  async function exaBacked<T>(
    client: string,
    site: string,
    method: SiteMethod,
    path: string,
    input: Record<string, unknown> | undefined,
    go: () => Promise<T>,
  ): Promise<T> {
    const mode = await step("key exa", () =>
      exaKeys.key(client, "exa", why("exa")).then(
        (k) => ({ mode: k.mode }),
        (err) => (isVendorStop(err) ? { stop: err.why } : Promise.reject(err)),
      ),
    );
    if ("stop" in mode) throw new VendorStop(site, method, path, "exa", mode.stop);
    if (mode.mode !== "own") return go();
    return own<T>(exaKeys, client, "exa", site, method, path, input);
  }

  return {
    call: <T>(
      site: string,
      method: SiteMethod,
      path: string,
      input?: Record<string, unknown>,
      account?: string,
    ) => {
      const vendor = vendorOfCall(site, method, path, input);
      const go = () => sites.call<T>(site, method, path, input, account);
      const client = s.client;
      if (!vendor && client !== null && isExaRoute(site, method, path))
        return inTurn(() => exaBacked<T>(client, site, method, path, input, go));
      // On a named login (a client's own X or YouTube account): that login's token, not a key.
      if (!vendor || (account && LOGINS.has(vendor))) return go();
      return inTurn(() => read<T>(vendor, site, method, path, input, go));
    },
    via: (site, method, path) => sites.via(site, method, path),
  };
}

/**
 * A model client whose every call runs on the client's `models` key: its own key straight to its
 * provider (`own`, no gateway), or Wren's (`llm`, the gateway) gated and metered on its share.
 * Own with no key saved is refused, never run on Wren's. `unset: "managed"` keeps a call site
 * that ran before modes running on Wren's for a client with no mode (metered, not gated). Build
 * one per invocation: its key is cached for its life.
 */
export function meteredModel<L extends { complete: (...args: never[]) => Promise<unknown> }>(
  llm: L,
  s: Omit<MeterScope, "step"> & {
    store: KeyStore | null;
    own: (key: string) => Pick<L, "complete">;
    unset?: "refuse" | "managed";
  },
): L {
  const keys = vendorKeys({
    main: s.main,
    keys: s.store,
    now: s.now,
    ...(s.unset ? { unset: s.unset } : {}),
  });
  let mine: { key: string; llm: Pick<L, "complete"> } | null = null;
  const ownOf = (key: string) => {
    if (mine?.key !== key) mine = { key, llm: s.own(key) };
    return mine.llm;
  };
  const wrapped = Object.create(llm) as L;
  wrapped.complete = ((...args: Parameters<L["complete"]>) =>
    keys.use(
      {
        client: s.client,
        vendor: "models",
        why: `model call for ${s.part}`,
        part: s.part,
        runId: s.runId ?? null,
      },
      (k) => (k.mode === "own" && k.key ? ownOf(k.key).complete(...args) : llm.complete(...args)),
    )) as L["complete"];
  return wrapped;
}
