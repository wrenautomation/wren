// Client social access, pure parts: the platform table, each sign-in with a fake platform, the
// states the page shows and the calls a connected account makes. Synthetic ids; no network.

import { OAuthError } from "@wren/core/oauth";
import { describe, expect, it } from "vitest";
import { connectionIdOf, loginOf, platformStates, socialAppsFrom, tokenName } from "./access.js";
import { connectUrl, landCode, refreshToken, whoAmI } from "./oauth.js";
import { liveFrom, SOCIAL, SOCIAL_PLATFORMS } from "./platforms.js";
import type { SocialConnectionRow } from "./schema.js";
import { socialSites, X_CHUNK } from "./sites.js";

const APP = { id: "app-id", secret: "app-secret" };
const NOW = new Date("2026-10-07T12:00:00Z");
const SECRET = "tok-SECRET-1234";

type Route = (url: string, init?: RequestInit) => Response | undefined;
const fakeFetch = (route: Route) => {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    asked.push({ url, ...(init ? { init } : {}) });
    return route(url, init) ?? new Response("{}", { status: 404 });
  };
  return { fetch, asked };
};

describe("platforms", () => {
  it("X and a LinkedIn profile are always live; others when named", () => {
    expect([...liveFrom("")].sort()).toEqual(["linkedin", "x"]);
    expect(liveFrom("facebook, bogus,instagram").has("instagram")).toBe(true);
    expect(liveFrom(undefined).has("facebook")).toBe(false);
  });

  it("every platform says what the client does and what Wren's team does", () => {
    for (const p of SOCIAL_PLATFORMS) {
      expect(SOCIAL[p].selfServe).not.toMatch(/—/);
      expect(SOCIAL[p].forYou.length).toBeGreaterThan(10);
    }
  });

  it("a login names its connection", () => {
    expect(connectionIdOf(loginOf(42))).toBe(42);
    expect(connectionIdOf("x@wren")).toBeNull();
    expect(tokenName("x", "123")).toMatch(/^SOCIAL_X_[0-9A-F]{16}$/);
  });
});

