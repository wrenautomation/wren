/**
 * The client portal (R14) and the public demo (R15), one Worker on two hosts.
 *
 * - demo.<domain> (DEMO_HOST): no sign-in; the viewer is the demo, and answers
 *   are cached at the edge for a few minutes. The server masks every answer.
 * - app.<domain>: people sign in at AUTH_ORIGIN (our own sign-in); the app
 *   sends its short-lived token as a bearer, the Worker checks it and passes
 *   the email. The token marks Wren's operators: they see every client.
 * - `/api/dictate`: dictation's speech server, for a signed-in person (./dictate.ts).
 * - `/api/notes/live/<id>`: a note's live room, a WebSocket to its Durable Object (./live.ts).
 * - `/api/media/grant` and `/media`: Learn's pictures and audio through our origin (./media.ts),
 *   for an operator, or for a client's login on its own items.
 * - `/api/<service>/<route>`: forwarded to that portal service (`./services.ts`)
 *   with the viewer set here, never by the browser. Writes are refused on the
 *   demo. The service's guard decides who may call each route.
 * - a client's own host (APP_HOST set, ./hosts.ts): the app for that one client, signed in
 *   through `/__auth/*`; the Worker pins the client, never the browser.
 * - `/oauth/mail/<provider>`: a mailbox's sign-in or an admin's consent lands (./mail-oauth.ts).
 * - `/o/*`: Sites' pages, preview, tracker and forms (./sites.ts), public; `/go/*` on a client's
 *   host, its tracked links.
 * - a client's booking page (./book.ts): `/book` on its host, `/c/<client>/book` on the app
 *   host, public, with its own API at `__book/<handler>`.
 * - everything else: the built app in dist/.
 *
 * The Worker holds no data: each client's list is its own Postgres database,
 * read through Restate.
 */

import { AUDIENCE, bearer, verifyToken } from "@wren/auth/verify";
import { readBody } from "@wren/core/http";
import { KEY_STAGE_PATH } from "@wren/core/key-refs";
import { LIVE_PREFIX } from "@wren/notes/room";
import { bookRoute } from "./book.js";
import { dictate } from "./dictate.js";
import { forward, json } from "./edge.js";
import type { Env } from "./env.js";
import { authRoute, type Site, siteOf, unknownHost } from "./hosts.js";
import { keyStage, rawKeyRefusal } from "./keys.js";
import { liveRoute, NoteRoom } from "./live.js";
import { mailOAuthRoute } from "./mail-oauth.js";
import {
  grantFor,
  MEDIA_GRANT_PATH,
  MEDIA_PATH,
  mediaKey,
  mediaProxy,
  urlGrantsFor,
} from "./media.js";
import { payRoute } from "./pay.js";
import { SERVICES } from "./services.js";
import { goRoute, sitesRoute } from "./sites.js";

/** The live note rooms' Durable Object (./live.ts): wrangler finds it on the main module. */
export { NoteRoom };

const MAX_BODY = 16 * 1024;
const DEMO_CACHE_SECONDS = 300;
/** The run feed changes by the second: a few seconds of cache, or a live run looks stuck. */
const RUN_CACHE_SECONDS = 2;

export type Viewer = { email: string; operator?: boolean } | { demo: true };

