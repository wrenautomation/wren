/**
 * Wren's mail apps' OAuth (designs/2026-10-07-mail-access.md): Google's and Microsoft's
 * authorization-code flow with PKCE, refresh, Microsoft's admin consent, and its app token for the
 * consent check. Every call goes through `FetchLike`, so tests never reach the network. Tokens
 * are returned to the caller, never logged; errors carry the provider's code, never a token.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FetchLike } from "../fetch-like.js";
import type { MailAccess, MailProvider } from "./schema.js";

/** One OAuth client: Wren's "Wren mail" app at Google or in Entra. */
export interface MailApp {
  id: string;
  secret: string;
}
export interface MailApps {
  google: MailApp | null;
  microsoft: MailApp | null;
}

export const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const GRAPH_READ = "https://graph.microsoft.com/Mail.Read";
export const GRAPH_SEND = "https://graph.microsoft.com/Mail.Send";
/** Who signed in: the address, and Google's `hd` or Microsoft's `tid`. */
const IDENTITY = ["openid", "email"];

/** The scopes a connect asks for. Read always comes with send: one sign-in, both jobs. */
export function scopesFor(provider: MailProvider, want: MailAccess): string[] {
  if (provider === "google")
    return [...IDENTITY, ...(want === "read" ? [GMAIL_READ] : []), GMAIL_SEND];
  return [...IDENTITY, "offline_access", ...(want === "read" ? [GRAPH_READ] : []), GRAPH_SEND];
}

/** What a set of granted scopes lets Wren do; null when it can't even send. */
export function accessOf(provider: MailProvider, granted: readonly string[]): MailAccess | null {
  const has = (s: string) => granted.some((g) => g.toLowerCase() === s.toLowerCase());
  const [read, send] = provider === "google" ? [GMAIL_READ, GMAIL_SEND] : [GRAPH_READ, GRAPH_SEND];
  if (!has(send)) return null;
  return has(read) ? "read" : "send";
}

/** Microsoft names Graph scopes bare in a token's `scope` ("Mail.Read"); the URL form is the same. */
export const graphScopes = (scope: string) =>
  scope
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => (/^Mail\.(Read|Send)$/i.test(s) ? `https://graph.microsoft.com/${s}` : s));

export const randomState = () => randomBytes(24).toString("base64url");
export const pkceVerifier = () => randomBytes(48).toString("base64url");
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const MS = "https://login.microsoftonline.com";
/** A tenant in a URL: a GUID or a domain, nothing else. */
const TENANT = /^[a-z0-9][a-z0-9.-]{0,253}$/i;
const tenantOf = (t: string | null | undefined) => {
  const v = (t ?? "organizations").trim();
  if (!TENANT.test(v)) throw new Error("tenant: a domain or a tenant id");
  return v;
};

/** Where a person signs in to connect one mailbox. */
export function connectUrl(
  provider: MailProvider,
  app: MailApp,
  o: {
    redirect: string;
    state: string;
    verifier: string;
    want: MailAccess;
    address: string;
    /** Microsoft: the org's domain or tenant id; none: any work account. */
    tenant?: string | null;
  },
): string {
  const q = new URLSearchParams({
    client_id: app.id,
    redirect_uri: o.redirect,
    response_type: "code",
    scope: scopesFor(provider, o.want).join(" "),
    state: o.state,
    code_challenge: pkceChallenge(o.verifier),
    code_challenge_method: "S256",
    login_hint: o.address,
  });
  if (provider === "google") {
    // A refresh token every time, and only the scopes asked now.
    q.set("access_type", "offline");
    q.set("prompt", "consent");
    q.set("include_granted_scopes", "false");
    const domain = o.address.split("@")[1] ?? "";
    if (domain && !CONSUMER_GOOGLE.has(domain)) q.set("hd", domain);
    return `${GOOGLE_AUTH}?${q}`;
  }
  q.set("response_mode", "query");
  q.set("prompt", "select_account");
  return `${MS}/${tenantOf(o.tenant)}/oauth2/v2.0/authorize?${q}`;
}

/**
 * Microsoft's admin consent for the tenant (v2 endpoint): the scopes are named here, so the admin
 * sees exactly Mail.Read, Mail.Send and offline_access, whatever the registration lists.
 */
export function consentUrl(
  app: MailApp,
  o: { tenant: string; redirect: string; state: string },
): string {
  const q = new URLSearchParams({
    client_id: app.id,
    scope: [GRAPH_READ, GRAPH_SEND, "offline_access", ...IDENTITY].join(" "),
    redirect_uri: o.redirect,
    state: o.state,
  });
  return `${MS}/${tenantOf(o.tenant)}/v2.0/adminconsent?${q}`;
}

