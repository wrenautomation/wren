/**
 * `/oauth/mail/google` and `/oauth/mail/microsoft` (designs/2026-10-07-mail-access.md): where
 * Google and Microsoft send a person back after a mailbox's sign-in or an admin's consent. No
 * sign-in is needed: the one-time `state` names the grant, and only `MailCallback/land` can spend
 * it. The page says what happened and links back to Account → Mail. Nothing in the URL is echoed
 * but the service's own sentence.
 */
import { forward } from "./edge.js";
import type { Env } from "./env.js";

const PATH = /^\/oauth\/mail\/(google|microsoft)\/?$/;
/** The query names the callback passes on; anything else is dropped. */
const KEEP = ["state", "code", "error", "admin_consent", "tenant", "scope"] as const;

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

function page(ok: boolean, said: string, status = 200): Response {
  const title = ok ? "Connected" : "Not connected";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;
color:#1c1b19;background:#fbfaf7}a{color:inherit}@media(prefers-color-scheme:dark){body{
color:#ece9e2;background:#161513}}</style></head><body><h1>${title}</h1><p>${esc(said)}</p>
<p><a href="/account/mail">Back to Account → Mail</a></p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

/** The callback's page, or null when the path isn't one. */
export async function mailOAuthRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  if (req.method !== "GET") return page(false, "Open this link in a browser.", 405);
  const q: Record<string, string> = {};
  for (const k of KEEP) {
    const v = url.searchParams.get(k);
    if (v !== null) q[k] = v.slice(0, 4096);
  }
  if (!q.state)
    return page(false, "This link is missing its sign-in. Start again from Account → Mail.", 400);
  const res = await forward(env, "MailCallback/land", JSON.stringify({ provider: m[1], ...q }));
  const body = (await res.json().catch(() => null)) as { ok?: boolean; said?: string } | null;
  if (!res.ok || !body || typeof body.said !== "string")
    return page(false, "Something went wrong on our side. Try again from Account → Mail.", 502);
  return page(body.ok === true, body.said);
}
