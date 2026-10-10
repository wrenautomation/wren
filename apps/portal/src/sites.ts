/**
 * Sites' public paths (designs/2026-10-07-sites.md, "Serving"), no sign-in:
 *
 * - `/o/<slug>`: a live data page, Wren's on the apex, a client's on its own host. Rendered by the
 *   `Sites` service and cached here for a minute, so a new page needs no deploy.
 * - `/o/__preview/<id>?t=<token>`: a draft, on the app host only, for the portal's preview frame.
 * - `/o/f/<slug>`: a live hosted form (designs/2026-10-07-forms-and-pay.md), framable anywhere
 *   (`?embed=1` drops the page chrome). Cached a minute like a page.
 * - `/o/__kit.js`, `/o/__t`, `/o/__form`: the tracker and the form, for data pages and for code
 *   pages on any host (CORS open: they carry no cookie and change nothing but counts and a lead).
 *   Every form submit passes Turnstile first when TURNSTILE_SECRET is set; the `wv` cookie rides
 *   along where the browser sends it.
 *
 * - `/o/__chat.js`, `/o/__chat`: the site chat bubble and its calls, for the host's owner
 *   (designs/2026-10-09-site-chat.md).
 * - `/o/<slug>` with a split running: each new visitor gets an arm by weight and a `wab` cookie
 *   (the arm only, scoped to that page's path) that keeps them on it; each arm is cached under
 *   its own key. Bots get A, uncounted in the split.
 * - `/go/<link>/<campaign>/<content>?to=/o/<slug>` on a client's host: a tracked link. Counted
 *   (bots left out), then a 302 to the page with utm on it (`@wren/sites/hops`).
 *
 * Bodies come as text/plain JSON (no preflight) or, for a form without JS, urlencoded.
 */
import { readBody } from "@wren/core/http";
import { CHAT_PATH, CHAT_SCRIPT_PATH, chatJs } from "@wren/sites/chat-widget";
import { hopOf, isBot } from "@wren/sites/hops";
import { FORM_PATH, KIT_PATH, kitJs, TRACK_PATH } from "@wren/sites/kit";
import { FORM_CSP, goneHtml, PAGE_CSP } from "@wren/sites/render";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { human } from "./turnstile.js";

const MAX_BODY = 8 * 1024;
const PAGE_CACHE_SECONDS = 60;
const SLUG = /^\/o\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)\/?$/;
const PREVIEW = /^\/o\/__preview\/([0-9a-f-]{36})$/;
const FORM_PAGE = /^\/o\/f\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|[0-9a-f-]{36})\/?$/;
const TOKEN = "cf-turnstile-response";
const VISITOR = /(?:^|;\s*)wv=([A-Za-z0-9_.-]{1,64})(?:;|$)/;
/** The split arm this visitor saw: `<split 8 hex>.<arm>` (`@wren/sites/split`). */
const ARM = /(?:^|;\s*)wab=([0-9a-f]{8}\.[A-E])(?:;|$)/;
const OPEN = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const ingress = (env: Env, path: string, body: unknown) =>
  fetch(`${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

const html = (body: string, status: number, cache: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PAGE_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": cache,
      ...extra,
    },
  });

const answer = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...OPEN },
  });

/** Whose pages this host serves: Wren's on the apex, a client's on its host; else none. */
function ownerOf(req: Request, env: Env, site: Site): { client: string | null } | null {
  if (site.kind === "client") return { client: site.client };
  const host = new URL(req.url).hostname.toLowerCase();
  if (site.kind === "ours") {
    const app = env.APP_HOST ?? "";
    return host === app.slice(app.indexOf(".") + 1) ? { client: null } : null;
  }
  // Local dev has no APP_HOST: the app host stands in for the apex.
  if (site.kind === "app" && !env.APP_HOST) return { client: null };
  return null;
}

interface Served {
  status: number;
  html: string;
  split?: { id: string; label: string; cookie: string; days: number } | null;
}

async function served(env: Env, body: unknown, handler = "Sites/serve"): Promise<Served> {
  try {
    const res = await ingress(env, handler, body);
    if (res.ok) return (await res.json()) as Served;
  } catch {}
  return { status: 503, html: goneHtml(404) };
}

/** A new visitor's roll for a split arm, in [0, 1). */
const roll = () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;

/** The split cookie for a page or form: only the arm, on its path, for its days. */
const armCookie = (path: string, value: string, days: number) =>
  `wab=${value}; Path=/o/${path}; Max-Age=${days * 86400}; Secure; HttpOnly; SameSite=Lax`;

/** A form without JS: urlencoded fields, the page named in a hidden field. */
function formOf(raw: string, type: string): Record<string, unknown> | null {
  if (type.startsWith("application/x-www-form-urlencoded")) {
    const fields = Object.fromEntries(new URLSearchParams(raw));
    return { page: fields.page, form: fields.form, fields, plain: true };
  }
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const THANKS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thanks</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px}</style></head><body><h1>Thanks. We got it.</h1><p>We'll be in touch soon.</p></body></html>`;

const NOT_HUMAN = THANKS.replace("<title>Thanks</title>", "<title>Not sent</title>").replace(
  "<h1>Thanks. We got it.</h1><p>We'll be in touch soon.</p>",
  "<h1>That didn't send.</h1><p>This form needs JavaScript on to check you're a person. Turn it on and try again.</p>",
);

/**
 * Site chat (designs/2026-10-09-site-chat.md): the bubble's script, and its `say` and `read`, for
 * the host's owner. Bots get nothing. Open CORS: the bubble sits on the owner's other sites too.
 */
async function chatRoute(
  req: Request,
  env: Env,
  owner: { client: string | null } | null,
): Promise<Response | null> {
  if (!owner) return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: OPEN });
  const path = new URL(req.url).pathname;
  if (path === CHAT_SCRIPT_PATH)
    return new Response(chatJs(), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
        ...OPEN,
      },
    });
  if (req.method !== "POST") return answer({ error: "POST only" }, 405);
  if (isBot(req.headers.get("user-agent"))) return answer({ error: "Chat is for people." }, 403);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return answer({ error: "too large" }, 413);
  const body = formOf(raw, "application/json");
  if (!body || (body.op !== "say" && body.op !== "read"))
    return answer({ error: "say or read" }, 400);
  try {
    const res = await ingress(env, body.op === "say" ? "Chat/say" : "Chat/read", {
      client: owner.client,
      key: body.key,
      body: body.body,
      name: body.name,
      contact: body.contact,
      page: body.page,
      after: body.after,
      ip: req.headers.get("cf-connecting-ip"),
    });
    const out = (await res.json().catch(() => ({}))) as { status?: number; error?: string };
    if (!res.ok) return answer({ error: "That didn't send. Try again." }, 502);
    const { status = 200, ...rest } = out;
    return answer(rest, status);
  } catch {
    return answer({ error: "That didn't send. Try again." }, 502);
  }
}

