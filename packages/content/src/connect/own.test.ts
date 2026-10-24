// Wren's own channels on Account → Social: config into channels, rows into the view, failures in
// plain words, and the Check against a stand-in autobrowse. Synthetic rows; no network, no DB.

import { CONTENT_CHANNELS, ENV_KEYS } from "@wren/config";
import type { Platform } from "@wren/core/content";
import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import type { SocialAccessApi } from "./access.js";
import { socialConsoleApi } from "./console.js";
import {
  checkOwn,
  handleFromUrl,
  handleOf,
  type OwnRows,
  type OwnSites,
  type OwnSwitches,
  ownChannels,
  ownSwitchesOf,
  ownView,
  plainFailure,
  renewalLine,
  scrub,
} from "./own.js";

const ALL: OwnSwitches = {
  channels: ["linkedin", "x", "youtube", "instagram", "facebook", "threads", "tiktok", "reddit"],
  tiktokPostVia: "web",
  instagramGraph: false,
  redditApi: false,
  box: true,
};
const SECRET = "EAAGm0PX4ZCpsBAKZCZBq1x2y3z4abcdef";
const NOW = Date.parse("2026-10-14T12:00:00Z");

const rows = (o: Partial<OwnRows> = {}): OwnRows => ({
  posts: [],
  failures: [],
  days: [],
  renewals: [],
  ...o,
});

/** A stand-in autobrowse: one site row for every site, and a count of who-am-I reads. */
function fakeSites(o: { fail?: Error; via?: "api" | "browser"; probe?: boolean } = {}) {
  const reads: string[] = [];
  const sites: OwnSites = {
    status: async () => ({
      authed: true,
      routes: [
        { method: "GET", path: "/v2/userinfo", via: o.via ?? "api" },
        { method: "POST", path: "/rest/posts", via: "browser" },
      ],
      ...(o.probe === false ? {} : { probe: { path: "/v2/userinfo" } }),
    }),
    read: async (_w, site, path, _i, account) => {
      reads.push(`${site} ${path} ${account ?? "-"}`);
      if (o.fail) throw o.fail;
      return { data: { username: "wren_automation" } };
    },
    renewDry: async () => ({ due: [{ site: "linkedin", expiresAt: "2026-10-20T00:00:00Z" }] }),
    now: async () => NOW,
  };
  return { sites, reads };
}

describe("own channels from config", () => {
  it("lists every configured channel, in order, as the worker wires it", () => {
    const c = ownChannels(ALL);
    expect(c.map((x) => x.platform)).toEqual(ALL.channels);
    const by = Object.fromEntries(c.map((x) => [x.platform, x]));
    expect(by.linkedin).toMatchObject({ site: "linkedin", account: "linkedin@wren", where: "box" });
    expect(by.tiktok).toMatchObject({ via: "browser", switches: ["WREN_TIKTOK_POST_VIA"] });
    expect(by.instagram).toMatchObject({ site: "instagram", via: "browser", tokenless: true });
    expect(by.reddit).toMatchObject({ site: "reddit", where: "desk", tokenless: true });
    expect(by.facebook).toMatchObject({ site: "meta", via: "api" });
  });

  it("follows the switches: TikTok's API, Instagram's Graph, Reddit's own token, the Mac", () => {
    const c = ownChannels({
      ...ALL,
      tiktokPostVia: "api",
      instagramGraph: true,
      redditApi: true,
      box: false,
    });
    const by = Object.fromEntries(c.map((x) => [x.platform, x]));
    expect(by.tiktok?.via).toBe("api");
    expect(by.instagram).toMatchObject({ site: "meta", via: "api", tokenless: false });
    expect(by.reddit).toMatchObject({ site: null, where: "wren", via: "api" });
    expect(by.x?.where).toBe("desk");
  });

  it("reads settings into switches without carrying a value", () => {
    const s = ownSwitchesOf({
      contentChannels: ["x"],
      tiktokPostVia: "web",
      mediaBucket: "bucket",
      metaPageId: "123",
      redditClientId: "id",
      redditClientSecret: SECRET,
      redditRefreshToken: SECRET,
      autobrowseInstanceId: "i-0abc",
    });
    expect(s).toEqual({
      channels: ["x"],
      tiktokPostVia: "web",
      instagramGraph: true,
      // No username: not every Reddit setting is there, so the desk posts.
      redditApi: false,
      box: true,
    });
    expect(JSON.stringify(s)).not.toContain(SECRET);
  });

  it("names only settings that exist", () => {
    const names = new Set<string>(Object.values(ENV_KEYS));
    for (const c of ownChannels({ ...ALL, channels: [...CONTENT_CHANNELS] as Platform[] }))
      for (const n of c.switches) expect(names.has(n), n).toBe(true);
  });
});

