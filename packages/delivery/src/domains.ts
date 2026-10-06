/**
 * Account > Domain: a client's portal on its own host (designs/2026-10-06-custom-domains.md).
 * The records to set and the live state come from Cloudflare; `Domains/resolve` tells the portal
 * Worker which client a host is.
 */
import * as restate from "@restatedev/restate-sdk";
import {
  addDomain,
  type ClientDomain,
  checkDomain,
  clientOfHost,
  DomainRefusal,
  type DomainsDeps,
  isLive,
  isOwner,
  listDomains,
  removeDomain,
} from "@wren/core/clients";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  seesInternal,
  teamCan,
} from "@wren/core/portal";

export interface DomainView {
  hostname: string;
  live: boolean;
  status: string;
  sslStatus: string;
  records: ClientDomain["records"];
  problem: string | null;
  checkedAt: string;
}

/** Cloudflare's answer is asked again at most this often for a host that isn't live. */
const RECHECK_MS = 10_000;

const viewOf = (d: ClientDomain): DomainView => ({
  hostname: d.hostname,
  live: isLive(d),
  status: d.status,
  sslStatus: d.sslStatus,
  records: d.records,
  problem: d.problem,
  checkedAt: d.checkedAt.toISOString(),
});

const refusal = (err: unknown): never => {
  if (err instanceof DomainRefusal) throw new PortalRefusal(err.message, err.status);
  throw err;
};

export function domainsApi(deps: DomainsDeps) {
  /** An owner of this client, or Wren's team with `manage` there. */
  const manager = async (req: PortalRequest) => {
    const { client, viewer } = await pickForWrite(deps.main, req);
    const ok = seesInternal(req)
      ? teamCan(req, "manage", client.id)
      : await isOwner(deps.main, client.id, viewer.email);
    if (!ok) throw new PortalRefusal("only an owner of this account can do that", 403);
    return { client, viewer };
  };
  return {
    /** This client's host, re-checked at Cloudflare while it isn't live. */
    domains: async (req: PortalRequest) => {
      const client = await pickClient(deps.main, req);
      if (isDemo(req.viewer))
        return { domains: [], target: deps.target, ready: false, canManage: false };
      const rows = await listDomains(deps.main, client.id);
      const fresh = await Promise.all(
        rows.map((r) =>
          deps.cloudflare && !isLive(r) && Date.now() - r.checkedAt.getTime() > RECHECK_MS
            ? checkDomain(deps, r).catch(() => r)
            : r,
        ),
      );
      const canManage = seesInternal(req)
        ? teamCan(req, "manage", client.id)
        : await isOwner(deps.main, client.id, req.viewer.email);
      return {
        domains: fresh.map(viewOf),
        target: deps.target,
        ready: deps.cloudflare !== undefined,
        canManage,
      };
    },
    addDomain: async (req: PortalRequest & { hostname: string }) => {
      const { client, viewer } = await manager(req);
      const row = await addDomain(deps, client.id, req.hostname, viewer.email).catch(refusal);
      return viewOf(row);
    },
    removeDomain: async (req: PortalRequest & { hostname: string }) => {
      const { client } = await manager(req);
      if (!(await removeDomain(deps, client.id, req.hostname).catch(refusal)))
        throw new PortalRefusal("no such domain on this account", 404);
      return { removed: String(req.hostname).trim().toLowerCase() };
    },
  };
}

/**
 * The portal Worker's lookup: which client a live host is, or null. No viewer: the host itself is
 * public (its DNS says it's ours), and the guard still checks every login against the client.
 */
export const makeDomainsResolver = (deps: Pick<DomainsDeps, "main">) =>
  restate.service({
    name: "Domains",
    handlers: {
      resolve: async (_: restate.Context, req: { host: string }) =>
        answer(async () => ({
          client: await clientOfHost(deps.main, String(req?.host ?? "").toLowerCase()),
        })),
    },
  });