/** The answer for a Sites path, or null when the path isn't one. */
export async function sitesRoute(
  req: Request,
  env: Env,
  site: Site,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith("/o/")) return null;
  const owner = ownerOf(req, env, site);
  const tools = path === KIT_PATH || path === TRACK_PATH || path === FORM_PATH;
  // Where we serve nothing: the tools on any of our hosts; pages where an owner is known.
  if (!owner && !tools && !(site.kind === "app" && PREVIEW.test(path))) return null;
  if (req.method === "OPTIONS" && tools) return new Response(null, { status: 204, headers: OPEN });

  if (path === CHAT_SCRIPT_PATH || path === CHAT_PATH) return chatRoute(req, env, owner);

  if (path === KIT_PATH)
    return new Response(kitJs(env.TURNSTILE_SITE_KEY), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
        ...OPEN,
      },
    });

  if (path === TRACK_PATH || path === FORM_PATH) {
    if (req.method !== "POST") return answer({ error: "POST only" }, 405);
    const raw = await readBody(req, MAX_BODY);
    if (raw === null) return answer({ error: "too large" }, 413);
    const body = formOf(raw, req.headers.get("content-type") ?? "");
    if (!body) return answer({ error: "not json" }, 400);
    if (path === TRACK_PATH) {
      // Counted after the answer: a visitor never waits on a view.
      const sent = ingress(env, "Sites/track", body).catch(() => null);
      if (ctx) ctx.waitUntil(sent);
      else await sent;
      return new Response(null, { status: 204, headers: OPEN });
    }
    const fields = (body.fields && typeof body.fields === "object" ? body.fields : {}) as Record<
      string,
      unknown
    >;
    const { [TOKEN]: token, ...kept } = fields;
    if (!(await human(env, token, req.headers.get("cf-connecting-ip")))) {
      const error = "Confirm you're a person, then send again.";
      if (body.plain) return html(NOT_HUMAN, 403, "no-store");
      return answer({ error }, 403);
    }
    const visitor = VISITOR.exec(req.headers.get("cookie") ?? "")?.[1] ?? null;
    let res: Response;
    try {
      res = await ingress(env, "Sites/form", {
        ...body,
        fields: kept,
        host: url.hostname,
        visitor,
        human: env.TURNSTILE_SECRET ? "yes" : "off",
        plain: undefined,
      });
    } catch {
      return answer({ error: "That didn't send. Try again." }, 502);
    }
    const out = (await res.json().catch(() => ({}))) as {
      status?: number;
      error?: string;
      errors?: Record<string, string>;
    };
    const status = res.ok ? (out.status ?? 202) : 502;
    if (body.plain)
      return html(status < 300 ? THANKS : goneHtml(404), status < 300 ? 200 : status, "no-store");
    return answer(
      status < 300
        ? { ok: true }
        : {
            error: out.error ?? "That didn't send. Try again.",
            ...(out.errors ? { errors: out.errors } : {}),
          },
      status,
    );
  }

  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const preview = PREVIEW.exec(path);
  if (preview) {
    const got = await served(env, {
      preview: { id: preview[1], token: url.searchParams.get("t") ?? "" },
    });
    return html(got.html, got.status, "no-store", {
      "x-robots-tag": "noindex",
      // Only the portal frames a preview.
      "content-security-policy": PAGE_CSP,
    });
  }
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const formPage = FORM_PAGE.exec(path);
  if (formPage && owner) {
    const slug = formPage[1] as string;
    const embed = url.searchParams.get("embed") === "1";
    return page(
      req,
      env,
      {
        path: `f/${slug}`,
        // The embed is its own copy: a cache key only, never a path served.
        key: `${url.origin}/o/f/${slug}${embed ? "/embed" : ""}`,
        handler: "Sites/serveForm",
        body: { client: owner.client, slug, embed },
        headers: { "content-security-policy": FORM_CSP },
      },
      cache,
      ctx,
    );
  }
  const slug = SLUG.exec(path);
  if (!slug || !owner) return null;
  const s = slug[1] as string;
  return page(
    req,
    env,
    {
      path: s,
      key: `${url.origin}/o/${s}`,
      handler: "Sites/serve",
      body: { client: owner.client, slug: s },
    },
    cache,
    ctx,
  );
}

