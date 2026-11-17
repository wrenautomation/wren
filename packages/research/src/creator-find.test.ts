import { describe, expect, it } from "vitest";
import {
  applyPick,
  autoTracks,
  candidatesOf,
  type FindHit,
  findInputKey,
  findQueries,
  nameKey,
  nameOfTitle,
  profileLink,
} from "./creator-find.js";

// shapes of the 11-16 measure run (01M7KDJGQX6F3YAF1GT0YFY0AC), on a made-up person
const s = (url: string, title: string, ...sources: string[]): FindHit => ({
  url,
  title,
  sources: sources.length ? sources : ["searxng"],
});
const HITS: FindHit[] = [
  s("https://www.youtube.com/@danareyes", "Dana Reyes - YouTube"),
  s("https://www.youtube.com/@DanaReyes", "Dana Reyes - YouTube", "searxng", "exa"),
  s("https://www.youtube.com/playlist?list=PLx", "The Show w/ Dana Reyes - YouTube"),
  s("https://www.youtube.com/@Reyes-en-Espa%C3%B1ol", "Dana Reyes en Español - YouTube"),
  s("https://www.youtube.com/@DailyDanaReyes", "Daily Dana Reyes - YouTube"),
  s("https://www.youtube.com/@DanaReyes/videos", "Dana Reyes - YouTube"),
  s("https://www.tiktok.com/@dreyes", "Dana Reyes (@dreyes) | TikTok"),
  s("https://www.tiktok.com/@dreyes?lang=en", "Dana Reyes (@dreyes)"),
  s("https://www.tiktok.com/@danareyes", "dana fan (@danareyes) | TikTok"),
  s(
    "https://shop.tiktok.com/us/pdp/dana-reyes-book/1",
    "Dana Reyes Book - TikTok Shop",
    "perplexity",
  ),
  s("https://notes.tiktok.com/@someone/76", "Why systems win", "perplexity"),
  s("https://www.tiktok.com/discover/dana-reyes", "Dana Reyes | TikTok", "exa"),
  s(
    "https://www.instagram.com/reyes/",
    "Dana Reyes (@reyes) • Instagram photos and videos",
    "searxng",
    "perplexity",
  ),
  s("https://www.instagram.com/reyes/reels/", "Dana Reyes (@reyes) • Instagram photos and videos"),
  s(
    "https://instagram.com/Reyes",
    "Dana Reyes (@Reyes) • Instagram photos and videos",
    "perplexity",
  ),
  s(
    "https://www.instagram.com/lenareyes/",
    "Lena Reyes (@lenareyes) • Instagram photos and videos",
  ),
  s(
    "https://www.instagram.com/danareyes_/reels/",
    "Dana Reyez (@danareyes_) • Instagram",
    "perplexity",
  ),
  s(
    "https://www.instagram.com/popular/danareyes/",
    "danareyes • 320K reels on Instagram",
    "perplexity",
  ),
  s("https://www.instagram.com/p/ABC123/", "Dana Reyes on Instagram: a post"),
  s("https://x.com/danareyes", "Dana Reyes (@DanaReyes) / X"),
  s("https://x.com/DanaReyes/reposts", "Reposts by Dana Reyes (@DanaReyes) / X"),
  s("https://x.com/DanaReyes/status/123", "Dana Reyes on X: a post"),
  s(
    "https://www.linkedin.com/in/danareyes",
    "Dana Reyes - Acquire Co | LinkedIn",
    "searxng",
    "perplexity",
  ),
  s("https://in.linkedin.com/in/dana-reyes-532", "Dana Reyes - Sales at Somewhere | LinkedIn"),
  s("https://www.linkedin.com/posts/danareyes_x-activity-1", "Dana Reyes on LinkedIn", "exa"),
  s("https://www.threads.net/@reyes", "Dana Reyes (@reyes) • Threads, Say more", "perplexity"),
  s("https://www.threads.net/@forbes", "Forbes (@forbes) • Threads, Say more", "perplexity"),
  s("https://www.threads.net/@someone/post/Dd/embed", "Threads"),
  s("https://www.threads.net/data/manifest.json", "www.threads.net", "perplexity"),
  s("https://example.com/dana-reyes", "Dana Reyes - Wiki"),
];
const API: FindHit = {
  url: "https://www.youtube.com/@danareyes",
  name: "Dana Reyes",
  followers: 4_650_000,
  sources: ["youtube-api"],
};

describe("findInputKey", () => {
  it("normalizes a name and a link", () => {
    expect(findInputKey("  Dana   Reyes ")).toBe("dana reyes");
    expect(findInputKey("https://www.Instagram.com/Reyes/?hl=en")).toBe("instagram.com/reyes");
    expect(findInputKey("www.x.com/danareyes/")).toBe("x.com/danareyes");
  });
});

describe("nameOfTitle", () => {
  it("takes the text before the first separator", () => {
    expect(nameOfTitle("Dana Reyes (@reyes) • Instagram photos and videos")).toBe("Dana Reyes");
    expect(nameOfTitle("Dana Reyes - YouTube")).toBe("Dana Reyes");
    expect(nameOfTitle("Dana Reyes (@DanaReyes) / X")).toBe("Dana Reyes");
    expect(nameOfTitle("Dana Reyes - Acquire Co | LinkedIn")).toBe("Dana Reyes");
    expect(nameOfTitle("Dana Reyes")).toBe("Dana Reyes");
    expect(nameOfTitle("Jean-Luc Picard - YouTube")).toBe("Jean-Luc Picard");
    expect(nameOfTitle("")).toBeNull();
  });
});

