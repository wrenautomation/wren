/**
 * The Search Console setup's check (designs/2026-10-07-setup-and-vendors.md): does Wren's service
 * account see the client's property? One free read of the properties it's on.
 */
import type { SetupCheck } from "@wren/core/setup";
import { listSites, type SearchConsoleClient } from "./console.js";

/** `sc-domain:example.com`, `https://example.com/` or a bare `example.com`, said one way. */
const bare = (ref: string) =>
  ref
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

/** The property an account names: its exact `siteUrl`, else the same domain said another way. */
export function propertyOf<T extends { siteUrl: string }>(ref: string, sites: readonly T[]) {
  return (
    sites.find((s) => s.siteUrl === ref.trim()) ??
    sites.find((s) => bare(s.siteUrl) === bare(ref)) ??
    null
  );
}

/** `client` is made on first use, so a worker without the key still starts. */
export function searchConsoleChecks(client: () => SearchConsoleClient): Record<string, SetupCheck> {
  let c: SearchConsoleClient | null = null;
  return {
    "search_console.access": async ({ account }) => {
      let sites: Awaited<ReturnType<typeof listSites>>;
      try {
        c ??= client();
        sites = await listSites(c);
      } catch (err) {
        return { ok: false, why: `Couldn't read Search Console: ${(err as Error).message}` };
      }
      const p = propertyOf(account.ref, sites);
      if (!p) return { ok: false, why: "Wren's service account doesn't see this property yet" };
      if (p.permissionLevel === "siteUnverifiedUser")
        return { ok: false, why: "The property isn't verified yet", seen: p };
      return { ok: true, why: "Wren's service account sees the property", seen: p };
    },
  };
}
