/**
 * auth.wrenautomation.com: the sign-in pages, and `/api/auth/*` forwarded to
 * the sign-in Lambda with the edge secret and the caller's address (A5). The
 * apps (app.) may read a token cross-origin; nothing else may.
 */
import { EDGE_HEADER, IP_HEADER } from "./headers.js";

export interface Env {
  ASSETS: Fetcher;
  /** The sign-in Lambda's function URL. Secret. */
  LAMBDA_URL?: string;
  /** Proves to the Lambda the call came through here. Secret. */
  EDGE_SECRET?: string;
  /** Origins that may ask for a token, comma separated. */
  APPS: string;
}

const TOKEN_PATH = "/api/auth/token";

/** Let an app read its token with the sign-in cookie; every other path stays same-origin. */
function withCors(res: Response, app: string | null, path: string): Response {
  if (!app || path !== TOKEN_PATH) return res;
  const out = new Response(res.body, res);
  out.headers.set("access-control-allow-origin", app);
  out.headers.set("access-control-allow-credentials", "true");
  out.headers.append("vary", "Origin");
  return out;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/auth/")) return env.ASSETS.fetch(req);

    const origin = req.headers.get("origin");
    const app = origin && env.APPS.split(",").includes(origin) ? origin : null;
    if (req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      if (app && url.pathname === TOKEN_PATH)
        res.headers.set("access-control-allow-methods", "GET");
      return withCors(res, app, url.pathname);
    }
    if (!env.LAMBDA_URL || !env.EDGE_SECRET)
      return new Response("sign-in is not configured", { status: 503 });

    const headers = new Headers(req.headers);
    headers.delete("host");
    headers.set(EDGE_HEADER, env.EDGE_SECRET);
    headers.set(IP_HEADER, req.headers.get("cf-connecting-ip") ?? "");
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const res = await fetch(new URL(url.pathname + url.search, env.LAMBDA_URL), {
      method: req.method,
      headers,
      ...(hasBody ? { body: req.body } : {}),
      // Provider redirects go back to the browser, not followed here.
      redirect: "manual",
    });
    return withCors(new Response(res.body, res), app, url.pathname);
  },
} satisfies ExportedHandler<Env>;
