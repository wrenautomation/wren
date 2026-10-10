/**
 * One cap per visitor on every path anyone may post to without signing in: Sites forms and the
 * tracker, site chat, document signing, booking and AI tools. Cloudflare's rate limiter, keyed by
 * IP (wrangler.toml `PUBLIC_LIMIT`). Unbound (local, tests) or no IP = no cap. Each path keeps its
 * own checks behind this (Turnstile, a thread's hourly cap, a token).
 */
import type { Env } from "./env.js";

const PUBLIC_POST = /^\/o\/|^\/api\/agent\/|\/__book\//;

/** A 429 when this visitor is over the cap on a public post, else null. */
export async function publicLimit(
  req: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (req.method !== "POST" || !env.PUBLIC_LIMIT || !PUBLIC_POST.test(pathname)) return null;
  const ip = req.headers.get("cf-connecting-ip");
  if (!ip) return null;
  const { success } = await env.PUBLIC_LIMIT.limit({ key: ip });
  if (success) return null;
  return new Response(JSON.stringify({ error: "Too many tries. Wait a minute, then try again." }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": "60",
      "cache-control": "no-store",
    },
  });
}
