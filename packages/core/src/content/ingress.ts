/**
 * autobrowse's site APIs through Restate's ingress, from outside any
 * invocation's journal: the CLI, and a loop step already inside one `ctx.run`
 * (a journaled call there would break replay). With a `wake`, the first call
 * starts the box; Restate holds the call until the worker is back on the
 * tunnel. That can outlast Node's 5-minute wait for response headers ("fetch
 * failed"), so each call carries an idempotency key and a dropped connection
 * asks again with it: Restate answers from the same invocation instead of
 * running a second one. `timeoutMs` gives up instead, for a caller that must
 * not wait on a machine that is off. `caller` names who asks on every call,
 * so autobrowse can say who spent a capped site's reads.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { SiteCallError, type SiteClient, viaOf } from "./index.js";
import { SITES, type SitesHost, type SitesService } from "./restate.js";

/** Restate answers a terminal error as `{"code":429,"message":"…"}` under that status. */
function siteError(err: unknown, site: string, method: string, path: string): Error {
  if (!(err instanceof clients.HttpCallError))
    return err instanceof Error ? err : new Error(String(err));
  let message = err.responseText || err.message;
  try {
    message = (JSON.parse(err.responseText) as { message?: string }).message ?? message;
  } catch {}
  return new SiteCallError(site, method, path, err.status, message);
}

const dropped = (err: unknown) => err instanceof TypeError && err.message === "fetch failed";
const ATTEMPTS = 4;

export interface IngressSitesOptions extends Partial<SitesHost> {
  caller: string;
  /** Give up on a call after this long (no retry); absent = wait, asking again on a dropped connection. */
  timeoutMs?: number;
}

export function ingressSites(
  ingress: { url: string; headers?: Record<string, string> },
  o: IngressSitesOptions,
): SiteClient {
  const { caller, wake, timeoutMs, service = SITES } = o;
  const client = clients.connect(ingress).serviceClient<SitesService>(service);
  const limit = timeoutMs ? { timeout: timeoutMs } : {};
  const held = async <T>(send: (idempotencyKey: string) => PromiseLike<T>): Promise<T> => {
    const key = crypto.randomUUID();
    for (let attempt = 1; ; attempt++) {
      try {
        return await send(key);
      } catch (err) {
        if (timeoutMs || !dropped(err) || attempt >= ATTEMPTS) throw err;
      }
    }
  };
  let woken: Promise<unknown> | null = null;
  const awake = () => {
    if (!wake) return Promise.resolve();
    woken ??= wake();
    return woken;
  };
  return {
    async call(site, method, path, input = {}, account) {
      await awake();
      try {
        return (await held((idempotencyKey) =>
          client.call(
            { site, method, path, input, ...(account ? { account } : {}), caller },
            clients.rpc.opts({ idempotencyKey, ...limit }),
          ),
        )) as never;
      } catch (err) {
        throw siteError(err, site, method, path);
      }
    },
    async via(site, method, path) {
      await awake();
      return viaOf(
        await held((idempotencyKey) =>
          client.status({ site }, clients.rpc.opts({ idempotencyKey, ...limit })),
        ),
        method,
        path,
      );
    },
  };
}
