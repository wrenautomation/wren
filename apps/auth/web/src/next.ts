/**
 * Where to go once signed in: `?next=` when it's one of our hosts over https,
 * else the portal. Anything else would make sign-in an open redirect.
 *
 * A client's own host (designs/2026-10-06-custom-domains.md) can't read our
 * cookie, so its landing page goes through the handoff instead, which checks
 * the host is a live client domain and the login is its member.
 */
export const BACK_PATH = "/__auth/back";

export function nextOf(search: string, base: string): string {
  const portal = `https://app.${base}/`;
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return portal;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return portal;
    const ours = u.hostname === base || u.hostname.endsWith(`.${base}`);
    if (ours) return u.href;
    if (u.pathname === BACK_PATH)
      return `https://auth.${base}/api/auth/handoff?to=${encodeURIComponent(u.href)}`;
    return portal;
  } catch {
    return portal;
  }
}
