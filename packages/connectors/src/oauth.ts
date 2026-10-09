/**
 * The apps' sign-in (designs/2026-10-09-connectors.md): the link, the code's exchange, a refresh.
 * Every call goes through `FetchLike`, so tests never reach the network. Tokens go back to the
 * caller only, never into an error or a log line.
 */
import { randomBytes } from "node:crypto";
import type { FetchLike } from "@wren/core";
import { APPS, type ConnectorApp } from "./apps.js";

/** One of Wren's developer apps. */
export interface AppKeys {
  id: string;
  secret: string;
}

export const randomState = () => randomBytes(24).toString("base64url");

/** A refusal from a token endpoint. `revoked`: the grant is gone; connect again. */
export class ConnectorAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly revoked: boolean,
  ) {
    super(message);
    this.name = "ConnectorAuthError";
  }
}

const REVOKED = new Set(["invalid_grant", "invalid_token", "unauthorized_client"]);

export interface Tokens {
  access: string;
  refresh: string;
  /** Seconds the access token lives. */
  expiresIn: number;
}

/** Where a person signs in to connect `app`. */
export function connectUrl(
  app: ConnectorApp,
  keys: AppKeys,
  o: { redirect: string; state: string },
): string {
  const s = APPS[app];
  const q = new URLSearchParams({
    client_id: keys.id,
    redirect_uri: o.redirect,
    state: o.state,
    response_type: "code",
  });
  if (s.scopes.length) q.set("scope", s.scopes.join(" "));
  return `${s.authorize}?${q}`;
}

async function tokenCall(
  fetch: FetchLike,
  app: ConnectorApp,
  keys: AppKeys,
  form: Record<string, string>,
): Promise<Tokens> {
  const s = APPS[app];
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (s.auth === "basic")
    headers.authorization = `Basic ${Buffer.from(`${keys.id}:${keys.secret}`).toString("base64")}`;
  else {
    body.set("client_id", keys.id);
    body.set("client_secret", keys.secret);
  }
  const res = await fetch(s.token, { method: "POST", headers, body: body.toString() });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof j.access_token !== "string") {
    const code = String(j.error ?? `http_${res.status}`);
    throw new ConnectorAuthError(code, `${s.label} said ${code}`, REVOKED.has(code));
  }
  const refresh = typeof j.refresh_token === "string" ? j.refresh_token : form.refresh_token;
  if (!refresh)
    throw new ConnectorAuthError("no_refresh", `${s.label} gave no refresh token`, false);
  const exp = Number(j.expires_in);
  return {
    access: j.access_token,
    refresh,
    expiresIn: Number.isFinite(exp) && exp > 0 ? exp : 3600,
  };
}

/** The code the app sent back, for tokens. */
export const exchange = (
  fetch: FetchLike,
  app: ConnectorApp,
  keys: AppKeys,
  o: { code: string; redirect: string },
) =>
  tokenCall(fetch, app, keys, {
    grant_type: "authorization_code",
    code: o.code,
    redirect_uri: o.redirect,
  });

/** A fresh access token. QuickBooks and Jobber hand back a new refresh token: keep it. */
export const refresh = (fetch: FetchLike, app: ConnectorApp, keys: AppKeys, token: string) =>
  tokenCall(fetch, app, keys, { grant_type: "refresh_token", refresh_token: token });