/** Personal Google accounts: no Workspace admin can trust Wren's app for them. */
export const CONSUMER_GOOGLE = new Set(["gmail.com", "googlemail.com"]);
/** Personal Microsoft accounts: no tenant, no admin consent. Not supported yet. */
export const CONSUMER_MICROSOFT = new Set(["outlook.com", "hotmail.com", "live.com", "msn.com"]);

/** A refusal from a token endpoint. `revoked`: the grant is gone; connect again. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly revoked: boolean,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

const REVOKED = new Set(["invalid_grant", "unauthorized_client", "interaction_required"]);

async function tokenCall(
  fetch: FetchLike,
  url: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.error === "string") {
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    // Microsoft's description starts "AADSTS70000: ..."; keep its first line, never more.
    const said =
      String(body.error_description ?? "")
        .split(/\r?\n/)[0]
        ?.slice(0, 200) ?? "";
    throw new OAuthError(code, said ? `${code}: ${said}` : code, REVOKED.has(code));
  }
  return body;
}

/** A JWT's claims, unverified: an id token straight from the token endpoint over TLS (OIDC 3.1.3.7). */
export function claimsOf(jwt: unknown): Record<string, unknown> {
  if (typeof jwt !== "string") return {};
  const part = jwt.split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface Tokens {
  access: string;
  /** Seconds the access token lives. */
  expiresIn: number;
  /** Microsoft sends a new one on every refresh; Google only on the first exchange. */
  refresh: string | null;
  scopes: string[];
  /** The signed-in address, lowercased, when an id token came. */
  address: string | null;
  /** Google's `hd` (Workspace domain) or Microsoft's `tid`. */
  org: string | null;
}

function tokensOf(provider: MailProvider, b: Record<string, unknown>): Tokens {
  const claims = claimsOf(b.id_token);
  const email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase();
  const scope = String(b.scope ?? "");
  return {
    access: String(b.access_token ?? ""),
    expiresIn: Number(b.expires_in ?? 3600),
    refresh: typeof b.refresh_token === "string" ? b.refresh_token : null,
    scopes: provider === "microsoft" ? graphScopes(scope) : scope.split(/\s+/).filter(Boolean),
    address: email.includes("@") ? email : null,
    org: provider === "google" ? ((claims.hd as string) ?? null) : ((claims.tid as string) ?? null),
  };
}

const tokenUrl = (provider: MailProvider, tenant?: string | null) =>
  provider === "google" ? GOOGLE_TOKEN : `${MS}/${tenantOf(tenant)}/oauth2/v2.0/token`;

/** The code from the callback, for tokens. */
export async function exchange(
  fetch: FetchLike,
  provider: MailProvider,
  app: MailApp,
  o: { code: string; redirect: string; verifier: string; tenant?: string | null },
): Promise<Tokens> {
  const b = await tokenCall(fetch, tokenUrl(provider, o.tenant), {
    grant_type: "authorization_code",
    code: o.code,
    redirect_uri: o.redirect,
    client_id: app.id,
    client_secret: app.secret,
    code_verifier: o.verifier,
  });
  return tokensOf(provider, b);
}

/** A fresh access token. Microsoft rotates the refresh token: the caller keeps the new one. */
export async function refresh(
  fetch: FetchLike,
  provider: MailProvider,
  app: MailApp,
  o: { refresh: string; tenant?: string | null },
): Promise<Tokens> {
  const b = await tokenCall(fetch, tokenUrl(provider, o.tenant), {
    grant_type: "refresh_token",
    refresh_token: o.refresh,
    client_id: app.id,
    client_secret: app.secret,
  });
  return tokensOf(provider, b);
}

/**
 * Whether Wren's Microsoft app is in the tenant: an app-only token is issued only where its
 * service principal exists, which an admin's consent creates. The token itself is dropped.
 */
export async function appInTenant(
  fetch: FetchLike,
  app: MailApp,
  tenant: string,
): Promise<{ ok: boolean; why: string }> {
  try {
    await tokenCall(fetch, tokenUrl("microsoft", tenant), {
      grant_type: "client_credentials",
      client_id: app.id,
      client_secret: app.secret,
      scope: "https://graph.microsoft.com/.default",
    });
    return { ok: true, why: "Wren's app is in the tenant" };
  } catch (err) {
    const e = err as OAuthError;
    // AADSTS700016: the app isn't in that directory; consent was never given or was removed.
    return /AADSTS700016/.test(e.message)
      ? { ok: false, why: "Wren's app isn't in the tenant: the admin hasn't consented" }
      : { ok: false, why: `Microsoft said ${e.code ?? "no"}` };
  }
}