describe("nameKey", () => {
  it("keeps letters and digits, single spaces", () => {
    expect(nameKey(" Dana  Reyes! ")).toBe("dana reyes");
    expect(nameKey("José Núñez")).toBe("josé núñez");
    expect(nameKey("danareyes")).not.toBe(nameKey("Dana Reyes"));
  });
});

describe("profileLink", () => {
  it("takes profile pages and their tabs only", () => {
    expect(profileLink("https://www.youtube.com/@DanaReyes/videos")?.handle).toBe("@danareyes");
    expect(profileLink("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(profileLink("https://www.youtube.com/playlist?list=PLx")).toBeNull();
    expect(profileLink("https://www.tiktok.com/@dreyes?lang=en")).toMatchObject({
      platform: "tiktok",
      handle: "dreyes",
    });
    expect(profileLink("https://www.tiktok.com/@dreyes/video/1")).toBeNull();
    expect(profileLink("https://shop.tiktok.com/us/pdp/x/1")).toBeNull();
    expect(profileLink("https://notes.tiktok.com/@someone/76")).toBeNull();
    expect(profileLink("https://www.instagram.com/popular/danareyes/")).toBeNull();
    expect(profileLink("https://www.instagram.com/p/ABC/")).toBeNull();
    expect(profileLink("https://x.com/DanaReyes/status/1")).toBeNull();
    expect(profileLink("https://twitter.com/DanaReyes")).toMatchObject({ platform: "x" });
    expect(profileLink("https://in.linkedin.com/in/dana-reyes-532")?.platform).toBe("linkedin");
    expect(profileLink("https://www.linkedin.com/company/acme")).toBeNull();
    expect(profileLink("https://www.threads.net/@reyes")?.url).toBe(
      "https://www.threads.com/@reyes",
    );
    expect(profileLink("https://www.threads.net/@someone/post/Dd")).toBeNull();
    expect(profileLink("not a url at all")).toBeNull();
  });
});

describe("candidatesOf", () => {
  const cands = candidatesOf([...HITS, API]);
  it("keeps one per platform and handle, sources merged", () => {
    const keys = cands.map((c) => `${c.platform}:${c.handle}`);
    expect(keys).toEqual([
      "youtube:@danareyes",
      "youtube:@reyes-en-español",
      "youtube:@dailydanareyes",
      "tiktok:dreyes",
      "tiktok:danareyes",
      "instagram:reyes",
      "instagram:lenareyes",
      "instagram:danareyes_",
      "x:danareyes",
      "linkedin:danareyes",
      "linkedin:dana-reyes-532",
      "threads:reyes",
      "threads:forbes",
    ]);
    const yt = cands[0];
    expect(yt?.sources.sort()).toEqual(["exa", "searxng", "youtube-api"]);
    expect(yt?.followers).toBe(4_650_000);
    expect(yt?.name).toBe("Dana Reyes");
  });
  it("one query per platform, pinned to its site", () => {
    expect(findQueries("Dana Reyes").map((q) => q.site)).toEqual([
      "youtube.com",
      "tiktok.com",
      "instagram.com",
      "x.com",
      "linkedin.com",
      "threads.net",
    ]);
  });
});

describe("autoTracks (D3)", () => {
  const cands = candidatesOf([...HITS, API]);
  const allMain = applyPick(cands, {
    labels: cands.map((_, i) => ({ i, label: "main" as const, why: "test" })),
  });
  it("on the replay: exactly the five named main accounts, even with every label main", () => {
    expect(autoTracks(allMain, "Dana Reyes").map((c) => `${c.platform}:${c.handle}`)).toEqual([
      "youtube:@danareyes",
      "tiktok:dreyes",
      "instagram:reyes",
      "x:danareyes",
      "threads:reyes",
    ]);
  });
  it("needs the label main", () => {
    const alt = allMain.map((c) =>
      c.platform === "x" ? { ...c, label: "alternate" as const } : c,
    );
    expect(autoTracks(alt, "Dana Reyes").some((c) => c.platform === "x")).toBe(false);
  });
  it("never by handle: a stranger's handle that spells the name fails", () => {
    const tt = allMain.find((c) => c.handle === "danareyes" && c.platform === "tiktok");
    expect(tt?.name).toBe("dana fan");
    expect(autoTracks([tt as never], "Dana Reyes")).toEqual([]);
  });
  it("two on one platform: YouTube takes the larger, elsewhere neither", () => {
    const two = [
      { ...allMain[0], handle: "@a", name: "Dana Reyes", followers: 10 },
      { ...allMain[0], handle: "@b", name: "Dana Reyes", followers: 900 },
      { ...allMain[5], handle: "a", name: "Dana Reyes" },
      { ...allMain[5], handle: "b", name: "Dana Reyes" },
    ] as typeof allMain;
    expect(autoTracks(two, "Dana Reyes").map((c) => c.handle)).toEqual(["@b"]);
    const tie = two.slice(0, 2).map((c) => ({ ...c, followers: null }));
    expect(autoTracks(tie, "Dana Reyes")).toEqual([]);
  });
  it("LinkedIn never tracks itself", () => {
    expect(autoTracks(allMain, "Dana Reyes").some((c) => c.platform === "linkedin")).toBe(false);
  });
});