describe("plain words", () => {
  it("says what kind of refusal, then the platform's reason", () => {
    expect(plainFailure("linkedin POST /rest/posts: 429 Too Many Requests")).toBe(
      "Too many calls for now (429). Too Many Requests",
    );
    expect(plainFailure("x GET /2/users/me: 401 Unauthorized")).toBe(
      "Sign-in refused (401). The token may have lapsed. Unauthorized",
    );
    expect(plainFailure("503 upstream")).toBe("The platform had a problem (503). upstream");
    expect(plainFailure(null)).toBe("It failed with no reason given.");
  });

  it("never carries anything that looks like a key", () => {
    expect(plainFailure(`meta POST /me/feed: 400 bad token ${SECRET}`)).not.toContain(SECRET);
    expect(scrub(`token=${SECRET}`)).not.toContain(SECRET);
    expect(scrub("a plain sentence, 12 words")).toBe("a plain sentence, 12 words");
  });

  it("reads a handle from a platform's answer or a post's link", () => {
    expect(handleOf({ data: { id: "1", username: "wren_automation" } })).toBe("wren_automation");
    expect(handleOf({ items: [{ snippet: { title: "Wren Automation" } }] })).toBe(
      "Wren Automation",
    );
    expect(handleOf({ firstDegreeSize: 10 })).toBeNull();
    expect(handleFromUrl("https://x.com/wren_automation/status/1")).toBe("wren_automation");
    expect(handleFromUrl("https://www.tiktok.com/@wrenautomation/video/1")).toBe("wrenautomation");
    expect(handleFromUrl("https://www.reddit.com/user/wren_test/comments/x")).toBe("wren_test");
    expect(handleFromUrl("not a url")).toBeNull();
  });

  it("reads renewal lines", () => {
    expect(
      renewalLine("renewed linkedin consent as l***@x.example (was lapsing 2026-10-20)"),
    ).toEqual({ site: "linkedin", ok: true, lapses: null, why: null });
    expect(
      renewalLine("could not renew threads consent (lapses 2026-10-18): 401 consent refused"),
    ).toMatchObject({ site: "threads", ok: false, lapses: "2026-10-18" });
    expect(renewalLine("due: x consent (lapses 2026-10-25)")).toEqual({
      site: "x",
      ok: null,
      lapses: "2026-10-25",
      why: null,
    });
    expect(renewalLine("SOME_TOKEN lapses soon and no setup step makes it")).toBeNull();
  });
});

