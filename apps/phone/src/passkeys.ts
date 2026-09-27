/**
 * Passkey sign-in. A device joins once with the setup link (`/?setup=<SETUP_TOKEN>`),
 * which registers a passkey on it (Face ID on the iPhone, fingerprint on the Seeker,
 * Touch ID on the Mac); after that, sign-in is the passkey alone. Credentials live in
 * KV (`cred:<id>`); the in-flight challenge rides a signed, five-minute cookie.
 */
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Env } from "./env.js";
import { cookie, setCookie, sign, unsign } from "./signed.js";

const CHALLENGE = "wren_challenge";
const CHALLENGE_TTL = 300;
export const SESSION = "wren_session";
export const SESSION_TTL = 30 * 86_400;

interface StoredCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  label: string;
  createdAt: string;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const rpOf = (req: Request, env: Env) => {
  const url = new URL(req.url);
  return { rpID: env.RP_ID ?? url.hostname, origin: url.origin };
};

async function challengeCookie(env: Env, challenge: string): Promise<string> {
  return setCookie(
    CHALLENGE,
    await sign(env.SESSION_SECRET, challenge, CHALLENGE_TTL, nowSeconds()),
    CHALLENGE_TTL,
    "/auth",
  );
}

async function sessionCookie(env: Env): Promise<string> {
  return setCookie(
    SESSION,
    await sign(env.SESSION_SECRET, "operator", SESSION_TTL, nowSeconds()),
    SESSION_TTL,
  );
}

export async function signedIn(req: Request, env: Env): Promise<boolean> {
  return (await unsign(env.SESSION_SECRET, cookie(req, SESSION), nowSeconds())) === "operator";
}

/** `POST /auth/register/options` {setup}: only the setup token may add a device. */
export async function registerOptions(req: Request, env: Env): Promise<Response> {
  const { setup } = (await req.json().catch(() => ({}))) as { setup?: string };
  if (!env.SETUP_TOKEN || !setup || !same(setup, env.SETUP_TOKEN))
    return json({ error: "bad setup link" }, 403);
  const { rpID } = rpOf(req, env);
  const options = await generateRegistrationOptions({
    rpName: "Wren",
    rpID,
    userName: "operator",
    userDisplayName: "Wren operator",
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return json(options, 200, { "set-cookie": await challengeCookie(env, options.challenge) });
}

/** `POST /auth/register/verify` {setup, label, response}: stores the passkey and signs in. */
export async function registerVerify(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    setup?: string;
    label?: string;
    response?: RegistrationResponseJSON;
  };
  if (!env.SETUP_TOKEN || !body.setup || !same(body.setup, env.SETUP_TOKEN))
    return json({ error: "bad setup link" }, 403);
  const challenge = await unsign(env.SESSION_SECRET, cookie(req, CHALLENGE), nowSeconds());
  if (!challenge || !body.response) return json({ error: "challenge expired, try again" }, 400);
  const { rpID, origin } = rpOf(req, env);
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    return json({ error: `passkey not accepted: ${(err as Error).message}` }, 400);
  }
  if (!result.verified || !result.registrationInfo)
    return json({ error: "passkey not accepted" }, 400);
  const cred = result.registrationInfo.credential;
  const stored: StoredCredential = {
    id: cred.id,
    publicKey: b64(cred.publicKey),
    counter: cred.counter,
    ...(cred.transports ? { transports: cred.transports } : {}),
    label: (body.label ?? "device").slice(0, 60),
    createdAt: new Date().toISOString(),
  };
  await env.CREDS.put(`cred:${cred.id}`, JSON.stringify(stored));
  return json({ ok: true }, 200, { "set-cookie": await sessionCookie(env) });
}

/** `POST /auth/login/options`: a discoverable-credential prompt, so no user name is typed. */
export async function loginOptions(req: Request, env: Env): Promise<Response> {
  const { rpID } = rpOf(req, env);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  return json(options, 200, { "set-cookie": await challengeCookie(env, options.challenge) });
}

/** `POST /auth/login/verify` {response}: a known passkey with a valid assertion signs in. */
export async function loginVerify(req: Request, env: Env): Promise<Response> {
  const { response } = (await req.json().catch(() => ({}))) as {
    response?: AuthenticationResponseJSON;
  };
  const challenge = await unsign(env.SESSION_SECRET, cookie(req, CHALLENGE), nowSeconds());
  if (!challenge || !response) return json({ error: "challenge expired, try again" }, 400);
  const raw = await env.CREDS.get(`cred:${response.id}`);
  if (!raw) return json({ error: "unknown passkey: add this device with the setup link" }, 403);
  const stored = JSON.parse(raw) as StoredCredential;
  const { rpID, origin } = rpOf(req, env);
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: unb64(stored.publicKey),
        counter: stored.counter,
        ...(stored.transports ? { transports: stored.transports as never } : {}),
      },
    });
  } catch (err) {
    return json({ error: `sign-in refused: ${(err as Error).message}` }, 403);
  }
  if (!result.verified) return json({ error: "sign-in refused" }, 403);
  await env.CREDS.put(
    `cred:${stored.id}`,
    JSON.stringify({ ...stored, counter: result.authenticationInfo.newCounter }),
  );
  return json({ ok: true }, 200, { "set-cookie": await sessionCookie(env) });
}

export function logout(): Response {
  return json({ ok: true }, 200, { "set-cookie": setCookie(SESSION, "", 0) });
}
