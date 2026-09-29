/**
 * autobrowse's site APIs from the CLI: the `sites` service through Restate's
 * ingress, the same door the worker uses, so no box port is ever reached.
 * With an instance id, the first call starts the box when it is stopped;
 * Restate holds the call until the worker is back on the tunnel.
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
        return (await client.call({
          site,
          method,
          path,
          input,
          ...(account ? { account } : {}),
        })) as never;
      } catch (err) {
        throw siteError(err, site, method, path);
      }
    },
    async via(site, method, path) {
      await awake();
      return viaOf(await client.status({ site }), method, path);
    },
  };
}
