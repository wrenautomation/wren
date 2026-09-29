/**
 * autobrowse's site APIs from the CLI: the `sites` service through Restate's
 * ingress, the same door the worker uses, so no box port is ever reached.
 * With an instance id, the first call starts the box when it is stopped;
 * Restate holds the call until the worker is back on the tunnel. That can
 * outlast Node's 5-minute wait for response headers ("fetch failed"), so each
 * call carries an idempotency key and a dropped connection asks again with it:
 * Restate answers from the same invocation instead of running a second one.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { SiteCallError, type SiteClient, viaOf } from "@wren/core/content";
import { SITES, type SitesService } from "@wren/core/content/restate";

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

/** A connection that dropped before Restate answered: undici's "fetch failed". */
const dropped = (err: unknown) => err instanceof TypeError && err.message === "fetch failed";
const ATTEMPTS = 4;

async function held<T>(send: (idempotencyKey: string) => PromiseLike<T>): Promise<T> {
  const key = crypto.randomUUID();
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(key);
    } catch (err) {
      if (!dropped(err) || attempt >= ATTEMPTS) throw err;
    }
  }
}

export function ingressSites(settings: Settings): SiteClient {
  const client = clients.connect(ingressOf(settings)).serviceClient<SitesService>(SITES);
  let woken: Promise<unknown> | null = null;
  const awake = () => {
    const id = settings.autobrowseInstanceId;
    if (!id) return Promise.resolve();
    woken ??= import("@wren/core/content/box").then(({ ec2Wake }) => ec2Wake(id)());
    return woken;
  };
  return {
    async call(site, method, path, input = {}, account) {
      await awake();
      try {
        return (await held((idempotencyKey) =>
          client.call(
            {
              site,
              method,
              path,
              input,
              ...(account ? { account } : {}),
            },
            clients.rpc.opts({ idempotencyKey }),
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
          client.status({ site }, clients.rpc.opts({ idempotencyKey })),
        ),
        method,
        path,
      );
    },
  };
}
