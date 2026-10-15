import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { findCreators, handleIn, markFollowed, sameAddress } from "./creator-search.js";

type Route = (input: Record<string, unknown>, account?: string) => unknown;
const sitesOf = (routes: Record<string, Route>) => {
  const calls: { site: string; path: string; account: string | undefined }[] = [];
  const sites: SiteClient = {
    call: async <T>(
      site: string,
      _method: string,
      path: string,
      input: Record<string, unknown> = {},
      account?: string,
    ) => {
      calls.push({ site, path, account });
      const r = routes[`${site} ${path}`];
      if (!r) throw new Error(`no route ${site} ${path}`);
      return r(input, account) as T;
    },
    via: async () => "api",
  };
  return { sites, calls };
};

const exa = (urls: [string, string][]) => () => ({
  hits: urls.map(([url, title]) => ({ url, title, snippet: `about ${title}` })),
});

describe("creator search", () => {
  it("one hit shape from every site; a failed site says why, the rest answer", async () => {
    const { sites, calls } = sitesOf({
      "youtube /youtube/v3/search": () => ({
        items: [{ id: { channelId: "UC1" }, snippet: { title: "Synthetic Channel" } }],
      }),
      "youtube /youtube/v3/channels": () => ({
        items: [
          {
            id: "UC1",
            snippet: { customUrl: "@synthetic" },
            statistics: { subscriberCount: "1200" },
          },
        ],
      }),
      "reddit-public /subreddits/search": () => ({
        data: {
          children: [
            { data: { display_name: "SyntheticSub", subreddit_type: "public", subscribers: 900 } },
            { data: { display_name: "Private", subreddit_type: "private" } },
          ],
        },
      }),
      "linkedin /search/results/people": () => ({
        people: [{ name: "Pat Synthetic", vanity: "pat-synthetic", url: "x", headline: "Founder" }],
      }),
      "web /search": (q) =>
        String(q.q).startsWith("site:linkedin.com")
          ? exa([
              ["https://www.linkedin.com/company/synthetic-co/", "Synthetic Co | LinkedIn"],
              ["https://www.linkedin.com/posts/someone_activity-1-x", "a post"],
            ])()
          : exa([["https://www.tiktok.com/@synthtok/video/1", "Synth Tok | TikTok"]])(),
      "web /google": () => ({
        results: [
          {
            site: "Instagram · synthetic.ig",
            url: "https://www.instagram.com/p/ABC/",
            snippet: "s",
          },
          { site: "Instagram", url: "https://www.instagram.com/other.ig/", snippet: "o" },
        ],
      }),
      "meta /instagram/other.ig": () => ({
        found: true,
        profile: { username: "other.ig", name: "Other IG", followers_count: 50 },
      }),
      "x /2/tweets/search/recent": () => {
        throw new Error("x: 429");
      },
      "meta /instagram/synthetic": () => ({ found: false }),
    });
    const out = await findCreators(sites, "synthetic", {
      accounts: { linkedin: "linkedin@wren", x: "x@wren" },
    });
    expect(out.hits.map((h) => [h.site, h.handle, h.follow])).toEqual([
      ["youtube", "@synthetic", "https://www.youtube.com/feeds/videos.xml?channel_id=UC1"],
      ["reddit", "r/SyntheticSub", "https://www.reddit.com/r/SyntheticSub/.rss"],
      ["linkedin", "company/synthetic-co", "https://www.linkedin.com/company/synthetic-co/"],
      ["linkedin", "in/pat-synthetic", "https://www.linkedin.com/in/pat-synthetic/"],
      ["instagram", "@synthetic.ig", "https://www.instagram.com/synthetic.ig/"],
      ["instagram", "@other.ig", "https://www.instagram.com/other.ig/"],
      ["tiktok", "@synthtok", "https://www.tiktok.com/@synthtok"],
    ]);
    expect(out.hits.find((h) => h.site === "youtube")?.followers).toBe(1200);
    // A video's title names the video, so the account goes by its handle.
    expect(out.hits.find((h) => h.site === "tiktok")?.name).toBe("synthtok");
    // Discovery can't read @synthetic.ig: it still shows, from Google's words.
    expect(
      out.hits.filter((h) => h.site === "instagram").map((h) => [h.name, h.followers, h.about]),
    ).toEqual([
      ["synthetic.ig", null, "s"],
      ["Other IG", 50, "o"],
    ]);
    expect(out.failed).toEqual([{ site: "x", why: "x: 429" }]);
    expect(calls.find((c) => c.path === "/search/results/people")?.account).toBe("linkedin@wren");
  });

  it("a used X search cap says when it resets", async () => {
    const { sites } = sitesOf({
      "x /2/tweets/search/recent": () => {
        throw new SiteCallError(
          "x",
          "GET",
          "/2/tweets/search/recent",
          429,
          "search cap is used (50/50 today); retry after 9000s",
        );
      },
    });
    const out = await findCreators(sites, "words", { only: ["x"], accounts: { x: "x@wren" } });
    expect(out.failed).toEqual([{ site: "x", why: "today's x search cap is used; back in 3h" }]);
  });

  it("no X account: X is skipped with the reason; `only` picks sites", async () => {
    const { sites, calls } = sitesOf({});
    const out = await findCreators(sites, "words", { only: ["x"] });
    expect(out).toEqual({
      hits: [],
      failed: [{ site: "x", why: "no X account is set (Shop → X comments)" }],
    });
    expect(calls).toEqual([]);
  });

  it("X from the page leg: no follower counts, so authors rank by their posts' views", async () => {
    const { sites } = sitesOf({
      "x /2/tweets/search/recent": () => ({
        data: [
          { author_username: "small", public_metrics: { impression_count: 40 } },
          { author_username: "Big", public_metrics: { impression_count: 900 } },
          { author_username: "small", public_metrics: { impression_count: 30 } },
        ],
        includes: {
          users: [
            { username: "small", name: "Small" },
            { username: "Big", name: "Big One" },
          ],
        },
      }),
    });
    const out = await findCreators(sites, "words", { only: ["x"], accounts: { x: "x@wren" } });
    expect(out.hits.map((h) => [h.handle, h.followers])).toEqual([
      ["@Big", null],
      ["@small", null],
    ]);
  });

  it("marks what's followed: Learn's addresses, LinkedIn's comment pages", () => {
    const hit = {
      name: "n",
      about: null,
      followers: null,
      avatar: null,
    };
    const marked = markFollowed(
      [
        { ...hit, site: "x", handle: "@a", url: "https://x.com/a", follow: "https://x.com/a" },
        { ...hit, site: "x", handle: "@b", url: "https://x.com/b", follow: "https://x.com/b" },
        {
          ...hit,
          site: "linkedin",
          handle: "company/acme",
          url: "https://www.linkedin.com/company/acme/",
          follow: "https://www.linkedin.com/company/acme/",
        },
      ],
      ["https://X.com/a/"],
      ["acme"],
    );
    expect(marked.map((m) => m.followed)).toEqual([true, false, true]);
    expect(sameAddress("https://www.Reddit.com/r/x/")).toBe("reddit.com/r/x");
    expect(handleIn("@acme.co")).toBe("acme.co");
    expect(handleIn("recruiting founders")).toBeNull();
  });
});
