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
import {
  GBP_API,
  GOOGLE_API,
  GRAPH,
  LINKEDIN_API,
  LINKEDIN_VERSION,
  TIKTOK_API,
  X_API,
} from "./oauth.js";
import type { SocialConnectionRow } from "./schema.js";

const TIKTOK_FIELDS =
  "id,title,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count";

export interface SocialSitesDeps {
  connection: (id: number) => Promise<SocialConnectionRow | null>;
  tokenOf: (c: SocialConnectionRow) => Promise<string>;
  broke: (id: number, why: string) => Promise<void>;
  fetch: FetchLike;
  /** Waits between X's video processing checks; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
}

/** X's chunk size for a video upload, under its 5 MB per append. */
export const X_CHUNK = 4 * 1024 * 1024;
/** Longest wait for X to finish processing a video before the call fails (and its step retries). */
const X_PROCESSING_MS = 5 * 60_000;

type Json = Record<string, unknown>;

const query = (input: Json) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(input))
    if (v !== undefined && v !== null)
      q.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return q;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
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
const codeOf = (b: Json) =>
  b.error && typeof b.error === "object" ? (b.error as Json).code : undefined;
/** A scope the token lacks (TikTok answers it with a 401): a missing scope, not a dead token. */
const missingScope = (b: Json) => codeOf(b) === "scope_not_authorized";
/** Meta's code 190 is a dead token whatever the status. */
const deadToken = (status: number, b: Json) =>
  (status === 401 && !missingScope(b)) || Number(codeOf(b)) === 190;

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
    throw new SiteCallError(site, method, path, missingScope(b) ? 403 : res.status, saidOf(b));
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

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /**
   * A video on X's v2 chunked upload: initialize, append each 4 MB chunk, finalize, then wait
   * while X processes it. Answers `{data: {id}}` like the image upload; the id posts once ready.
   */
  async function xVideo(
    c: SocialConnectionRow,
    auth: Record<string, string>,
    m: { bytes: ArrayBuffer; type: string },
  ): Promise<Json> {
    const path = "/2/media/upload";
    const json = (to: string, input: Json) =>
      http(c, "x", "POST", path, `${X_API}${to}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify(input),
      }).then(body);
    const init = await json("/2/media/upload/initialize", {
      media_type: m.type,
      total_bytes: m.bytes.byteLength,
      media_category: "tweet_video",
    });
    const id = str((init.data as Json | undefined)?.id);
    if (!id) throw new SiteCallError("x", "POST", path, 502, "the upload answered no id");
    for (let at = 0, seg = 0; at < m.bytes.byteLength; at += X_CHUNK, seg++) {
      const f = new FormData();
      f.set("segment_index", String(seg));
      f.set("media", new Blob([m.bytes.slice(at, at + X_CHUNK)], { type: m.type }));
      await http(c, "x", "POST", path, `${X_API}/2/media/upload/${id}/append`, {
        method: "POST",
        headers: auth,
        body: f,
      });
    }
    let state = await json(`/2/media/upload/${id}/finalize`, {});
    let waited = 0;
    for (;;) {
      const info = (state.data as Json | undefined)?.processing_info as Json | undefined;
      if (!info || info.state === "succeeded") return { data: { id } };
      if (info.state === "failed")
        throw new SiteCallError("x", "POST", path, 422, "X could not process the video");
      if (waited >= X_PROCESSING_MS)
        throw new SiteCallError("x", "POST", path, 504, "X is still processing the video");
      const wait = Math.min(Math.max(Number(info.check_after_secs) || 2, 1) * 1000, 30_000);
      await sleep(wait);
      waited += wait;
      state = await http(
        c,
        "x",
        "GET",
        path,
        withQuery(`${X_API}/2/media/upload`, query({ command: "STATUS", media_id: id })),
        { method: "GET", headers: auth },
      ).then(body);
    }
  }

  /**
   * One image or document onto LinkedIn: `initializeUpload` for the owner, then the bytes PUT to
   * its `uploadUrl`. Answers the URN a post names (channel-linkedin's `UPLOAD_PATH`).
   */
  async function linkedinUpload(
    c: SocialConnectionRow,
    input: Json,
    auth: Record<string, string>,
  ): Promise<{ urn: string }> {
    const path = "/upload";
    const kind = input.kind === "document" ? "documents" : input.kind === "image" ? "images" : null;
    if (!kind || typeof input.owner !== "string")
      throw new SiteCallError("linkedin", "POST", path, 422, "kind (image|document) and owner");
    const m = await media("linkedin", path, input.file);
    const headers = {
      ...auth,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    };
    const init = (await http(
      c,
      "linkedin",
      "POST",
      path,
      `${LINKEDIN_API}/rest/${kind}?action=initializeUpload`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ initializeUploadRequest: { owner: input.owner } }),
      },
    ).then(body)) as { value?: { uploadUrl?: string; image?: string; document?: string } };
    const v = init.value ?? {};
    const urn = v.image ?? v.document;
    if (!v.uploadUrl || !urn)
      throw new SiteCallError("linkedin", "POST", path, 502, "initializeUpload gave no uploadUrl");
    await http(c, "linkedin", "PUT", path, v.uploadUrl, {
      method: "PUT",
      headers: { ...auth, "content-type": m.type || "application/octet-stream" },
      body: m.bytes,
    });
    return { urn };
  }

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
        if (method === "POST" && path === "/upload") return linkedinUpload(c, input, auth);
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
          if (m.type.startsWith("video/")) return xVideo(c, auth, m);
          if (!m.type.startsWith("image/"))
            throw new SiteCallError(site, method, path, 422, "only images and videos upload to X");
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
      case "google_business": {
        // Only the connected location's own posts and reviews.
        const own = c.extra.location ? `/v4/${c.extra.location}/` : null;
        if (!own || !path.startsWith(own))
          throw new SiteCallError(site, method, path, 404, "not this Profile's location");
        return plain(GBP_API);
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
