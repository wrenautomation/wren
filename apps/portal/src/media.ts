/**
 * Learn's pictures and audio through the app's own origin, so the page's CSP stays at 'self' for
 * images and media, however many hosts thumbnails and podcasts live on.
 *
 * - `POST /api/media/grant`: a signed-in operator gets a grant, good to the end of tomorrow
 *   (UTC). It is the same all day, so the browser caches each picture under one address.
 *   Anyone else names a workspace and its items (`{ client, items }`): Learn's service, asked as
 *   them, gives the pictures and audio of the items that workspace owns, and each gets a grant
 *   good for that address alone.
 * - `GET /media?u=<https address>&g=<grant>`: that picture or audio file. Range passes through,
 *   so a long episode seeks. Only images and audio pass; every answer is sandboxed, so an SVG
 *   can't run as the app.
 * - `GET /media?u=s3://<bucket>/media/<hash>.<ext>&g=<grant>`: a picture Learn's ingest kept in
 *   our store. It never changes, so the edge keeps it a year; a miss asks Learn for a signed
 *   address once. Opening Learn reads no platform.
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
type MediaKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

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

/** Signed over the expiry, and the one address it's good for when it names one. */
const message = (exp: number, url?: string) =>
  enc.encode(url ? `media|${exp}|${url}` : `media|${exp}`);
const sign = async (key: MediaKey, exp: number, url?: string) =>
  hex(await crypto.subtle.sign("HMAC", key, message(exp, url)));
const expiry = (now: number) => (Math.floor(now / 1000 / DAY_S) + 2) * DAY_S;

/** A grant good to the end of tomorrow, UTC. */
export async function grantFor(
  key: MediaKey,
  now = Date.now(),
): Promise<{ grant: string; expires: string }> {
  const exp = expiry(now);
  return { grant: `${exp}.${await sign(key, exp)}`, expires: new Date(exp * 1000).toISOString() };
}

/** A grant for each address, good for it alone, to the end of tomorrow: a client's items. */
export async function urlGrantsFor(
  key: MediaKey,
  urls: readonly string[],
  now = Date.now(),
): Promise<{ grants: Record<string, string>; expires: string }> {
  const exp = expiry(now);
  const grants: Record<string, string> = {};
  for (const u of urls) grants[u] = `${exp}.${await sign(key, exp, u)}`;
  return { grants, expires: new Date(exp * 1000).toISOString() };
}

/** The grant is ours, not past its end, and good for every address or for `url`. */
async function grantOk(
  key: MediaKey,
  grant: string,
  url: string | null = null,
  now = Date.now(),
): Promise<boolean> {
  const m = /^(\d{9,11})\.([0-9a-f]{64})$/.exec(grant);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < now) return false;
  const sig = new Uint8Array((m[2] ?? "").match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
  if (await crypto.subtle.verify("HMAC", key, sig, message(exp))) return true;
  return !!url && crypto.subtle.verify("HMAC", key, sig, message(exp, url));
}

/** The address a page may load, or null: https, a public host. */
function mediaTarget(raw: string | null): URL | null {
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

/** A picture Learn kept: content-addressed, so it never changes under its name. */
const STORED = /^s3:\/\/[a-z0-9.-]+\/media\/[0-9a-f]{32}\.(jpg|png|webp|gif|avif)$/;
const YEAR_S = 365 * DAY_S;

/** Where a stored picture comes from: its signed address, and the edge's cache. */
interface StoredMedia {
  sign: (ref: string) => Promise<string | null>;
  cache?: {
    match(req: Request): Promise<Response | undefined>;
    put(req: Request, res: Response): Promise<void>;
  } | null;
  /** Keeps the cache write alive past the answer (the Worker's `waitUntil`). */
  wait?: (p: Promise<unknown>) => void;
}

const safeHeaders = (type: string, cache: string) =>
  new Headers({
    "content-type": type,
    "cache-control": cache,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  });

/** A stored picture: the edge's copy, or the store's once, then kept a year. */
async function storedPicture(
  req: Request,
  ref: string,
  stored: StoredMedia | undefined,
  fetchFn: typeof fetch,
): Promise<Response> {
  if (!stored) return new Response(null, { status: 404 });
  const cacheKey = new Request(`https://media.cache/${encodeURIComponent(ref)}`);
  let kept = (await stored.cache?.match(cacheKey).catch(() => undefined)) ?? null;
  if (!kept) {
    const url = await stored.sign(ref).catch(() => null);
    if (!url) return new Response(null, { status: 404 });
    let up: Response;
    try {
      up = await fetchFn(url);
    } catch {
      return new Response(null, { status: 502 });
    }
    if (!up.ok) return new Response(null, { status: up.status === 404 ? 404 : 502 });
    const type = (up.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!type.startsWith("image/")) return new Response(null, { status: 415 });
    kept = new Response(await up.arrayBuffer(), {
      headers: { "content-type": type, "cache-control": `public, max-age=${YEAR_S}, immutable` },
    });
    const put = stored.cache?.put(cacheKey, kept.clone());
    if (put) stored.wait ? stored.wait(put.catch(() => {})) : await put.catch(() => {});
  }
  const type = kept.headers.get("content-type") ?? "image/jpeg";
  return new Response(req.method === "HEAD" ? null : kept.body, {
    headers: safeHeaders(type, `private, max-age=${YEAR_S}, immutable`),
  });
}

/** `GET /media`: the picture or audio file a grant asks for. */
export async function mediaProxy(
  req: Request,
  key: MediaKey,
  fetchFn: typeof fetch = fetch,
  stored?: StoredMedia,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const q = new URL(req.url).searchParams;
  if (!(await grantOk(key, q.get("g") ?? "", q.get("u"))))
    return new Response(null, { status: 403 });
  const ref = q.get("u") ?? "";
  if (ref.startsWith("s3://"))
    return STORED.test(ref)
      ? storedPicture(req, ref, stored, fetchFn)
      : new Response(null, { status: 400 });
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
  const headers = safeHeaders(type, "private, max-age=86400");
  for (const h of KEEP) {
    const v = up.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, headers });
}
