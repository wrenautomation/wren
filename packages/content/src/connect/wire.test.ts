/**
 * The social sign-in's wire, pinned: every request the module sends (URL, method, headers, form
 * fields) and every result and refusal, for all eight platforms. A fake `fetch` keeps each call.
 * Field order in a form or a query does not count. Synthetic ids and tokens only.
 *
 * This file imports only the module's public functions, so it runs unchanged on whatever the
 * module is built on.
 */
import { shapeOfError, type Wire, wireRecorder } from "@wren/core/wire";
import { describe, expect, it } from "vitest";
import { connectUrl, landCode, refreshToken, whoAmI } from "./oauth.js";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "./platforms.js";

const APP = { id: "app-id", secret: "app-secret" };
const NOW = new Date("2026-10-07T12:00:00Z");
const REDIRECT = "https://app.test/cb";
const VERIFIER = "v".repeat(48);

/** A URL as origin + path and the query as a map. */
const parsed = (url: string) => {
  const u = new URL(url);
  return {
    url: u.origin + u.pathname,
    query: Object.fromEntries([...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
};

describe("connectUrl: all eight platforms", () => {
  const at = (p: SocialPlatform, verifier: string | null) =>
    parsed(connectUrl(p, APP, { redirect: REDIRECT, state: "st", verifier }));

  it("facebook and instagram: the Meta dialog, comma-joined scopes, no PKCE", () => {
    expect(at("facebook", VERIFIER)).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "pages_show_list,pages_read_engagement,pages_manage_posts,pages_read_user_content,pages_manage_engagement,pages_messaging,business_management",
          "state": "st",
        },
        "url": "https://www.facebook.com/v23.0/dialog/oauth",
      }
    `);
    expect(at("instagram", VERIFIER)).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "pages_show_list,pages_read_engagement,pages_manage_posts,pages_read_user_content,pages_manage_engagement,pages_messaging,business_management,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_messages",
          "state": "st",
        },
        "url": "https://www.facebook.com/v23.0/dialog/oauth",
      }
    `);
  });

  it("linkedin and its company page: space-joined scopes, no PKCE", () => {
    expect(at("linkedin", VERIFIER)).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "openid profile email w_member_social",
          "state": "st",
        },
        "url": "https://www.linkedin.com/oauth/v2/authorization",
      }
    `);
    expect(at("linkedin_page", null)).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "r_organization_social w_organization_social rw_organization_admin",
          "state": "st",
        },
        "url": "https://www.linkedin.com/oauth/v2/authorization",
      }
    `);
  });

  it("youtube and google_business: offline, consent, PKCE", () => {
    expect(at("youtube", VERIFIER)).toMatchInlineSnapshot(`
      {
        "query": {
          "access_type": "offline",
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "include_granted_scopes": "false",
          "prompt": "consent",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly",
          "state": "st",
        },
        "url": "https://accounts.google.com/o/oauth2/v2/auth",
      }
    `);
    expect(at("google_business", VERIFIER)).toMatchInlineSnapshot(`
      {
        "query": {
          "access_type": "offline",
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "include_granted_scopes": "false",
          "prompt": "consent",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "https://www.googleapis.com/auth/business.manage",
          "state": "st",
        },
        "url": "https://accounts.google.com/o/oauth2/v2/auth",
      }
    `);
  });

  it("x: PKCE; tiktok: client_key and comma-joined scopes", () => {
    expect(at("x", VERIFIER)).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "tweet.read tweet.write users.read offline.access dm.read dm.write media.write",
          "state": "st",
        },
        "url": "https://x.com/i/oauth2/authorize",
      }
    `);
    expect(at("tiktok", null)).toMatchInlineSnapshot(`
      {
        "query": {
          "client_key": "app-id",
          "redirect_uri": "https://app.test/cb",
          "response_type": "code",
          "scope": "user.info.basic,user.info.stats,video.publish,video.upload,video.list",
          "state": "st",
        },
        "url": "https://www.tiktok.com/v2/auth/authorize/",
      }
    `);
  });

  it("a PKCE platform with no verifier sends no challenge; the others ignore one", () => {
    const keys = (p: SocialPlatform, v: string | null) => Object.keys(at(p, v).query).sort();
    expect(keys("x", null)).not.toContain("code_challenge");
    expect(keys("youtube", null)).not.toContain("code_challenge");
    expect(keys("google_business", null)).not.toContain("code_challenge");
    for (const p of ["facebook", "instagram", "linkedin", "linkedin_page", "tiktok"] as const)
      expect(keys(p, VERIFIER)).not.toContain("code_challenge");
  });

  it("every platform is covered above", () => {
    expect([...SOCIAL_PLATFORMS].sort()).toMatchInlineSnapshot(`
      [
        "facebook",
        "google_business",
        "instagram",
        "linkedin",
        "linkedin_page",
        "tiktok",
        "x",
        "youtube",
      ]
    `);
  });
});

/** One fake that answers every platform's token endpoint and reads, by URL. */
const platformAnswers = (w: Wire): Response | undefined => {
  switch (w.url) {
    case "https://graph.facebook.com/v23.0/oauth/access_token":
      return w.query?.grant_type === "fb_exchange_token"
        ? Response.json({ access_token: "long-user", token_type: "bearer", expires_in: 5_183_999 })
        : Response.json({ access_token: "short-user", token_type: "bearer" });
    case "https://graph.facebook.com/v23.0/me/permissions":
      return Response.json({
        data: [
          { permission: "pages_show_list", status: "granted" },
          { permission: "pages_manage_posts", status: "granted" },
          { permission: "business_management", status: "declined" },
        ],
      });
    case "https://graph.facebook.com/v23.0/me/accounts":
      return Response.json({
        data: [
          { id: "p1", name: "Plain Page", access_token: "page-token-1" },
          {
            id: "p2",
            name: "Shop Page",
            access_token: "page-token-2",
            instagram_business_account: { id: "ig9", username: "shopgram" },
          },
        ],
      });
    case "https://graph.facebook.com/v23.0/p1":
      return Response.json({ id: "p1", name: "Plain Page" });
    case "https://graph.facebook.com/v23.0/ig9":
      return Response.json({ id: "ig9", username: "shopgram" });
    case "https://www.linkedin.com/oauth/v2/accessToken":
      return Response.json(
        w.form?.client_id === "app-id" && w.form?.refresh_token
          ? { access_token: "lp-refreshed", expires_in: 5_184_000 }
          : {
              access_token: "li-access",
              expires_in: 5_184_000,
              scope: "openid,profile,email,w_member_social",
              refresh_token: w.form?.code === "page-code" ? "lp-refresh" : undefined,
              refresh_token_expires_in: w.form?.code === "page-code" ? 31_536_000 : undefined,
            },
      );
    case "https://api.linkedin.com/v2/userinfo":
      return Response.json({ sub: "member-1", name: "Amy Example" });
    case "https://api.linkedin.com/rest/organizationAcls":
      return Response.json({ elements: [{ organization: "urn:li:organization:5" }] });
    case "https://api.linkedin.com/rest/organizations/5":
      return Response.json({ localizedName: "Acme Co", vanityName: "acme" });
    case "https://api.x.com/2/oauth2/token":
      return Response.json({
        access_token: "x-access",
        refresh_token: "x-refresh-2",
        expires_in: 7200,
        scope: "tweet.read tweet.write users.read offline.access",
        token_type: "bearer",
      });
    case "https://api.x.com/2/users/me":
      return Response.json({ data: { id: "u1", name: "Acme", username: "acme" } });
    case "https://open.tiktokapis.com/v2/oauth/token/":
      return Response.json({
        access_token: "tt-access",
        refresh_token: "tt-refresh-2",
        expires_in: 86_400,
        refresh_expires_in: 31_536_000,
        scope: "user.info.basic,video.publish",
        open_id: "o1",
      });
    case "https://open.tiktokapis.com/v2/user/info/":
      return Response.json({
        data: {
          user: { open_id: "o1", display_name: "Wren", avatar_url: "https://cdn.example/a.jpeg" },
        },
        error: { code: "ok", message: "", log_id: "l1" },
      });
    case "https://oauth2.googleapis.com/token":
      return Response.json({
        access_token: "g-access",
        refresh_token: w.form?.grant_type === "refresh_token" ? undefined : "g-refresh",
        expires_in: 3599,
        scope: "https://www.googleapis.com/auth/youtube.upload openid",
      });
    case "https://www.googleapis.com/youtube/v3/channels":
      return Response.json({
        items: [{ id: "UC1", snippet: { title: "Acme", customUrl: "@acme" } }],
      });
    case "https://mybusinessaccountmanagement.googleapis.com/v1/accounts":
      return Response.json({ accounts: [{ name: "accounts/1", accountName: "Acme Co" }] });
    case "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations":
      return Response.json({ locations: [{ name: "locations/2", title: "Acme Downtown" }] });
    default:
      return undefined;
  }
};

describe("landCode: the requests and the result, per platform", () => {
  const land = async (platform: SocialPlatform, code = "code-1") => {
    const r = wireRecorder(platformAnswers);
    const landed = await landCode(r.fetch, platform, APP, {
      code,
      redirect: REDIRECT,
      verifier: VERIFIER,
      now: NOW,
    });
    return { calls: r.calls, landed };
  };

  it("facebook: the first Page; its token is the one kept", async () => {
    expect(await land("facebook")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {},
            "method": "GET",
            "query": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "redirect_uri": "https://app.test/cb",
            },
            "url": "https://graph.facebook.com/v23.0/oauth/access_token",
          },
          {
            "headers": {},
            "method": "GET",
            "query": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "fb_exchange_token": "short-user",
              "grant_type": "fb_exchange_token",
            },
            "url": "https://graph.facebook.com/v23.0/oauth/access_token",
          },
          {
            "headers": {
              "authorization": "Bearer long-user",
            },
            "method": "GET",
            "url": "https://graph.facebook.com/v23.0/me/permissions",
          },
          {
            "headers": {
              "authorization": "Bearer long-user",
            },
            "method": "GET",
            "query": {
              "fields": "id,name,access_token,instagram_business_account{id,username}",
            },
            "url": "https://graph.facebook.com/v23.0/me/accounts",
          },
        ],
        "landed": {
          "access": "page-token-1",
          "accessFor": 86400,
          "expiresAt": null,
          "externalId": "p1",
          "extra": {
            "pageId": "p1",
            "pageName": "Plain Page",
          },
          "handle": null,
          "name": "Plain Page",
          "scopes": [
            "pages_show_list",
            "pages_manage_posts",
          ],
          "stored": {
            "kind": "page",
            "page": "page-token-1",
          },
        },
      }
    `);
  });

  it("instagram: the first Page with a linked professional account", async () => {
    expect(await land("instagram")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {},
            "method": "GET",
            "query": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "redirect_uri": "https://app.test/cb",
            },
            "url": "https://graph.facebook.com/v23.0/oauth/access_token",
          },
          {
            "headers": {},
            "method": "GET",
            "query": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "fb_exchange_token": "short-user",
              "grant_type": "fb_exchange_token",
            },
            "url": "https://graph.facebook.com/v23.0/oauth/access_token",
          },
          {
            "headers": {
              "authorization": "Bearer long-user",
            },
            "method": "GET",
            "url": "https://graph.facebook.com/v23.0/me/permissions",
          },
          {
            "headers": {
              "authorization": "Bearer long-user",
            },
            "method": "GET",
            "query": {
              "fields": "id,name,access_token,instagram_business_account{id,username}",
            },
            "url": "https://graph.facebook.com/v23.0/me/accounts",
          },
        ],
        "landed": {
          "access": "page-token-2",
          "accessFor": 86400,
          "expiresAt": null,
          "externalId": "ig9",
          "extra": {
            "igUserId": "ig9",
            "pageId": "p2",
            "pageName": "Shop Page",
          },
          "handle": "shopgram",
          "name": "shopgram",
          "scopes": [
            "pages_show_list",
            "pages_manage_posts",
          ],
          "stored": {
            "kind": "page",
            "page": "page-token-2",
          },
        },
      }
    `);
  });

  it("linkedin: an access-only token kept with its end", async () => {
    expect(await land("linkedin")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/cb",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://www.linkedin.com/oauth/v2/accessToken",
          },
          {
            "headers": {
              "authorization": "Bearer li-access",
            },
            "method": "GET",
            "url": "https://api.linkedin.com/v2/userinfo",
          },
        ],
        "landed": {
          "access": "li-access",
          "accessFor": 5184000,
          "expiresAt": 2026-12-06T12:00:00.000Z,
          "externalId": "member-1",
          "extra": {},
          "handle": null,
          "name": "Amy Example",
          "scopes": [
            "openid",
            "profile",
            "email",
            "w_member_social",
          ],
          "stored": {
            "access": "li-access",
            "expiresAt": "2026-12-06T12:00:00.000Z",
            "kind": "access",
          },
        },
      }
    `);
  });

  it("linkedin_page: a year-long refresh token and the company page", async () => {
    expect(await land("linkedin_page", "page-code")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "page-code",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/cb",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://www.linkedin.com/oauth/v2/accessToken",
          },
          {
            "headers": {
              "authorization": "Bearer li-access",
              "linkedin-version": "202609",
              "x-restli-protocol-version": "2.0.0",
            },
            "method": "GET",
            "query": {
              "q": "roleAssignee",
              "role": "ADMINISTRATOR",
              "state": "APPROVED",
            },
            "url": "https://api.linkedin.com/rest/organizationAcls",
          },
          {
            "headers": {
              "authorization": "Bearer li-access",
              "linkedin-version": "202609",
              "x-restli-protocol-version": "2.0.0",
            },
            "method": "GET",
            "url": "https://api.linkedin.com/rest/organizations/5",
          },
        ],
        "landed": {
          "access": "li-access",
          "accessFor": 5184000,
          "expiresAt": 2027-10-07T12:00:00.000Z,
          "externalId": "5",
          "extra": {
            "orgUrn": "urn:li:organization:5",
          },
          "handle": "acme",
          "name": "Acme Co",
          "scopes": [
            "openid",
            "profile",
            "email",
            "w_member_social",
          ],
          "stored": {
            "kind": "refresh",
            "refresh": "lp-refresh",
          },
        },
      }
    `);
  });

  it("x: Basic auth, the id and the verifier in the form", async () => {
    expect(await land("x")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "code": "code-1",
              "code_verifier": "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/cb",
            },
            "headers": {
              "authorization": "Basic YXBwLWlkOmFwcC1zZWNyZXQ=",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://api.x.com/2/oauth2/token",
          },
          {
            "headers": {
              "authorization": "Bearer x-access",
            },
            "method": "GET",
            "url": "https://api.x.com/2/users/me",
          },
        ],
        "landed": {
          "access": "x-access",
          "accessFor": 7200,
          "expiresAt": null,
          "externalId": "u1",
          "extra": {},
          "handle": "acme",
          "name": "Acme",
          "scopes": [
            "tweet.read",
            "tweet.write",
            "users.read",
            "offline.access",
          ],
          "stored": {
            "kind": "refresh",
            "refresh": "x-refresh-2",
          },
        },
      }
    `);
  });

  it("tiktok: client_key and client_secret, no verifier", async () => {
    expect(await land("tiktok")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_key": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/cb",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://open.tiktokapis.com/v2/oauth/token/",
          },
          {
            "headers": {
              "authorization": "Bearer tt-access",
            },
            "method": "GET",
            "query": {
              "fields": "open_id,display_name,avatar_url",
            },
            "url": "https://open.tiktokapis.com/v2/user/info/",
          },
        ],
        "landed": {
          "access": "tt-access",
          "accessFor": 86400,
          "expiresAt": 2027-10-07T12:00:00.000Z,
          "externalId": "o1",
          "extra": {
            "avatarUrl": "https://cdn.example/a.jpeg",
          },
          "handle": null,
          "name": "Wren",
          "scopes": [
            "user.info.basic",
            "video.publish",
          ],
          "stored": {
            "kind": "refresh",
            "refresh": "tt-refresh-2",
          },
        },
      }
    `);
  });

  it("youtube: Google's token form with the verifier", async () => {
    expect(await land("youtube")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "code_verifier": "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/cb",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://oauth2.googleapis.com/token",
          },
          {
            "headers": {
              "authorization": "Bearer g-access",
            },
            "method": "GET",
            "query": {
              "mine": "true",
              "part": "snippet",
            },
            "url": "https://www.googleapis.com/youtube/v3/channels",
          },
        ],
        "landed": {
          "access": "g-access",
          "accessFor": 3599,
          "expiresAt": null,
          "externalId": "UC1",
          "extra": {},
          "handle": "acme",
          "name": "Acme",
          "scopes": [
            "https://www.googleapis.com/auth/youtube.upload",
            "openid",
          ],
          "stored": {
            "kind": "refresh",
            "refresh": "g-refresh",
          },
        },
      }
    `);
  });

  it("google_business: the first account's first location", async () => {
    expect(await land("google_business")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "code_verifier": "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/cb",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://oauth2.googleapis.com/token",
          },
          {
            "headers": {
              "authorization": "Bearer g-access",
            },
            "method": "GET",
            "url": "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
          },
          {
            "headers": {
              "authorization": "Bearer g-access",
            },
            "method": "GET",
            "query": {
              "pageSize": "100",
              "readMask": "name,title",
            },
            "url": "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations",
          },
        ],
        "landed": {
          "access": "g-access",
          "accessFor": 3599,
          "expiresAt": null,
          "externalId": "accounts/1/locations/2",
          "extra": {
            "location": "accounts/1/locations/2",
          },
          "handle": null,
          "name": "Acme Downtown",
          "scopes": [
            "https://www.googleapis.com/auth/youtube.upload",
            "openid",
          ],
          "stored": {
            "kind": "refresh",
            "refresh": "g-refresh",
          },
        },
      }
    `);
  });
});

describe("landCode: refusals", () => {
  const refuse = async (
    platform: SocialPlatform,
    answers: (w: Wire) => Response | undefined,
    code = "c",
  ) => {
    const r = wireRecorder((w) => answers(w) ?? platformAnswers(w));
    const err = await landCode(r.fetch, platform, APP, {
      code,
      redirect: REDIRECT,
      verifier: VERIFIER,
      now: NOW,
    }).catch((e: unknown) => e);
    return { error: shapeOfError(err), calls: r.calls.length };
  };

  it("Meta with no Page, with and without a linked Instagram account", async () => {
    const none = (w: Wire) =>
      w.url.endsWith("/me/accounts") ? Response.json({ data: [] }) : undefined;
    const unlinked = (w: Wire) =>
      w.url.endsWith("/me/accounts")
        ? Response.json({ data: [{ id: "p1", access_token: "t" }] })
        : undefined;
    expect(await refuse("facebook", none)).toMatchInlineSnapshot(`
      {
        "calls": 4,
        "error": {
          "class": "OAuthError",
          "code": "no_page",
          "isError": true,
          "message": "No Page was shared. Pick your Page when Facebook asks.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
    expect(await refuse("instagram", unlinked)).toMatchInlineSnapshot(`
      {
        "calls": 4,
        "error": {
          "class": "OAuthError",
          "code": "no_page",
          "isError": true,
          "message": "No Page with a linked Instagram professional account was shared. Link it, then try again.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
  });

  it("no refresh token for a refresh-token platform", async () => {
    const noRefresh = (w: Wire) =>
      w.url === "https://api.x.com/2/oauth2/token"
        ? Response.json({ access_token: "x-access", expires_in: 7200 })
        : undefined;
    expect(await refuse("x", noRefresh)).toMatchInlineSnapshot(`
      {
        "calls": 1,
        "error": {
          "class": "OAuthError",
          "code": "no_refresh",
          "isError": true,
          "message": "No lasting sign-in came back. Try again.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
  });

  it("a LinkedIn member who admins no company page", async () => {
    const none = (w: Wire) =>
      w.url.endsWith("/rest/organizationAcls") ? Response.json({ elements: [] }) : undefined;
    expect(await refuse("linkedin_page", none, "page-code")).toMatchInlineSnapshot(`
      {
        "calls": 2,
        "error": {
          "class": "OAuthError",
          "code": "no_page",
          "isError": true,
          "message": "You aren't an admin of a LinkedIn company page. Sign in as one.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
  });

  it("a Google account with no YouTube channel, and one with no Profile", async () => {
    const noChannel = (w: Wire) =>
      w.url.endsWith("/youtube/v3/channels") ? Response.json({ items: [] }) : undefined;
    const noProfile = (w: Wire) =>
      w.url.endsWith("/v1/accounts") ? Response.json({ accounts: [] }) : undefined;
    const noLocation = (w: Wire) =>
      w.url.endsWith("/accounts/1/locations") ? Response.json({ locations: [] }) : undefined;
    expect(await refuse("youtube", noChannel)).toMatchInlineSnapshot(`
      {
        "calls": 2,
        "error": {
          "class": "OAuthError",
          "code": "no_channel",
          "isError": true,
          "message": "This Google account has no YouTube channel. Sign in with the one that owns it.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
    expect(await refuse("google_business", noProfile)).toMatchInlineSnapshot(`
      {
        "calls": 2,
        "error": {
          "class": "OAuthError",
          "code": "no_profile",
          "isError": true,
          "message": "This Google account manages no Profile.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
    expect(await refuse("google_business", noLocation)).toMatchInlineSnapshot(`
      {
        "calls": 3,
        "error": {
          "class": "OAuthError",
          "code": "no_profile",
          "isError": true,
          "message": "This Google account manages no business location.",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
  });

  it("a token endpoint's refusal: the code and its first line, never the body", async () => {
    const bad = () =>
      Response.json(
        {
          error: "invalid_grant",
          error_description: "bad code\nsecond line",
          access_token: "tok-SECRET-1234",
        },
        { status: 400 },
      );
    const out = await refuse("youtube", bad);
    expect(out).toMatchInlineSnapshot(`
      {
        "calls": 1,
        "error": {
          "class": "OAuthError",
          "code": "invalid_grant",
          "isError": true,
          "message": "invalid_grant: bad code",
          "name": "OAuthError",
          "revoked": true,
        },
      }
    `);
    expect(JSON.stringify(out)).not.toContain("tok-SECRET-1234");
  });
});

describe("error mapping", () => {
  const whoWith = async (status: number, body: unknown) => {
    const r = wireRecorder(() => Response.json(body, { status }));
    const out = await whoAmI(r.fetch, "facebook", "t", { pageId: "p1" }).catch((e: unknown) => e);
    return out instanceof Error ? shapeOfError(out) : out;
  };

  it("Meta code 190 is a revoked token", async () => {
    expect(
      await whoWith(400, { error: { code: 190, message: "Session expired" } }),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_token",
        "isError": true,
        "message": "invalid_token: Session expired",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
  });

  it("another Meta code is meta_<code> and not revoked; no code falls back to the status", async () => {
    expect(
      await whoWith(400, { error: { code: 100, message: "Invalid parameter" } }),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "meta_100",
        "isError": true,
        "message": "meta_100: Invalid parameter",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
    expect(await whoWith(500, { error: { message: "oops" } })).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "meta_500",
        "isError": true,
        "message": "meta_500: oops",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });

  it("an HTTP 401 is revoked whatever it says", async () => {
    expect(await whoWith(401, {})).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "http_401",
        "isError": true,
        "message": "http_401",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
    expect(await whoWith(401, { error: "server_error" })).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "server_error",
        "isError": true,
        "message": "server_error",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
  });

  it("a plain error string, with its description, first line only and cut at 160", async () => {
    expect(
      await whoWith(400, { error: "invalid_request", error_description: "bad\nsecond" }),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_request",
        "isError": true,
        "message": "invalid_request: bad",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
    const long = (await whoWith(400, {
      error: "invalid_request",
      error_description: "y".repeat(300),
    })) as {
      message: string;
    };
    expect(long.message).toBe(`invalid_request: ${"y".repeat(160)}`);
  });

  it("no body at all: http_<status>", async () => {
    expect(await whoWith(502, {})).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "http_502",
        "isError": true,
        "message": "http_502",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });

  it("TikTok's {error: {code: ok}} is success; another code is a refusal", async () => {
    const ok = wireRecorder(platformAnswers);
    expect(await whoAmI(ok.fetch, "tiktok", "tok", {})).toMatchInlineSnapshot(`
      {
        "externalId": "o1",
        "extra": {
          "avatarUrl": "https://cdn.example/a.jpeg",
        },
        "handle": null,
        "name": "Wren",
      }
    `);
    const bad = wireRecorder(() =>
      Response.json({ error: { code: "access_token_invalid", message: "expired" } }),
    );
    expect(
      shapeOfError(await whoAmI(bad.fetch, "tiktok", "tok", {}).catch((e: unknown) => e)),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "meta_access_token_invalid",
        "isError": true,
        "message": "meta_access_token_invalid: expired",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });
});

describe("whoAmI: the reads, per platform", () => {
  const who = async (platform: SocialPlatform, extra = {}) => {
    const r = wireRecorder(platformAnswers);
    const out = await whoAmI(r.fetch, platform, "access-1", extra);
    return { calls: r.calls, out };
  };

  it("a Page, an Instagram account and a company page read themselves by id", async () => {
    expect(await who("facebook", { pageId: "p1" })).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "query": {
              "fields": "id,name",
            },
            "url": "https://graph.facebook.com/v23.0/p1",
          },
        ],
        "out": {
          "externalId": "p1",
          "handle": null,
          "name": "Plain Page",
        },
      }
    `);
    expect(await who("instagram", { igUserId: "ig9" })).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "query": {
              "fields": "id,username",
            },
            "url": "https://graph.facebook.com/v23.0/ig9",
          },
        ],
        "out": {
          "externalId": "ig9",
          "handle": "shopgram",
          "name": "shopgram",
        },
      }
    `);
    expect(await who("linkedin_page", { orgUrn: "urn:li:organization:5" })).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
              "linkedin-version": "202609",
              "x-restli-protocol-version": "2.0.0",
            },
            "method": "GET",
            "url": "https://api.linkedin.com/rest/organizations/5",
          },
        ],
        "out": {
          "externalId": "5",
          "extra": {
            "orgUrn": "urn:li:organization:5",
          },
          "handle": "acme",
          "name": "Acme Co",
        },
      }
    `);
  });

  it("a member, a channel, an X account and a TikTok account", async () => {
    expect(await who("linkedin")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "url": "https://api.linkedin.com/v2/userinfo",
          },
        ],
        "out": {
          "externalId": "member-1",
          "handle": null,
          "name": "Amy Example",
        },
      }
    `);
    expect(await who("youtube")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "query": {
              "mine": "true",
              "part": "snippet",
            },
            "url": "https://www.googleapis.com/youtube/v3/channels",
          },
        ],
        "out": {
          "externalId": "UC1",
          "handle": "acme",
          "name": "Acme",
        },
      }
    `);
    expect(await who("x")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "url": "https://api.x.com/2/users/me",
          },
        ],
        "out": {
          "externalId": "u1",
          "handle": "acme",
          "name": "Acme",
        },
      }
    `);
    expect(await who("tiktok")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "query": {
              "fields": "open_id,display_name,avatar_url",
            },
            "url": "https://open.tiktokapis.com/v2/user/info/",
          },
        ],
        "out": {
          "externalId": "o1",
          "extra": {
            "avatarUrl": "https://cdn.example/a.jpeg",
          },
          "handle": null,
          "name": "Wren",
        },
      }
    `);
  });

  it("a Business Profile: a known location reads itself, an unknown one is found", async () => {
    const known = wireRecorder(() => Response.json({ title: "Acme Downtown" }));
    expect({
      out: await whoAmI(known.fetch, "google_business", "access-1", {
        location: "accounts/1/locations/2",
      }),
      calls: known.calls,
    }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "query": {
              "readMask": "name,title",
            },
            "url": "https://mybusinessbusinessinformation.googleapis.com/v1/locations/2",
          },
        ],
        "out": {
          "externalId": "accounts/1/locations/2",
          "extra": {
            "location": "accounts/1/locations/2",
          },
          "handle": null,
          "name": "Acme Downtown",
        },
      }
    `);
    expect(await who("google_business")).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "url": "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
          },
          {
            "headers": {
              "authorization": "Bearer access-1",
            },
            "method": "GET",
            "query": {
              "pageSize": "100",
              "readMask": "name,title",
            },
            "url": "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations",
          },
        ],
        "out": {
          "externalId": "accounts/1/locations/2",
          "extra": {
            "location": "accounts/1/locations/2",
          },
          "handle": null,
          "name": "Acme Downtown",
        },
      }
    `);
  });

  it("TikTok keeps an https avatar and drops any other", async () => {
    const avatar = (avatar_url: string) =>
      wireRecorder(() =>
        Response.json({ data: { user: { open_id: "o1", display_name: "W", avatar_url } } }),
      );
    const http = avatar("http://cdn.example/a.jpeg");
    expect((await whoAmI(http.fetch, "tiktok", "t", {})).extra).toBeUndefined();
    const https = avatar("https://cdn.example/a.jpeg");
    expect((await whoAmI(https.fetch, "tiktok", "t", {})).extra).toEqual({
      avatarUrl: "https://cdn.example/a.jpeg",
    });
  });
});

describe("refreshToken: each stored kind", () => {
  const refreshWith = async (
    platform: SocialPlatform,
    kept: Parameters<typeof refreshToken>[3],
    answers?: (w: Wire) => Response | undefined,
  ) => {
    const r = wireRecorder((w) => answers?.(w) ?? platformAnswers(w));
    const out = await refreshToken(r.fetch, platform, APP, kept, NOW).catch((e: unknown) => e);
    return { calls: r.calls, out: out instanceof Error ? shapeOfError(out) : out };
  };

  it("a Page token needs no call and answers a day", async () => {
    expect(
      await refreshWith("facebook", { kind: "page", page: "page-token-1" }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [],
        "out": {
          "access": "page-token-1",
          "expiresIn": 86400,
          "stored": null,
        },
      }
    `);
  });

  it("an access-only token answers what is left, and its lapse says connect again", async () => {
    expect(
      await refreshWith("linkedin", {
        kind: "access",
        access: "li-access",
        expiresAt: "2026-10-08T12:00:00.000Z",
      }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [],
        "out": {
          "access": "li-access",
          "expiresIn": 86400,
          "stored": null,
        },
      }
    `);
    expect(
      await refreshWith("linkedin", {
        kind: "access",
        access: "li-access",
        expiresAt: "2026-10-01T00:00:00.000Z",
      }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [],
        "out": {
          "class": "OAuthError",
          "code": "expired",
          "isError": true,
          "message": "Its 60 days ran out. Connect it again.",
          "name": "OAuthError",
          "revoked": true,
        },
      }
    `);
  });

  it("x rotates: Basic auth, and the new refresh token is the one to keep", async () => {
    expect(
      await refreshWith("x", { kind: "refresh", refresh: "x-refresh-1" }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "grant_type": "refresh_token",
              "refresh_token": "x-refresh-1",
            },
            "headers": {
              "authorization": "Basic YXBwLWlkOmFwcC1zZWNyZXQ=",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://api.x.com/2/oauth2/token",
          },
        ],
        "out": {
          "access": "x-access",
          "expiresIn": 7200,
          "stored": {
            "kind": "refresh",
            "refresh": "x-refresh-2",
          },
        },
      }
    `);
  });

  it("tiktok rotates: client_key and client_secret in the form", async () => {
    expect(
      await refreshWith("tiktok", { kind: "refresh", refresh: "tt-refresh-1" }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_key": "app-id",
              "client_secret": "app-secret",
              "grant_type": "refresh_token",
              "refresh_token": "tt-refresh-1",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://open.tiktokapis.com/v2/oauth/token/",
          },
        ],
        "out": {
          "access": "tt-access",
          "expiresIn": 86400,
          "stored": {
            "kind": "refresh",
            "refresh": "tt-refresh-2",
          },
        },
      }
    `);
  });

  it("google keeps its refresh token: nothing new to store", async () => {
    expect(
      await refreshWith("youtube", { kind: "refresh", refresh: "g-refresh" }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "grant_type": "refresh_token",
              "refresh_token": "g-refresh",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://oauth2.googleapis.com/token",
          },
        ],
        "out": {
          "access": "g-access",
          "expiresIn": 3599,
          "stored": null,
        },
      }
    `);
  });

  it("a company page's refresh, answered with the same token or none, stores nothing", async () => {
    expect(
      await refreshWith("linkedin_page", { kind: "refresh", refresh: "lp-refresh" }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "grant_type": "refresh_token",
              "refresh_token": "lp-refresh",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://www.linkedin.com/oauth/v2/accessToken",
          },
        ],
        "out": {
          "access": "lp-refreshed",
          "expiresIn": 5184000,
          "stored": null,
        },
      }
    `);
    const same = () =>
      Response.json({ access_token: "a", refresh_token: "g-refresh", expires_in: 60 });
    expect(
      await refreshWith("google_business", { kind: "refresh", refresh: "g-refresh" }, same),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "grant_type": "refresh_token",
              "refresh_token": "g-refresh",
            },
            "headers": {
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://oauth2.googleapis.com/token",
          },
        ],
        "out": {
          "access": "a",
          "expiresIn": 60,
          "stored": null,
        },
      }
    `);
  });

  it("a revoked refresh token is named, and the answer's token never shows", async () => {
    const revoked = () =>
      Response.json(
        {
          error: "invalid_grant",
          error_description: "Token revoked",
          access_token: "tok-SECRET-1234",
        },
        { status: 400 },
      );
    const out = await refreshWith("x", { kind: "refresh", refresh: "x-refresh-1" }, revoked);
    expect(out.out).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_grant",
        "isError": true,
        "message": "invalid_grant: Token revoked",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
    expect(JSON.stringify(out.out)).not.toContain("tok-SECRET-1234");
  });

  it("a missing expires_in answers an hour", async () => {
    const bare = () => Response.json({ access_token: "a" });
    expect(
      await refreshWith("x", { kind: "refresh", refresh: "x-refresh-1" }, bare),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "grant_type": "refresh_token",
              "refresh_token": "x-refresh-1",
            },
            "headers": {
              "authorization": "Basic YXBwLWlkOmFwcC1zZWNyZXQ=",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://api.x.com/2/oauth2/token",
          },
        ],
        "out": {
          "access": "a",
          "expiresIn": 3600,
          "stored": null,
        },
      }
    `);
  });
});
