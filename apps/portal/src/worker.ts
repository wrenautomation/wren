/**
 * The client portal (R14) and the public demo (R15), one Worker on two hosts.
 *
 * - demo.<domain> (DEMO_HOST): no sign-in; the viewer is the demo, and answers
 *   are cached at the edge for a few minutes. The server masks every answer.
 * - app.<domain>: Cloudflare Access signs people in (email code); the Worker
 *   checks the token itself and passes the email. OPERATOR_EMAILS see every client.
 * - `/api/<route>`: forwarded to the `ReactivationPortal` service with the
 *   viewer set here, never by the browser.
 * - everything else: the built app in dist/.
 *
 * The Worker holds no data: each client's list is its own Postgres database,
 * read through Restate.
 */
import { PORTAL_ROUTES } from "@wren/reactivation/portal-routes";
import { accessEmail } from "./access.js";
import type { Env } from "./env.js";

const ROUTES: ReadonlySet<string> = new Set(PORTAL_ROUTES);

const MAX_BODY = 16 * 1024;
const DEMO_CACHE_SECONDS = 300;

type Viewer = { email: string; operator?: boolean } | { demo: true };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const ingress = (env: Env, path: string) =>
  `${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/${path}`;

const operators = (env: Env): Set<string> =>
  new Set(
    (env.OPERATOR_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

/** The viewer, or the response that refuses one. */
async function viewerOf(req: Request, env: Env): Promise<Viewer | Response> {
  const host = new URL(req.url).hostname;
  if (host === env.DEMO_HOST) return { demo: true };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
    return json({ error: "Sign-in isn't set up yet." }, 503);
  let email: string | null;
  try {
    email = await accessEmail(req.headers.get("cf-access-jwt-assertion"), {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
    });
  } catch {
    return json({ error: "Couldn't check your sign-in. Try again." }, 502);
  }
  if (!email) return json({ error: "Sign in." }, 401);
  return operators(env).has(email) ? { email, operator: true } : { email };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function forward(env: Env, route: string, body: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(ingress(env, `ReactivationPortal/${route}`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
      },
      body,
    });
  } catch {
    return json({ error: "The portal's server is unreachable. Try again." }, 502);
  }
  // Restate's status and body: a refusal (no client for this login) reads as its message.
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

/** The body as text, or null past MAX_BODY bytes; a bigger stream is cut off, not buffered. */
async function bodyOf(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function api(req: Request, env: Env, route: string, ctx?: ExecutionContext) {
  if (!ROUTES.has(route)) return json({ error: "not found" }, 404);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // A JSON content type forces a CORS preflight, so another site can't post here with the Access cookie.
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
    return json({ error: "json only" }, 415);
  const raw = await bodyOf(req);
  if (raw === null) return json({ error: "too large" }, 413);
  let input: unknown;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "not json" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json({ error: "an object only" }, 400);
  const viewer = await viewerOf(req, env);
  if (viewer instanceof Response) return viewer;
  const body = JSON.stringify({ ...(input as Record<string, unknown>), viewer });
  if (!("demo" in viewer)) return forward(env, route, body);

  // The demo is the same for everyone: answer from the edge cache when it can.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return forward(env, route, body);
  const key = new Request(`https://${env.DEMO_HOST}/__demo/${route}/${await sha256(body)}`);
  const hit = await cache.match(key);
  const answer = (b: BodyInit | null) =>
    new Response(b, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  if (hit) return answer(hit.body);
  const res = await forward(env, route, body);
  if (res.status !== 200) return res;
  const text = await res.text();
  const stored = new Response(text, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": `public, max-age=${DEMO_CACHE_SECONDS}`,
    },
  });
  const put = cache.put(key, stored);
  if (ctx) ctx.waitUntil(put);
  else await put;
  return answer(text);
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) return api(req, env, pathname.slice("/api/".length), ctx);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