/** The viewer, or the response that refuses one. */
async function viewerOf(req: Request, env: Env): Promise<Viewer | Response> {
  const host = new URL(req.url).hostname;
  if (host === env.DEMO_HOST) return { demo: true };
  if (!env.AUTH_ORIGIN) return json({ error: "Sign-in isn't set up yet." }, 503);
  let who: Awaited<ReturnType<typeof verifyToken>>;
  try {
    who = await verifyToken(bearer(req), { issuer: env.AUTH_ORIGIN, audience: AUDIENCE });
  } catch {
    return json({ error: "Couldn't check your sign-in." }, 502);
  }
  if (!who) return json({ error: "Sign in." }, 401);
  return who.operator ? { email: who.email, operator: true } : { email: who.email };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function api(req: Request, env: Env, path: string, site: Site, ctx?: ExecutionContext) {
  const [name = "", route = "", ...rest] = path.split("/");
  const svc = Object.hasOwn(SERVICES, name) ? SERVICES[name] : undefined;
  if (!svc || rest.length || !svc.routes.has(route)) return json({ error: "not found" }, 404);
  const target = `${svc.name}/${route}`;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // A JSON content type forces a CORS preflight, so another site can't post here.
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
    return json({ error: "json only" }, 415);
  const raw = await readBody(req, svc.maxBody ?? MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let input: unknown;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "not json" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json({ error: "an object only" }, 400);
  // A key goes to /api/keys/stage; a route that takes its ref never gets the key itself.
  const rawKey = rawKeyRefusal(`${name}/${route}`, input);
  if (rawKey) return rawKey;
  // View as reads only; the guard checks who may (`viewAsOf`).
  const viewAs = (input as { viewAs?: unknown }).viewAs;
  if (viewAs !== undefined && viewAs !== null && viewAs !== "" && svc.writes.has(route))
    return json({ error: "View as is read-only." }, 403);
  const viewer = await viewerOf(req, env);
  if (viewer instanceof Response) return viewer;
  if (!("demo" in viewer)) {
    // Where a signed-in request came from, set here like the viewer: a contract signature records it.
    // `origin`, never a name a handler might take as input (a range's `from` once lost to it).
    const origin = {
      ip: req.headers.get("cf-connecting-ip"),
      agent: req.headers.get("user-agent"),
    };
    // A client's host shows that client only, as the client sees it.
    const pin = site.kind === "client" ? { client: site.client, asClient: true } : {};
    return forward(env, target, JSON.stringify({ ...(input as object), ...pin, viewer, origin }));
  }
  const body = JSON.stringify({ ...(input as Record<string, unknown>), viewer });
  // The service refuses too; this keeps a demo write out of the cache and off the wire.
  if (svc.writes.has(route)) return json({ error: "The demo is read-only." }, 403);

  // The demo is the same for everyone: answer from the edge cache when it can.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return forward(env, target, body);
  const key = new Request(`https://${env.DEMO_HOST}/__demo/${target}/${await sha256(body)}`);
  const hit = await cache.match(key);
  const answer = (b: BodyInit | null) =>
    new Response(b, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  if (hit) return answer(hit.body);
  const res = await forward(env, target, body);
  if (res.status !== 200) return res;
  const text = await res.text();
  const stored = new Response(text, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": `public, max-age=${target === "ReactivationPortal/run" ? RUN_CACHE_SECONDS : DEMO_CACHE_SECONDS}`,
    },
  });
  const put = cache.put(key, stored);
  if (ctx) ctx.waitUntil(put);
  else await put;
  return answer(text);
}

/**
 * The session player (`web/replay.html`): rrweb rebuilds a lander page with inline styles and
 * the lander's images and fonts, so this page alone allows them. Still no outside scripts, and
 * only the app may frame it.
 */
async function replayPage(req: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(req);
  const site = (env.AUTH_ORIGIN ?? "https://auth.wrenautomation.com").replace("//auth.", "//");
  const out = new Response(res.body, res);
  out.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; img-src 'self' data: ${site}; style-src 'self' 'unsafe-inline'; ` +
      `font-src data: ${site}; script-src 'self'; ` +
      "connect-src 'self' https://*.s3.us-east-1.amazonaws.com; frame-ancestors 'self'; " +
      "base-uri 'none'; form-action 'none'",
  );
  return out;
}

/** The media key, from the Restate token the Worker already holds; null when it holds none. */
const keyOf = (env: Env) => (env.RESTATE_AUTH_TOKEN ? mediaKey(env.RESTATE_AUTH_TOKEN) : null);

/** Items one grant ask may name. */
const MEDIA_ITEMS = 200;

/**
 * `POST /api/media/grant`: a grant to load Learn's pictures and audio. An operator asking for no
 * items gets the day's grant. Anyone else names the workspace and its items: Learn's service,
 * asked as them, answers with the media of the items that workspace owns, each granted alone.
 */
async function mediaGrant(req: Request, env: Env, site: Site): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (site.kind === "demo") return json({ error: "Sign in." }, 401);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "too large" }, 413);
  let input: { client?: unknown; items?: unknown } | null;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "not json" }, 400);
  }
  const viewer = await viewerOf(req, env);
  if (viewer instanceof Response) return viewer;
  if ("demo" in viewer) return json({ error: "Sign in." }, 401);
  const items = Array.isArray(input?.items) ? input.items.map(String) : null;
  if (!items && !viewer.operator) return json({ error: "Name the items." }, 403);
  if (items && (!items.length || items.length > MEDIA_ITEMS))
    return json({ error: `1 to ${MEDIA_ITEMS} items` }, 400);
  const key = await keyOf(env);
  if (!key) return json({ error: "Media isn't set up yet." }, 503);
  let out: Response;
  if (!items) out = json(await grantFor(key));
  else {
    // A client's host is that client; elsewhere the workspace asked for. The service checks both.
    const named = input?.client;
    const client =
      site.kind === "client"
        ? site.client
        : typeof named === "string" && named.length <= 200
          ? named
          : undefined;
    const asked = await forward(
      env,
      "LearnConsole/media",
      JSON.stringify({ ...(client ? { client } : {}), ids: items, viewer }),
    );
    if (asked.status !== 200) return asked;
    const { urls } = (await asked.json()) as { urls?: unknown };
    const list = Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string") : [];
    out = json(await urlGrantsFor(key, list));
  }
  out.headers.set("cache-control", "no-store");
  return out;
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    const site = await siteOf(req, env, ctx);
    // Sites' pages, tracker and forms: on the apex, a client's host, or the app host (./sites.ts).
    if (pathname.startsWith("/o/")) {
      const page = await sitesRoute(req, env, site, ctx);
      if (page) return page;
    }
    // Stripe's webhook for a client's pay links, on the app host (./pay.ts).
    if (pathname.startsWith("/__pay/")) {
      const paid = await payRoute(req, env, site);
      if (paid) return paid;
    }
    // Our other hosts on the zone (`*/*` routes every host here): straight to their origin.
    if (site.kind === "ours") return fetch(req);
    if (site.kind === "unknown") return unknownHost();
    if (site.kind === "client") {
      // A tracked link on the client's own host: counted, then on to its page (./sites.ts).
      if (pathname.startsWith("/go/")) {
        const hop = await goRoute(req, env, site, ctx);
        if (hop) return hop;
      }
      const auth = await authRoute(req, env);
      if (auth) return auth;
    }
    // A mailbox's sign-in and an admin's consent come back here; never on the demo.
    if (pathname.startsWith("/oauth/mail/") && site.kind !== "demo") {
      const landed = await mailOAuthRoute(req, env);
      if (landed) return landed;
    }
    if (pathname === "/api/dictate")
      return dictate(req, env, {
        demo: site.kind === "demo",
        signedIn: async () => {
          const v = await viewerOf(req, env);
          return v instanceof Response ? v : "demo" in v ? json({ error: "Sign in." }, 401) : null;
        },
      });
    if (pathname.startsWith(LIVE_PREFIX)) return liveRoute(req, env, site, (r) => viewerOf(r, env));
    if (pathname === MEDIA_GRANT_PATH) return mediaGrant(req, env, site);
    if (pathname === KEY_STAGE_PATH) return keyStage(req, env, site, (r) => viewerOf(r, env));
    if (pathname === MEDIA_PATH) {
      const key = site.kind === "demo" ? null : await keyOf(env);
      return key ? mediaProxy(req, key) : new Response(null, { status: 404 });
    }
    if (pathname.startsWith("/api/"))
      return api(req, env, pathname.slice("/api/".length), site, ctx);
    const booking = await bookRoute(req, env, site);
    if (booking) return booking;
    // The booking page's own file is only for a client's booking path above.
    if (/^\/book(\.html)?\/?$/.test(pathname))
      return env.ASSETS.fetch(new Request(new URL("/", req.url), req));
    if (pathname === "/replay") return replayPage(req, env);
    // A record page whose id holds a slash (/handlers/all/Ads%2Fstart): the asset server would
    // 307 it to the decoded path, a different page. The app reads the id from the address.
    if (/%2f/i.test(pathname)) return env.ASSETS.fetch(new Request(new URL("/", req.url), req));
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