describe("the view", () => {
  const view = ownView(
    ownChannels({ ...ALL, channels: ["linkedin", "x", "reddit"] }),
    rows({
      posts: [
        {
          platform: "x",
          at: new Date("2026-10-13T10:00:00Z"),
          url: "https://x.com/wren_automation/status/9",
        },
      ],
      failures: [
        {
          platform: "linkedin",
          at: new Date("2026-10-12T09:00:00Z"),
          kind: "post",
          note: `linkedin POST /rest/posts: 401 expired ${SECRET}`,
        },
      ],
      days: [{ platform: "linkedin", raw: { firstDegreeSize: 50 } }],
      renewals: [
        {
          at: new Date("2026-10-14T00:00:00Z"),
          finishedAt: new Date(),
          stats: { lines: [], next: "2026-11-30" },
        },
        {
          at: new Date("2026-10-07T00:00:00Z"),
          finishedAt: new Date(),
          stats: {
            lines: [
              "renewed linkedin consent (was lapsing 2026-10-15)",
              "could not renew x consent (lapses 2026-10-16): 500 browser closed",
            ],
            next: "2026-10-16",
          },
        },
      ],
    }),
    CONTENT_CHANNELS as unknown as Platform[],
  );
  const by = Object.fromEntries(view.channels.map((c) => [c.platform, c]));

  it("shows each channel's last post, failure and renewal", () => {
    expect(by.x?.lastPost?.url).toBe("https://x.com/wren_automation/status/9");
    expect(by.x?.handle).toBe("wren_automation");
    expect(by.x?.token).toMatchObject({ kind: "kept", lapses: "2026-10-16" });
    expect(by.x?.token.renewal).toMatchObject({
      ok: false,
      said: "The platform had a problem (500). browser closed",
    });
    expect(by.linkedin?.token.renewal).toMatchObject({
      ok: true,
      said: "Renewed",
      at: "2026-10-07T00:00:00.000Z",
    });
    expect(by.linkedin?.lastFailure).toMatchObject({ what: "A post" });
    expect(by.linkedin?.login).toBe("linkedin@wren");
    expect(by.reddit?.token.kind).toBe("none");
    expect(view.renewal).toMatchObject({ ok: true, next: "2026-11-30" });
    expect(view.off).toContain("YouTube");
  });

  it("never carries a key", () => {
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it("says when renewal's newest pass failed", () => {
    const v = ownView(
      ownChannels({ ...ALL, channels: ["x"] }),
      rows({
        renewals: [
          {
            at: new Date(NOW),
            finishedAt: new Date(NOW),
            stats: { error: "Error: sites renew refused: 501 nothing lists" },
          },
        ],
      }),
      [],
    );
    expect(v.renewal).toMatchObject({ ok: false });
    expect(v.renewal?.why).toContain("501");
  });
});

describe("the Check", () => {
  const linkedin = ownChannels(ALL).find((c) => c.platform === "linkedin");
  const x = ownChannels(ALL).find((c) => c.platform === "x");
  if (!linkedin || !x) throw new Error("no channels");

  it("runs one who-am-I read as the channel's login", async () => {
    const { sites, reads } = fakeSites();
    const r = await checkOwn(sites, linkedin);
    expect(reads).toEqual(["linkedin /v2/userinfo linkedin@wren"]);
    expect(r).toMatchObject({
      ok: true,
      handle: "wren_automation",
      lapses: "2026-10-20T00:00:00Z",
      routes: { api: 1, browser: 1, none: 0 },
    });
  });

  it("says why in plain words when the read fails", async () => {
    const { sites } = fakeSites({ fail: new Error(`x GET /2/users/me: 401 bad ${SECRET}`) });
    const r = await checkOwn(sites, x);
    expect(r.ok).toBe(false);
    expect(r.said).toMatch(/^Sign-in refused \(401\)/);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("doesn't read when the probe has no API leg, or there is no probe", async () => {
    const noLeg = fakeSites({ via: "browser" });
    expect((await checkOwn(noLeg.sites, x)).ok).toBeNull();
    expect(noLeg.reads).toEqual([]);
    const none = fakeSites({ probe: false });
    expect((await checkOwn(none.sites, x)).said).toMatch(/no sign-in check/);
    expect(none.reads).toEqual([]);
  });

  it("says autobrowse didn't answer when its status fails", async () => {
    const { sites } = fakeSites();
    const r = await checkOwn(
      { ...sites, status: async () => Promise.reject(new Error("no answer in 45 s")) },
      x,
    );
    expect(r).toMatchObject({ ok: false });
    expect(r.said).toMatch(/^Autobrowse on the AWS box didn't answer/);
  });
});

describe("SocialAccess for Wren's own channels", () => {
  const { sites, reads } = fakeSites();
  const api = socialConsoleApi({
    main: {} as Db,
    access: {} as SocialAccessApi,
    own: { switches: ALL, known: [], sites },
  });
  const team = { viewer: { email: "ops@example.test", operator: true }, client: "wren" };

  it("checks for the team, once per call", async () => {
    const r = await api.ownCheck({ ...team, platform: "x", requestId: "r1" });
    expect(r.ok).toBe(true);
    expect(reads).toHaveLength(1);
  });

  it("refuses a client's people, another workspace and a channel Wren doesn't post to", async () => {
    await expect(
      api.ownCheck({ viewer: { email: "amy@acme.example" }, client: "wren", platform: "x" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(api.ownCheck({ ...team, client: "acme", platform: "x" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(api.ownCheck({ ...team, platform: "myspace" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.ownCheck({ ...team, asClient: true, platform: "x" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("shows nothing of its own to a viewer who isn't on the team", async () => {
    const page = await api.social({ viewer: { email: "amy@acme.example" }, client: "wren" });
    expect(page).toMatchObject({ wren: true, own: null, mayAct: false });
  });
});
