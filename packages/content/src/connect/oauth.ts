/**
 * Each platform's sign-in (designs/2026-10-07-client-social.md): the authorize link, the code's
 * exchange, a refresh, and a who-am-I read. Every call goes through `FetchLike`, so tests never
 * reach the network. Tokens go back to the caller only, never into an error or a log line.
 */
import type { FetchLike } from "@wren/core";
import { OAuthError, pkceChallenge, revokedCode } from "@wren/core/oauth";
import { SOCIAL, type SocialPlatform } from "./platforms.js";
import type { SocialExtra } from "./schema.js";

/** One of Wren's developer apps. */
export interface SocialAppKeys {
  id: string;
  secret: string;
}

export const GRAPH = "https://graph.facebook.com/v23.0";
export const LINKEDIN_API = "https://api.linkedin.com";
export const GOOGLE_API = "https://www.googleapis.com";
export const GBP_ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
/** Business Profile locations (v1) and their posts and reviews (v4). */
export const GBP_INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
export const GBP_API = "https://mybusiness.googleapis.com";
/** LinkedIn's versioned REST API: the month it speaks. */
export const LINKEDIN_VERSION = "202508";
export const X_API = "https://api.x.com";
export const TIKTOK_API = "https://open.tiktokapis.com";

/** The secret a connection keeps in the key store, as JSON. */
export type StoredToken =
  | { kind: "refresh"; refresh: string }
  | { kind: "access"; access: string; expiresAt: string }
  | { kind: "page"; page: string };

/** Who signed in, and what to keep. */
export interface Landed {
  externalId: string;
  name: string | null;
  handle: string | null;
  scopes: string[];
  stored: StoredToken;
  /** A live access token and its seconds, for the in-memory cache. */
  access: string;
  accessFor: number;
  /** When the stored token itself lapses; null when it doesn't. */
  expiresAt: Date | null;
  extra: SocialExtra;
}

/** Where a person signs in to connect one account of `platform`. */
export function connectUrl(
  platform: SocialPlatform,
  app: SocialAppKeys,
  o: { redirect: string; state: string; verifier: string | null },
): string {
  const s = SOCIAL[platform];
  const q = new URLSearchParams({
    redirect_uri: o.redirect,
    state: o.state,
    response_type: "code",
  });
  if (s.app === "tiktok") {
    q.set("client_key", app.id);
    q.set("scope", s.scopes.join(","));
  } else {
    q.set("client_id", app.id);
    q.set("scope", s.scopes.join(s.app === "meta" ? "," : " "));
  }
  if (s.pkce && o.verifier) {
    q.set("code_challenge", pkceChallenge(o.verifier));
    q.set("code_challenge_method", "S256");
  }
  if (s.app === "google") {
    // A refresh token every time, and only the scopes asked now.
    q.set("access_type", "offline");
    q.set("prompt", "consent");
    q.set("include_granted_scopes", "false");
  }
  return `${s.authorize}?${q}`;
}

type Json = Record<string, unknown>;

/** The platform's error code and first line, never the body: a success holds a token. */
function failure(status: number, b: Json): OAuthError {
  const e = b.error;
  const meta = e && typeof e === "object" ? (e as Json) : null;
  const code = meta
    ? Number(meta.code) === 190
      ? "invalid_token"
      : `meta_${String(meta.code ?? status)}`
    : typeof e === "string"
      ? e
      : `http_${status}`;
  const said = String(
    (meta?.message as string | undefined) ?? b.error_description ?? b.message ?? "",
  )
    .split(/\r?\n/)[0]
    ?.slice(0, 160);
  return new OAuthError(
    code,
    said ? `${code}: ${said}` : code,
    revokedCode(code) || status === 401,
  );
}

async function json(fetch: FetchLike, url: string, init: RequestInit): Promise<Json> {
  const res = await fetch(url, init);
  const b = (await res.json().catch(() => ({}))) as Json;
  const e = b.error;
  // TikTok answers `{error: {code: "ok"}}` on success.
  const ok = e == null || e === "" || (typeof e === "object" && (e as Json).code === "ok");
  if (!res.ok || !ok) throw failure(res.status, b);
  return b;
}

