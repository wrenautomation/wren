/**
 * autobrowse's site APIs from the CLI: the `sites` service through Restate's
 * ingress (`ingressSites`), the same door the worker uses, so no box port is
 * ever reached. With an instance id, the first call starts the box when it is
 * stopped; with none, the Mac's desk serves every site. `timeoutMs` gives up on a call that
 * long instead of waiting, for a command that must not sit on a Mac that is off or a call
 * Restate keeps retrying.
 */
import { ingressOf, type Settings } from "@wren/config";
import type { SiteClient } from "@wren/core/content";
import { ingressSites as viaIngress } from "@wren/core/content/ingress";
import { DESK, SITES } from "@wren/core/content/restate";

export function ingressSites(
  settings: Settings,
  caller: string,
  service: { name: string } = settings.autobrowseInstanceId ? SITES : DESK,
  timeoutMs?: number,
): SiteClient {
  const id = service === SITES ? settings.autobrowseInstanceId : undefined; // the desk is the Mac: nothing to wake
  return viaIngress(ingressOf(settings), {
    caller,
    service,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(id
      ? { wake: () => import("@wren/core/content/box").then(({ ec2Wake }) => ec2Wake(id)()) }
      : {}),
  });
}