describe("connectUrl", () => {
  it("X asks with PKCE and space-separated scopes", () => {
    const u = new URL(
      connectUrl("x", APP, {
        redirect: "https://app.test/cb",
        state: "st",
        verifier: "v".repeat(50),
      }),
    );
    expect(u.origin + u.pathname).toBe(SOCIAL.x.authorize);
    expect(u.searchParams.get("client_id")).toBe("app-id");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("dm.write offline.access".split(" ")[0]);
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("TikTok names its client_key; Google asks offline; Meta joins with commas", () => {
    const t = new URL(connectUrl("tiktok", APP, { redirect: "r", state: "s", verifier: null }));
    expect(t.searchParams.get("client_key")).toBe("app-id");
    const g = new URL(connectUrl("youtube", APP, { redirect: "r", state: "s", verifier: "v" }));
    expect(g.searchParams.get("access_type")).toBe("offline");
    expect(g.searchParams.get("prompt")).toBe("consent");
    const m = new URL(connectUrl("facebook", APP, { redirect: "r", state: "s", verifier: null }));
    expect(m.searchParams.get("scope")).toContain("pages_manage_posts,");
    expect(m.searchParams.get("code_challenge")).toBeNull();
  });
});

describe("landCode", () => {
  it("Meta: code, long-lived user token, then the Page's token is the one kept", async () => {
    const { fetch, asked } = fakeFetch((url) => {
      if (url.includes("fb_exchange_token")) return Response.json({ access_token: "long-user" });
      if (url.includes("/oauth/access_token")) return Response.json({ access_token: "short" });
      if (url.includes("/me/permissions"))
        return Response.json({ data: [{ permission: "pages_manage_posts", status: "granted" }] });
      if (url.includes("/me/accounts"))
        return Response.json({
          data: [
            { id: "p1", name: "Plain Page", access_token: "page-1" },
            {
              id: "p2",
              name: "Shop Page",
              access_token: SECRET,
              instagram_business_account: { id: "ig9", username: "shop" },
            },
          ],
        });
      return undefined;
    });
    const fb = await landCode(fetch, "facebook", APP, {
      code: "c",
      redirect: "r",
      verifier: null,
      now: NOW,
    });
    expect(fb).toMatchObject({
      externalId: "p1",
      stored: { kind: "page", page: "page-1" },
      expiresAt: null,
      extra: { pageId: "p1" },
    });
    const ig = await landCode(fetch, "instagram", APP, {
      code: "c",
      redirect: "r",
      verifier: null,
      now: NOW,
    });
    expect(ig).toMatchObject({
      externalId: "ig9",
      handle: "shop",
      extra: { pageId: "p2", igUserId: "ig9" },
    });
    expect(asked.some((a) => a.url.includes("fb_exchange_token"))).toBe(true);
  });

  it("Instagram without a linked account says what to do", async () => {
    const { fetch } = fakeFetch((url) =>
      url.includes("/me/accounts")
        ? Response.json({ data: [{ id: "p1", access_token: "x" }] })
        : url.includes("/me/permissions")
          ? Response.json({ data: [] })
          : Response.json({ access_token: "t" }),
    );
    await expect(
      landCode(fetch, "instagram", APP, { code: "c", redirect: "r", verifier: null, now: NOW }),
    ).rejects.toThrow(/linked Instagram/);
  });

  it("X keeps the refresh token and sends the verifier with Basic auth", async () => {
    const { fetch, asked } = fakeFetch((url) => {
      if (url === SOCIAL.x.token)
        return Response.json({
          access_token: "acc",
          refresh_token: SECRET,
          expires_in: 7200,
          scope: "tweet.read dm.write",
        });
      if (url.endsWith("/2/users/me"))
        return Response.json({ data: { id: "u1", name: "Acme", username: "acme" } });
      return undefined;
    });
    const l = await landCode(fetch, "x", APP, {
      code: "c",
      redirect: "r",
      verifier: "ver",
      now: NOW,
    });
    expect(l).toMatchObject({
      externalId: "u1",
      handle: "acme",
      stored: { kind: "refresh", refresh: SECRET },
      scopes: ["tweet.read", "dm.write"],
    });
    const init = asked[0]?.init;
    expect(String(init?.body)).toContain("code_verifier=ver");
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toMatch(/^Basic /);
  });

  it("LinkedIn keeps its 60-day access token with its end", async () => {
    const { fetch } = fakeFetch((url) =>
      url === SOCIAL.linkedin.token
        ? Response.json({ access_token: "li", expires_in: 5_184_000 })
        : url.endsWith("/v2/userinfo")
          ? Response.json({ sub: "m1", name: "Amy" })
          : undefined,
    );
    const l = await landCode(fetch, "linkedin", APP, {
      code: "c",
      redirect: "r",
      verifier: null,
      now: NOW,
    });
    expect(l.stored.kind).toBe("access");
    expect(l.expiresAt?.toISOString()).toBe("2026-12-06T12:00:00.000Z");
  });

  it("YouTube's @handle is stored bare", async () => {
    const { fetch } = fakeFetch((url) =>
      url === SOCIAL.youtube.token
        ? Response.json({ access_token: "y", refresh_token: "yr", expires_in: 3600 })
        : url.includes("/youtube/v3/channels")
          ? Response.json({
              items: [{ id: "UC1", snippet: { title: "Acme", customUrl: "@acme" } }],
            })
          : undefined,
    );
    const l = await landCode(fetch, "youtube", APP, {
      code: "c",
      redirect: "r",
      verifier: null,
      now: NOW,
    });
    expect(l).toMatchObject({ externalId: "UC1", name: "Acme", handle: "acme" });
  });

  it("a LinkedIn company page: the first page the member admins, its year-long refresh", async () => {
    const { fetch, asked } = fakeFetch((url) =>
      url === SOCIAL.linkedin_page.token
        ? Response.json({
            access_token: "lp",
            expires_in: 5_184_000,
            refresh_token: "lr",
            refresh_token_expires_in: 31_536_000,
          })
        : url.includes("/rest/organizationAcls")
          ? Response.json({ elements: [{ organization: "urn:li:organization:5" }] })
          : url.endsWith("/rest/organizations/5")
            ? Response.json({ localizedName: "Acme Co", vanityName: "acme" })
            : undefined,
    );
    const l = await landCode(fetch, "linkedin_page", APP, {
      code: "c",
      redirect: "r",
      verifier: null,
      now: NOW,
    });
    expect(l).toMatchObject({
      externalId: "5",
      name: "Acme Co",
      handle: "acme",
      stored: { kind: "refresh", refresh: "lr" },
      extra: { orgUrn: "urn:li:organization:5" },
    });
    expect(l.expiresAt?.toISOString()).toBe("2027-10-07T12:00:00.000Z");
    const h = asked[1]?.init?.headers as Record<string, string> | undefined;
    expect(h?.["LinkedIn-Version"]).toBeTruthy();
  });

  it("a LinkedIn member who admins no page is told so", async () => {
    const { fetch } = fakeFetch((url) =>
      url === SOCIAL.linkedin_page.token
        ? Response.json({ access_token: "lp", refresh_token: "lr" })
        : url.includes("/rest/organizationAcls")
          ? Response.json({ elements: [] })
          : undefined,
    );
    await expect(
      landCode(fetch, "linkedin_page", APP, { code: "c", redirect: "r", verifier: null, now: NOW }),
    ).rejects.toThrow(/admin of a LinkedIn company page/);
  });

  it("a Business Profile lands on its account's first location", async () => {
    const { fetch } = fakeFetch((url) =>
      url === SOCIAL.google_business.token
        ? Response.json({ access_token: "g", refresh_token: "gr", expires_in: 3600 })
        : url.endsWith("/v1/accounts")
          ? Response.json({ accounts: [{ name: "accounts/1", accountName: "Acme" }] })
          : url.includes("/accounts/1/locations?")
            ? Response.json({ locations: [{ name: "locations/2", title: "Acme Downtown" }] })
            : undefined,
    );
    const l = await landCode(fetch, "google_business", APP, {
      code: "c",
      redirect: "r",
      verifier: "v",
      now: NOW,
    });
    expect(l).toMatchObject({
      externalId: "accounts/1/locations/2",
      name: "Acme Downtown",
      extra: { location: "accounts/1/locations/2" },
    });
  });

  it("a refusal never carries the body", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json(
        { error: "invalid_grant", error_description: "bad code", access_token: SECRET },
        { status: 400 },
      ),
    );
    const err = await landCode(fetch, "youtube", APP, {
      code: "c",
      redirect: "r",
      verifier: "v",
      now: NOW,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).revoked).toBe(true);
    expect((err as Error).message).toBe("invalid_grant: bad code");
    expect(String((err as Error).message)).not.toContain(SECRET);
  });
});

