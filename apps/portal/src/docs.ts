/**
 * The signing page's paths (designs/2026-10-09-documents.md, "Signing page"), no sign-in:
 *
 * - `GET /o/d/<token>`: the document, rendered by `Documents/serve`. A bot's fetch (a texting
 *   app's link preview) is served but never counted as an open.
 * - `POST /o/d/<token>`: sign or decline, after Turnstile. Urlencoded, from the page's own form.
 * - `GET /o/d/<token>/pdf`: the signed copy, or the document as sent.
 * - `GET /o/d/<token>/pay`: the deposit: made on the client's Stripe on the first ask, then a 303.
 *
 * Served on a client's host (its documents only), Wren's apex (Wren's), and the app host (any:
 * a client with no live domain links there). Never cached: the token is the key.
 */
import { readBody } from "@wren/core/http";
import { isBot } from "@wren/sites/hops";
import { goneHtml, PAGE_CSP } from "@wren/sites/render";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { human } from "./turnstile.js";

const DOC = /^\/o\/d\/([A-Za-z0-9_-]{43})(\/pdf|\/pay)?\/?$/;
const MAX_BODY = 8 * 1024;
const TOKEN = "cf-turnstile-response";

interface Answer {
  status: number;
  html?: string;
  pdf?: string;
  filename?: string;
  location?: string;
}

const NOT_HUMAN = (back: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not sent</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px}</style></head><body><h1>That didn't go through.</h1><p>The page needs JavaScript on to check you're a person. Turn it on, then <a href="${back}">go back and try again</a>.</p></body></html>`;

/** Whose documents this host serves: a client's on its host, Wren's on the apex, any on the app. */
function askedBy(
  req: Request,
  env: Env,
  site: Site,
): { client: string | null; apex: boolean } | null {
  if (site.kind === "client") return { client: site.client, apex: false };
  if (site.kind === "app") return { client: null, apex: false };
  const host = new URL(req.url).hostname.toLowerCase();
  const app = env.APP_HOST ?? "";
  if (site.kind === "ours" && host === app.slice(app.indexOf(".") + 1))
    return { client: null, apex: true };
  return null;
}

const page = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PAGE_CSP.replace(
        "frame-ancestors 'self'",
        "frame-ancestors 'none'",
      ),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });

async function call(env: Env, handler: string, body: unknown): Promise<Answer> {
  try {
    const res = await fetch(`${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/Documents/${handler}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as Answer;
  } catch {}
  return { status: 503, html: goneHtml(404) };
}

function reply(a: Answer): Response {
  if (a.location && /^https:\/\//.test(a.location))
    return new Response(null, {
      status: 303,
      headers: {
        location: a.location,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  if (a.pdf) {
    const bytes = Uint8Array.from(atob(a.pdf), (c) => c.charCodeAt(0));
    const name = (a.filename ?? "document.pdf").replace(/[^A-Za-z0-9._-]/g, "");
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${name}"`,
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
      },
    });
  }
  return page(a.html ?? goneHtml(404), a.status || 200);
}

export async function docsRoute(req: Request, env: Env, site: Site): Promise<Response | null> {
  const url = new URL(req.url);
  const m = DOC.exec(url.pathname);
  if (!m) return null;
  const owner = askedBy(req, env, site);
  if (!owner) return null;
  const token = m[1] as string;
  const agent = req.headers.get("user-agent");
  const base = {
    ...owner,
    token,
    siteKey: env.TURNSTILE_SITE_KEY ?? null,
    ip: req.headers.get("cf-connecting-ip"),
    agent: agent?.slice(0, 500) ?? null,
  };
  if (req.method === "GET" || req.method === "HEAD") {
    if (m[2] === "/pdf") return reply(await call(env, "pdf", base));
    if (m[2] === "/pay") {
      if (isBot(agent)) return page(goneHtml(404), 404);
      return reply(await call(env, "deposit", base));
    }
    return reply(await call(env, "serve", { ...base, bot: isBot(agent) }));
  }
  if (req.method !== "POST" || m[2]) return new Response(null, { status: 405 });
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded"))
    return new Response(null, { status: 415 });
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return new Response(null, { status: 413 });
  const { [TOKEN]: check, ...fields } = Object.fromEntries(new URLSearchParams(raw));
  if (!(await human(env, check, base.ip))) return page(NOT_HUMAN(`/o/d/${token}`), 403);
  const act = fields.act === "decline" ? "decline" : "sign";
  return reply(await call(env, "act", { ...base, act, fields }));
}