const keep = (cache: Cache | undefined, key: Request, out: Response, ctx?: ExecutionContext) => {
  if (!cache) return Promise.resolve();
  const put = cache.put(key, out).catch(() => {});
  if (ctx) {
    ctx.waitUntil(put);
    return Promise.resolve();
  }
  return put;
};

/**
 * A data page or a hosted form, split or not. Not split: one cached copy. Split: one cached copy
 * per arm, keyed by the visitor's cookie; a new visitor (no cookie, or one from an old split)
 * misses and gets an arm by weight and a cookie. Split copies go to the browser uncached, so the
 * cookie decides each visit. Bots get A under their own key, never split.
 */
async function page(
  req: Request,
  env: Env,
  at: {
    /** The path after `/o/`: the cookie's scope. */
    path: string;
    /** The cache key's base. */
    key: string;
    handler: string;
    body: Record<string, unknown>;
    headers?: Record<string, string>;
  },
  cache: Cache | undefined,
  ctx?: ExecutionContext,
): Promise<Response> {
  const bot = isBot(req.headers.get("user-agent"));
  const arm = bot ? null : (ARM.exec(req.headers.get("cookie") ?? "")?.[1] ?? null);
  const base = at.key;
  const show = (body: string, status: number, cacheControl: string) =>
    html(body, status, cacheControl, at.headers);
  const key = new Request(bot ? `${base}?bot=1` : arm ? `${base}?arm=${arm}` : base);
  const hit = await cache?.match(key);
  if (hit) {
    // A split arm's copy: back to the browser uncached. A plain copy as it was kept.
    if (!arm) return hit;
    const out = new Response(hit.body, hit);
    out.headers.set("cache-control", "private, no-store");
    return out;
  }
  const got = await served(env, { ...at.body, arm, bot, roll: roll() }, at.handler);
  const ok = got.status === 200;
  const shared = ok ? `public, max-age=${PAGE_CACHE_SECONDS}` : "no-store";
  if (!got.split) {
    const out = show(got.html, got.status, shared);
    // A cookie from a split that's over: cleared, so the page caches as one again.
    if (arm) out.headers.append("set-cookie", armCookie(at.path, "", 0));
    if (ok) await keep(cache, new Request(bot ? `${base}?bot=1` : base), out.clone(), ctx);
    return out;
  }
  const { cookie, days } = got.split;
  if (ok) await keep(cache, new Request(`${base}?arm=${cookie}`), show(got.html, 200, shared), ctx);
  const out = show(got.html, got.status, "private, no-store");
  if (cookie !== arm) out.headers.append("set-cookie", armCookie(at.path, cookie, days));
  return out;
}

/**
 * A client's `/go/` link: counted unless a bot, then a 302 to its page with the utm. Null when
 * the path isn't one, or the host isn't a client's (Wren's `/go/` is the lander's).
 */
export async function goRoute(
  req: Request,
  env: Env,
  site: Site,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (site.kind !== "client" || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const url = new URL(req.url);
  const hop = hopOf(url.pathname, url.searchParams);
  if (!hop) return null;
  if (!isBot(req.headers.get("user-agent"))) {
    const counted = ingress(env, "Sites/hop", {
      client: site.client,
      link: hop.link,
      source: hop.source,
      medium: hop.medium,
      campaign: hop.campaign,
      content: hop.content,
      to: hop.to,
      slug: hop.slug,
      ref: (req.headers.get("referer") ?? "").slice(0, 200) || null,
    }).catch(() => null);
    // Counted after the answer: a click never waits on the count.
    if (ctx) ctx.waitUntil(counted);
    else await counted;
  }
  return new Response(null, {
    status: 302,
    headers: { location: hop.location, "cache-control": "no-store" },
  });
}