const form = (fields: Record<string, string>, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  body: new URLSearchParams(fields).toString(),
});
const bearer = (token: string): RequestInit => ({
  method: "GET",
  headers: { authorization: `Bearer ${token}` },
});
/** LinkedIn's REST reads: its version and Rest.li 2.0. */
const linkedinGet = (token: string): RequestInit => ({
  method: "GET",
  headers: {
    authorization: `Bearer ${token}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  },
});
const basic = (app: SocialAppKeys) => ({
  authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString("base64")}`,
});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const scopesOf = (v: unknown, sep = /[\s,]+/) =>
  String(v ?? "")
    .split(sep)
    .filter(Boolean);

/** The code from the callback: tokens, the account it is, what to keep. */
export async function landCode(
  fetch: FetchLike,
  platform: SocialPlatform,
  app: SocialAppKeys,
  o: { code: string; redirect: string; verifier: string | null; now: Date },
): Promise<Landed> {
  const s = SOCIAL[platform];
  if (s.app === "meta") return landMeta(fetch, platform, app, o);
  if (s.app === "linkedin") {
    const t = await json(
      fetch,
      s.token,
      form({
        grant_type: "authorization_code",
        code: o.code,
        redirect_uri: o.redirect,
        client_id: app.id,
        client_secret: app.secret,
      }),
    );
    const access = String(t.access_token ?? "");
    const secs = Number(t.expires_in ?? 5_184_000);
    const who = await whoAmI(fetch, platform, access, {});
    const expiresAt = new Date(o.now.getTime() + secs * 1000);
    return {
      ...who,
      scopes: scopesOf(t.scope),
      stored: { kind: "access", access, expiresAt: expiresAt.toISOString() },
      access,
      accessFor: secs,
      expiresAt,
      extra: {},
    };
  }
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code: o.code,
    redirect_uri: o.redirect,
    ...(o.verifier && s.pkce ? { code_verifier: o.verifier } : {}),
  };
  const t =
    s.app === "x"
      ? await json(fetch, s.token, form({ ...fields, client_id: app.id }, basic(app)))
      : s.app === "tiktok"
        ? await json(
            fetch,
            s.token,
            form({ ...fields, client_key: app.id, client_secret: app.secret }),
          )
        : await json(
            fetch,
            s.token,
            form({ ...fields, client_id: app.id, client_secret: app.secret }),
          );
  const refresh = str(t.refresh_token);
  if (!refresh)
    throw new OAuthError("no_refresh", "No lasting sign-in came back. Try again.", false);
  const access = String(t.access_token ?? "");
  const who = await whoAmI(fetch, platform, access, {});
  // TikTok says `refresh_expires_in`, LinkedIn's company pages `refresh_token_expires_in`.
  const refreshFor = Number(t.refresh_expires_in ?? t.refresh_token_expires_in ?? 0);
  return {
    ...who,
    scopes: scopesOf(t.scope),
    stored: { kind: "refresh", refresh },
    access,
    accessFor: Number(t.expires_in ?? 3600),
    expiresAt: refreshFor > 0 ? new Date(o.now.getTime() + refreshFor * 1000) : null,
    extra: who.extra ?? {},
  };
}

/**
 * Meta: the code for a user token, that for a long-lived one, and that for the Page's token, which
 * then never lapses. Only the Page's token is kept. Instagram takes the first Page with a linked
 * professional account.
 */
