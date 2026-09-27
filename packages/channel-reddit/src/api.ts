/**
 * Reddit's own API as a `SiteClient`, straight from wren: no autobrowse on
 * the path. An approved OAuth app's id and secret plus a permanent refresh
 * token (from one browser consent, autobrowse's job) mint hour-long access
 * tokens here; calls go to oauth.reddit.com with the User-Agent Reddit
 * requires. Reads send a query, writes a form body (Reddit takes no JSON).
 */
import type { FetchLike } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { REDDIT_SITE } from "./content.js";

export const REDDIT_API = "https://oauth.reddit.com";
export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
/** Mint a new token this long before the old one lapses. */
const EARLY_MS = 60_000;

export interface RedditApiOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The posting account, for the User-Agent. */
  username: string;
  fetch?: FetchLike;
  now?: () => number;
}

export const redditUserAgent = (username: string) => `server:wren-content:1.0 (by /u/${username})`;

export function redditApi(o: RedditApiOptions): SiteClient {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i));
  const now = o.now ?? Date.now;
  const userAgent = redditUserAgent(o.username);
  let token: { value: string; until: number } | null = null;

  const mint = async (): Promise<string> => {
    if (token && token.until > now()) return token.value;
    const res = await doFetch(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${o.clientId}:${o.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": userAgent,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: o.refreshToken }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    // Never echo the body: it holds the token on success.
    if (!res.ok || !body.access_token)
      throw new SiteCallError(
        REDDIT_SITE,
        "POST",
        "/api/v1/access_token",
        res.status,
        body.error ?? "no token",
      );
    token = {
      value: body.access_token,
      until: now() + (body.expires_in ?? 3600) * 1000 - EARLY_MS,
    };
    return token.value;
  };

  const send = async (method: string, path: string, input: Record<string, unknown>) => {
    const read = method === "GET" || method === "DELETE";
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(input))
      if (v !== undefined && v !== null)
        form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    const url = `${REDDIT_API}${path}${read && form.size ? `${path.includes("?") ? "&" : "?"}${form}` : ""}`;
    return doFetch(url, {
      method,
      headers: {
        authorization: `bearer ${await mint()}`,
        "user-agent": userAgent,
        ...(read ? {} : { "content-type": "application/x-www-form-urlencoded" }),
      },
      ...(read ? {} : { body: form }),
    });
  };

  return {
    async call(site, method, path, input = {}, account) {
      if (site !== REDDIT_SITE) throw new Error(`redditApi answers ${REDDIT_SITE}, not ${site}`);
      if (account) throw new Error("redditApi is one account; build one client per account");
      let res = await send(method, path, input);
      if (res.status === 401) {
        // Revoked or lapsed early: mint once more, then let the answer stand.
        token = null;
        res = await send(method, path, input);
      }
      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        const b = body as { message?: string; error?: string | number } | null;
        throw new SiteCallError(
          site,
          method,
          path,
          res.status,
          String(b?.message ?? b?.error ?? res.statusText),
        );
      }
      return body as never;
    },
    async via() {
      return "api";
    },
  };
}
