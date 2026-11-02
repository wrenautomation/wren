/**
 * Each platform's sign-in (designs/2026-10-07-client-social.md): what a token answer means to
 * Wren. The wire (the authorize link, the code's exchange, a refresh, Meta's user token and
 * Pages, the who-am-I read) is `@wrenautomation/autobrowse/oauth`; this file keeps which Page
 * to pick, what to store and when it lapses. Every call goes through `FetchLike`, so tests
 * never reach the network. Tokens go back to the caller only, never into an error or a log line.
 */
import { type FetchLike, optionalInit } from "@wren/core";
import {
  authorizeUrl,
  exchangeCode,
  metaPages,
  metaUserToken,
  OAuthError,
  type OAuthProvider,
  whoAmI as pieceWhoAmI,
  refreshGrant,
  SOCIAL_PROVIDER,
} from "@wrenautomation/autobrowse/oauth";
import { SOCIAL, type SocialPlatform } from "./platforms.js";
import type { SocialExtra } from "./schema.js";

/** Who the token is: the piece's read, over wren's `FetchLike`. */
export function whoAmI(
  fetch: FetchLike,
  platform: SocialPlatform,
  access: string,
  extra: SocialExtra,
) {
  return pieceWhoAmI(optionalInit(fetch), platform, access, extra);
}

/** One of Wren's developer apps. */
export interface SocialAppKeys {
  id: string;
  secret: string;
}

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
  return authorizeUrl(SOCIAL_PROVIDER[platform], app.id, {
    redirect: o.redirect,
    state: o.state,
    scopes: SOCIAL[platform].scopes,
    verifier: o.verifier,
  });
}

type Json = Record<string, unknown>;

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
  const provider = SOCIAL_PROVIDER[platform];
  if (provider === "meta") return landMeta(fetch, platform, app, o);
  const t = await exchangeCode(optionalInit(fetch), provider, app, {
    code: o.code,
    redirect: o.redirect,
    verifier: o.verifier,
  });
  if (s.app === "linkedin") {
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
  const long = await metaUserToken(optionalInit(fetch), app, {
    code: o.code,
    redirect: o.redirect,
  });
  const { granted, pages: list } = await metaPages(
    optionalInit(fetch),
    String(long.access_token ?? ""),
  );
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
  // A Meta connection keeps a Page token and returned above; the cast only drops Meta from the type.
  const provider = SOCIAL_PROVIDER[platform] as Exclude<OAuthProvider, "meta">;
  const t = await refreshGrant(optionalInit(fetch), provider, app, kept.refresh);
  const next = str(t.refresh_token);
  return {
    access: String(t.access_token ?? ""),
    expiresIn: Number(t.expires_in ?? 3600),
    stored: next && next !== kept.refresh ? { kind: "refresh", refresh: next } : null,
  };
}
