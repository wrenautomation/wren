/**
 * `/oauth/<kind>/<name>`: where a provider sends a person back after connecting something. No
 * sign-in is needed: the one-time `state` names the grant, and only the kind's `…Callback/land`
 * can spend it. Only the kind's known query names go on; the page shows the service's own
 * sentence, escaped, and links back to the Account page it started on.
 *
 * - `mail`: a mailbox's sign-in or an admin's consent (designs/2026-10-07-mail-access.md).
 * - `social`: a client's social account (designs/2026-10-07-client-social.md).
 * - `connector`: a client's HubSpot, QuickBooks or Jobber (designs/2026-10-09-connectors.md).
 */
import { CONNECTOR_APPS } from "@wren/connectors/apps";
import { SOCIAL_PLATFORMS } from "@wren/content/connect/platforms";
import { forward } from "./edge.js";
import type { Env } from "./env.js";

interface Landing {
  /** Which names the path takes, and the field the service reads it as. */
  names: readonly string[];
  field: string;
  service: string;
  /** The query names passed on; anything else is dropped. */
  keep: readonly string[];
  back: { href: string; label: string };
}

const LANDINGS: Record<string, Landing> = {
  mail: {
    names: ["google", "microsoft"],
    field: "provider",
    service: "MailCallback/land",
    keep: ["state", "code", "error", "admin_consent", "tenant", "scope"],
    back: { href: "/account/mail", label: "Account → Mail" },
  },
  social: {
    names: SOCIAL_PLATFORMS,
    field: "platform",
    service: "SocialCallback/land",
    keep: ["state", "code", "error"],
    back: { href: "/account/social", label: "Account → Social" },
  },
  connector: {
    names: CONNECTOR_APPS,
    field: "app",
    service: "ConnectorCallback/land",
    // QuickBooks adds its company.
    keep: ["state", "code", "error", "realmId"],
    back: { href: "/account/connectors", label: "Account → Connectors" },
  },
};

const PATH = /^\/oauth\/([a-z]+)\/([a-z_]+)\/?$/;
/** A code or scope list can run long; the rest are short. */
const MOST: Record<string, number> = { code: 4096, scope: 4096 };

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** The landing page: what happened, and a link back to the Account page it started on. */
function landingPage(
  ok: boolean,
  said: string,
  back: { href: string; label: string },
  status = 200,
): Response {
  const title = ok ? "Connected" : "Not connected";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;
color:#1c1b19;background:#fbfaf7}a{color:inherit}@media(prefers-color-scheme:dark){body{
color:#ece9e2;background:#161513}}</style></head><body><h1>${title}</h1><p>${esc(said)}</p>
<p><a href="${back.href}">Back to ${esc(back.label)}</a></p></body></html>`;
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
export async function oauthLanding(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  const l = m ? LANDINGS[m[1] as string] : undefined;
  const name = m?.[2] as string;
  if (!l?.names.includes(name)) return null;
  const page = (ok: boolean, said: string, status = 200) => landingPage(ok, said, l.back, status);
  if (req.method !== "GET") return page(false, "Open this link in a browser.", 405);
  const q: Record<string, string> = {};
  for (const k of l.keep) {
    const v = url.searchParams.get(k);
    if (v !== null) q[k] = v.slice(0, MOST[k] ?? 200);
  }
  if (!q.state)
    return page(false, `This link is missing its sign-in. Start again from ${l.back.label}.`, 400);
  const res = await forward(env, l.service, JSON.stringify({ [l.field]: name, ...q }));
  const body = (await res.json().catch(() => null)) as { ok?: boolean; said?: string } | null;
  if (!res.ok || !body || typeof body.said !== "string")
    return page(false, `Something went wrong on our side. Try again from ${l.back.label}.`, 502);
  return page(body.ok === true, body.said);
}
