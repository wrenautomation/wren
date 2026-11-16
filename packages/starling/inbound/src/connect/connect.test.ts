// Client social access, pure parts: the platform table, the states the page shows and the calls a
// connected account makes. The sign-in's wire (connectUrl, landCode, whoAmI, refreshToken): wire.test.ts.
// Synthetic ids; no network.

import { describe, expect, it } from "vitest";
import { connectionIdOf, loginOf, platformStates, socialAppsFrom, tokenName } from "./access.js";
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

  it("a connection's avatar from its extra; none is null", () => {
    const v = platformStates(
      [
        conn({ platform: "tiktok", extra: { avatarUrl: "https://p16.tiktokcdn.example/a.jpeg" } }),
        conn({ id: 8, platform: "x" }),
      ],
      { apps: all, live: liveFrom("tiktok"), ready: true, now: NOW },
    );
    expect(of(v, "tiktok").connections[0]?.avatarUrl).toBe("https://p16.tiktokcdn.example/a.jpeg");
    expect(of(v, "x").connections[0]?.avatarUrl).toBeNull();
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