describe("refreshToken", () => {
  it("a Page token needs none; LinkedIn's lapse says connect again", async () => {
    const { fetch, asked } = fakeFetch(() => undefined);
    expect(
      await refreshToken(fetch, "facebook", APP, { kind: "page", page: "p" }, NOW),
    ).toMatchObject({ access: "p", stored: null });
    await expect(
      refreshToken(
        fetch,
        "linkedin",
        APP,
        { kind: "access", access: "a", expiresAt: "2026-10-01T00:00:00Z" },
        NOW,
      ),
    ).rejects.toMatchObject({ revoked: true, code: "expired" });
    expect(asked).toHaveLength(0);
  });

  it("X rotates: the new refresh token is the one to keep", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 7200 }),
    );
    const t = await refreshToken(fetch, "x", APP, { kind: "refresh", refresh: "r1" }, NOW);
    expect(t).toEqual({
      access: "a2",
      expiresIn: 7200,
      stored: { kind: "refresh", refresh: "r2" },
    });
  });

  it("Meta's code 190 is a revoked token", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ error: { code: 190, message: "Session expired" } }, { status: 400 }),
    );
    await expect(whoAmI(fetch, "facebook", "t", { pageId: "p1" })).rejects.toMatchObject({
      revoked: true,
    });
  });
});

const conn = (
  over: Partial<SocialConnectionRow> & Pick<SocialConnectionRow, "platform">,
): SocialConnectionRow => ({
  id: 7,
  client: "acme",
  accountId: 1,
  externalId: "e1",
  name: "Acme",
  handle: null,
  scopes: "",
  tokenRef: "ks_x",
  expiresAt: null,
  extra: {},
  state: "connected",
  why: null,
  connectedAt: NOW,
  checkedAt: NOW,
  by: "amy@acme.example",
  ...over,
});