async function landMeta(
  fetch: FetchLike,
  platform: SocialPlatform,
  app: SocialAppKeys,
  o: { code: string; redirect: string },
): Promise<Landed> {
  const s = SOCIAL[platform];
  const q = (p: Record<string, string>) => `${s.token}?${new URLSearchParams(p)}`;
  const short = await json(
    fetch,
    q({
      client_id: app.id,
      client_secret: app.secret,
      redirect_uri: o.redirect,
      code: o.code,
    }),
    { method: "GET" },
  );
  const long = await json(
    fetch,
    q({
      grant_type: "fb_exchange_token",
      client_id: app.id,
      client_secret: app.secret,
      fb_exchange_token: String(short.access_token ?? ""),
    }),
    { method: "GET" },
  );
  const user = String(long.access_token ?? "");
  const perms = await json(fetch, `${GRAPH}/me/permissions`, bearer(user));
  const granted = ((perms.data as Json[] | undefined) ?? [])
    .filter((p) => p.status === "granted")
    .map((p) => String(p.permission));
  const pages = await json(
    fetch,
    `${GRAPH}/me/accounts?fields=${encodeURIComponent("id,name,access_token,instagram_business_account{id,username}")}`,
    bearer(user),
  );
  const list = (pages.data as Json[] | undefined) ?? [];
  const page = platform === "instagram" ? list.find((p) => p.instagram_business_account) : list[0];
  if (!page)
    throw new OAuthError(
      "no_page",
      platform === "instagram"
        ? "No Page with a linked Instagram professional account was shared. Link it, then try again."
        : "No Page was shared. Pick your Page when Facebook asks.",
      false,
    );
  const token = String(page.access_token ?? "");
  const ig = page.instagram_business_account as Json | undefined;
  const pageId = String(page.id);
  const pageName = str(page.name);
  const base = { pageId, ...(pageName ? { pageName } : {}) };
  return platform === "instagram"
    ? {
        externalId: String(ig?.id),
        name: str(ig?.username) ?? pageName,
        handle: str(ig?.username),
        scopes: granted,
        stored: { kind: "page", page: token },
        access: token,
        accessFor: 86_400,
        expiresAt: null,
        extra: { ...base, igUserId: String(ig?.id) },
      }
    : {
        externalId: pageId,
        name: pageName,
        handle: null,
        scopes: granted,
        stored: { kind: "page", page: token },
        access: token,
        accessFor: 86_400,
        expiresAt: null,
        extra: base,
      };
}

/** A fresh access token from what's kept. X and TikTok rotate: `stored` is the new one to keep. */
export async function refreshToken(
  fetch: FetchLike,
  platform: SocialPlatform,
  app: SocialAppKeys,
  kept: StoredToken,
  now: Date,
): Promise<{ access: string; expiresIn: number; stored: StoredToken | null }> {
  if (kept.kind === "page") return { access: kept.page, expiresIn: 86_400, stored: null };
  if (kept.kind === "access") {
    const left = new Date(kept.expiresAt).getTime() - now.getTime();
    if (left <= 0) throw new OAuthError("expired", "Its 60 days ran out. Connect it again.", true);
    return { access: kept.access, expiresIn: Math.floor(left / 1000), stored: null };
  }
  const s = SOCIAL[platform];
  const fields = { grant_type: "refresh_token", refresh_token: kept.refresh };
  const t =
    s.app === "x"
      ? await json(fetch, s.token, form({ ...fields, client_id: app.id }, basic(app)))
      : s.app === "tiktok"
        ? await json(
            fetch,
            s.token,
            form({ ...fields, client_key: app.id, client_secret: app.secret }),
          )
        : await json(
            fetch,
            s.token,
            form({ ...fields, client_id: app.id, client_secret: app.secret }),
          );
  const next = str(t.refresh_token);
  return {
    access: String(t.access_token ?? ""),
    expiresIn: Number(t.expires_in ?? 3600),
    stored: next && next !== kept.refresh ? { kind: "refresh", refresh: next } : null,
  };
}

/**
 * Who the token is: one free read. A Page, Instagram account, company page or Profile location
 * reads itself by id. Signing in, a company page or a Profile takes the first one the person
 * manages, and says it in `extra`.
 */
