/**
 * A client's reads through the vendor gate (designs/2026-10-07-setup-and-vendors.md): each read
 * a site call or a model call makes asks `gate` first and is `meter`ed after, on the client's
 * own limits. A stop throws `VendorStop` (a 429, so a pass that ends its reads on a cap ends
 * them on a stop too). Writes are never metered: a client's sends wait on its live flag.
 */
import type { Db } from "@wren/db";
import { SiteCallError, type SiteClient, type SiteMethod } from "./content/autobrowse.js";
import { gate, meter } from "./vendors.js";

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

/** The gate said no: nothing was read. `why` is the gate's words ("No daily share set"). */
export class VendorStop extends SiteCallError {
  readonly vendor: string;
  readonly why: string;
  constructor(site: string, method: string, path: string, vendor: string, why: string) {
    super(site, method, path, 429, `${vendor}: ${why}`);
    this.name = "VendorStop";
    this.vendor = vendor;
    this.why = why;
  }
}

export const isVendorStop = (err: unknown): err is VendorStop =>
  err instanceof Error && err.name === "VendorStop";

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
  return null;
}

const plain = <T>(_name: string, fn: () => Promise<T>) => fn();

/** One read: gate, run, meter. The meter counts what answered; a failed call costs nothing. */
async function admitted<T>(
  s: MeterScope,
  vendor: string,
  stop: (why: string) => VendorStop,
  run: () => Promise<T>,
): Promise<T> {
  const step = s.step ?? plain;
  const g = await step(`gate ${vendor}`, () => gate(s.main, s.client, vendor, 1, s.now()));
  if (!g.ok) throw stop(g.why);
  const out = await run();
  await step(`meter ${vendor}`, () =>
    meter(s.main, { client: s.client, vendor, units: 1, part: s.part, runId: s.runId ?? null }),
  );
  return out;
}

/**
 * The same sites, every read gated and metered for the scope's client. Reads go one at a time,
 * in the order asked: a caller's `Promise.all` would otherwise await journaled steps at once,
 * which a Restate handler can't, and a replay must meet them in the same order.
 */
export function meteredSites(sites: SiteClient, s: MeterScope): SiteClient {
  let chain: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };
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
      if (!vendor) return go();
      return inTurn(() =>
        admitted(s, vendor, (why) => new VendorStop(site, method, path, vendor, why), go),
      );
    },
    via: (site, method, path) => sites.via(site, method, path),
  };
}

/** A model client whose every call is gated and metered on `models`. */
export function meteredModel<L extends { complete: (...args: never[]) => Promise<unknown> }>(
  llm: L,
  s: Omit<MeterScope, "step">,
): L {
  const wrapped = Object.create(llm) as L;
  wrapped.complete = ((...args: Parameters<L["complete"]>) =>
    admitted(
      s,
      "models",
      (why) => new VendorStop("models", "POST", "complete", "models", why),
      () => llm.complete(...args),
    )) as L["complete"];
  return wrapped;
}