describe("platformStates", () => {
  const all = { meta: APP, linkedin: APP, google: APP, x: APP, tiktok: APP };
  const of = (v: ReturnType<typeof platformStates>, p: string) => {
    const r = v.find((x) => x.platform === p);
    if (!r) throw new Error(p);
    return r;
  };

  it("no app: Needs setup, Connect off", () => {
    const v = platformStates([], { apps: {}, live: liveFrom(""), ready: true, now: NOW });
    expect(of(v, "x")).toMatchObject({
      state: "not_connected",
      blocking: "Needs setup: Wren's X app",
      may: { connect: false },
    });
  });

  it("under review: testers may connect where the platform allows it; GBP may not", () => {
    const v = platformStates([], { apps: all, live: liveFrom(""), ready: true, now: NOW });
    expect(of(v, "facebook")).toMatchObject({
      state: "waiting_review",
      blocking: SOCIAL.facebook.review,
      today: SOCIAL.facebook.before,
      may: { connect: true },
    });
    expect(of(v, "google_business").may.connect).toBe(false);
    expect(of(v, "x")).toMatchObject({ state: "not_connected", blocking: null, today: null });
  });

  it("connected, broken, and a LinkedIn sign-in near its end", () => {
    const v = platformStates(
      [
        conn({ platform: "x" }),
        conn({ id: 8, platform: "facebook", state: "broken", why: "Access was taken back." }),
        conn({ id: 9, platform: "linkedin", expiresAt: new Date(NOW.getTime() + 2 * 86_400_000) }),
      ],
      { apps: all, live: liveFrom("facebook"), ready: true, now: NOW },
    );
    expect(of(v, "x").state).toBe("connected");
    expect(of(v, "facebook")).toMatchObject({
      state: "broken",
      blocking: "Access was taken back.",
    });
    expect(of(v, "linkedin").connections[0]?.expiring).toBe(true);
  });

  it("without the key store or origin: In development", () => {
    const v = platformStates([], { apps: all, live: liveFrom(""), ready: false, now: NOW });
    expect(of(v, "x").blocking).toMatch(/^In development/);
    expect(of(v, "x").may.connect).toBe(false);
  });
});

