/**
 * autobrowse's site APIs from here: one client per worker, one call shaped
 * like the official API (`call("linkedin", "POST", "/rest/posts", body)`).
 * The worker answers through the platform's API or its browser; this side
 * never knows which, except through `fetchedWith` on what comes back.
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
  ): Promise<T>;
  /** How the worker answers a route now; `api` or `browser` (`none` when it cannot yet). */
  via(site: string, method: SiteMethod, path: string): Promise<FetchedWith | "none">;
}

export class SiteCallError extends Error {
  readonly status: number;
  constructor(site: string, method: string, path: string, status: number, message: string) {
    super(`${site} ${method} ${path}: ${status} ${message}`);
    this.name = "SiteCallError";
    this.status = status;
  }
}

interface SiteRow {
  routes: Array<{ method: string; path: string; via: "api" | "browser" | "none" }>;
}

/** `/rest/socialActions/{urn}` matches `/rest/socialActions/urn:li:share:1`. */
function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const a = (path.split("?")[0] ?? "").split("/");
  return p.length === a.length && p.every((seg, i) => seg.startsWith("{") || seg === a[i]);
}

export function autobrowseSites(o: {
  url: string;
  token?: string | null;
  fetch?: FetchLike;
}): SiteClient {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i));
  const base = o.url.replace(/\/$/, "");
  const headers = (json: boolean) => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
  });
  const statusRows = new Map<string, Promise<SiteRow>>();
  const status = (site: string) => {
    let p = statusRows.get(site);
    if (!p) {
      p = doFetch(`${base}/api/sites/${site}`, { method: "GET", headers: headers(false) }).then(
        async (res) => {
          if (!res.ok) throw new SiteCallError(site, "GET", "/", res.status, await res.text());
          return (await res.json()) as SiteRow;
        },
      );
      statusRows.set(site, p);
      // A status is a snapshot: tokens get made, flows get recorded. Ask again next time.
      p.finally(() => setTimeout(() => statusRows.delete(site), 60_000).unref?.());
    }
    return p;
  };
  return {
    async call(site, method, path, input = {}) {
      const read = method === "GET" || method === "DELETE";
      let url = `${base}/api/sites/${site}${path}`;
      if (read && Object.keys(input).length) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(input)) if (v !== undefined) q.set(k, String(v));
        url += `${path.includes("?") ? "&" : "?"}${q}`;
      }
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
      const row = (await status(site)).routes.find(
        (r) => r.method === method && matches(r.path, path),
      );
      return row?.via ?? "none";
    },
  };
}
