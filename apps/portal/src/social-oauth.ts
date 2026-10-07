/**
 * `/oauth/social/<platform>` (designs/2026-10-07-client-social.md): where Facebook, Instagram,
 * LinkedIn, Google, X and TikTok send a person back after connecting a client's account. No
 * sign-in is needed: the one-time `state` names the grant, and only `SocialCallback/land` can
 * spend it. The page says what happened and links back to Account → Social.
 */
import { SOCIAL_PLATFORMS } from "@wren/content/connect/platforms";
import { forward } from "./edge.js";
import type { Env } from "./env.js";
import { landingPage } from "./mail-oauth.js";

const PATH = new RegExp(`^/oauth/social/(${SOCIAL_PLATFORMS.join("|")})/?$`);
/** The query names the callback passes on; anything else is dropped. */
const KEEP = ["state", "code", "error"] as const;
const BACK = { href: "/account/social", label: "Account → Social" };
const page = (ok: boolean, said: string, status = 200) => landingPage(ok, said, BACK, status);

/** The callback's page, or null when the path isn't one. */
export async function socialOAuthRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  if (req.method !== "GET") return page(false, "Open this link in a browser.", 405);
  const q: Record<string, string> = {};
  for (const k of KEEP) {
    const v = url.searchParams.get(k);
    if (v !== null) q[k] = v.slice(0, k === "code" ? 4096 : 200);
  }
  if (!q.state)
    return page(false, "This link is missing its sign-in. Start again from Account → Social.", 400);
  const res = await forward(env, "SocialCallback/land", JSON.stringify({ platform: m[1], ...q }));
  const body = (await res.json().catch(() => null)) as { ok?: boolean; said?: string } | null;
  if (!res.ok || !body || typeof body.said !== "string")
    return page(false, "Something went wrong on our side. Try again from Account → Social.", 502);
  return page(body.ok === true, body.said);
}
