/**
 * Who signed in, for an app: the short-lived token our sign-in signs (A6),
 * checked against its published keys. EdDSA (Ed25519) plus iss, aud, exp and
 * nbf, checked by jose (open source; runs in a Worker and in Node). Nothing here
 * imports Better Auth.
 */

import { createRemoteJWKSet, customFetch, errors, type JWTPayload, jwtVerify } from "jose";

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

type Jwks = ReturnType<typeof createRemoteJWKSet>;
/** Keys are fetched again after an hour, or sooner when a token names a key id we lack. */
const KEYS_TTL_MS = 60 * 60 * 1000;
/** An unknown key id refetches at most this often, so made-up ids can't hammer the sign-in. */
const REFETCH_MS = 60 * 1000;
/** Clocks drift: a token may say it starts this far ahead of ours. Expiry is exact. */
const SKEW_SECONDS = 60;
const sets = new Map<string, Jwks>();

/** The issuer's published keys, cached and rotated by jose. */
function keysOf(issuer: string, fetcher?: typeof fetch): Jwks {
  const hit = fetcher ? undefined : sets.get(issuer);
  if (hit) return hit;
  const set = createRemoteJWKSet(new URL(`${issuer}/api/auth/jwks`), {
    cacheMaxAge: KEYS_TTL_MS,
    cooldownDuration: REFETCH_MS,
    ...(fetcher ? { [customFetch]: fetcher } : {}),
  });
  if (!fetcher) sets.set(issuer, set);
  return set;
}

/** The signed-in person, or null for anything short of a valid token. */
export async function verifyToken(
  token: string | null,
  check: TokenCheck,
  opts: { fetcher?: typeof fetch; now?: number } = {},
): Promise<Signed | null> {
  if (!token) return null;
  const now = opts.now ?? Date.now();
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(token, keysOf(check.issuer, opts.fetcher), {
      algorithms: ["EdDSA", "Ed25519"],
      issuer: check.issuer,
      audience: check.audience,
      requiredClaims: ["exp", "sub"],
      currentDate: new Date(now),
      clockTolerance: SKEW_SECONDS,
    }));
  } catch (err) {
    // The sign-in unreachable is an outage, not a bad token: the caller says so.
    if (err instanceof errors.JWKSTimeout || isFetchFailure(err)) throw err;
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || typeof claims.sub !== "string") return null;
  return {
    email,
    ...(typeof claims.name === "string" ? { name: claims.name } : {}),
    operator: claims.operator === true,
    sub: claims.sub,
  };
}

/** jose's error when the key set couldn't be fetched (a non-200, or the network). */
const isFetchFailure = (err: unknown): boolean =>
  err instanceof errors.JOSEError
    ? err.code === "ERR_JOSE_GENERIC" && /fetch|response/i.test(err.message)
    : err instanceof TypeError;

/** The bearer token on a request, or null. */
export const bearer = (req: Request): string | null =>
  /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

/** For tests: forget fetched keys. */
export const forgetKeys = () => sets.clear();