describe("socialSites", () => {
  const sites = (row: SocialConnectionRow, route: Route) => {
    const f = fakeFetch(route);
    const broken: string[] = [];
    const slept: number[] = [];
    const client = socialSites({
      connection: async (id) => (id === row.id ? row : null),
      tokenOf: async () => SECRET,
      broke: async (_id, why) => {
        broken.push(why);
      },
      fetch: f.fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    return { client, asked: f.asked, broken, slept };
  };

  it("an X video goes up in chunks, then waits while X processes it", async () => {
    const row = conn({ platform: "x" });
    const size = X_CHUNK + 10;
    let checks = 0;
    const { client, asked, slept } = sites(row, (url) => {
      if (url === "https://cdn.test/v.mp4")
        return new Response(new Uint8Array(size), { headers: { "content-type": "video/mp4" } });
      if (url.endsWith("/2/media/upload/initialize")) return Response.json({ data: { id: "m1" } });
      if (url.endsWith("/2/media/upload/m1/append")) return new Response(null, { status: 204 });
      if (url.endsWith("/2/media/upload/m1/finalize"))
        return Response.json({
          data: { id: "m1", processing_info: { state: "pending", check_after_secs: 3 } },
        });
      if (url.includes("command=STATUS")) {
        checks += 1;
        return Response.json({
          data: {
            id: "m1",
            processing_info:
              checks < 2 ? { state: "in_progress", check_after_secs: 1 } : { state: "succeeded" },
          },
        });
      }
      return undefined;
    });
    const out = await client.call<{ data: { id: string } }>(
      "x",
      "POST",
      "/2/media/upload",
      { file: "https://cdn.test/v.mp4" },
      "social:7",
    );
    expect(out).toEqual({ data: { id: "m1" } });
    const init = asked.find((a) => a.url.endsWith("/initialize"));
    expect(JSON.parse(String(init?.init?.body))).toEqual({
      media_type: "video/mp4",
      total_bytes: size,
      media_category: "tweet_video",
    });
    const appends = asked.filter((a) => a.url.endsWith("/append"));
    const form = (i: number) => appends[i]?.init?.body as FormData;
    expect(appends.map((_, i) => form(i).get("segment_index"))).toEqual(["0", "1"]);
    expect((form(1).get("media") as Blob).size).toBe(10);
    expect(slept).toEqual([3000, 1000]);
    expect(checks).toBe(2);
  });

  it("an X video that fails processing is refused", async () => {
    const row = conn({ platform: "x" });
    const { client } = sites(row, (url) => {
      if (url === "https://cdn.test/v.mp4")
        return new Response(new Uint8Array(5), { headers: { "content-type": "video/mp4" } });
      if (url.endsWith("/initialize")) return Response.json({ data: { id: "m2" } });
      if (url.endsWith("/append")) return new Response(null, { status: 204 });
      if (url.endsWith("/finalize"))
        return Response.json({ data: { id: "m2", processing_info: { state: "failed" } } });
      return undefined;
    });
    await expect(
      client.call("x", "POST", "/2/media/upload", { file: "https://cdn.test/v.mp4" }, "social:7"),
    ).rejects.toThrow(/could not process/);
  });

  it("TikTok's missing scope is a 403 and the connection stays", async () => {
    const row = conn({ platform: "tiktok" });
    const { client, broken } = sites(row, () =>
      Response.json(
        { error: { code: "scope_not_authorized", message: "needs user.info.stats" } },
        { status: 401 },
      ),
    );
    const err = await client
      .call("tiktok", "GET", "/v2/user/info/", { fields: "follower_count" }, "social:7")
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(403);
    expect(broken).toEqual([]);
  });

  it("Meta answers its own Page for /me/accounts and reads Graph with a query", async () => {
    const row = conn({ platform: "instagram", extra: { pageId: "p2", igUserId: "ig9" } });
    const { client, asked } = sites(row, (url) =>
      url.startsWith("https://graph.facebook.com/") ? Response.json({ data: [] }) : undefined,
    );
    const me = await client.call<{ data: { id: string }[] }>(
      "meta",
      "GET",
      "/me/accounts",
      {},
      "social:7",
    );
    expect(me.data[0]).toMatchObject({ id: "p2", instagram_business_account: { id: "ig9" } });
    await client.call("meta", "GET", "/ig9/media", { fields: "id" }, "social:7");
    expect(asked[0]?.url).toBe("https://graph.facebook.com/v23.0/ig9/media?fields=id");
    expect((asked[0]?.init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      `Bearer ${SECRET}`,
    );
  });

  it("a 401 breaks the connection and the error carries no token", async () => {
    const row = conn({ platform: "x" });
    const { client, broken } = sites(row, () =>
      Response.json({ title: "Unauthorized", token: SECRET }, { status: 401 }),
    );
    const err = await client
      .call("x", "POST", "/2/tweets", { text: "hi" }, "social:7")
      .catch((e: unknown) => e);
    expect(String(err)).not.toContain(SECRET);
    expect(broken).toEqual(["Access was taken back. Connect it again."]);
  });

  it("LinkedIn's new post id comes from its header", async () => {
    const row = conn({ platform: "linkedin" });
    const { client, asked } = sites(
      row,
      () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:1" } }),
    );
    const out = await client.call<{ id: string }>(
      "linkedin",
      "POST",
      "/rest/posts",
      {},
      "social:7",
    );
    expect(out.id).toBe("urn:li:share:1");
    expect(
      (asked[0]?.init?.headers as Record<string, string> | undefined)?.["LinkedIn-Version"],
    ).toBeTruthy();
  });

  it("LinkedIn's /upload initializes, fetches the file and PUTs its bytes", async () => {
    const row = conn({ platform: "linkedin" });
    const { client, asked } = sites(row, (url) =>
      url.includes("action=initializeUpload")
        ? Response.json({
            value: { uploadUrl: "https://up.example/x", document: "urn:li:document:9" },
          })
        : url === "https://files.example/a.pdf"
          ? new Response("%PDF", { headers: { "content-type": "application/pdf" } })
          : url === "https://up.example/x"
            ? new Response(null, { status: 201 })
            : undefined,
    );
    const out = await client.call<{ urn: string }>(
      "linkedin",
      "POST",
      "/upload",
      { kind: "document", owner: "urn:li:person:1", file: "https://files.example/a.pdf" },
      "social:7",
    );
    expect(out.urn).toBe("urn:li:document:9");
    expect(asked.map((a) => a.url)).toEqual([
      "https://files.example/a.pdf",
      "https://api.linkedin.com/rest/documents?action=initializeUpload",
      "https://up.example/x",
    ]);
    expect(asked[2]?.init?.method).toBe("PUT");
  });

  it("LinkedIn's /upload of a video PUTs each part, finalizes by ETags, waits until ready", async () => {
    const row = conn({ platform: "linkedin" });
    const { client, asked } = sites(row, (url) =>
      url.includes("rest/videos?action=initializeUpload")
        ? Response.json({
            value: {
              video: "urn:li:video:5",
              uploadToken: "t",
              uploadInstructions: [
                { uploadUrl: "https://up.example/1", firstByte: 0, lastByte: 1 },
                { uploadUrl: "https://up.example/2", firstByte: 2, lastByte: 3 },
              ],
            },
          })
        : url === "https://files.example/v.mp4"
          ? new Response("abcd", { headers: { "content-type": "video/mp4" } })
          : url.startsWith("https://up.example/")
            ? new Response(null, { status: 200, headers: { etag: `e${url.slice(-1)}` } })
            : url.includes("action=finalizeUpload")
              ? new Response(null, { status: 200 })
              : url.endsWith("urn%3Ali%3Avideo%3A5")
                ? Response.json({ status: "AVAILABLE" })
                : undefined,
    );
    const out = await client.call<{ urn: string }>(
      "linkedin",
      "POST",
      "/upload",
      { kind: "video", owner: "urn:li:person:1", file: "https://files.example/v.mp4" },
      "social:7",
    );
    expect(out.urn).toBe("urn:li:video:5");
    const fin = asked.find((a) => a.url.includes("finalizeUpload"));
    expect(JSON.parse(String(fin?.init?.body)).finalizeUploadRequest.uploadedPartIds).toEqual([
      "e1",
      "e2",
    ]);
    expect(asked.filter((a) => a.url.startsWith("https://up.example/"))).toHaveLength(2);
  });

  it("a Business Profile reaches only its own location", async () => {
    const row = conn({
      platform: "google_business",
      externalId: "accounts/1/locations/2",
      extra: { location: "accounts/1/locations/2" },
    });
    const { client, asked } = sites(row, (url) =>
      url.startsWith("https://mybusiness.googleapis.com/")
        ? Response.json({ reviews: [] })
        : undefined,
    );
    await client.call(
      "google_business",
      "GET",
      "/v4/accounts/1/locations/2/reviews",
      { pageSize: 50 },
      "social:7",
    );
    expect(asked[0]?.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews?pageSize=50",
    );
    const err = await client
      .call("google_business", "GET", "/v4/accounts/1/locations/3/reviews", {}, "social:7")
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);
    expect(asked).toHaveLength(1);
  });

  it("refuses a broken or unknown account before any call", async () => {
    const row = conn({ platform: "x", state: "broken", why: "Its sign-in ran out." });
    const { client, asked } = sites(row, () => Response.json({}));
    await expect(client.call("x", "GET", "/2/users/me", {}, "social:7")).rejects.toThrow(/ran out/);
    await expect(client.call("x", "GET", "/2/users/me", {}, "x@wren")).rejects.toThrow(
      /no connected account/,
    );
    expect(asked).toHaveLength(0);
  });
});

describe("socialAppsFrom", () => {
  it("takes an app from env, needing both halves", async () => {
    const apps = await socialAppsFrom(null, {
      WREN_SOCIAL_META_CLIENT_ID: "meta-id",
      WREN_SOCIAL_META_CLIENT_SECRET: "meta-secret",
      WREN_SOCIAL_X_CLIENT_ID: "x-id",
      WREN_SOCIAL_TIKTOK_CLIENT_SECRET: " ",
    })();
    expect(apps).toEqual({ meta: { id: "meta-id", secret: "meta-secret" } });
  });
});
