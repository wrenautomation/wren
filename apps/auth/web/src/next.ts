/**
 * Where to go once signed in: `?next=` when it's one of our hosts over https,
 * else the portal. Anything else would make sign-in an open redirect.
 */
export function nextOf(search: string, base: string): string {
  const portal = `https://app.${base}/`;
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return portal;
  try {
    const u = new URL(raw);
    const ours = u.hostname === base || u.hostname.endsWith(`.${base}`);
    return u.protocol === "https:" && ours ? u.href : portal;
  } catch {
    return portal;
  }
}
