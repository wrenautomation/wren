/**
 * A client's connected accounts as a `SiteClient` (designs/2026-10-07-client-social.md): the same
 * calls Wren's adapters make through autobrowse, sent straight to each platform's official API
 * on the client's token. The account is `social:<connection id>`. Reads send a query, writes JSON.
 * The worker wraps it in `journaledSites`, so each call is one step and only the platform's
 * answer is journaled; the token is read inside the step and never leaves this file.
 */
import type { FetchLike } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { connectionIdOf, SocialRefusal } from "./access.js";
import { GOOGLE_API, GRAPH, LINKEDIN_API, TIKTOK_API, X_API } from "./oauth.js";
import type { SocialConnectionRow } from "./schema.js";

export const LINKEDIN_VERSION = "202508";
const TIKTOK_FIELDS =
  "id,title,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count";

export interface SocialSitesDeps {
  connection: (id: number) => Promise<SocialConnectionRow | null>;
  tokenOf: (c: SocialConnectionRow) => Promise<string>;
  broke: (id: number, why: string) => Promise<void>;
  fetch: FetchLike;
}

type Json = Record<string, unknown>;

const query = (input: Json) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(input))
    if (v !== undefined && v !== null)
      q.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return q;
};
const withQuery = (url: string, q: URLSearchParams) =>
  q.size ? `${url}${url.includes("?") ? "&" : "?"}${q}` : url;

/** The platform's own words on a refusal: its message's first line, never the body. */
function saidOf(b: Json): string {
  const e = b.error;
  const m =
    (e && typeof e === "object" ? (e as Json).message : e) ??
    b.message ??
    b.detail ??
    b.title ??
    "";
  return String(m).split(/\r?\n/)[0]?.slice(0, 200) || "refused";
}
/** Meta's code 190 is a dead token whatever the status. */
const deadToken = (status: number, b: Json) =>
  status === 401 ||
  (!!b.error && typeof b.error === "object" && Number((b.error as Json).code) === 190);

