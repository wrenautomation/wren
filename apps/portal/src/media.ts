/**
 * Learn's pictures and audio through the app's own origin, so the page's CSP stays at 'self' for
 * images and media, however many hosts thumbnails and podcasts live on.
 *
 * - `POST /api/media/grant`: a signed-in operator gets a grant, good to the end of tomorrow
 *   (UTC). It is the same all day, so the browser caches each picture under one address.
 * - `GET /media?u=<https address>&g=<grant>`: that picture or audio file. Range passes through,
 *   so a long episode seeks. Only images and audio pass; every answer is sandboxed, so an SVG
 *   can't run as the app.
 *
 * The grant is an HMAC of its expiry under a key derived from a secret the Worker already holds:
 * no new secret, and nothing to store. Web APIs only, so the preview runs the same code.
 */

export const MEDIA_PATH = "/media";
export const MEDIA_GRANT_PATH = "/api/media/grant";

const DAY_S = 86_400;
const AUDIO_PATH = /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i;
/** Hosts a picture never comes from: this machine and private ranges, by name or number. */
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|\[.*\]|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

/** The HMAC key: named by what makes one, since the Worker's types and the DOM's differ. */
export type MediaKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The signing key, derived from a secret the Worker holds, labelled for this use alone. */
export async function mediaKey(secret: string): Promise<MediaKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign("HMAC", base, enc.encode("wren learn media v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const sign = async (key: MediaKey, exp: number) =>
  hex(await crypto.subtle.sign("HMAC", key, enc.encode(`media|${exp}`)));

/** A grant good to the end of tomorrow, UTC. */
export async function grantFor(
  key: MediaKey,
  now = Date.now(),
): Promise<{ grant: string; expires: string }> {
  const exp = (Math.floor(now / 1000 / DAY_S) + 2) * DAY_S;
  return { grant: `${exp}.${await sign(key, exp)}`, expires: new Date(exp * 1000).toISOString() };
}

/** The grant is ours and not past its end. */
export async function grantOk(key: MediaKey, grant: string, now = Date.now()): Promise<boolean> {
  const m = /^(\d{9,11})\.([0-9a-f]{64})$/.exec(grant);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < now) return false;
  const sig = new Uint8Array((m[2] ?? "").match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(`media|${exp}`));
}

/** The address a page may load, or null: https, a public host. */
export function mediaTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (PRIVATE_HOST.test(u.hostname)) return null;
  return u;
}

const KEEP = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

/** `GET /media`: the picture or audio file a grant asks for. */
export async function mediaProxy(
  req: Request,
  key: MediaKey,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const q = new URL(req.url).searchParams;
  if (!(await grantOk(key, q.get("g") ?? ""))) return new Response(null, { status: 403 });
  const target = mediaTarget(q.get("u"));
  if (!target) return new Response(null, { status: 400 });
  const range = req.headers.get("range");
  let up: Response;
  try {
    up = await fetchFn(target.toString(), {
      method: req.method,
      headers: {
        accept: "image/avif,image/webp,image/*,audio/*;q=0.9,*/*;q=0.5",
        "user-agent": "Mozilla/5.0 (compatible; WrenLearn/1.0)",
        ...(range ? { range } : {}),
      },
      redirect: "follow",
      // The edge keeps a whole picture a day; a range is never cached.
      ...(range ? {} : { cf: { cacheEverything: true, cacheTtl: DAY_S } }),
    } as RequestInit);
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!up.ok) return new Response(null, { status: up.status === 404 ? 404 : 502 });
  let type = (up.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (/^(application|binary)\/octet-stream$/.test(type) && AUDIO_PATH.test(target.pathname))
    type = "audio/mpeg";
  if (!/^(image|audio)\//.test(type)) return new Response(null, { status: 415 });
  const headers = new Headers({
    "content-type": type,
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  });
  for (const h of KEEP) {
    const v = up.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, headers });
}
