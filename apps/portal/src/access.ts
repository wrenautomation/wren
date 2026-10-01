/**
 * Who signed in, from Cloudflare Access. Access sits in front of app. and
 * sends a signed token (`Cf-Access-Jwt-Assertion`) with each request; checking
 * it here too means a request that got past the edge some other way still
 * carries no email. RS256 against the team's published keys, plus aud, iss and
 * exp. Nothing here trusts a cookie or a header on its own.
 */

export interface AccessConfig {
  /** `<team>.cloudflareaccess.com` */
  teamDomain: string;
  /** The Access application's AUD tag. */
  aud: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

type Keys = { at: number; keys: Map<string, CryptoKey> };
const KEYS_TTL_MS = 60 * 60 * 1000;
/** An unknown key id refetches at most this often, so made-up ids can't hammer Access. */
const REFETCH_MS = 60 * 1000;
const cache = new Map<string, Keys>();

const b64url = (s: string): Uint8Array => {
  const b = atob(
    s
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(s.length / 4) * 4, "="),
  );
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const jsonPart = (s: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(b64url(s)));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

async function teamKeys(
  teamDomain: string,
  fetcher: typeof fetch,
  now: number,
  fresh = false,
): Promise<Map<string, CryptoKey>> {
  const hit = cache.get(teamDomain);
  if (hit && now - hit.at < (fresh ? REFETCH_MS : KEYS_TTL_MS)) return hit.keys;
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs ${res.status}`);
  const { keys = [] } = (await res.json()) as { keys?: Jwk[] };
  const out = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    out.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }
  cache.set(teamDomain, { at: now, keys: out });
  return out;
}

/** The signed-in email, lowercased, or null for anything short of a valid token. */
export async function accessEmail(
  token: string | null,
  config: AccessConfig,
  opts: { fetcher?: typeof fetch; now?: number } = {},
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = jsonPart(h);
  const claims = jsonPart(p);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const now = opts.now ?? Date.now();
  const fetcher = opts.fetcher ?? fetch;
  let keys = await teamKeys(config.teamDomain, fetcher, now);
  // A key Access rotated in since the last fetch: fetch once more.
  if (!keys.has(header.kid)) keys = await teamKeys(config.teamDomain, fetcher, now, true);
  const key = keys.get(header.kid);
  if (!key) return null;
  let sig: Uint8Array;
  try {
    sig = b64url(s);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    sig,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(config.aud)) return null;
  if (claims.iss !== `https://${config.teamDomain}`) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf * 1000 > now + 60_000) return null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  return email || null;
}

/** For tests: forget fetched keys. */
export const forgetKeys = () => cache.clear();
