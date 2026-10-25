/**
 * Wren's sign-in (designs/2026-09-30-client-delivery-portal.md, A1–A9): Better
 * Auth over our Postgres, tables in schema `auth`. One account per verified
 * email across every method, passkeys included. Invite-only: an account is made only when
 * `allowed(email)` says so; the registry decides who that is (A7), never this
 * package. Apps check the short-lived token it signs against its JWKS
 * (`@wren/auth/verify`).
 */
import { passkey } from "@better-auth/passkey";
import type { Db } from "@wren/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { emailOTP, haveIBeenPwned, jwt, oneTimeToken } from "better-auth/plugins";
import { handoff } from "./handoff.js";
import * as schema from "./schema.js";
import { AUDIENCE } from "./verify.js";

export { BACK_PATH, handoffTarget } from "./handoff.js";
export { AUDIENCE, schema };

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
}

interface AuthOptions {
  db: Db;
  /** Signs sessions and encrypts the JWKS private keys. */
  secret: string;
  /** Where sign-in lives, e.g. https://auth.wrenautomation.com */
  baseURL: string;
  /** Origins that may be sent back to after sign-in and may ask for a token. */
  trustedOrigins: string[];
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string };
  /** May this email have an account? The registry's answer: a client member or an operator. */
  allowed(email: string): Promise<boolean>;
  /** Extra token claims for this email, e.g. `{ operator: true }`. Read fresh for every token. */
  claims?(email: string): Promise<Record<string, unknown>>;
  /**
   * Signed in as this email, reading the session or a token has no cap: Wren's operators, whose
   * tabs and tools share one address. The proof is the session cookie (HttpOnly, never in a page),
   * so there is nothing to copy. Unset: everyone is capped.
   */
  uncapped?(email: string): Promise<boolean>;
  send(mail: AuthMail): Promise<void>;
  /** The header the edge writes the caller's address to; anything else is ignored. */
  ipHeader?: string;
  /**
   * May sign-in be carried to this client host for this email (designs/2026-10-06-custom-domains.md)?
   * Unset: no handoffs.
   */
  handoff?(host: string, email: string): Promise<boolean>;
  /** Where a refused handoff goes, e.g. https://app.wrenautomation.com. */
  portal?: string;
}

const NOT_INVITED =
  "This email has no access yet. Ask the person you work with at Wren to invite you.";
const UNVERIFIED =
  "Your provider didn't confirm this email. Sign in with the emailed code instead.";

/** How long a code lasts; the email says so. */
const CODE_MINUTES = 10;