export async function whoAmI(
  fetch: FetchLike,
  platform: SocialPlatform,
  access: string,
  extra: SocialExtra,
): Promise<{
  externalId: string;
  name: string | null;
  handle: string | null;
  extra?: SocialExtra;
}> {
  switch (platform) {
    case "facebook": {
      const b = await json(fetch, `${GRAPH}/${extra.pageId}?fields=id,name`, bearer(access));
      return { externalId: String(b.id), name: str(b.name), handle: null };
    }
    case "instagram": {
      const b = await json(fetch, `${GRAPH}/${extra.igUserId}?fields=id,username`, bearer(access));
      return { externalId: String(b.id), name: str(b.username), handle: str(b.username) };
    }
    case "linkedin": {
      const b = await json(fetch, `${LINKEDIN_API}/v2/userinfo`, bearer(access));
      return { externalId: String(b.sub), name: str(b.name), handle: null };
    }
    case "youtube": {
      const b = await json(
        fetch,
        `${GOOGLE_API}/youtube/v3/channels?part=snippet&mine=true`,
        bearer(access),
      );
      const ch = ((b.items as Json[] | undefined) ?? [])[0];
      if (!ch)
        throw new OAuthError(
          "no_channel",
          "This Google account has no YouTube channel. Sign in with the one that owns it.",
          false,
        );
      const sn = (ch.snippet as Json | undefined) ?? {};
      // customUrl comes as "@handle"; handles are kept bare, the page adds the "@".
      return {
        externalId: String(ch.id),
        name: str(sn.title),
        handle: str(sn.customUrl)?.replace(/^@/, "") ?? null,
      };
    }
    case "x": {
      const b = await json(fetch, `${X_API}/2/users/me`, bearer(access));
      const d = (b.data as Json | undefined) ?? {};
      return { externalId: String(d.id), name: str(d.name), handle: str(d.username) };
    }
    case "tiktok": {
      const b = await json(
        fetch,
        `${TIKTOK_API}/v2/user/info/?fields=open_id,display_name,username`,
        bearer(access),
      );
      const u = ((b.data as Json | undefined)?.user as Json | undefined) ?? {};
      return {
        externalId: String(u.open_id),
        name: str(u.display_name),
        handle: str(u.username),
      };
    }
    case "linkedin_page": {
      let org = extra.orgUrn;
      if (!org) {
        const acl = await json(
          fetch,
          `${LINKEDIN_API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
          linkedinGet(access),
        );
        const first = ((acl.elements as Json[] | undefined) ?? [])[0];
        org = str(first?.organization) ?? str(first?.organizationalTarget) ?? undefined;
        if (!org)
          throw new OAuthError(
            "no_page",
            "You aren't an admin of a LinkedIn company page. Sign in as one.",
            false,
          );
      }
      const id = org.split(":").pop() ?? "";
      const b = await json(fetch, `${LINKEDIN_API}/rest/organizations/${id}`, linkedinGet(access));
      return {
        externalId: id,
        name: str(b.localizedName),
        handle: str(b.vanityName),
        extra: { orgUrn: org },
      };
    }
    case "google_business": {
      const fields = "readMask=name,title";
      if (extra.location) {
        const at = extra.location.slice(extra.location.indexOf("locations/"));
        const b = await json(fetch, `${GBP_INFO}/${at}?${fields}`, bearer(access));
        return { externalId: extra.location, name: str(b.title), handle: null, extra };
      }
      const b = await json(fetch, GBP_ACCOUNTS, bearer(access));
      const a = ((b.accounts as Json[] | undefined) ?? [])[0];
      if (!a) throw new OAuthError("no_profile", "This Google account manages no Profile.", false);
      const l = await json(
        fetch,
        `${GBP_INFO}/${String(a.name)}/locations?${fields}&pageSize=100`,
        bearer(access),
      );
      const loc = ((l.locations as Json[] | undefined) ?? [])[0];
      if (!loc)
        throw new OAuthError(
          "no_profile",
          "This Google account manages no business location.",
          false,
        );
      const location = `${String(a.name)}/${String(loc.name)}`;
      return {
        externalId: location,
        name: str(loc.title) ?? str(a.accountName),
        handle: null,
        extra: { location },
      };
    }
  }
}
