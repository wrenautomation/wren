/**
 * `/oauth/connector/<app>` (designs/2026-10-09-connectors.md): where HubSpot, QuickBooks and
 * Jobber send a person back after connecting a client's account. No sign-in is needed: the
 * one-time `state` names the grant, and only `ConnectorCallback/land` can spend it.
 */
import { CONNECTOR_APPS } from "@wren/connectors/apps";
import { forward } from "./edge.js";
import type { Env } from "./env.js";
import { landingPage } from "./mail-oauth.js";

const PATH = new RegExp(`^/oauth/connector/(${CONNECTOR_APPS.join("|")})/?$`);
/** The query names the callback passes on; QuickBooks adds its company (`realmId`). */
const KEEP = ["state", "code", "error", "realmId"] as const;
const BACK = { href: "/account/connectors", label: "Account → Connectors" };
const page = (ok: boolean, said: string, status = 200) => landingPage(ok, said, BACK, status);

/** The callback's page, or null when the path isn't one. */
export async function connectorOAuthRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  if (req.method !== "GET") return page(false, "Open this link in a browser.", 405);
  const q: Record<string, string> = {};
  for (const k of KEEP) {
    const v = url.searchParams.get(k);
    if (v !== null) q[k] = v.slice(0, k === "code" ? 4096 : k === "realmId" ? 64 : 200);
  }
  if (!q.state)
    return page(
      false,
      "This link is missing its sign-in. Start again from Account → Connectors.",
      400,
    );
  const res = await forward(env, "ConnectorCallback/land", JSON.stringify({ app: m[1], ...q }));
  const body = (await res.json().catch(() => null)) as { ok?: boolean; said?: string } | null;
  if (!res.ok || !body || typeof body.said !== "string")
    return page(
      false,
      "Something went wrong on our side. Try again from Account → Connectors.",
      502,
    );
  return page(body.ok === true, body.said);
}
