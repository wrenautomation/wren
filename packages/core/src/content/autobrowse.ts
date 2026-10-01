/**
 * autobrowse's site APIs from here: one call shaped like the official API
 * (`call("linkedin", "POST", "/rest/posts", body)`). The worker answers
 * through the platform's API or its browser; this side never knows which,
 * except through `fetchedWith` on what comes back. This is the HTTP client
 * (a laptop against a local autobrowse); the worker uses `restateSites` in
 * `./restate.js`, which reaches the box through Restate without a port.
 */
import type { FetchLike } from "../doh.js";
import type { FetchedWith } from "./index.js";

export type SiteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SiteClient {
  call<T = unknown>(
    site: string,
    method: SiteMethod,
    path: string,
    input?: Record<string, unknown>,
    /** Which of the site's logins answers (`linkedin@outreach-2`); absent = the site's default. */
    account?: string,
  ): Promise<T>;
  /** How the worker answers a route now; `api` or `browser` (`none` when it cannot yet). */
  via(site: string, method: SiteMethod, path: string): Promise<FetchedWith | "none">;
}

export class SiteCallError extends Error {
  readonly site: string;
  readonly status: number;
  constructor(site: string, method: string, path: string, status: number, message: string) {
    super(`${site} ${method} ${path}: ${status} ${message}`);
    this.name = "SiteCallError";
    this.site = site;
    this.status = status;
  }
}

/** The part of autobrowse's site status this side reads. */
export interface SiteStatus {
  routes: Array<{ method: string; path: string; via: "api" | "browser" | "none" }>;
}

/** `/rest/socialActions/{urn}` matches `/rest/socialActions/urn:li:share:1`. */
export function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const a = (path.split("?")[0] ?? "").split("/");
  const one = (seg: string, got: string) => {
    // `{urn}`, or a fixed prefix/suffix around it (`act_{adAccountId}`).
    const m = /^([^{}]*)\{[^{}]+\}([^{}]*)$/.exec(seg);
    if (!m) return seg === got;
    const [, before = "", after = ""] = m;
    return (
      got.startsWith(before) && got.endsWith(after) && got.length > before.length + after.length
    );
  };
  return p.length === a.length && p.every((seg, i) => one(seg, a[i] ?? ""));
}

/** A route's `via` from a status snapshot; `none` when the worker has no leg for it. */
export function viaOf(status: SiteStatus, method: string, path: string): FetchedWith | "none" {
  const row = status.routes.find((r) => r.method === method && matches(r.path, path));
  return row?.via ?? "none";
}

/**
 * The same client, pinned to one login: every call carries `account`, so an
 * adapter written for "the" LinkedIn works unchanged for any of them.
 */
export function asAccount(sites: SiteClient, account: string | null | undefined): SiteClient {
  if (!account) return sites;
  return {
    call: (site, method, path, input, a) => sites.call(site, method, path, input, a ?? account),
    via: (site, method, path) => sites.via(site, method, path),
  };
}

export function autobrowseSites(o: {
  url: string;
  token?: string | null;
  fetch?: FetchLike;
  /** Who in wren asked, sent as `x-caller` for autobrowse's per-caller usage. */
  caller?: string;
}): SiteClient {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i));
  const base = o.url.replace(/\/$/, "");
  const headers = (json: boolean) => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    ...(o.caller ? { "x-caller": o.caller } : {}),
  });
  const statusRows = new Map<string, Promise<SiteStatus>>();
  const status = (site: string) => {
    let p = statusRows.get(site);
    if (!p) {
      p = doFetch(`${base}/api/sites/${site}`, { method: "GET", headers: headers(false) }).then(
        async (res) => {
          if (!res.ok) throw new SiteCallError(site, "GET", "/", res.status, await res.text());
          return (await res.json()) as SiteStatus;
        },
      );
      statusRows.set(site, p);
      // A status is a snapshot: tokens get made, flows get recorded. Ask again next time.
      p.finally(() => setTimeout(() => statusRows.delete(site), 60_000).unref?.());
    }
    return p;
  };
  return {
    async call(site, method, path, input = {}, account) {
      const read = method === "GET" || method === "DELETE";
      let url = `${base}/api/sites/${site}${path}`;
      const q = new URLSearchParams();
      if (read)
        for (const [k, v] of Object.entries(input)) if (v !== undefined) q.set(k, String(v));
      // The server takes `account` off the query before the site sees it.
      if (account) q.set("account", account);
      if (q.size) url += `${path.includes("?") ? "&" : "?"}${q}`;
      const res = await doFetch(url, {
        method,
        headers: headers(!read),
        ...(read ? {} : { body: JSON.stringify(input) }),
      });
      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        const message = (body as { error?: string } | null)?.error ?? res.statusText;
        throw new SiteCallError(site, method, path, res.status, message);
      }
      return body as never;
    },
    async via(site, method, path) {
      return viaOf(await status(site), method, path);
    },
  };
}
