/**
 * The portal on a client's own host (designs/2026-10-06-custom-domains.md). Cloudflare for SaaS
 * sends every custom hostname on our zone here. This file decides what a host is, and runs
 * sign-in on a client's host:
 *
 * - `/__auth/in?next=`: off to our sign-in, which hands the session back to `/__auth/back`.
 * - `/__auth/back?ott=&next=`: redeems Better Auth's one-time token at the sign-in Lambda, server
 *   to server, and keeps the session in this host's own cookie, which JavaScript never sees.
 * - `/__auth/token`: the short-lived token for that session, as `auth.` gives one on `app.`.
 * - `/__auth/out`: signs the session out and clears the cookie.
 */
import type { Env } from "./env.js";

/** Who a request is for: our app, the demo, a client's host, or a host of ours we don't serve. */
export type Site =
  | { kind: "app" }
  | { kind: "demo" }
  | { kind: "client"; client: string }
  | { kind: "unknown" }
  | { kind: "ours" };

export const SESSION_COOKIE = "__Host-wren_session";
const SESSION_SECONDS = 30 * 24 * 3600;
const HOST_CACHE_SECONDS = 300;
/** A host not live yet is asked again sooner, so it works soon after it goes live. */
const MISS_CACHE_SECONDS = 30;

/** The domain our own hosts sit under: app.wrenautomation.com → wrenautomation.com. */
const ownDomain = (appHost: string) => appHost.slice(appHost.indexOf(".") + 1);

