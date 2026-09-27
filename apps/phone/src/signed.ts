/**
 * Signed values for cookies: `<value>.<expiresAtSeconds>.<hmac>`, HMAC-SHA256
 * over the first two parts with SESSION_SECRET. No server-side session store:
 * a cookie that verifies and has not expired is the session.
 */

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant time, so a timing probe learns nothing about the right signature. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(
  secret: string,
  value: string,
  ttlSeconds: number,
  nowSeconds: number,
): Promise<string> {
  if (value.includes(".")) throw new Error("signed value must not contain a dot");
  const body = `${value}.${nowSeconds + ttlSeconds}`;
  return `${body}.${await hmac(secret, body)}`;
}

/** The value, or null when the token is malformed, forged or expired. */
export async function unsign(
  secret: string,
  token: string | null,
  nowSeconds: number,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [value, exp, sig] = parts as [string, string, string];
  if (!same(sig, await hmac(secret, `${value}.${exp}`))) return null;
  if (!(Number(exp) > nowSeconds)) return null;
  return value;
}

export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function setCookie(name: string, value: string, maxAge: number, path = "/"): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=Strict`;
}