/** The sign-in email: a link that opens a button (a link scanner can't burn it), and the code (A8). */
function codeMail(baseURL: string, email: string, code: string): AuthMail {
  const link = new URL("/link", baseURL);
  link.searchParams.set("email", email);
  link.searchParams.set("code", code);
  return {
    to: email,
    subject: `Your Wren sign-in code: ${code}`,
    text: [
      "Sign in to Wren:",
      link.toString(),
      "",
      `Or enter this code: ${code}`,
      "",
      `It works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    ].join("\n"),
  };
}

function passwordMail(email: string, url: string): AuthMail {
  return {
    to: email,
    subject: "Set your Wren password",
    text: [
      "Set a new password for Wren:",
      url,
      "",
      "The link works for one hour. If you didn't ask for it, ignore this email.",
    ].join("\n"),
  };
}

/**
 * Passkeys belong to the registrable domain (auth.example.com → example.com),
 * so the same passkey still works if sign-in ever moves host.
 */
const rpIdOf = (baseURL: string) => new URL(baseURL).hostname.replace(/^auth\./, "");

/** How long a handoff's one-time token lasts: the hop is a redirect. */
const HANDOFF_MINUTES = 1;

export function makeAuth(o: AuthOptions) {
  const gate = async (email: string) => o.allowed(email.trim().toLowerCase());
  // The session's own reads, uncapped for `uncapped` people; anyone else keeps the rule.
  const sessionRead = async (req: Request, rule: { window: number; max: number }) => {
    const email = o.uncapped ? await signedIn(req.headers) : null;
    return email && (await o.uncapped?.(email)) ? false : rule;
  };
  // The handoff mints through Better Auth's own endpoint, on the instance made below.
  let mint = async (_: Headers): Promise<string> => {
    throw new Error("auth is not made yet");
  };
  let signedIn = async (_: Headers): Promise<string | null> => null;
  const auth = betterAuth({
    appName: "Wren",
    baseURL: o.baseURL,
    secret: o.secret,
    trustedOrigins: [o.baseURL, ...o.trustedOrigins],
    database: drizzleAdapter(o.db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    session: { expiresIn: 30 * 24 * 3600, updateAge: 24 * 3600 },
    emailAndPassword: {
      enabled: true,
      // A password is set from an emailed link, never by signing up (A4).
      disableSignUp: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => o.send(passwordMail(user.email, url)),
    },
    socialProviders: {
      ...(o.google ? { google: { ...o.google, prompt: "select_account" as const } } : {}),
      ...(o.microsoft ? { microsoft: { ...o.microsoft, tenantId: "common" } } : {}),
    },
    account: { accountLinking: { enabled: true } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await gate(user.email)))
              throw new APIError("FORBIDDEN", { message: NOT_INVITED });
            // An unconfirmed address from a provider could be anyone's (nOAuth).
            if (!user.emailVerified) throw new APIError("FORBIDDEN", { message: UNVERIFIED });
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/token": sessionRead,
        "/get-session": sessionRead,
        // Public keys, read by every app's Worker from Cloudflare's few shared addresses.
        "/jwks": { window: 60, max: 600 },
        "/email-otp/send-verification-otp": { window: 600, max: 5 },
        "/sign-in/email-otp": { window: 600, max: 10 },
        "/sign-in/email": { window: 600, max: 10 },
        "/request-password-reset": { window: 600, max: 5 },
        "/passkey/verify-authentication": { window: 600, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: o.baseURL.startsWith("https:"),
      ...(o.ipHeader ? { ipAddress: { ipAddressHeaders: [o.ipHeader] } } : {}),
    },
    plugins: [
      emailOTP({
        expiresIn: CODE_MINUTES * 60,
        storeOTP: "hashed",
        // A code is sent only to someone who may have an account; the answer is the same either way.
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in" && !(await gate(email))) return;
          await o.send(codeMail(o.baseURL, email, otp));
        },
      }),
      haveIBeenPwned(),
      // Added once signed in (a session under a day old); signs in alone after that.
      passkey({ rpID: rpIdOf(o.baseURL), rpName: "Wren", origin: new URL(o.baseURL).origin }),
      jwt({
        jwt: {
          issuer: o.baseURL,
          audience: AUDIENCE,
          expirationTime: "15m",
          definePayload: async ({ user }) => {
            const email = user.email.toLowerCase();
            return { ...(await o.claims?.(email)), email, name: user.name };
          },
        },
      }),
      // Only the handoff mints one (a server call); the browser may only redeem, via a Worker.
      oneTimeToken({
        expiresIn: HANDOFF_MINUTES,
        storeToken: "hashed",
        disableClientRequest: true,
      }),
      handoff({
        allowed: (host, email) => o.handoff?.(host, email) ?? Promise.resolve(false),
        mint: (headers) => mint(headers),
        home: o.portal ?? o.baseURL,
      }),
    ],
  });
  mint = async (headers) => (await auth.api.generateOneTimeToken({ headers })).token;
  signedIn = async (headers) => {
    const s = await auth.api
      .getSession({ headers, query: { disableRefresh: true } })
      .catch(() => null);
    return s?.user.email.toLowerCase() ?? null;
  };
  return auth;
}

export type Auth = ReturnType<typeof makeAuth>;
