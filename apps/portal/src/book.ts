/**
 * A client's public booking page (designs/2026-10-06-calendar.md, per client), no sign-in:
 *
 * - On the client's own host: `/book`, `/book/<tag>`, `/booking/<token>`, and its API at
 *   `/__book/<handler>`. The host names the client.
 * - On the app host, for a client with no live domain: the same under `/c/<client>/`.
 *
 * The page is `web/book.html`. Its API goes to `ClientCalendar/<handler>` through ingress with
 * the client pinned here, never by the browser. A booking passes a honeypot, then Turnstile when
 * TURNSTILE_SECRET is set (its site key rides on the slots answer). Wren's own `/book/<offer>`
 * lives on the lander and never comes here.
 */
import { readBody } from "@wren/core/http";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { human } from "./turnstile.js";

const MAX_BODY = 8 * 1024;
const CLIENT = "[a-z][a-z0-9_]{0,39}";
const PAGE = new RegExp(
  `^(?:/c/(${CLIENT}))?/(?:book(?:/[A-Za-z0-9_-]{1,64})?|booking/[A-Za-z0-9._-]{1,80})/?$`,
);
const API = new RegExp(`^(?:/c/(${CLIENT}))?/__book/(slots|book|booking|reschedule|cancel)$`);
const WRITES = new Set(["book", "reschedule", "cancel"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** The page allows Turnstile's script and frame, nothing else from outside. */
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; " +
  "script-src 'self' https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com; connect-src 'self'; frame-ancestors 'none'; " +
  "base-uri 'none'; form-action 'self'";

/** The client a booking path is for: the host's, or `/c/<client>` on the app host only. */
function clientOf(site: Site, prefixed: string | undefined): string | null {
  if (site.kind === "client") return prefixed ? null : site.client;
  if (site.kind === "app") return prefixed ?? null;
  return null;
}

async function call(env: Env, route: string, client: string, input: Record<string, unknown>) {
  const { client: _c, viewer: _v, website: _w, human: _h, ...rest } = input;
  let res: Response;
  try {
    res = await fetch(`${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/ClientCalendar/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({ ...rest, client }),
    });
  } catch {
    return json({ error: "Booking is down for a moment. Try again soon." }, 502);
  }
  const text = await res.text();
  if (!res.ok) {
    // Restate's refusal is { message }: the page shows it.
    let message = "Something went wrong. Try again.";
    try {
      const m = (JSON.parse(text) as { message?: unknown }).message;
      if (typeof m === "string" && res.status < 500) message = m;
    } catch {}
    return json({ error: message }, res.status >= 500 ? 502 : res.status);
  }
  if (route !== "slots" || !(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY))
    return new Response(text, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  return json({ ...(JSON.parse(text) as object), human: env.TURNSTILE_SITE_KEY });
}

/** The booking page or its API; null when the path is neither. */
export async function bookRoute(req: Request, env: Env, site: Site): Promise<Response | null> {
  const url = new URL(req.url);
  const api = API.exec(url.pathname);
  if (api) {
    const client = clientOf(site, api[1]);
    if (!client) return json({ error: "No booking page here." }, 404);
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
      return json({ error: "json only" }, 415);
    const raw = await readBody(req, MAX_BODY);
    if (raw === null) return json({ error: "too large" }, 413);
    let input: unknown;
    try {
      input = raw ? JSON.parse(raw) : {};
    } catch {
      return json({ error: "not json" }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return json({ error: "an object only" }, 400);
    const body = input as Record<string, unknown>;
    const route = api[2] as string;
    if (WRITES.has(route)) {
      // A bot fills the hidden field; a person never sees it.
      if (typeof body.website === "string" && body.website.trim())
        return json({ error: "That time was just taken. Pick another." }, 409);
      if (route === "book" && !(await human(env, body.human, req.headers.get("cf-connecting-ip"))))
        return json({ error: "Please finish the check and try again." }, 403);
    }
    return call(env, route, client, body);
  }
  const page = PAGE.exec(url.pathname);
  if (!page) return null;
  if (!clientOf(site, page[1]) || req.method !== "GET") return null;
  const res = await env.ASSETS.fetch(new Request(new URL("/book", url), req));
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", CSP);
  out.headers.set("cache-control", "no-store");
  return out;
}