const restate = (env: Env, path: string, body: unknown) =>
  fetch(`${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

/** The client a live host is, cached at the edge; null when none (or Restate didn't answer). */
async function clientOfHost(
  env: Env,
  host: string,
  ctx?: ExecutionContext,
): Promise<string | null> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`https://${env.APP_HOST}/__host/${encodeURIComponent(host)}`);
  const hit = await cache?.match(key);
  if (hit) return ((await hit.json()) as { client: string | null }).client;
  let client: string | null = null;
  let sure = false;
  try {
    const res = await restate(env, "Domains/resolve", { host });
    if (res.ok) {
      client = ((await res.json()) as { client?: string | null }).client ?? null;
      sure = true;
    }
  } catch {}
  if (cache && sure) {
    const put = cache.put(
      key,
      new Response(JSON.stringify({ client }), {
        headers: {
          "cache-control": `public, max-age=${client ? HOST_CACHE_SECONDS : MISS_CACHE_SECONDS}`,
        },
      }),
    );
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return client;
}

/** Without APP_HOST every host but the demo is the app, as before custom domains. */
export async function siteOf(req: Request, env: Env, ctx?: ExecutionContext): Promise<Site> {
  const host = new URL(req.url).hostname.toLowerCase();
  if (host === env.DEMO_HOST) return { kind: "demo" };
  if (!env.APP_HOST || host === env.APP_HOST) return { kind: "app" };
  const own = ownDomain(env.APP_HOST);
  if (host === own || host.endsWith(`.${own}`)) return { kind: "ours" };
  const client = await clientOfHost(env, host, ctx);
  return client ? { kind: "client", client } : { kind: "unknown" };
}

const page = (status: number, text: string, extra: HeadersInit = {}) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
      `<title>Wren</title><p style="font:16px system-ui;margin:3rem auto;max-width:32rem;padding:0 1rem">${text}</p>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...extra,
      },
    },
  );

/**
 * Same-origin paths only. Parsed as the browser will (it drops tabs and newlines, reads `\` as
 * `/`), so `//evil`, `/\evil` and `/\t/evil` all come back as `/`.
 */
export function safeNext(raw: string | null): string {
  const base = "https://next.invalid";
  try {
    const u = new URL(raw ?? "/", base);
    if (raw?.startsWith("/") && u.origin === base) return u.pathname + u.search + u.hash;
  } catch {}
  return "/";
}

function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

const keep = (value: string) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
const clear = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Better Auth's session cookie in a Lambda answer: its name and signed value. */
function sessionIn(res: Response): { name: string; value: string } | null {
  for (const c of res.headers.getSetCookie()) {
    const [pair = ""] = c.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (name.endsWith("session_token") && value) return { name, value };
  }
  return null;
}

/** Better Auth's cookie name for the session, as the sign-in Lambda sets it over https. */
const AUTH_COOKIE = "__Secure-better-auth.session_token";

/** The sign-in Lambda, called as the auth Worker calls it: edge secret, the visitor's address. */
function lambda(req: Request, env: Env, path: string, init: RequestInit & { session?: string }) {
  if (!env.LAMBDA_URL || !env.EDGE_SECRET) return null;
  const headers = new Headers(init.headers);
  headers.set("x-wren-edge", env.EDGE_SECRET);
  headers.set("x-wren-ip", req.headers.get("cf-connecting-ip") ?? "");
  if (init.session) headers.set("cookie", `${AUTH_COOKIE}=${init.session}`);
  return fetch(new URL(`/api/auth/${path}`, env.LAMBDA_URL), {
    ...init,
    headers,
    redirect: "manual",
  });
}

const notSetUp = () => page(503, "Sign-in isn't set up on this domain yet.");

/** `/__auth/*` on a client's host; null for any other path. */
export async function authRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/__auth/")) return null;
  const route = url.pathname.slice("/__auth/".length);
  if (!env.AUTH_ORIGIN) return notSetUp();

  if (route === "in") {
    const back = new URL("/__auth/back", url.origin);
    back.searchParams.set("next", safeNext(url.searchParams.get("next")));
    return Response.redirect(`${env.AUTH_ORIGIN}/?next=${encodeURIComponent(back.href)}`, 302);
  }

  if (route === "back") {
    const ott = url.searchParams.get("ott");
    if (!ott) return page(400, `That sign-in link isn't complete. <a href="/">Try again</a>.`);
    const res = await lambda(req, env, "one-time-token/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ott }),
    });
    if (!res) return notSetUp();
    const session = res.ok ? sessionIn(res) : null;
    if (!session) return page(400, `That sign-in link has expired. <a href="/">Sign in again</a>.`);
    return new Response(null, {
      status: 303,
      headers: {
        location: safeNext(url.searchParams.get("next")),
        "set-cookie": keep(session.value),
        "cache-control": "no-store",
      },
    });
  }

  if (route === "token") {
    const session = cookieOf(req, SESSION_COOKIE);
    const json = (body: unknown, status: number, cookie?: string) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          ...(cookie ? { "set-cookie": cookie } : {}),
        },
      });
    if (!session) return json({ error: "Sign in." }, 401);
    const res = await lambda(req, env, "token", { method: "GET", session });
    if (!res) return notSetUp();
    if (res.status === 401) return json({ error: "Sign in." }, 401, clear);
    if (!res.ok)
      return new Response(res.body, {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    // A refreshed session comes back as a new cookie value: keep that one.
    const fresh = sessionIn(res)?.value ?? session;
    return json(await res.json(), 200, keep(fresh));
  }

  if (route === "out") {
    const session = cookieOf(req, SESSION_COOKIE);
    if (session)
      await lambda(req, env, "sign-out", {
        method: "POST",
        // Better Auth checks a cookie-carrying POST came from a trusted origin: our sign-in's own.
        headers: { "content-type": "application/json", origin: env.AUTH_ORIGIN },
        body: "{}",
        session,
      })?.catch(() => null);
    return new Response(null, {
      status: 303,
      headers: { location: `${env.AUTH_ORIGIN}/?out=1`, "set-cookie": clear },
    });
  }

  return page(404, "Not found.");
}

export const unknownHost = () =>
  page(
    404,
    "This domain isn't connected to a Wren portal yet. If you just set it up, give it a few minutes.",
  );
