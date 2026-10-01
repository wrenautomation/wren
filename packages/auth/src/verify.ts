/**
 * Who signed in, for an app: the short-lived token our sign-in signs (A6),
 * checked against its published keys. EdDSA (Ed25519) plus iss, aud, exp and
 * nbf. WebCrypto only, so it runs in a Worker; nothing here imports Better Auth.
 */

/** Who the token is for: every Wren app checks this. */
export const AUDIENCE = "wren";

export interface TokenCheck {
  /** The sign-in's origin, e.g. https://auth.wrenautomation.com: the token's `iss`. */
  issuer: string;
  /** Who the token must be for: `wren`. */
  audience: string;
}

export interface Signed {
  /** Lowercased. */
  email: string;
  name?: string;
  /** Wren's own people: they see every client. */
  operator: boolean;
  /** The account id. */
  sub: string;
}

/** The parts of a published key we read; the same shape in a Worker and in Node. */
interface Jwk {
  kid?: string;
  kty?: string;
  crv?: string;
  x?: string;
}
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

type Keys = { at: number; keys: Map<string, Key> };
const KEYS_TTL_MS = 60 * 60 * 1000;
/** An unknown key id refetches at most this often, so made-up ids can't hammer the sign-in. */
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

async function issuerKeys(
  issuer: string,
  fetcher: typeof fetch,
  now: number,
  fresh = false,
): Promise<Map<string, Key>> {
  const hit = cache.get(issuer);
  if (hit && now - hit.at < (fresh ? REFETCH_MS : KEYS_TTL_MS)) return hit.keys;
  const res = await fetcher(`${issuer}/api/auth/jwks`);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const { keys = [] } = (await res.json()) as { keys?: Jwk[] };
  const out = new Map<string, Key>();
  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string")
      continue;
    const key = { kty: "OKP", crv: "Ed25519", x: jwk.x };
    out.set(
      jwk.kid,
      await crypto.subtle.importKey("jwk", key, { name: "Ed25519" }, false, ["verify"]),
    );
  }
  cache.set(issuer, { at: now, keys: out });
  return out;
}

/** The signed-in person, or null for anything short of a valid token. */
export async function verifyToken(
  token: string | null,
  check: TokenCheck,
  opts: { fetcher?: typeof fetch; now?: number } = {},
): Promise<Signed | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = jsonPart(h);
  const claims = jsonPart(p);
  if (!header || !claims || header.alg !== "EdDSA" || typeof header.kid !== "string") return null;
  const now = opts.now ?? Date.now();
  const fetcher = opts.fetcher ?? fetch;
  let keys = await issuerKeys(check.issuer, fetcher, now);
  // A key rotated in since the last fetch: fetch once more.
  if (!keys.has(header.kid)) keys = await issuerKeys(check.issuer, fetcher, now, true);
  const key = keys.get(header.kid);
  if (!key) return null;
  let sig: Uint8Array;
  try {
    sig = b64url(s);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("Ed25519", key, sig, new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(check.audience)) return null;
  if (claims.iss !== check.issuer) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf * 1000 > now + 60_000) return null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || typeof claims.sub !== "string") return null;
  return {
    email,
    ...(typeof claims.name === "string" ? { name: claims.name } : {}),
    operator: claims.operator === true,
    sub: claims.sub,
  };
}

/** The bearer token on a request, or null. */
export const bearer = (req: Request): string | null =>
  /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

/** For tests: forget fetched keys. */
export const forgetKeys = () => cache.clear();