export function socialSites(deps: SocialSitesDeps): SiteClient {
  const http = async (
    c: SocialConnectionRow,
    site: string,
    method: string,
    path: string,
    url: string,
    init: RequestInit,
  ): Promise<Response> => {
    const res = await deps.fetch(url, init);
    if (res.ok) return res;
    const b = (await res.json().catch(() => ({}))) as Json;
    if (deadToken(res.status, b))
      await deps.broke(c.id, "Access was taken back. Connect it again.");
    throw new SiteCallError(site, method, path, res.status, saidOf(b));
  };
  const body = async (res: Response) => {
    const t = await res.text();
    return t ? (JSON.parse(t) as Json) : {};
  };
  /** The bytes behind a hosted media URL. */
  const media = async (site: string, path: string, file: unknown) => {
    if (typeof file !== "string" || !/^https:\/\//.test(file))
      throw new SiteCallError(site, "POST", path, 422, "media must be a hosted https URL");
    const res = await deps.fetch(file, { method: "GET" });
    if (!res.ok) throw new SiteCallError(site, "POST", path, 422, `media fetch ${res.status}`);
    return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "" };
  };

  async function send(
    c: SocialConnectionRow,
    site: string,
    method: string,
    path: string,
    input: Json,
  ): Promise<unknown> {
    const token = await deps.tokenOf(c);
    const auth = { authorization: `Bearer ${token}` };
    const read = method === "GET" || method === "DELETE";
    const plain = (origin: string, extra: Record<string, string> = {}) =>
      read
        ? http(c, site, method, path, withQuery(`${origin}${path}`, query(input)), {
            method,
            headers: { ...auth, ...extra },
          }).then(body)
        : http(c, site, method, path, `${origin}${path}`, {
            method,
            headers: { ...auth, ...extra, "content-type": "application/json" },
            body: JSON.stringify(input),
          }).then(body);

    switch (site) {
      case "meta": {
        // A Page's token reads no `me/accounts`: the Page it is answers from the connection.
        if (method === "GET" && path === "/me/accounts") {
          const e = c.extra;
          return {
            data: e.pageId
              ? [
                  {
                    id: e.pageId,
                    name: e.pageName ?? c.name,
                    ...(e.igUserId ? { instagram_business_account: { id: e.igUserId } } : {}),
                  },
                ]
              : [],
          };
        }
        return plain(GRAPH);
      }
      case "linkedin": {
        if (!/^\/(rest|v2)\//.test(path))
          throw new SiteCallError(site, method, path, 404, "not on LinkedIn's API");
        const headers = {
          "LinkedIn-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
        };
        if (method === "POST" && path === "/rest/posts") {
          // The new post's URN comes in a header; the body is empty.
          const res = await http(c, site, method, path, `${LINKEDIN_API}${path}`, {
            method,
            headers: { ...auth, ...headers, "content-type": "application/json" },
            body: JSON.stringify(input),
          });
          return { id: res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") };
        }
        return plain(LINKEDIN_API, headers);
      }
      case "youtube": {
        if (read) return plain(GOOGLE_API);
        if (path === "/upload/youtube/v3/videos") {
          const { file, part, notifySubscribers, ...meta } = input;
          const m = await media(site, path, file);
          const q = new URLSearchParams({
            uploadType: "resumable",
            part: String(part ?? "snippet,status"),
          });
          if (notifySubscribers !== undefined)
            q.set("notifySubscribers", String(notifySubscribers));
          const start = await http(c, site, method, path, `${GOOGLE_API}${path}?${q}`, {
            method: "POST",
            headers: {
              ...auth,
              "content-type": "application/json",
              "x-upload-content-type": m.type || "video/*",
            },
            body: JSON.stringify(meta),
          });
          const at = start.headers.get("location");
          if (!at) throw new SiteCallError(site, method, path, 502, "no upload address");
          return body(
            await http(c, site, "PUT", path, at, {
              method: "PUT",
              headers: { ...auth, "content-type": m.type || "video/*" },
              body: m.bytes,
            }),
          );
        }
        if (path.startsWith("/upload/"))
          throw new SiteCallError(site, method, path, 422, "not on a client's channel yet");
        const { part, ...rest } = input;
        const payload =
          path === "/youtube/v3/playlistItems" && rest.videoId
            ? {
                snippet: {
                  playlistId: rest.playlistId,
                  resourceId: { kind: "youtube#video", videoId: rest.videoId },
                },
              }
            : rest;
        return body(
          await http(
            c,
            site,
            method,
            path,
            `${GOOGLE_API}${path}?part=${encodeURIComponent(String(part ?? "snippet"))}`,
            {
              method,
              headers: { ...auth, "content-type": "application/json" },
              body: JSON.stringify(payload),
            },
          ),
        );
      }
      case "x": {
        if (method === "POST" && path === "/2/media/upload") {
          const m = await media(site, path, input.file);
          if (!m.type.startsWith("image/"))
            throw new SiteCallError(site, method, path, 422, "only images upload to a client's X");
          const f = new FormData();
          f.set("media", new Blob([m.bytes], { type: m.type }));
          f.set("media_category", "tweet_image");
          return body(
            await http(c, site, method, path, `${X_API}${path}`, {
              method,
              headers: auth,
              body: f,
            }),
          );
        }
        return plain(X_API);
      }
      case "tiktok": {
        const listing = path === "/v2/video/list/" || path === "/v2/video/query/";
        const url = listing
          ? `${TIKTOK_API}${path}?fields=${encodeURIComponent(TIKTOK_FIELDS)}`
          : `${TIKTOK_API}${path}`;
        if (read) return plain(TIKTOK_API);
        return body(
          await http(c, site, method, path, url, {
            method,
            headers: { ...auth, "content-type": "application/json; charset=UTF-8" },
            body: JSON.stringify(input),
          }),
        );
      }
      default:
        throw new SiteCallError(site, method, path, 404, "no such site on a client's account");
    }
  }

  return {
    async call<T>(
      site: string,
      method: Parameters<SiteClient["call"]>[1],
      path: string,
      input: Json = {},
      account?: string,
    ): Promise<T> {
      const id = connectionIdOf(account);
      if (id === null) throw new SiteCallError(site, method, path, 400, "no connected account");
      const c = await deps.connection(id);
      if (!c) throw new SiteCallError(site, method, path, 404, "that account was disconnected");
      if (c.state === "broken")
        throw new SiteCallError(site, method, path, 409, c.why ?? "its sign-in stopped working");
      try {
        return (await send(c, site, method, path, input)) as T;
      } catch (err) {
        if (err instanceof SocialRefusal)
          throw new SiteCallError(site, method, path, 409, err.message);
        throw err;
      }
    },
    via: async () => "api",
  };
}
