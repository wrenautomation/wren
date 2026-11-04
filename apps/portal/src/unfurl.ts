/**
 * Link previews (designs/2026-11-04-multi-user-runtime.md, Decision 12): `GET /api/unfurl?url=`,
 * a signed-in person only. The page's head gives a title, a line, an image and an icon; images come
 * back as `data:` URLs so the CSP holds and the viewer's browser never calls the site. Cloudflare
 * refuses private addresses; IP literals and odd ports are refused here too.
 */
import { Parser } from "htmlparser2";

export const UNFURL_PATH = "/api/unfurl";

const HTML_MAX = 512 * 1024;
const IMAGE_MAX = 300 * 1024;
const ICON_MAX = 50 * 1024;
const WAIT_MS = 5000;
const CACHE_SECONDS = 3600;
const UA = "WrenPreview/1 (+https://wrenautomation.com)";

export interface Preview {
  url: string;
  host: string;
  title?: string;
  line?: string;
  image?: string;
  icon?: string;
}

/** The address, if it may be fetched: http(s), a name not an IP, the default port. */
export function fetchable(raw: string | null): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.port || u.username || u.password) return null;
  const h = u.hostname;
  if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^[\d.]+$/.test(h) || h.startsWith("[")) return null;
  return u;
}

interface Head {
  title?: string;
  line?: string;
  image?: string;
  icon?: string;
}

/** The head's preview fields, relative addresses made whole against `base`. */
export function headOf(html: string, base: string): Head {
  const meta = new Map<string, string>();
  const icons: { href: string; rank: number }[] = [];
  let title = "";
  let inTitle = false;
  let done = false;
  const p = new Parser(
    {
      onopentag(name, a) {
        if (done) return;
        if (name === "title") inTitle = true;
        else if (name === "meta") {
          const k = (a.property ?? a.name ?? "").toLowerCase();
          if (k && a.content && !meta.has(k)) meta.set(k, a.content);
        } else if (name === "link" && a.href) {
          const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
          if (rel.includes("icon")) icons.push({ href: a.href, rank: 2 });
          else if (rel.includes("apple-touch-icon")) icons.push({ href: a.href, rank: 1 });
        } else if (name === "body") done = true;
      },
      ontext(t) {
        if (inTitle && !done) title += t;
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
        if (name === "head") done = true;
      },
    },
    { decodeEntities: true },
  );
  p.write(html);
  p.end();
  const abs = (x: string | undefined) => {
    if (!x) return undefined;
    try {
      const u = new URL(x.trim(), base);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
    } catch {
      return undefined;
    }
  };
  const clean = (x: string | undefined) => x?.replace(/\s+/g, " ").trim() || undefined;
  const pick = (...k: string[]) => clean(k.map((x) => meta.get(x)).find(Boolean));
  const icon = icons.sort((a, b) => b.rank - a.rank)[0]?.href;
  const out: Head = {};
  const t = pick("og:title", "twitter:title") ?? clean(title);
  const l = pick("og:description", "twitter:description", "description");
  const i = abs(pick("og:image", "og:image:url", "og:image:secure_url", "twitter:image"));
  const f = abs(icon ?? "/favicon.ico");
  if (t) out.title = t;
  if (l) out.line = l;
  if (i) out.image = i;
  if (f) out.icon = f;
  return out;
}

/** At most `max` bytes of a body; null past it when `whole`. */
async function bytes(res: Response, max: number, whole: boolean): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      await reader.cancel();
      if (whole) return null;
      parts.push(value.subarray(0, max - size));
      size = max;
      break;
    }
    parts.push(value);
    size += value.byteLength;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const x of parts) {
    all.set(x, at);
    at += x.byteLength;
  }
  return all;
}

const base64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** An image as a `data:` URL, or nothing: not an image, over the cap, or no answer. */
async function inline(src: string | undefined, max: number, signal: AbortSignal) {
  const u = src ? fetchable(src) : null;
  if (!u) return undefined;
  try {
    const res = await fetch(u, { headers: { "user-agent": UA, accept: "image/*" }, signal });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!res.ok || !type.startsWith("image/")) return undefined;
    const b = await bytes(res, max, true);
    return b?.length ? `data:${type};base64,${base64(b)}` : undefined;
  } catch {
    return undefined;
  }
}

/** The preview of one address; the site and host alone when the page gives nothing. */
export async function preview(u: URL): Promise<Preview> {
  const out: Preview = { url: u.href, host: u.hostname.replace(/^www\./, "") };
  const signal = AbortSignal.timeout(WAIT_MS);
  try {
    const res = await fetch(u, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal,
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/html/i.test(type)) {
      await res.body?.cancel();
      return out;
    }
    const body = await bytes(res, HTML_MAX, false);
    const head = headOf(new TextDecoder().decode(body ?? new Uint8Array()), res.url || u.href);
    const [image, icon] = await Promise.all([
      inline(head.image, IMAGE_MAX, signal),
      inline(head.icon, ICON_MAX, signal),
    ]);
    if (head.title) out.title = head.title;
    if (head.line) out.line = head.line;
    if (image) out.image = image;
    if (icon) out.icon = icon;
  } catch {}
  return out;
}

const json = (body: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache },
  });

/** The route: a signed-in person, capped by `capped`, one address per call, cached an hour. */
export async function unfurl(
  req: Request,
  opts: { signedIn: () => Promise<Response | string>; capped: (who: string) => Promise<boolean> },
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  const who = await opts.signedIn();
  if (who instanceof Response) return who;
  const u = fetchable(new URL(req.url).searchParams.get("url"));
  if (!u) return json({ error: "Not a web address we can open." }, 400);
  const store =
    typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
  const key = new Request(`https://unfurl.cache/${encodeURIComponent(u.href)}`);
  const hit = await store?.match(key);
  if (hit) return json(await hit.json(), 200, "private, max-age=3600");
  if (await opts.capped(who)) return json({ error: "Too many previews. Wait a minute." }, 429);
  const p = await preview(u);
  await store?.put(key, json(p, 200, `public, max-age=${CACHE_SECONDS}`));
  return json(p, 200, "private, max-age=3600");
}
